// BASE_PATH — mount prefix when hosted under a subpath (e.g. '/waymark').
// Must start with '/' and have NO trailing slash. Empty string means root.
const basePath = (process.env.BASE_PATH || '').replace(/\/+$/, '');

const config = {
  BASE_PATH: basePath,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'dev-secret-change-me',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  WAYMARK_LOCAL: process.env.WAYMARK_LOCAL === 'true',

  // GitHub source — frontend files are served from GitHub by default,
  // falling back to local public/ if a fetch fails.  The ref starts at
  // 'main' and is overridden at runtime when the user has a pinned ref.
  GITHUB_OWNER: 'tekjanson',
  GITHUB_REPO:  'Waymark',
  GITHUB_REF:   'main',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',  // optional PAT for higher rate limits
  GITHUB_SOURCE_LOCAL: process.env.GITHUB_SOURCE_LOCAL === 'true',  // serve from local public/ instead of git checkout

  SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/calendar.readonly',
  ],

  GOOGLE_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
};

module.exports = config;
