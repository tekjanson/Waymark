const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const setupAuth = require('./auth');

const app = express();

/* ---------- Middleware ---------- */

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
        "script-src 'self'",
        "connect-src 'self' https://www.googleapis.com https://sheets.googleapis.com https://oauth2.googleapis.com https://generativelanguage.googleapis.com",
        "img-src 'self' https://*.googleusercontent.com data:",
        "style-src 'self' 'unsafe-inline'",
      ].join('; ')
    );
  }

  next();
});

/* ---------- Local-only mode ---------- */

if (config.WAYMARK_LOCAL) {
  console.log('🔧  WAYMARK_LOCAL=true — running in local-only mock mode');

  // Serve test fixtures at /__fixtures
  const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');
  app.use('/__fixtures', express.static(fixturesDir));

  // Serve index.html with injected __WAYMARK_LOCAL flag
  app.get('/', (_req, res) => {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');
    html = html.replace(
      '</head>',
      '  <script>window.__WAYMARK_LOCAL=true;</script>\n</head>'
    );
    res.type('html').send(html);
  });
}

/* ---------- Auth routes ---------- */

setupAuth(app);

/* ---------- Static files ---------- */

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback — serve index.html for any unmatched route
app.get('*', (req, res) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/__fixtures')) {
    return res.status(404).end();
  }

  if (config.WAYMARK_LOCAL) {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');
    html = html.replace(
      '</head>',
      '  <script>window.__WAYMARK_LOCAL=true;</script>\n</head>'
    );
    return res.type('html').send(html);
  }

  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/* ---------- Start ---------- */

app.listen(config.PORT, () => {
  console.log(`✅  WayMark server listening on http://localhost:${config.PORT}`);
});

module.exports = app; // for testing
