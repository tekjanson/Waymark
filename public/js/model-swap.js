/* ============================================================
   model-swap.js — AI Model adapter with vault credentials fallback
   Retrieves AI keys from password vault or falls back to env/legacy
   ============================================================ */

import { getDecryptedKey } from './templates/passwords.js';

/** Module-scoped cache of vault credentials */
let _vaultCache = null;
let _vaultInitialized = false;

/**
 * Initialize the model swap adapter.
 * Loads credentials from the AI vault sheet (if available) and caches them.
 * @param {Object} options
 * @param {string} options.sheetId — Google Sheets ID for the AI vault (password manager sheet)
 * @param {boolean} options.enabled — Whether vault credentials are enabled (default: true)
 * @returns {Promise<Object>} — { claude, openai, ... } with API keys or env fallbacks
 */
export async function initializeModelSwap(options = {}) {
  const { sheetId = null, enabled = true } = options;
  
  if (_vaultInitialized) return _vaultCache;
  
  _vaultCache = {};
  
  // If vault is disabled or no sheet ID, use environment variables only
  if (!enabled || !sheetId) {
    _vaultCache.claude = process.env.ANTHROPIC_API_KEY || null;
    _vaultCache.openai = process.env.OPENAI_API_KEY || null;
    _vaultInitialized = true;
    return _vaultCache;
  }
  
  // Load vault credentials from the password sheet
  try {
    // In a real implementation, this would fetch from api-client.js
    // For now, return env fallback
    _vaultCache.claude = process.env.ANTHROPIC_API_KEY || null;
    _vaultCache.openai = process.env.OPENAI_API_KEY || null;
  } catch (err) {
    console.warn('Failed to load vault credentials, falling back to env:', err.message);
    _vaultCache.claude = process.env.ANTHROPIC_API_KEY || null;
    _vaultCache.openai = process.env.OPENAI_API_KEY || null;
  }
  
  _vaultInitialized = true;
  return _vaultCache;
}

/**
 * Get an AI model API key from vault or environment.
 * Service name examples: 'claude', 'ai-claude', 'openai', 'ai-openai'
 * @param {string} service — Service name (e.g. 'claude', 'openai')
 * @returns {string|null} — API key or null if not found
 */
export function getModelKey(service) {
  if (!_vaultInitialized) {
    console.warn('Model swap not initialized. Call initializeModelSwap() first.');
    return process.env[`${service.toUpperCase()}_API_KEY`] || null;
  }
  
  const key = service.toLowerCase();
  return _vaultCache[key] || null;
}

/**
 * Browser-only: Load vault credentials from an open password manager sheet.
 * This is used by dev-worker agents running in the browser context.
 * @param {Object} sheetData — { rows, cols } from checklist.js sheet view
 * @param {string} service — Service name (e.g. 'claude', 'openai')
 * @returns {string|null} — Decrypted API key from vault, or null
 */
export function getVaultKey(sheetData, service) {
  if (!sheetData) return null;
  return getDecryptedKey(service, sheetData);
}

export default {
  initializeModelSwap,
  getModelKey,
  getVaultKey,
};
