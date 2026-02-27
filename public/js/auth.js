/* ============================================================
   auth.js — client-side token management
   Stores access token in-memory only. Refresh token lives in
   an httpOnly cookie managed by the server.
   ============================================================ */

let accessToken = null;
let tokenExpiry  = 0;          // epoch ms
let currentUser  = null;

/* ---------- Public API ---------- */

/** Redirect browser to server's OAuth login endpoint. */
export function login() {
  window.location.href = '/auth/login';
}

/**
 * Try to obtain a fresh access token from the server.
 * Returns the user profile on success, or null if not authenticated.
 */
export async function init() {
  try {
    const ok = await refreshToken();
    if (!ok) return null;
    currentUser = await fetchUser();
    return currentUser;
  } catch {
    return null;
  }
}

/**
 * POST /auth/refresh → exchange httpOnly cookie for a new access token.
 * Returns true on success.
 */
export async function refreshToken() {
  const res = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) { accessToken = null; return false; }
  const data = await res.json();
  accessToken  = data.access_token;
  tokenExpiry  = Date.now() + (data.expires_in || 3600) * 1000 - 60_000; // refresh 1 min early
  return true;
}

/** POST /auth/logout → clear refresh token cookie. */
export async function logout() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  accessToken = null;
  tokenExpiry = 0;
  currentUser = null;
}

/** Get the current access token, auto-refreshing if needed. */
export async function getToken() {
  if (!accessToken) return null;
  if (Date.now() >= tokenExpiry) {
    const ok = await refreshToken();
    if (!ok) return null;
  }
  return accessToken;
}

/** Return cached user profile (call init first). */
export function getUser() {
  return currentUser;
}

/** Is the user currently authenticated? */
export function isLoggedIn() {
  return !!accessToken;
}

/* ---------- Internal ---------- */

async function fetchUser() {
  const token = await getToken();
  if (!token) return null;

  // In local mode the server returns a mock token; we use mock user data
  if (window.__WAYMARK_LOCAL) {
    return { name: 'Test User', email: 'testuser@gmail.com', picture: '' };
  }

  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}
