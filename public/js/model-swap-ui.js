/* ============================================================
   model-swap-ui.js — UI controls for AI model selection
   Handles settings modal interactions and model preference persistence
   ============================================================ */

import { showToast } from './ui.js';
import { getDecryptedKey } from './templates/passwords.js';
import {
  getCurrentModel,
  setCurrentModel,
  getModelKey as getModelKeyFromAdapter,
  hasModelKey,
} from './model-swap.js';

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
  const currentModel = getCurrentModel();
  modelSelect.value = currentModel;
  updateStatusDisplay(statusText);

  // Handle model selection change
  modelSelect.addEventListener('change', async (e) => {
    const newModel = e.target.value;
    await selectModel(newModel, statusText);
  });

  // Show help modal
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      if (setupModal) setupModal.classList.remove('hidden');
    });
  }

  if (setupClose) {
    setupClose.addEventListener('click', () => {
      if (setupModal) setupModal.classList.add('hidden');
    });
  }

  if (setupDone) {
    setupDone.addEventListener('click', () => {
      if (setupModal) setupModal.classList.add('hidden');
    });
  }

  // Close on overlay click
  if (setupModal) {
    setupModal.addEventListener('click', (e) => {
      if (e.target === setupModal) {
        setupModal.classList.add('hidden');
      }
    });
  }
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

  // Verify credentials are available
  const key = await getAvailableKey(model);
  if (!key) {
    showToast(`No API key found for ${model}. Add it to the Password Manager vault.`, 'warning');
    updateStatusDisplay(statusText, false);
    return;
  }

  // Set the preference and show confirmation
  setCurrentModel(model);
  showToast(`Switched to ${model}`, 'success');
  updateStatusDisplay(statusText, true);
}

/**
 * Update the status display to show current model and key status
 * @param {HTMLElement} statusText — Status text element
 * @param {boolean} hasKey — Whether a valid API key was found
 */
function updateStatusDisplay(statusText, hasKey = null) {
  const model = getCurrentModel();
  const modelName = model === 'claude' ? 'Claude' : 'Gemini';
  
  let status = `Active: ${modelName}`;
  
  // Check if key is available
  const keyAvailable = hasKey !== null ? hasKey : hasModelKey(model);
  
  if (keyAvailable) {
    status += ' • ✓ API key ready';
  } else {
    status += ' • ⚠️ No API key configured';
  }

  statusText.textContent = status;
}

/**
 * Get API key for the specified model from vault or environment
 * Synchronous version for tests - returns immediately without async
 * @param {string} model — 'gemini' or 'claude'
 * @returns {string|null} — API key or null
 */
export function getModelKey(model) {
  // Try vault first (only if a password sheet is open)
  if (_vaultSheet && _vaultSheet.rows && _vaultSheet.cols) {
    const passwordCol = _vaultSheet.cols.password;
    const siteCol = _vaultSheet.cols.site;
    
    // Look for a row matching the model
    for (const row of _vaultSheet.rows) {
      const site = row[siteCol]?.toLowerCase() || '';
      const password = row[passwordCol];
      
      // Match service name
      if (model === 'gemini' && (site.includes('gemini') || site.includes('google'))) {
        return password;
      } else if (model === 'claude' && (site.includes('claude') || site.includes('anthropic'))) {
        return password;
      }
    }
  }

  // Try model-swap adapter (environment variables + window globals)
  const key = getModelKeyFromAdapter(model);
  if (key) return key;

  return null;
}

/**
 * Get API key for the specified model from vault or environment (async version)
 * @param {string} model — 'gemini' or 'claude'
 * @returns {Promise<string|null>} — API key or null
 */
export async function getAvailableKey(model) {
  // Try vault first (only if a password sheet is open)
  if (_vaultSheet) {
    const vaultKey = await getDecryptedKey(model, _vaultSheet, _vaultSheetId);
    if (vaultKey) return vaultKey;
  }

  // Try model-swap adapter (environment variables + window globals)
  const key = getModelKeyFromAdapter(model);
  if (key) return key;

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
  getModelKey,
  getAvailableKey,
  setVaultSheet,
  clearVaultSheet,
};
