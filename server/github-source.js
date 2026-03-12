/**
 * github-source.js — Fetch and cache frontend files from a GitHub repo.
 *
 * This module serves frontend files from GitHub instead of the local
 * public/ directory.  It extends the server's existing "serve static
 * files" responsibility — no business logic is added.
 *
 * How it works:
 *   1. On first request for a file, fetch it from GitHub's raw content API
 *      at the configured commit hash / branch / tag.
 *   2. Write the file to a local disk cache (`server/.github-cache/<ref>/`).
 *   3. Subsequent requests for the same ref+path are served from disk.
 *   4. Changing the ref (API call) invalidates the cache automatically
 *      because the cache key includes the ref.
 *
 * Configuration (hardcoded in config.js):
 *   GITHUB_OWNER   — repo owner ('tekjanson')
 *   GITHUB_REPO    — repo name  ('Waymark')
 *   GITHUB_REF     — default ref ('main')
 *   GITHUB_TOKEN   — optional PAT for private repos / rate-limit relief (env var)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '.github-cache');

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

function isTextMime(mime) {
  return mime.startsWith('text/') || mime.includes('javascript') || mime.includes('json') || mime.includes('xml');
}

/**
 * Fetch a raw file from GitHub.
 * Uses the raw.githubusercontent.com endpoint — no API rate limit auth needed
 * for public repos, but we send the token if provided for private repos.
 */
function fetchFromGitHub(owner, repo, ref, filePath, token) {
  return new Promise((resolve, reject) => {
    const urlPath = `/${owner}/${repo}/${ref}/${filePath}`;
    const options = {
      hostname: 'raw.githubusercontent.com',
      path: urlPath,
      method: 'GET',
      headers: {
        'User-Agent': 'WayMark-GitHubSource/1.0',
      },
    };

    if (token) {
      options.headers['Authorization'] = `token ${token}`;
    }

    const req = https.request(options, (res) => {
      if (res.statusCode === 404) {
        return resolve(null); // file not found at this ref
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`GitHub responded with ${res.statusCode} for ${urlPath}`));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub request timed out')); });
    req.setTimeout(15000);
    req.end();
  });
}

/* ---------- Cache ---------- */

function getCachePath(ref, filePath) {
  // Sanitize ref to be filesystem-safe
  const safeRef = ref.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(CACHE_DIR, safeRef, filePath);
}

function readFromCache(ref, filePath) {
  const cachePath = getCachePath(ref, filePath);
  try {
    return fs.readFileSync(cachePath);
  } catch {
    return null;
  }
}

function writeToCache(ref, filePath, data) {
  const cachePath = getCachePath(ref, filePath);
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cachePath, data);
}

/* ---------- In-memory LRU for hot files ---------- */

class MemoryCache {
  constructor(maxEntries = 500) {
    this.max = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const val = this.map.get(key);
    if (val !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val ?? null;
  }

  set(key, val) {
    this.map.delete(key);
    this.map.set(key, val);
    if (this.map.size > this.max) {
      // Evict oldest
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  clear() {
    this.map.clear();
  }
}

const memCache = new MemoryCache(500);

/* ---------- Pre-warm: fetch the full tree ---------- */

/**
 * Fetch the repo tree at a given ref using the GitHub Trees API.
 * This tells us every file path that exists, so we can 404 immediately
 * for paths that don't exist instead of hitting GitHub every time.
 */
async function fetchTree(owner, repo, ref, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'WayMark-GitHubSource/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `token ${token}`;
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode !== 200) {
            return reject(new Error(`GitHub Trees API: ${res.statusCode} — ${body.message || 'unknown error'}`));
          }
          // Extract just the file paths under public/
          const paths = new Set();
          for (const item of body.tree || []) {
            if (item.type === 'blob' && item.path.startsWith('public/')) {
              paths.add(item.path.slice('public/'.length)); // strip 'public/' prefix
            }
          }
          resolve(paths);
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000);
    req.end();
  });
}

/* ---------- Main export: GitHub source middleware ---------- */

