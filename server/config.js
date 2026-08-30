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

  // ── OAuth scope tiers ──
  // Two access levels the user can choose between at sign-in:
  //   'file' (default) — drive.file: the app only ever touches files the user
  //                       created through Waymark or explicitly picked via the
  //                       Google Picker. Minimal, privacy-preserving, no
  //                       Google verification required.
  //   'full'           — adds the full Drive scope so anything shared with the
  //                       user "just works": shared Waymarks appear and open
  //                       without the Picker, and can be read/written directly.
  //                       This is a restricted scope (requires app verification
  //                       for public production use).
  SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.file',
  ],

  DRIVE_FULL_SCOPE: 'https://www.googleapis.com/auth/drive',

  GOOGLE_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
};

/**
 * Resolve the OAuth scope list for a requested access tier.
 * @param {'full'|'file'} [tier]  desired access level (defaults to 'file')
 * @returns {string[]}  scopes to request at consent
 */
config.scopesFor = function scopesFor(tier) {
  return tier === 'full'
    ? [...config.SCOPES, config.DRIVE_FULL_SCOPE]
    : config.SCOPES;
};

/**
 * Classify a space-separated scope string returned by Google into the
 * access tier the app cares about.
 * @param {string} [granted]  the `scope` field from a token response
 * @returns {'full'|'file'}
 */
config.driveAccessFromScope = function driveAccessFromScope(granted) {
  const list = (granted || '').split(/\s+/);
  return list.includes(config.DRIVE_FULL_SCOPE) ? 'full' : 'file';
};

module.exports = config;
