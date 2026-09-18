/* ============================================================
   service-account.js — Zero-dependency Google access token helper
   ============================================================ */

'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build and exchange a service-account JWT for an OAuth access token.
 * @param {{ client_email: string, private_key: string }} creds
 * @param {string} scope
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
async function fetchAccessToken(creds, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: creds.client_email,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(creds.private_key);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/**
 * Create a cached token getter for a service-account key file.
 * @param {{ keyFile: string, scope: string }} options
 * @returns {() => Promise<string>}
 */
function createTokenProvider({ keyFile, scope }) {
  if (!keyFile) throw new Error('service-account: keyFile is required');
  if (!scope) throw new Error('service-account: scope is required');

  const creds = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  let cached = null;

  return async function getToken() {
    if (!cached || cached.expiresAt - 60_000 < Date.now()) {
      cached = await fetchAccessToken(creds, scope);
    }
    return cached.token;
  };
}

module.exports = {
  base64url,
  createTokenProvider,
  fetchAccessToken,
};