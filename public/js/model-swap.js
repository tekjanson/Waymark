/* ============================================================
   model-swap.js — AI Model adapter with vault credentials fallback
   Retrieves AI keys from password vault or falls back to env/legacy
   ============================================================ */

import { getDecryptedKeySync } from './templates/passwords.js';
import {
  getAiModel,
  setAiModel,
  getStorageValue,
  setStorageValue,
} from './storage.js';

/** Module-scoped cache of vault credentials */
let _vaultCache = null;
let _vaultInitialized = false;
let _currentModel = 'claude';

/**
 * Initialize the model swap adapter.
 * Loads the preferred model from storage and caches credentials.
 * @param {Object} options
 * @param {boolean} options.enabled — Whether model swap is enabled (default: true)
 * @returns {Promise<Object>} — { claude, gemini, currentModel } with API keys or env fallbacks
 */
export async function initializeModelSwap(options = {}) {
  const { enabled = true } = options;
  
  if (_vaultInitialized) return _vaultCache;
  
  _vaultCache = {};
  
  // Load saved model preference
  try {
    _currentModel = getAiModel();
  } catch (e) {
    console.warn('Failed to load model preference:', e.message);
    _currentModel = 'claude';
  }
  
  // Load credentials from environment variables (only in Node.js environment)
  if (typeof process !== 'undefined' && process.env) {
    _vaultCache.claude = process.env.ANTHROPIC_API_KEY || null;
    _vaultCache.gemini = process.env.GOOGLE_GEMINI_API_KEY || null;
    _vaultCache.openai = process.env.OPENAI_API_KEY || null;
  }
  
  // Also check window globals (injected at runtime in browser)
  _vaultCache.claude = _vaultCache.claude || (typeof window !== 'undefined' && window.__WAYMARK_CLAUDE_KEY) || null;
  _vaultCache.gemini = _vaultCache.gemini || (typeof window !== 'undefined' && window.__WAYMARK_GEMINI_KEY) || null;
  
  _vaultInitialized = true;
  return _vaultCache;
}

/**
 * Get the currently selected AI model.
 * @returns {string} — 'claude', 'gemini', or the saved preference
 */
export function getCurrentModel() {
  return _currentModel;
}

/**
 * Set the current AI model preference.
 * @param {string} model — 'claude' or 'gemini'
 * @returns {void}
 */
export function setCurrentModel(model) {
  const valid = ['claude', 'gemini'];
  if (!valid.includes(model)) {
    console.warn(`Invalid model: ${model}`);
    return;
  }
  _currentModel = model;
  try {
    setAiModel(model);
  } catch (e) {
    console.warn('Failed to save model preference:', e.message);
  }
}

/**
 * Get an AI model API key from environment or window globals.
 * Service name examples: 'claude', 'gemini', 'openai'
 * @param {string} service — Service name (e.g. 'claude', 'gemini')
 * @returns {string|null} — API key or null if not found
 */
export function getModelKey(service) {
  if (!_vaultInitialized) {
    console.warn('Model swap not initialized. Call initializeModelSwap() first.');
    const key = service.toLowerCase();
    const envKey = (typeof process !== 'undefined' && process.env) 
      ? process.env[`${key.toUpperCase()}_API_KEY`]
      : null;
    return envKey || (typeof window !== 'undefined' && window[`__WAYMARK_${key.toUpperCase()}_KEY`]) || null;
  }
  
  const key = service.toLowerCase();
  return _vaultCache[key] || null;
}

/**
 * Browser-only: Load vault credentials from an open password manager sheet.
 * This is used by UI elements running in the browser context.
 * @param {Object} sheetData — { rows, cols } from checklist.js sheet view
 * @param {string} service — Service name (e.g. 'claude', 'gemini')
 * @returns {Promise<string|null>} — Decrypted API key from vault, or null
 */
export async function getVaultKey(sheetData, service) {
  if (!sheetData) return null;
  return getDecryptedKeySync(service, sheetData);
}

/**
 * Get both the current model and its API key.
 * @returns {Object|null} — { model: 'claude'|'gemini', key: '...' } or null if unavailable
 */
export function getCurrentModelWithKey() {
  const model = _currentModel;
  const key = getModelKey(model);
  return key ? { model, key } : null;
}

/**
 * Check if a model has a valid API key available.
 * @param {string} model — 'claude', 'gemini', etc.
 * @returns {boolean}
 */
export function hasModelKey(model) {
  const key = getModelKey(model);
  return !!key;
}

export default {
  initializeModelSwap,
  getCurrentModel,
  setCurrentModel,
  getModelKey,
  getVaultKey,
  getCurrentModelWithKey,
  hasModelKey,
};
