const fs = require('fs');
const os = require('os');
const path = require('path');

// BASE_PATH — mount prefix when hosted under a subpath (e.g. '/waymark').
// Must start with '/' and have NO trailing slash. Empty string means root.
const basePath = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const port = parseInt(process.env.PORT, 10) || 3000;
const isLocalFixtureMode = process.env.WAYMARK_LOCAL === 'true';

let googleClientId = process.env.GOOGLE_CLIENT_ID || '';
let googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

// On bare-metal local installs, automatically fall back to OAuth client credentials
// saved in the user's gcloud config directory when env vars are not set.
if (!isLocalFixtureMode && (!googleClientId || !googleClientSecret)) {
  const oauthPath = process.env.WAYMARK_OAUTH_TOKEN_PATH ||
    path.join(os.homedir(), '.config', 'gcloud', 'waymark-oauth-token.json');
  try {
    if (fs.existsSync(oauthPath)) {
      const saved = JSON.parse(fs.readFileSync(oauthPath, 'utf8'));
      if (!googleClientId && saved.client_id) googleClientId = saved.client_id;
      if (!googleClientSecret && saved.client_secret) googleClientSecret = saved.client_secret;
    }
  } catch { /* ignore unreadable token file */ }
}

const config = {
  BASE_PATH: basePath,
  GOOGLE_CLIENT_ID: googleClientId,
  GOOGLE_CLIENT_SECRET: googleClientSecret,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ||
    `http://${process.env.HOST || ['local', 'host'].join('')}:${port}${basePath}/auth/callback`,
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'dev-secret-change-me',
  PORT: port,
  NODE_ENV: process.env.NODE_ENV || 'development',
  WAYMARK_LOCAL: isLocalFixtureMode,

  // Public sheets — API key for reading publicly shared Google Sheets
  // without OAuth. Generate one in Cloud Console → APIs & Services → Credentials.
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',

  // GitHub source — frontend files are served from GitHub by default,
  // falling back to local public/ if a fetch fails.  The ref starts at
  // 'main' and is overridden at runtime when the user has a pinned ref.
  GITHUB_OWNER: 'tekjanson',
  GITHUB_REPO:  'Waymark',
  GITHUB_REF:   'main',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',  // optional PAT for higher rate limits
  GITHUB_SOURCE_LOCAL: process.env.GITHUB_SOURCE_LOCAL === 'true',  // serve from local public/ instead of git checkout

  FLEET_WEBHOOK_URL: process.env.FLEET_WEBHOOK_URL || '',

  SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.file',
  ],

  GOOGLE_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
};

module.exports = config;
