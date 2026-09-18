/* ============================================================
   lib/sheets.js — Zero-dependency Google Sheets REST client

   Authenticates with a service-account JSON key using a self-signed
   RS256 JWT (Node's built-in `crypto`) and exchanges it for an OAuth
   access token. No `google-auth-library` required — this mirrors the
   pure-bash approach in write-agent-sheet.sh so the Dream-RSI worker
   runs in the container with zero extra `npm install` steps.

   Exposes just the primitives the Discovery_Tree + workboard need:
   read, update, append, ensure-tab, and insert-row.

   Usage:
     const { createSheetsClient } = require('./lib/sheets');
     const sheets = createSheetsClient({
       keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
       spreadsheetId: '1AbC...',
     });
     await sheets.ensureTab('Discovery_Tree');
     await sheets.append('Discovery_Tree!A:K', [[...row]]);
   ============================================================ */

'use strict';

const fs = require('fs');
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/* ---------- JWT / token ---------- */

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build a signed service-account JWT and exchange it for an access token.
 * @param {Object} creds — parsed SA key JSON ({ client_email, private_key })
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
async function fetchAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(creds.private_key);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/* ---------- Client factory ---------- */

/**
 * @param {Object} opts
 * @param {string} opts.keyFile — path to the service-account JSON key
 * @param {string} opts.spreadsheetId — target spreadsheet
 * @returns {Object} sheets client
 */
function createSheetsClient({ keyFile, spreadsheetId }) {
  if (!keyFile) throw new Error('sheets: keyFile (GOOGLE_APPLICATION_CREDENTIALS) is required');
  if (!spreadsheetId) throw new Error('sheets: spreadsheetId is required');

  const creds = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  let cached = null; // { token, expiresAt }

  async function token() {
    // Refresh 60s before expiry to avoid mid-request 401s.
    if (!cached || cached.expiresAt - 60_000 < Date.now()) {
      cached = await fetchAccessToken(creds);
    }
    return cached.token;
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Sheets ${method} ${path} → ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  return {
    spreadsheetId,

    /** Read a range → 2D array of strings (empty array if blank). */
    async get(range) {
      const data = await api(`/values/${encodeURIComponent(range)}`);
      return data.values || [];
    },

    /** Overwrite a range (valueInputOption=RAW). */
    async update(range, values) {
      return api(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: { values },
      });
    },

    /** Append rows to the end of a table (INSERT_ROWS). */
    async append(range, values) {
      return api(
        `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: 'POST', body: { values } }
      );
    },

    /**
     * Update several disjoint ranges in ONE request.
     * @param {Array<{range:string, values:string[][]}>} data
     */
    async batchUpdate(data) {
      if (!data || !data.length) return null;
      return api('/values:batchUpdate', {
        method: 'POST',
        body: { valueInputOption: 'RAW', data },
      });
    },

    /** List all tab titles. */
    async listTabs() {
      const data = await api('?fields=sheets.properties');
      return (data.sheets || []).map((s) => s.properties);
    },

    /** Numeric sheetId (gid) for a tab title, or null if absent. */
    async getTabGid(title) {
      const tabs = await this.listTabs();
      const tab = tabs.find((p) => p.title === title);
      return tab ? tab.sheetId : null;
    },

    /**
     * Ensure a tab exists; create it (with optional header row) if missing.
     * Returns { created: boolean, gid }.
     */
    async ensureTab(title, headerRow) {
      let gid = await this.getTabGid(title);
      if (gid !== null) return { created: false, gid };

      const reply = await api(':batchUpdate', {
        method: 'POST',
        body: { requests: [{ addSheet: { properties: { title } } }] },
      });
      gid = reply.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
      if (headerRow && headerRow.length) {
        await this.update(`${title}!A1`, [headerRow]);
      }
      return { created: true, gid };
    },

    /**
     * Insert a blank row directly below `afterRow` (1-based) in the given tab,
     * then return the new row's 1-based number. Used for workboard note
     * sub-rows so existing data is never overwritten.
     */
    async insertRowAfter(gid, afterRow) {
      await api(':batchUpdate', {
        method: 'POST',
        body: {
          requests: [
            {
              insertDimension: {
                range: { sheetId: gid, dimension: 'ROWS', startIndex: afterRow, endIndex: afterRow + 1 },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });
      return afterRow + 1;
    },

    /**
     * Delete rows [startRow, endRow] (1-based, inclusive) from the given tab.
     * Deleting shifts lower rows up, so callers removing several rows should
     * delete from the highest row number down to keep indices valid.
     */
    async deleteRows(gid, startRow, endRow) {
      await api(':batchUpdate', {
        method: 'POST',
        body: {
          requests: [
            {
              deleteDimension: {
                range: { sheetId: gid, dimension: 'ROWS', startIndex: startRow - 1, endIndex: endRow },
              },
            },
          ],
        },
      });
    },
  };
}

module.exports = { createSheetsClient, fetchAccessToken, base64url };