/**
 * Creates an Express middleware that serves files from a GitHub repo.
 *
 * @param {object} opts
 * @param {string} opts.owner      — GitHub repo owner
 * @param {string} opts.repo       — GitHub repo name
 * @param {string} opts.ref        — commit SHA, branch name, or tag
 * @param {string} [opts.token]    — optional GitHub PAT
 * @param {string} [opts.basePath] — public/ subdir prefix in the repo
 * @returns {{ middleware: Function, setRef: Function, getRef: Function, preWarm: Function }}
 */
function createGitHubSource(opts) {
  let { owner, repo, ref, token, basePath = 'public' } = opts;

  // Known file set — populated by preWarm()
  let knownFiles = null; // Set<string> or null (if tree fetch failed)

  const middleware = async (req, res, next) => {
    // Only handle GET/HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // Resolve the file path
    let filePath = req.path;

    // Strip leading slash
    if (filePath.startsWith('/')) filePath = filePath.slice(1);

    // Default to index.html for empty path
    if (!filePath) filePath = 'index.html';

    // Security: no path traversal
    if (filePath.includes('..') || filePath.includes('\0')) {
      return res.status(400).end();
    }

    // Skip auth and API routes
    if (filePath.startsWith('auth/') || filePath.startsWith('api/') || filePath.startsWith('__fixtures')) {
      return next();
    }

    // If we have the file tree, do a fast 404 check
    if (knownFiles && !knownFiles.has(filePath)) {
      // Could be an SPA route — let the caller handle fallback
      return next();
    }

    const cacheKey = `${ref}:${filePath}`;

    // 1. Check in-memory cache
    let data = memCache.get(cacheKey);

    // 2. Check disk cache
    if (!data) {
      data = readFromCache(ref, filePath);
      if (data) memCache.set(cacheKey, data);
    }

    // 3. Fetch from GitHub
    if (!data) {
      try {
        const repoPath = `${basePath}/${filePath}`;
        data = await fetchFromGitHub(owner, repo, ref, repoPath, token);
        if (!data) {
          // File doesn't exist at this ref — pass to next handler (SPA fallback)
          return next();
        }
        // Cache it
        writeToCache(ref, filePath, data);
        memCache.set(cacheKey, data);
      } catch (err) {
        console.error(`[github-source] Failed to fetch ${filePath}@${ref}:`, err.message);
        return next(); // fall through to local static or 404
      }
    }

    // Serve the file
    const mime = getMimeType(filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('X-GitHub-Ref', ref);
    res.setHeader('X-Served-From', 'github-source');

    // Cache headers
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', data.length);
      return res.end();
    }

    res.send(data);
  };

  /** Change the ref at runtime (e.g. via admin API) */
  function setRef(newRef) {
    ref = newRef;
    memCache.clear();
    console.log(`[github-source] Ref changed to: ${ref}`);
  }

  /** Get the current ref */
  function getRef() {
    return ref;
  }

  /** Pre-warm the cache by fetching the file tree */
  async function preWarm() {
    try {
      console.log(`[github-source] Fetching file tree for ${owner}/${repo}@${ref}...`);
      knownFiles = await fetchTree(owner, repo, ref, token);
      console.log(`[github-source] Found ${knownFiles.size} files in public/ at ${ref}`);
    } catch (err) {
      console.warn(`[github-source] Could not fetch tree (will fetch on demand): ${err.message}`);
      knownFiles = null;
    }
  }

  /** Purge all cached files for the current ref */
  function purgeCache() {
    memCache.clear();
    const safeRef = ref.replace(/[^a-zA-Z0-9._-]/g, '_');
    const refDir = path.join(CACHE_DIR, safeRef);
    try {
      fs.rmSync(refDir, { recursive: true, force: true });
      console.log(`[github-source] Purged cache for ${ref}`);
    } catch { /* ignore */ }
  }

  /** List all cached refs */
  function listCachedRefs() {
    try {
      return fs.readdirSync(CACHE_DIR);
    } catch {
      return [];
    }
  }

  return { middleware, setRef, getRef, preWarm, purgeCache, listCachedRefs };
}

module.exports = { createGitHubSource };
