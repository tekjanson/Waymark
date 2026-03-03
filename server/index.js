const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const setupAuth = require('./auth');

const app = express();

/* ---------- Base-path aware router ---------- */
// When BASE_PATH is set (e.g. '/waymark'), all routes are mounted under
// that prefix so the app can live behind an nginx location block.
const basePath = config.BASE_PATH || '';
const router = express.Router();

/* ---------- Top-level middleware (runs before router) ---------- */

app.use(cookieParser(config.COOKIE_SECRET));
app.use(express.json());

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (config.NODE_ENV === 'production') {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self' https://www.googleapis.com https://sheets.googleapis.com https://oauth2.googleapis.com",
        "img-src 'self' https://*.googleusercontent.com data:",
        "style-src 'self' 'unsafe-inline'",
      ].join('; ')
    );
  }

  next();
});

/* ---------- Helper: serve index.html with injections ---------- */

function serveIndex(_req, res) {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');

  // Inject the base path so client-side JS can build correct URLs
  const injections = [];
  if (basePath) {
    injections.push(`window.__WAYMARK_BASE='${basePath}';`);
  }
  if (config.WAYMARK_LOCAL) {
    injections.push('window.__WAYMARK_LOCAL=true;');
  }
  if (injections.length) {
    html = html.replace('</head>', `  <script>${injections.join('')}</script>\n</head>`);
  }

  res.type('html').send(html);
}

/* ---------- Local-only mode ---------- */

if (config.WAYMARK_LOCAL) {
  console.log('🔧  WAYMARK_LOCAL=true — running in local-only mock mode');

  // Serve test fixtures at /__fixtures
  const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');
  router.use('/__fixtures', express.static(fixturesDir));
}

// Serve index.html with injected __WAYMARK_BASE / __WAYMARK_LOCAL flags
// Must come before express.static so the root '/' is handled here.
router.get('/', serveIndex);

/* ---------- API: server-side URL fetch (avoids CORS) ---------- */

router.post('/api/fetch-url', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "url" parameter' });
  }

  // Validate URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported' });
  }

  // Block private/internal IPs to prevent SSRF
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('172.') ||
    hostname.endsWith('.local')
  ) {
    return res.status(400).json({ error: 'Cannot fetch internal/private URLs' });
  }

  const httpMod = parsed.protocol === 'https:' ? require('https') : require('http');

  try {
    const html = await new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WayMark/1.0; +https://swiftirons.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 15000,
      };

      const request = httpMod.get(url, options, (response) => {
        // Follow redirects (3xx)
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          const redirectUrl = new URL(response.headers.location, url).href;
          httpMod.get(redirectUrl, options, (resp2) => {
            if (resp2.statusCode < 200 || resp2.statusCode >= 400) {
              return reject(new Error(`HTTP ${resp2.statusCode}`));
            }
            const chunks = [];
            resp2.on('data', (chunk) => chunks.push(chunk));
            resp2.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            resp2.on('error', reject);
          }).on('error', reject);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 400) {
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        response.on('error', reject);
      });

      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timed out'));
      });
    });

    if (!html || html.length < 100) {
      return res.status(502).json({ error: 'Empty or too-short response from target URL' });
    }

    res.json({ html });
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch URL: ${err.message}` });
  }
});

/* ---------- Auth routes ---------- */

setupAuth(router);

/* ---------- Static files ---------- */

// index: false — prevent express.static from serving raw index.html;
// the serveIndex handler above (and the SPA fallback below) inject runtime
// config (e.g. __WAYMARK_BASE) that the client JS needs.
router.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

// SPA fallback — serve index.html for any unmatched route
router.get('*', (req, res) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/__fixtures')) {
    return res.status(404).end();
  }
  serveIndex(req, res);
});

/* ---------- Mount router at BASE_PATH ---------- */

if (basePath) {
  app.use(basePath, router);
  // Redirect /waymark → /waymark/ for clean URLs
  app.get(basePath, (_req, res) => res.redirect(301, basePath + '/'));
} else {
  app.use('/', router);
}

/* ---------- Start ---------- */

app.listen(config.PORT, () => {
  console.log(`✅  WayMark server listening on http://localhost:${config.PORT}${basePath || '/'}`);
});

module.exports = app; // for testing
