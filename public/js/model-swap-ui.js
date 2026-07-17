/* ============================================================
   model-swap-ui.js — UI controls for AI model selection
   Handles settings modal interactions and model preference persistence
   ============================================================ */

import { showToast } from './ui.js';
import { getDecryptedKey } from './templates/passwords.js';

let _currentModel = 'gemini';
let _vaultSheet = null;
let _vaultSheetId = null;

/** Initialize model swap UI in the settings modal */
export async function initializeModelSwapUI() {
  const modelSelect = document.getElementById('settings-ai-model');
  const statusText = document.getElementById('settings-ai-status-text');
  const helpBtn = document.getElementById('settings-ai-help-btn');
  const setupModal = document.getElementById('ai-setup-modal');
  const setupClose = document.getElementById('ai-setup-close');
  const setupDone = document.getElementById('ai-setup-done');

  if (!modelSelect) return; // UI not loaded

  // Load saved preference
  try {
    const saved = localStorage.getItem('waymark_ai_model') || 'gemini';
    _currentModel = saved;
    modelSelect.value = saved;
    updateStatusDisplay(statusText);
  } catch (e) {
    console.warn('Failed to load AI model preference:', e.message);
  }

  // Handle model selection change
  modelSelect.addEventListener('change', async (e) => {
    const newModel = e.target.value;
    await selectModel(newModel, statusText);
  });

  // Show help modal
  helpBtn.addEventListener('click', () => {
    setupModal.classList.remove('hidden');
  });

  setupClose.addEventListener('click', () => {
    setupModal.classList.add('hidden');
  });

  setupDone.addEventListener('click', () => {
    setupModal.classList.add('hidden');
  });

  // Close on overlay click
  setupModal.addEventListener('click', (e) => {
    if (e.target === setupModal) {
      setupModal.classList.add('hidden');
    }
  });
}

/**
 * Select an AI model and persist preference
 * @param {string} model — 'gemini' or 'claude'
 * @param {HTMLElement} statusText — Element to update with status
 */
async function selectModel(model, statusText) {
  const valid = ['gemini', 'claude'];
  if (!valid.includes(model)) {
    showToast(`Invalid model: ${model}`, 'error');
    return;
  }

  _currentModel = model;

  // Persist preference
  try {
    localStorage.setItem('waymark_ai_model', model);
  } catch (e) {
    console.warn('Failed to save AI model preference:', e.message);
  }

  // Verify credentials are available
  const key = await getModelKey(model);
  if (!key) {
    showToast(`No API key found for ${model}. Check settings.`, 'warning');
    updateStatusDisplay(statusText, false);
  } else {
    showToast(`Switched to ${model}`, 'success');
    updateStatusDisplay(statusText, true);
  }
}

/**
 * Update the status display to show current model and key status
 * @param {HTMLElement} statusText — Status text element
 * @param {boolean} hasKey — Whether a valid API key was found
 */
function updateStatusDisplay(statusText, hasKey = null) {
  const modelName = _currentModel === 'claude' ? 'Claude' : 'Gemini';
  
  let status = `Active: ${modelName}`;
  
  if (hasKey === null) {
    status += ' • Checking credentials…';
  } else if (hasKey) {
    status += ' • ✓ API key ready';
  } else {
    status += ' • ⚠️ No API key configured';
  }

  statusText.textContent = status;
}

/**
 * Get the current selected AI model
 * @returns {string} — 'gemini' or 'claude'
 */
export function getCurrentModel() {
  return _currentModel;
}

/**
 * Get API key for the specified model from vault or environment
 * @param {string} model — 'gemini' or 'claude'
 * @returns {Promise<string|null>} — API key or null
 */
export async function getModelKey(model) {
  // Try vault first (only if a password sheet is open)
  if (_vaultSheet) {
    const key = getDecryptedKey(model, _vaultSheet);
    if (key) return key;
  }

  // Try environment variables as fallback
  if (model === 'claude') {
    return process.env.ANTHROPIC_API_KEY || window.__WAYMARK_CLAUDE_KEY || null;
  } else if (model === 'gemini') {
    return process.env.GOOGLE_GEMINI_API_KEY || window.__WAYMARK_GEMINI_KEY || null;
  }

  return null;
}

/**
 * Set vault sheet data (called when password manager is open)
 * @param {Object} vaultData — { rows, cols } from password template
 * @param {string} sheetId — Google Sheets ID of the password sheet
 */
export function setVaultSheet(vaultData, sheetId) {
  _vaultSheet = vaultData;
  _vaultSheetId = sheetId;
}

/**
 * Clear vault sheet reference (called when password manager is closed)
 */
export function clearVaultSheet() {
  _vaultSheet = null;
  _vaultSheetId = null;
}

export default {
  initializeModelSwapUI,
  getCurrentModel,
  getModelKey,
  setVaultSheet,
  clearVaultSheet,
};
