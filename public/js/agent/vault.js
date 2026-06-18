/* ============================================================
   vault.js — Agent Keys Sheet integration
   Reads AI API keys from a Waymark Passwords sheet.

   The keys live in your own Google Sheet (passwords template).
   The Password column can be encrypted with encryption.js —
   neither Waymark nor Google ever sees your plaintext keys.

   Flow:
     1. User links their passwords sheet in Agent Settings
     2. Agent reads the sheet; finds rows for Gemini / Claude
     3. If Password column is encrypted → user enters sheet password
     4. encryption.unlock() decrypts in-memory; keys are used
     5. lock() clears decryption key from memory (or on page close)
   ============================================================ */

import { api } from '../api-client.js';
import * as encryption from '../encryption.js';

/* ---------- localStorage keys ---------- */

const LS_SHEET_ID   = 'waymark_agent_keys_sheet_id';
const LS_SHEET_NAME = 'waymark_agent_keys_sheet_name';

/* ---------- In-memory session ---------- */

/** @type {{ geminiKeys: Array, claudeKeys: Array } | null} */
let _session = null;

/* ---------- Link / Unlink ---------- */

/** @returns {string|null} */
export function getLinkedSheetId() {
  try { return JSON.parse(localStorage.getItem(LS_SHEET_ID) || 'null'); } catch { return null; }
}

/** @returns {string} friendly sheet name */
export function getLinkedSheetName() {
  try { return JSON.parse(localStorage.getItem(LS_SHEET_NAME) || 'null') || 'Passwords sheet'; } catch { return 'Passwords sheet'; }
}

/**
 * Link a passwords sheet as the AI keys source.
 * @param {string} id   — spreadsheet ID
 * @param {string} name — friendly title
 */
export function linkSheet(id, name) {
  localStorage.setItem(LS_SHEET_ID, JSON.stringify(id));
  localStorage.setItem(LS_SHEET_NAME, JSON.stringify(name || id));
  _session = null; // force re-unlock after linking
}

/** Remove the link and lock. */
export function unlinkSheet() {
  const id = getLinkedSheetId();
  if (id) encryption.lock(id);
  localStorage.removeItem(LS_SHEET_ID);
  localStorage.removeItem(LS_SHEET_NAME);
  _session = null;
}

/* ---------- Lock / Unlock status ---------- */

/** @returns {boolean} a sheet has been linked */
export function isVaultSetUp() {
  return !!getLinkedSheetId();
}

/** @returns {boolean} keys are decrypted and in memory */
export function isVaultUnlocked() {
  return _session !== null;
}

/** Lock — evict in-memory keys and encryption key. */
export function lockVault() {
  const id = getLinkedSheetId();
  if (id) encryption.lock(id);
  _session = null;
}

/* ---------- Unlock ---------- */

/**
 * Read the linked passwords sheet and decrypt the Password column.
 * Classifies each row as a Gemini key or Claude key by Site/Category/Notes.
 * Returns true on success, false on wrong password or unreadable sheet.
 * @param {string} password — sheet unlock password (empty string if unencrypted)
 * @returns {Promise<boolean>}
 */
export async function unlockVault(password) {
  const sheetId = getLinkedSheetId();
  if (!sheetId) return false;

  try {
    const sheet = await api.sheets.getSpreadsheet(sheetId);
    const headers = (sheet.values?.[0] || []).map(h => String(h).toLowerCase().trim());
    const rows    = (sheet.values || []).slice(1);

    /* Identify column indices (passwords template roles) */
    const siteCol     = headers.findIndex(h => /^(site|service|website|domain|app|account|platform)/.test(h));
    const usernameCol = headers.findIndex(h => /^(user.?name|login|email|user|id)/.test(h));
    const passwordCol = headers.findIndex(h => /^(password|passwd|secret|credential|pass)/.test(h));
    const categoryCol = headers.findIndex(h => /^(category|type|group|folder|tag)/.test(h));
    const notesCol    = headers.findIndex(h => /^(notes?|comment|detail|info|description)/.test(h));

    /* Check if column is encrypted and validate password */
    const encryptedSample = passwordCol >= 0
      ? rows.map(r => (r[passwordCol] || '')).find(v => encryption.isEncrypted(v))
      : undefined;

    if (encryptedSample) {
      const ok = await encryption.unlock(password, sheetId, encryptedSample);
      if (!ok) return false;
    }

    /* Read and classify rows */
    const geminiKeys = [];
    const claudeKeys = [];

    for (const row of rows) {
      const site      = siteCol     >= 0 ? String(row[siteCol]     || '') : '';
      const username  = usernameCol >= 0 ? String(row[usernameCol] || '') : '';
      const rawPw     = passwordCol >= 0 ? String(row[passwordCol] || '') : '';
      const category  = categoryCol >= 0 ? String(row[categoryCol] || '') : '';
      const notes     = notesCol    >= 0 ? String(row[notesCol]    || '') : '';

      if (!rawPw) continue;

      const decrypted = encryption.isEncrypted(rawPw)
        ? await encryption.decrypt(sheetId, rawPw)
        : rawPw;

      if (!decrypted) continue; // wrong key → skip silently

      const searchText = `${site} ${username} ${category} ${notes}`.toLowerCase();
      const entry = {
        key:           decrypted.trim(),
        nickname:      site || 'Sheet Key',
        addedAt:       new Date().toISOString(),
        requestsToday: 0,
        lastUsed:      null,
        lastError:     null,
        isBilled:      /billed|paid|pro/i.test(searchText),
      };

      if (/gemini|google|aistudio|ai\.google/i.test(searchText)) {
        geminiKeys.push(entry);
      } else if (/claude|anthropic|sonnet|haiku|opus/i.test(searchText)) {
        claudeKeys.push(entry);
      }
    }

    _session = { geminiKeys, claudeKeys };
    return true;
  } catch (err) {
    console.error('[keys-sheet] unlock failed:', err);
    return false;
  }
}

/* ---------- Key accessors ---------- */

/** @returns {Array} Gemini key entries (empty when locked) */
export function getGeminiKeys() { return _session?.geminiKeys || []; }

/** @returns {Array} Claude key entries (empty when locked) */
export function getClaudeKeys() { return _session?.claudeKeys || []; }

