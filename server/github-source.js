/**
 * github-source.js — Serve frontend files from a local git clone.
 *
 * This module clones the Waymark repo (bare) and checks out the public/
 * directory for whichever ref (branch, tag, commit SHA) is active.
 * Switching refs is a local git operation — no GitHub API calls needed
 * after the initial clone and periodic fetches.
 *
 * How it works:
 *   1. On first boot, `git clone --bare` the repo to server/.git-repo/
 *   2. Extract public/ files for the active ref into server/.git-checkout/<ref>/
 *   3. Serve files from disk via Express middleware.
 *   4. Switching refs: `git fetch`, then extract the new ref's public/ files.
 *   5. Periodic `git fetch` keeps the bare repo up-to-date (every 5 min).
 *
 * Configuration (hardcoded in config.js):
 *   GITHUB_OWNER   — repo owner ('tekjanson')
 *   GITHUB_REPO    — repo name  ('Waymark')
 *   GITHUB_REF     — default ref ('main')
 *   GITHUB_TOKEN   — optional PAT for private repos (env var)
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const REPO_DIR = path.join(__dirname, '.git-repo');
const CHECKOUT_DIR = path.join(__dirname, '.git-checkout');

function toSafeRef(ref) {
  return ref.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/* ---------- Ref validation ---------- */

/**
 * Validate a git ref (branch, tag, or SHA) for safe use in shell commands
 * and HTML/JS injection contexts.  Rejects anything that could escape
 * shell quoting, path traversal, or HTML attribute boundaries.
 * @param {string} ref
 * @returns {boolean}
 */
function isValidRef(ref) {
  if (!ref || typeof ref !== 'string') return false;
  if (ref.length > 200) return false;
  // Allow alphanumeric, dot, dash, underscore, slash (for branch names like feature/foo)
  if (!/^[a-zA-Z0-9._\/-]+$/.test(ref)) return false;
  // Git-specific invalid patterns
  if (ref.includes('..') || ref.endsWith('.') || ref.endsWith('/')) return false;
  if (ref.includes('@{') || ref.startsWith('-')) return false;
  return true;
}

/* ---------- Helpers ---------- */

/** MIME types for common frontend assets */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4':  'video/mp4',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Build HTTPS clone URL, optionally embedding a PAT for private repos.
 */
function buildCloneUrl(owner, repo, token) {
  if (token) {
    return `https://${token}@github.com/${owner}/${repo}.git`;
  }
  return `https://github.com/${owner}/${repo}.git`;
}

/**
 * Run a git command inside the bare repo. Returns stdout as a string.
 */
function git(args, opts = {}) {
  const cmd = `git --git-dir="${REPO_DIR}" ${args}`;
  return execSync(cmd, {
    encoding: 'utf-8',
    timeout: opts.timeout || 60000,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

/**
 * Run a git command asynchronously (non-blocking).
 * Returns a promise that resolves with stdout.
 */
function gitAsync(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const cmd = `git --git-dir="${REPO_DIR}" ${args}`;
    exec(cmd, {
      encoding: 'utf-8',
      timeout: opts.timeout || 60000,
      ...opts,
    }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout.trim());
    });
  });
}

/* ---------- Clone / Fetch ---------- */

/**
 * Ensure the bare repo exists. Clone if not, update remote URL if it does.
 */
