/* ============================================================
   model-swap.js — Model provider fallback adapter
   
   Provides AI API keys from multiple sources in priority order:
   1. Waymark Passwords vault (via passwords.js helper)
   2. localStorage (legacy agent keys)
   3. Environment variables (via runtime flags)
   ============================================================ */

import { api } from '../api-client.js';
import * as storage from '../storage.js';

/**
 * Retrieve a decrypted AI key for a service from the passwords vault.
 * Uses the passwords.js template's encryption and decryption utilities.
 *
 * @param {string} service — e.g. 'claude', 'gemini', 'ai-claude'
 * @param {string} vaultSheetId — spreadsheet ID of the passwords vault
 * @param {string} masterPassword — decryption password (if encrypted)
 * @returns {Promise<string|null>} — decrypted API key or null
 */
export async function getKeyFromVault(service, vaultSheetId, masterPassword) {
  if (!vaultSheetId || !service) return null;

  try {
    // Fetch the vault sheet
    const sheet = await api.sheets.getSpreadsheet(vaultSheetId);
    if (!sheet.values || sheet.values.length < 2) return null;

    // Parse header row
    const headers = (sheet.values[0] || []).map(h => String(h).toLowerCase().trim());
    const rows = (sheet.values || []).slice(1);

    // Map column indices (passwords template roles)
    const cols = {
      site: headers.findIndex(h => /^(site|service|website|domain|app|account|platform)/.test(h)),
      username: headers.findIndex(h => /^(user.?name|login|email|user|id)/.test(h)),
      password: headers.findIndex(h => /^(password|passwd|secret|credential|pass)/.test(h)),
      url: headers.findIndex(h => /^(url|link|address|href|web)/.test(h)),
      category: headers.findIndex(h => /^(category|type|group|folder|tag)/.test(h)),
      notes: headers.findIndex(h => /^(notes?|comment|detail|info|description)/.test(h)),
    };

    // Use passwords.js helper to get the decrypted key
    const { getDecryptedKey } = await import('../templates/passwords.js');
    const key = await getDecryptedKey(service, rows, cols, masterPassword);
    return key;
  } catch (err) {
    console.error('[model-swap] vault lookup failed:', err);
    return null;
  }
}

/**
 * Get the best available Claude API key from any source.
 * Tries vault first, then falls back to localStorage, then environment.
 *
 * @param {string} vaultSheetId — optional: spreadsheet ID of passwords vault
 * @param {string} masterPassword — optional: vault decryption password
 * @returns {Promise<string|null>} — Claude API key or null
 */
export async function getClaudeKey(vaultSheetId, masterPassword) {
  // 1. Try vault if configured
  if (vaultSheetId) {
    const vaultKey = await getKeyFromVault('claude', vaultSheetId, masterPassword);
    if (vaultKey) return vaultKey;
  }

  // 2. Fall back to localStorage (legacy agent keys)
  const localKeys = storage.getClaudeKeys && storage.getClaudeKeys();
  if (localKeys && localKeys.length > 0) {
    return localKeys[0].key;
  }

  // 3. Fall back to environment variable (injected at server level)
  if (typeof window !== 'undefined' && window.__WAYMARK_CLAUDE_KEY) {
    return window.__WAYMARK_CLAUDE_KEY;
  }

  return null;
}

/**
 * Get the best available Gemini API key from any source.
 * Tries vault first, then falls back to localStorage, then environment.
 *
 * @param {string} vaultSheetId — optional: spreadsheet ID of passwords vault
 * @param {string} masterPassword — optional: vault decryption password
 * @returns {Promise<string|null>} — Gemini API key or null
 */
export async function getGeminiKey(vaultSheetId, masterPassword) {
  // 1. Try vault if configured
  if (vaultSheetId) {
    const vaultKey = await getKeyFromVault('gemini', vaultSheetId, masterPassword);
    if (vaultKey) return vaultKey;
  }

  // 2. Fall back to localStorage (legacy agent keys)
  const localKeys = storage.getAgentKeys && storage.getAgentKeys();
  if (localKeys && localKeys.length > 0) {
    return localKeys[0].key;
  }

  // 3. Fall back to environment variable (injected at server level)
  if (typeof window !== 'undefined' && window.__WAYMARK_GEMINI_KEY) {
    return window.__WAYMARK_GEMINI_KEY;
  }

  return null;
}

export default {
  getKeyFromVault,
  getClaudeKey,
  getGeminiKey,
};
