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

/* ---------- Android nonce store ----------
 * After /auth/callback completes for an Android-initiated flow, the refresh
 * token is stashed here keyed by a one-time nonce so the WebView can claim
 * it via /auth/exchange without the token ever appearing in a URL or cookie
 * visible to the system browser.  Entries expire after 5 minutes.
 */
const _androidNonces = new Map(); // nonce → { refreshToken, expiry }
const NONCE_TTL_MS = 5 * 60 * 1000;

function storeAndroidNonce(refreshToken) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  _androidNonces.set(nonce, { refreshToken, expiry: Date.now() + NONCE_TTL_MS });
  // Lazily evict expired entries
  for (const [k, v] of _androidNonces) {
    if (v.expiry < Date.now()) _androidNonces.delete(k);
  }
  return nonce;
}

function consumeAndroidNonce(nonce) {
  const entry = _androidNonces.get(nonce);
  if (!entry) return null;
  _androidNonces.delete(nonce);
  if (entry.expiry < Date.now()) return null;
  return entry.refreshToken;
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

    // Android WebView passes ?android=1 — flag this flow so /auth/callback
    // knows to redirect to the app via a custom-scheme deep-link instead of
    // sending the response cookies back to the system browser.
    if (req.query.android) {
      res.cookie('waymark_android_flow', '1', SHORT_COOKIE_OPTS);
    }

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

    const isAndroidFlow = !!req.cookies.waymark_android_flow;
    res.clearCookie('waymark_android_flow', { path: bp + '/' });

    try {
      const tokens = await exchangeCode(code, codeVerifier);

      if (tokens.error) {
        console.error('Token exchange error:', tokens);
        return res.redirect(isAndroidFlow ? 'com.waymark.app://auth_error' : bp + '/#auth_error');
      }

      if (isAndroidFlow) {
        // The callback ran in the system browser — its cookies won't be in the
        // WebView's session.  Stash the refresh token behind a one-time nonce
        // and redirect back to the app; the WebView claims it via /auth/exchange.
        const nonce = tokens.refresh_token ? storeAndroidNonce(tokens.refresh_token) : '';
        return res.redirect(`com.waymark.app://auth_success?nonce=${encodeURIComponent(nonce)}`);
      }

      if (tokens.refresh_token) {
        res.cookie('waymark_refresh', tokens.refresh_token, REFRESH_COOKIE_OPTS);
      }

      // On login, pre-warm the user's pinned ref so it is ready to serve
      // immediately after redirect.  setRef() no longer mutates global state;
      // the per-user cookie drives which ref is actually served.
      const pinnedRef = req.signedCookies?.waymark_pinned_ref;
      if (pinnedRef && pinnedRef !== 'main') {
        try {
          const githubSource = req.app.get('githubSource');
          if (githubSource && githubSource.setRef) {
            await githubSource.setRef(pinnedRef);
            console.log(`[auth] Pre-warmed pinned ref on login: ${pinnedRef}`);
          }
        } catch (err) {
          console.warn(`[auth] Failed to pre-warm pinned ref "${pinnedRef}":`, err.message);
        }
      }

      // Redirect to app — frontend calls /auth/refresh to get the access token
      res.redirect(bp + '/#auth_success');
    } catch (err) {
      console.error('OAuth callback exception:', err);
      res.redirect(isAndroidFlow ? 'com.waymark.app://auth_error' : bp + '/#auth_error');
    }
  });

  /* --- GET /auth/exchange ---
   * Called by the Android WebView after onNewIntent catches the
   * com.waymark.app://auth_success?nonce=X deep-link.  Retrieves the
   * refresh token stored by /auth/callback and sets the httpOnly cookie
   * in the WebView's own cookie session. */
  app.get('/auth/exchange', (req, res) => {
    if (config.WAYMARK_LOCAL) {
      // Local mode: just set the mock cookie and redirect
      res.cookie('waymark_refresh', 'mock-refresh-token', REFRESH_COOKIE_OPTS);
      return res.redirect(bp + '/#auth_success');
    }

    const { nonce } = req.query;
    if (!nonce || typeof nonce !== 'string') {
      return res.status(400).send('Missing nonce.');
    }

    const refreshToken = consumeAndroidNonce(nonce);
    if (!refreshToken) {
      // Nonce invalid or expired — send user back to login
      return res.redirect(bp + '/#auth_error');
    }

    res.cookie('waymark_refresh', refreshToken, REFRESH_COOKIE_OPTS);
    res.redirect(bp + '/#auth_success');
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
  app.post('/auth/logout', async (req, res) => {
    res.clearCookie('waymark_refresh', { path: bp + '/auth' });
    // Clear the temporary session ref so the user's next visit uses their
    // pinned ref (or the server default) rather than a stale switch.
    res.clearCookie('waymark_session_ref', { path: bp + '/' });

    // Pre-warm the pinned ref so it is ready to serve after login.
    // This is best-effort; per-user cookies drive actual ref resolution.
    const pinnedRef = req.signedCookies?.waymark_pinned_ref || 'main';
    try {
      const githubSource = req.app.get('githubSource');
      if (githubSource && githubSource.setRef) {
        await githubSource.setRef(pinnedRef);
        console.log(`[auth] Pre-warmed pinned ref on logout: ${pinnedRef}`);
      }
    } catch (err) {
      console.warn(`[auth] Failed to pre-warm pinned ref on logout:`, err.message);
    }

    res.json({ success: true });
  });
};