function ensureRepo(owner, repo, token) {
  const url = buildCloneUrl(owner, repo, token);

  if (fs.existsSync(path.join(REPO_DIR, 'HEAD'))) {
    // Already cloned — update the remote URL in case token changed
    try {
      git(`remote set-url origin "${url}"`);
    } catch { /* ignore if remote doesn't exist yet */ }
    // Bare clones have no fetch refspec by default, so
    // `git fetch origin` silently skips new branches.
    // Ensure the refspec is always configured.
    try {
      git('config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"');
    } catch { /* best-effort */ }
    return;
  }

  console.log(`[github-source] Cloning ${owner}/${repo} (bare)...`);
  fs.mkdirSync(REPO_DIR, { recursive: true });
  execSync(`git clone --bare "${url}" "${REPO_DIR}"`, {
    encoding: 'utf-8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Bare clones omit the fetch refspec — add it so future fetches
  // actually pull new branches into refs/remotes/origin/*.
  try {
    git('config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"');
  } catch { /* best-effort */ }
  console.log(`[github-source] Clone complete.`);
}

/**
 * Fetch latest refs from origin (async, non-blocking).
 */
async function fetchOrigin() {
  try {
    await gitAsync('fetch origin --prune', { timeout: 60000 });
    console.log('[github-source] Fetched latest from origin.');
  } catch (err) {
    console.warn('[github-source] Fetch failed:', err.message);
  }
}

/* ---------- Checkout / Extract ---------- */

/**
 * Resolve a ref (branch name, tag, short SHA) to a full commit SHA.
 * Tries refs/remotes/origin/<ref> first (for branches), then the raw ref
 * (for tags and SHAs).
 */
function resolveRef(ref) {
  if (!isValidRef(ref)) {
    throw new Error(`Invalid ref: ${String(ref).slice(0, 80)}`);
  }
  // Try as a remote branch first
  try {
    return git(`rev-parse "refs/remotes/origin/${ref}"`);
  } catch { /* not a remote branch */ }

  // Try as a tag
  try {
    return git(`rev-parse "refs/tags/${ref}^{}"`);
  } catch { /* not a tag */ }

  // Try as a raw ref (SHA)
  try {
    return git(`rev-parse "${ref}"`);
  } catch {
    throw new Error(`Could not resolve ref: ${ref}`);
  }
}

/**
 * Extract public/ files for a given ref into CHECKOUT_DIR/<safeName>/.
 * Uses `git archive` to extract without a full working tree.
 */
function extractPublicDir(ref) {
  const commitSha = resolveRef(ref);
  const safeRef = toSafeRef(ref);
  const outDir = path.join(CHECKOUT_DIR, safeRef);

  // If already extracted for this exact commit, skip
  const shaMarker = path.join(outDir, '.git-sha');
  const refMarker = path.join(outDir, '.waymark-ref');
  if (fs.existsSync(shaMarker)) {
    try {
      const cached = fs.readFileSync(shaMarker, 'utf-8').trim();
      if (cached === commitSha) {
        if (!fs.existsSync(refMarker)) {
          fs.writeFileSync(refMarker, ref);
        }
        return outDir;
      }
    } catch { /* re-extract */ }
  }

  // Clean and re-extract
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  try {
    // Use git archive to extract just the public/ subtree
    execSync(
      `git --git-dir="${REPO_DIR}" archive "${commitSha}" -- public/ | tar -x -C "${outDir}" --strip-components=1`,
      { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    // Fallback: try without --strip-components (some systems)
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    execSync(
      `git --git-dir="${REPO_DIR}" archive "${commitSha}" -- public/ | tar -x -C "${outDir}"`,
      { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Move public/* up one level
    const nested = path.join(outDir, 'public');
    if (fs.existsSync(nested)) {
      for (const item of fs.readdirSync(nested)) {
        fs.renameSync(path.join(nested, item), path.join(outDir, item));
      }
      fs.rmSync(nested, { recursive: true, force: true });
    }
  }

  // Write SHA marker so we know this extraction is current
  fs.writeFileSync(shaMarker, commitSha);
  fs.writeFileSync(refMarker, ref);
  console.log(`[github-source] Extracted public/ for ${ref} (${commitSha.slice(0, 8)}) -> ${outDir}`);
  return outDir;
}

/* ---------- Main export ---------- */

/**
 * Creates an Express middleware that serves files from a local git clone.
 *
 * @param {object} opts
 * @param {string} opts.owner       — GitHub repo owner
 * @param {string} opts.repo        — GitHub repo name
 * @param {string} opts.ref         — default/server ref (branch, tag, SHA)
 * @param {string} [opts.token]     — optional GitHub PAT for private repos
 * @param {Function} [opts.resolveRef] — (req) => string: per-request ref resolver
 * @returns {{ middleware, setRef, getRef, getContentSha, getContentShaForRef, preWarm, purgeCache, listCachedRefs, readFile }}
 */
function createGitHubSource(opts) {
  const { owner, repo, token } = opts;
  const defaultRef = opts.ref;

  /**
   * Per-ref extracted state.
   * Key: ref string  Value: { publicDir: string, contentSha: string|null }
   * NEVER shared across requests — each user's ref has its own entry here.
   */
  const refState = new Map();

  /** Update the refState entry after extractPublicDir succeeds. */
  function updateRefState(theRef, dir) {
    let sha = null;
    try {
      sha = fs.readFileSync(path.join(dir, '.git-sha'), 'utf-8').trim();
    } catch { /* no marker */ }
    refState.set(theRef, { publicDir: dir, contentSha: sha });
  }

  // Clone the repo (synchronous on first boot, fast on subsequent boots)
  try {
    ensureRepo(owner, repo, token);
  } catch (err) {
    console.error('[github-source] Failed to clone repo:', err.message);
    console.warn('[github-source] Will serve from local public/ only.');
  }

  // Extract public/ for the default ref
  try {
    const dir = extractPublicDir(defaultRef);
    updateRefState(defaultRef, dir);
  } catch (err) {
    console.warn(`[github-source] Could not extract ref "${defaultRef}":`, err.message);
  }

  /* ---------- Middleware ---------- */

  const middleware = (req, res, next) => {
    // Only handle GET/HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // Resolve the ref for THIS specific request — never share state across users.
    // opts.resolveRef reads the user's signed cookies; falls back to the server default.
    const requestRef = (opts.resolveRef ? opts.resolveRef(req) : null) || defaultRef;
    const state = refState.get(requestRef) || refState.get(defaultRef);

    // No checkout available for any ref — fall through to local public/
    if (!state?.publicDir) return next();

    let filePath = req.path;
    if (filePath.startsWith('/')) filePath = filePath.slice(1);
    if (!filePath) filePath = 'index.html';

    // Security: no path traversal
    if (filePath.includes('..') || filePath.includes('\0')) {
      return res.status(400).end();
    }

    // Skip auth, API, and fixture routes
    if (filePath.startsWith('auth/') || filePath.startsWith('api/') || filePath.startsWith('__fixtures')) {
      return next();
    }

    const fullPath = path.join(state.publicDir, filePath);

    // Single stat call — avoids the previous existsSync + statSync double-syscall.
    // Reused for HEAD Content-Length to avoid a second kernel round-trip.
    let fileStat;
    try { fileStat = fs.statSync(fullPath); } catch { return next(); }
    if (fileStat.isDirectory()) return next();

    // Serve the file
    const mime = getMimeType(filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('X-GitHub-Ref', requestRef);
    res.setHeader('X-Served-From', 'github-source');

    // Vary: Cookie — content differs per user's ref cookie.
    // Ensures any caching proxy keys on cookie values, not just URL.
    res.setHeader('Vary', 'Cookie');

    if (filePath.endsWith('.html')) {
      // HTML contains injected runtime config (ref, API key, etc.) — never cache.
      res.setHeader('Cache-Control', 'no-store');
    } else if (filePath.endsWith('.css') || filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
      // JS/CSS: allow ETag-based conditional GET (If-None-Match → 304 Not Modified).
      // res.sendFile() sets ETag from file mtime+size, which changes each time
      // extractPublicDir re-extracts the checkout (i.e., on every ref switch or
      // new push).  This reduces page-refresh CPU from "read+stream 100 files"
      // to "answer 100 tiny 304s" — the primary fix for the per-refresh CPU spike.
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', fileStat.size);
      return res.end();
    }

    res.sendFile(fullPath);
  };

  /* ---------- API ---------- */

  /**
   * Pre-warm a ref: fetch from origin and extract its public/ directory.
   * Does NOT change the server default or affect any other user.
   * Safe to call from any user-originated request.
   */
  async function setRef(newRef) {
    if (!isValidRef(newRef)) {
      throw new Error(`Invalid ref: ${String(newRef).slice(0, 80)}`);
    }
    // Fetch latest to make sure we have the ref
    await fetchOrigin();

    // Force-purge the existing checkout for this ref so extractPublicDir
    // does a full re-extract instead of short-circuiting on a stale SHA
    // marker.  Guarantees the user gets the latest code after a push.
    const safeRef = toSafeRef(newRef);
    const refDir = path.join(CHECKOUT_DIR, safeRef);
    fs.rmSync(refDir, { recursive: true, force: true });

    // Resolve, extract, and cache — no global state mutation.
    const outDir = extractPublicDir(newRef);
    updateRefState(newRef, outDir);
    console.log(`[github-source] Pre-warmed ref: ${newRef}`);
  }

  /** Returns the server default ref (from config). Never a per-user value. */
  function getRef() {
    return defaultRef;
  }

  /**
   * Pre-warm: fetch from origin and re-extract current ref.
   * Called on startup and periodically.
   */
  async function preWarm() {
    try {
      await fetchOrigin();
      const dir = extractPublicDir(defaultRef);
      updateRefState(defaultRef, dir);
    } catch (err) {
      console.warn('[github-source] Pre-warm failed:', err.message);
    }
  }

  /** Purge extracted files for the default ref (used by admin purge endpoint). */
  function purgeCache() {
    const safeRef = toSafeRef(defaultRef);
    const refDir = path.join(CHECKOUT_DIR, safeRef);
    fs.rmSync(refDir, { recursive: true, force: true });
    refState.delete(defaultRef); // invalidate HTML cache for this ref
    console.log(`[github-source] Purged checkout for ${defaultRef}`);
  }

  /** List all extracted refs. */
  function listCachedRefs() {
    try {
      const dirs = fs.readdirSync(CHECKOUT_DIR).filter(d => !d.startsWith('.'));

      // Build best-effort reverse mapping for older caches without .waymark-ref marker.
      const fallbackMap = new Map();
      try {
        const branches = git('for-each-ref --format="%(refname:strip=3)" refs/remotes/origin')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);
        const tags = git('for-each-ref --format="%(refname:strip=2)" refs/tags')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);
        for (const candidate of [...branches, ...tags]) {
          fallbackMap.set(toSafeRef(candidate), candidate);
        }
      } catch {
        /* best-effort */
      }

      function restoreLikelyRef(dirName) {
        if (!dirName || dirName.includes('/')) return dirName;
        // Common branch prefixes often use one slash segment, e.g. feature/foo.
        const prefixed = dirName.replace(
          /^(feature|fix|bugfix|hotfix|chore|docs|refactor|test|perf|ci|build|release)_(.+)$/i,
          '$1/$2',
        );
        if (prefixed !== dirName) return prefixed;
        return dirName;
      }

      const refs = [];
      for (const dir of dirs) {
        const marker = path.join(CHECKOUT_DIR, dir, '.waymark-ref');
        if (fs.existsSync(marker)) {
          const original = fs.readFileSync(marker, 'utf-8').trim();
          refs.push(original || dir);
          continue;
        }
        refs.push(fallbackMap.get(dir) || restoreLikelyRef(dir));
      }

      return Array.from(new Set(refs));
    } catch {
      return [];
    }
  }

  /**
   * Read a file from the extracted public/ for theRef (or defaultRef as fallback).
   * Used by serveIndex() to get index.html per user without going through middleware.
   */
  function readFile(relPath, theRef) {
    const state = refState.get(theRef || defaultRef) || refState.get(defaultRef);
    if (!state?.publicDir) return null;
    const fullPath = path.join(state.publicDir, relPath);
    try {
      return fs.readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /* ---------- Periodic fetch (keep repo up-to-date) ---------- */

  // Fetch from origin every 5 minutes to pick up new commits
  const _fetchInterval = setInterval(async () => {
    try {
      await fetchOrigin();
      // Re-extract ALL cached refs in case branch tips moved.
      for (const [cachedRef] of refState) {
        try {
          const newDir = extractPublicDir(cachedRef);
          updateRefState(cachedRef, newDir);
          console.log(`[github-source] Auto-updated ref ${cachedRef}`);
        } catch (err) {
          console.warn(`[github-source] Periodic update failed for ${cachedRef}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('[github-source] Periodic fetch failed:', err.message);
    }
  }, 5 * 60 * 1000);

  // Don't let the interval keep the process alive during tests
  if (_fetchInterval.unref) _fetchInterval.unref();

  return {
    middleware,
    setRef,
    getRef,
    getContentShaForRef: (theRef) => refState.get(theRef)?.contentSha || null,
    preWarm,
    purgeCache,
    listCachedRefs,
    readFile,
  };
}

module.exports = { createGitHubSource, isValidRef };
