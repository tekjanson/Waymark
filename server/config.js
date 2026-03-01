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

  SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ],

  GOOGLE_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
};

module.exports = config;
