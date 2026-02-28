const crypto = require('crypto');
const config = require('./config');

/* ---------- PKCE helpers ---------- */

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

/* ---------- Google token helpers ---------- */

function buildAuthUrl(codeChallenge, state) {
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: config.SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${config.GOOGLE_AUTH_URL}?${params}`;
}

async function exchangeCode(code, codeVerifier) {
  const res = await fetch(config.GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(config.GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  return res.json();
}

/* ---------- Cookie options ---------- */

const isSecure = config.NODE_ENV === 'production';

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: isSecure,
  sameSite: isSecure ? 'strict' : 'lax',
  path: (config.BASE_PATH || '') + '/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

const SHORT_COOKIE_OPTS = {
  httpOnly: true,
  secure: isSecure,
  sameSite: 'lax',
  path: (config.BASE_PATH || '') + '/',
  maxAge: 10 * 60 * 1000, // 10 minutes
};

/* ---------- Route handler ---------- */

module.exports = function setupAuth(app) {
  const bp = config.BASE_PATH || '';

  /* --- GET /auth/login --- */
  app.get('/auth/login', (req, res) => {
    if (config.WAYMARK_LOCAL) {
      res.cookie('waymark_refresh', 'mock-refresh-token', REFRESH_COOKIE_OPTS);
      return res.redirect(bp + '/#auth_success');
    }

    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    res.cookie('pkce_verifier', verifier, SHORT_COOKIE_OPTS);
    res.cookie('oauth_state', state, SHORT_COOKIE_OPTS);

    res.redirect(buildAuthUrl(challenge, state));
  });

  /* --- GET /auth/callback --- */
  app.get('/auth/callback', async (req, res) => {
    if (config.WAYMARK_LOCAL) {
      return res.redirect(bp + '/');
    }

    const { code, state, error } = req.query;
    const savedState = req.cookies.oauth_state;
    const codeVerifier = req.cookies.pkce_verifier;

    // Clear one-time cookies
    res.clearCookie('pkce_verifier', { path: bp + '/' });
    res.clearCookie('oauth_state', { path: bp + '/' });

    if (error) {
      console.error('OAuth error:', error);
      return res.redirect(bp + '/#auth_error');
    }

    if (!code || !state || state !== savedState || !codeVerifier) {
      return res.status(400).send('Invalid OAuth callback — missing or mismatched parameters.');
    }

    try {
      const tokens = await exchangeCode(code, codeVerifier);

      if (tokens.error) {
        console.error('Token exchange error:', tokens);
        return res.redirect(bp + '/#auth_error');
      }

      if (tokens.refresh_token) {
        res.cookie('waymark_refresh', tokens.refresh_token, REFRESH_COOKIE_OPTS);
      }

      // Redirect to app — frontend calls /auth/refresh to get the access token
      res.redirect(bp + '/#auth_success');
    } catch (err) {
      console.error('OAuth callback exception:', err);
      res.redirect(bp + '/#auth_error');
    }
  });

  /* --- POST /auth/refresh --- */
  app.post('/auth/refresh', async (req, res) => {
    if (config.WAYMARK_LOCAL) {
      const refreshToken = req.cookies.waymark_refresh;
      if (!refreshToken) {
        return res.status(401).json({ error: 'No refresh token' });
      }
      return res.json({
        access_token: 'mock-access-token-' + Date.now(),
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }

    const refreshToken = req.cookies.waymark_refresh;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    try {
      const tokens = await refreshAccessToken(refreshToken);

      if (tokens.error) {
        // Refresh token is expired or revoked — clear cookie
        res.clearCookie('waymark_refresh', { path: bp + '/auth' });
        return res.status(401).json({ error: tokens.error_description || tokens.error });
      }

      // If Google issued a new refresh token (rotation), update the cookie
      if (tokens.refresh_token) {
        res.cookie('waymark_refresh', tokens.refresh_token, REFRESH_COOKIE_OPTS);
      }

      res.json({
        access_token: tokens.access_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
      });
    } catch (err) {
      console.error('Token refresh exception:', err);
      res.status(500).json({ error: 'Token refresh failed' });
    }
  });

  /* --- POST /auth/logout --- */
  app.post('/auth/logout', (_req, res) => {
    res.clearCookie('waymark_refresh', { path: bp + '/auth' });
    res.json({ success: true });
  });
};
