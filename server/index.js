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
