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

/* ---------- Helpers ---------- */

/** MIME types for common frontend assets */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
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
    return;
  }

  console.log(`[github-source] Cloning ${owner}/${repo} (bare)...`);
  fs.mkdirSync(REPO_DIR, { recursive: true });
  execSync(`git clone --bare "${url}" "${REPO_DIR}"`, {
    encoding: 'utf-8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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
  const safeRef = ref.replace(/[^a-zA-Z0-9._-]/g, '_');
  const outDir = path.join(CHECKOUT_DIR, safeRef);

  // If already extracted for this exact commit, skip
  const shaMarker = path.join(outDir, '.git-sha');
  if (fs.existsSync(shaMarker)) {
    try {
      const cached = fs.readFileSync(shaMarker, 'utf-8').trim();
      if (cached === commitSha) {
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
  console.log(`[github-source] Extracted public/ for ${ref} (${commitSha.slice(0, 8)}) -> ${outDir}`);
  return outDir;
}

/* ---------- Main export ---------- */

/**
 * Creates an Express middleware that serves files from a local git clone.
 *
 * @param {object} opts
 * @param {string} opts.owner   — GitHub repo owner
 * @param {string} opts.repo    — GitHub repo name
 * @param {string} opts.ref     — initial ref (branch, tag, SHA)
 * @param {string} [opts.token] — optional GitHub PAT for private repos
 * @returns {{ middleware, setRef, getRef, preWarm, purgeCache, listCachedRefs, readFile }}
 */
function createGitHubSource(opts) {
  const { owner, repo, token } = opts;
  let ref = opts.ref;
  let publicDir = null;  // path to extracted public/ for current ref

  // Clone the repo (synchronous on first boot, fast on subsequent boots)
  try {
    ensureRepo(owner, repo, token);
  } catch (err) {
    console.error('[github-source] Failed to clone repo:', err.message);
    console.warn('[github-source] Will serve from local public/ only.');
  }

  // Extract public/ for the initial ref
  try {
    publicDir = extractPublicDir(ref);
  } catch (err) {
    console.warn(`[github-source] Could not extract ref "${ref}":`, err.message);
  }

  /* ---------- Middleware ---------- */

  const middleware = (req, res, next) => {
    // Only handle GET/HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // No checkout available — fall through to local public/
    if (!publicDir) return next();

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

    const fullPath = path.join(publicDir, filePath);

    // Check file exists
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      return next(); // SPA fallback or local static
    }

    // Serve the file
    const mime = getMimeType(filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('X-GitHub-Ref', ref);
    res.setHeader('X-Served-From', 'github-source');

    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    if (req.method === 'HEAD') {
      const stat = fs.statSync(fullPath);
      res.setHeader('Content-Length', stat.size);
      return res.end();
    }

    res.sendFile(fullPath);
  };

  /* ---------- API ---------- */

  /** Switch to a different ref. Fetches from origin first. */
  async function setRef(newRef) {
    // Fetch latest to make sure we have the ref
    await fetchOrigin();

    // Resolve and extract
    const outDir = extractPublicDir(newRef);
    ref = newRef;
    publicDir = outDir;
    console.log(`[github-source] Switched to ref: ${ref}`);
  }

  function getRef() {
    return ref;
  }

  /**
   * Pre-warm: fetch from origin and re-extract current ref.
   * Called on startup and periodically.
   */
  async function preWarm() {
    try {
      await fetchOrigin();
      publicDir = extractPublicDir(ref);
    } catch (err) {
      console.warn('[github-source] Pre-warm failed:', err.message);
    }
  }

  /** Purge extracted files for the current ref. */
  function purgeCache() {
    const safeRef = ref.replace(/[^a-zA-Z0-9._-]/g, '_');
    const refDir = path.join(CHECKOUT_DIR, safeRef);
    fs.rmSync(refDir, { recursive: true, force: true });
    publicDir = null;
    console.log(`[github-source] Purged checkout for ${ref}`);
  }

  /** List all extracted refs. */
  function listCachedRefs() {
    try {
      return fs.readdirSync(CHECKOUT_DIR).filter(d => !d.startsWith('.'));
    } catch {
      return [];
    }
  }

  /**
   * Read a file from the current ref's extracted public/ directory.
   * Used by serveIndex() to get index.html without going through middleware.
   * Returns the file contents as a string, or null if not found.
   */
  function readFile(relPath) {
    if (!publicDir) return null;
    const fullPath = path.join(publicDir, relPath);
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
      // Re-extract current ref in case it moved (branch tips do)
      const newDir = extractPublicDir(ref);
      if (newDir !== publicDir) {
        publicDir = newDir;
        console.log(`[github-source] Auto-updated ref ${ref}`);
      }
    } catch (err) {
      console.warn('[github-source] Periodic fetch failed:', err.message);
    }
  }, 5 * 60 * 1000);

  // Don't let the interval keep the process alive during tests
  if (_fetchInterval.unref) _fetchInterval.unref();

  return { middleware, setRef, getRef, preWarm, purgeCache, listCachedRefs, readFile };
}

module.exports = { createGitHubSource };
