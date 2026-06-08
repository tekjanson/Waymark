/* ============================================================
   plaid.js — Plaid Link OAuth integration
   Handles bank account connection via Plaid's OAuth link flow.
   The access_token never touches the server after exchange — it
   lives in localStorage under waymark_plaid_token.
   ============================================================ */

const BASE = window.__WAYMARK_BASE || '';
const STORAGE_KEY = 'waymark_plaid_token';
const STORAGE_ITEM_KEY = 'waymark_plaid_item';
const PLAID_CDN = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

/* ---------- Script loader ---------- */

let _scriptPromise = null;

/**
 * Load the Plaid Link SDK from CDN (once).
 * @returns {Promise<void>}
 */
async function loadPlaidScript() {
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    if (window.Plaid) { resolve(); return; }
    const script = document.createElement('script');
    script.src = PLAID_CDN;
    script.async = true;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Plaid Link SDK'));
    document.head.appendChild(script);
  });
  return _scriptPromise;
}

/* ---------- Token storage ---------- */

/**
 * Return the stored Plaid access token, or null if not connected.
 * @returns {{ access_token: string, item_id: string } | null}
 */
export function getStoredToken() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Return the stored institution info, or null.
 * @returns {{ name: string, institution_id: string } | null}
 */
export function getStoredInstitution() {
  try {
    const raw = localStorage.getItem(STORAGE_ITEM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Remove the stored Plaid token and institution (disconnect). */
export function clearStoredToken() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_ITEM_KEY);
}

/* ---------- Server calls ---------- */

/**
 * Fetch a fresh Plaid link token from the server.
 * @param {string} [redirectUri] — Plaid OAuth redirect URI (for OAuth banks)
 * @returns {Promise<string>} link_token
 */
async function fetchLinkToken(redirectUri) {
  const body = { client_name: 'Waymark' };
  if (redirectUri) body.redirect_uri = redirectUri;

  const res = await fetch(BASE + '/auth/plaid/link-token', {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'include',
    body:         JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Link token request failed (${res.status})`);
  }
  const data = await res.json();
  return data.link_token;
}

/**
 * Exchange a Plaid public_token for an access_token via the server.
 * @param {string} publicToken
 * @returns {Promise<{ access_token: string, item_id: string }>}
 */
async function exchangePublicToken(publicToken) {
  const res = await fetch(BASE + '/auth/plaid/exchange', {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'include',
    body:         JSON.stringify({ public_token: publicToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Token exchange failed (${res.status})`);
  }
  return res.json();
}

/* ---------- Plaid Link lifecycle ---------- */

let _handler = null;  // current Plaid Link handler instance

/**
 * Open Plaid Link and connect a bank account.
 * Loads the Plaid CDN script, fetches a link token, and opens the dialog.
 *
 * @param {Object} opts
 * @param {function({ access_token, item_id, institution }): void} opts.onSuccess — called after successful connection
 * @param {function(string): void}  [opts.onError]   — called on error (receives message)
 * @param {function(): void}        [opts.onExit]    — called if user closes Link without connecting
 * @param {string}                  [opts.redirectUri] — Plaid OAuth redirect URI for OAuth-enabled banks
 * @returns {Promise<void>}
 */
export async function openPlaidLink({ onSuccess, onError, onExit, redirectUri } = {}) {
  try {
    await loadPlaidScript();
  } catch (err) {
    onError?.(err.message);
    return;
  }

  let linkToken;
  try {
    linkToken = await fetchLinkToken(redirectUri);
  } catch (err) {
    onError?.(err.message);
    return;
  }

  _handler = window.Plaid.create({
    token: linkToken,

    onSuccess(publicToken, metadata) {
      exchangePublicToken(publicToken)
        .then(({ access_token, item_id }) => {
          // Persist connection in localStorage — never sent back to server
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token, item_id }));
          if (metadata?.institution) {
            localStorage.setItem(STORAGE_ITEM_KEY, JSON.stringify(metadata.institution));
          }
          onSuccess?.({ access_token, item_id, institution: metadata?.institution || null });
        })
        .catch(err => onError?.(err.message));
    },

    onExit(err) {
      if (err) {
        console.warn('[plaid] Link exited with error:', err);
        onError?.(err.display_message || err.error_message || 'Plaid Link closed unexpectedly');
      } else {
        onExit?.();
      }
      _handler = null;
    },

    onEvent(eventName) {
      // No-op — hook point for analytics if needed
      console.debug('[plaid] event:', eventName);
    },
  });

  _handler.open();
}

/**
 * Resume a Plaid OAuth flow after the bank redirects the user back.
 * Call this when the app detects the `#/plaid-oauth-return` hash route.
 *
 * @param {Object} opts — same callbacks as openPlaidLink
 * @returns {Promise<void>}
 */
export async function resumePlaidOAuth({ onSuccess, onError, onExit } = {}) {
  const stored = sessionStorage.getItem('waymark_plaid_link_token');
  if (!stored) {
    onError?.('No pending Plaid OAuth session');
    return;
  }
  sessionStorage.removeItem('waymark_plaid_link_token');

  try {
    await loadPlaidScript();
  } catch (err) {
    onError?.(err.message);
    return;
  }

  _handler = window.Plaid.create({
    token: stored,
    receivedRedirectUri: window.location.href,

    onSuccess(publicToken, metadata) {
      exchangePublicToken(publicToken)
        .then(({ access_token, item_id }) => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token, item_id }));
          if (metadata?.institution) {
            localStorage.setItem(STORAGE_ITEM_KEY, JSON.stringify(metadata.institution));
          }
          onSuccess?.({ access_token, item_id, institution: metadata?.institution || null });
        })
        .catch(err => onError?.(err.message));
    },

    onExit(err) {
      if (err) onError?.(err.display_message || err.error_message || 'Plaid Link closed');
      else onExit?.();
      _handler = null;
    },

    onEvent(eventName) {
      console.debug('[plaid] event:', eventName);
    },
  });

  _handler.open();
}

/**
 * Disconnect the linked bank account (removes token from localStorage).
 * Does NOT call Plaid's remove endpoint — the access_token simply becomes
 * unused.  For full revocation, call the Plaid /item/remove API from your
 * own backend.
 */
export function disconnectPlaid() {
  clearStoredToken();
}

/**
 * Return true if a bank account is currently connected.
 * @returns {boolean}
 */
export function isConnected() {
  return getStoredToken() !== null;
}
