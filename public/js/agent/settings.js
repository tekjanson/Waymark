/* ============================================================
   settings.js — Agent settings modal
   API key ring and model configuration UI for the chat agent.
   Supports Gemini (Google) and Claude (Anthropic) providers.
   ============================================================ */

import { el, showToast } from '../ui.js';
import * as storage from '../storage.js';
import * as userData from '../user-data.js';
import * as vault from './vault.js';
import {
  DEFAULT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  GEMINI_MODEL_OPTIONS,
  CLAUDE_MODEL_OPTIONS,
  fetchGeminiModels,
  fetchClaudeModels,
} from './config.js';

/* ---------- Settings Modal ---------- */

/**
 * Show the agent settings modal with provider toggle (Gemini / Claude).
 * @param {Function} onRefresh
 */
export function showSettingsModal(onRefresh) {
  const existingModal = document.getElementById('agent-settings-modal');
  if (existingModal) existingModal.remove();

  /* ---------- Mutable state inside the modal ---------- */
  let activeProvider = storage.getAgentProvider() || 'gemini';
  let geminiKeys = storage.getAgentKeys();
  let claudeKeys = storage.getClaudeKeys();
  let geminiModel = storage.getAgentModel() || DEFAULT_MODEL;
  let claudeModel = storage.getClaudeModel() || DEFAULT_CLAUDE_MODEL;
  const driveSettings = userData.getAgentSettings();
  const cloudSyncEnabled = driveSettings !== null;

  /* ---------- Provider toggle ---------- */
  const geminiBtn = el('button', {
    className: 'agent-provider-btn' + (activeProvider === 'gemini' ? ' active' : ''),
    type: 'button',
    on: { click: () => switchProvider('gemini') },
  }, ['🔵 Google Gemini']);

  const claudeBtn = el('button', {
    className: 'agent-provider-btn' + (activeProvider === 'claude' ? ' active' : ''),
    type: 'button',
    on: { click: () => switchProvider('claude') },
  }, ['🟣 Anthropic Claude']);

  const providerToggle = el('div', { className: 'agent-provider-toggle' }, [geminiBtn, claudeBtn]);

  /* ---------- Key ring list ---------- */
  const keyListContainer = el('div', { className: 'agent-keyring-list' });

  function activeKeys() {
    return activeProvider === 'claude' ? claudeKeys : geminiKeys;
  }

  function renderKeyList() {
    keyListContainer.innerHTML = '';
    const currentKeys = activeKeys();
    if (currentKeys.length === 0) {
      keyListContainer.appendChild(
        el('p', { className: 'agent-keyring-empty' }, ['No API keys configured. Add one below.'])
      );
      return;
    }
    currentKeys.forEach((keyEntry, index) => {
      const row = el('div', { className: 'agent-keyring-row' }, [
        el('div', { className: 'agent-keyring-info' }, [
          el('span', { className: 'agent-keyring-nickname' }, [keyEntry.nickname || `Key ${index + 1}`]),
          el('span', { className: 'agent-keyring-masked' }, [maskKey(keyEntry.key)]),
          el('span', { className: 'agent-keyring-usage' }, [`${keyEntry.requestsToday || 0} today`]),
          keyEntry.isBilled ? el('span', { className: 'agent-keyring-badge agent-keyring-billed' }, ['Billed']) : null,
        ]),
        el('button', {
          className: 'agent-keyring-remove',
          title: 'Remove this key',
          on: {
            click: () => {
              if (activeProvider === 'claude') {
                claudeKeys = claudeKeys.filter((_, i) => i !== index);
                storage.setClaudeKeys(claudeKeys);
              } else {
                geminiKeys = geminiKeys.filter((_, i) => i !== index);
                storage.setAgentKeys(geminiKeys);
              }
              renderKeyList();
            },
          },
        }, ['✕']),
      ]);
      keyListContainer.appendChild(row);
    });
  }
  renderKeyList();

  /* ---------- Dynamic hint paragraph ---------- */
  const hintPara = el('p', { className: 'agent-settings-hint' }, []);
  function updateHint() {
    hintPara.innerHTML = '';
    if (activeProvider === 'gemini') {
      hintPara.append(
        'Add multiple free Gemini API keys to rotate between them automatically. ',
        el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, ['Get a free key →'])
      );
    } else {
      hintPara.append(
        'Add your Anthropic Claude API key. ',
        el('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, ['Get a key →'])
      );
    }
  }
  updateHint();

  /* ---------- Add-key form ---------- */
  const newKeyInput = el('input', {
    type: 'password',
    className: 'agent-settings-input',
    placeholder: activeProvider === 'claude' ? 'Paste a Claude API key (sk-ant-...)...' : 'Paste a Gemini API key...',
  });

  const newNicknameInput = el('input', {
    type: 'text',
    className: 'agent-settings-input agent-keyring-nickname-input',
    placeholder: 'Nickname (optional)',
  });

  const billedToggle = el('input', { type: 'checkbox', className: 'agent-settings-toggle' });

  const addKeyBtn = el('button', {
    className: 'agent-keyring-add-btn',
    type: 'button',
    on: {
      click: () => {
        const key = newKeyInput.value.trim();
        if (!key) { showToast('Please enter an API key', 'error'); return; }

        if (activeProvider === 'claude') {
          if (claudeKeys.some(k => k.key === key)) { showToast('This key is already in your ring', 'error'); return; }
          claudeKeys.push({
            key,
            nickname: newNicknameInput.value.trim() || `Key ${claudeKeys.length + 1}`,
            addedAt: new Date().toISOString(),
            requestsToday: 0,
            lastUsed: null,
            lastError: null,
            isBilled: billedToggle.checked,
          });
          storage.setClaudeKeys(claudeKeys);
        } else {
          if (geminiKeys.some(k => k.key === key)) { showToast('This key is already in your ring', 'error'); return; }
          geminiKeys.push({
            key,
            nickname: newNicknameInput.value.trim() || `Key ${geminiKeys.length + 1}`,
            addedAt: new Date().toISOString(),
            requestsToday: 0,
            lastUsed: null,
            lastError: null,
            isBilled: billedToggle.checked,
          });
          storage.setAgentKeys(geminiKeys);
        }

        newKeyInput.value = '';
        newNicknameInput.value = '';
        billedToggle.checked = false;
        renderKeyList();
        // Refresh model list for the newly added key
        _refreshModelDropdown().catch(() => {});
        showToast('Key added to ring', 'success');
      },
    },
  }, ['+ Add Key']);

  /* ---------- Model dropdown — immediately hardcoded, async-refreshed ---------- */
  const modelSelect = el('select', { className: 'agent-settings-select' }, []);

  function updateModelDropdown() {
    modelSelect.innerHTML = '';
    const opts = activeProvider === 'claude' ? CLAUDE_MODEL_OPTIONS : GEMINI_MODEL_OPTIONS;
    const current = activeProvider === 'claude' ? claudeModel : geminiModel;
    for (const opt of opts) {
      modelSelect.appendChild(el('option', { value: opt.value, ...(current === opt.value ? { selected: 'selected' } : {}) }, [opt.label]));
    }
    _refreshModelDropdown().catch(() => {});
  }
  updateModelDropdown();

  /** Async: replace dropdown options with live model list from provider API. */
  async function _refreshModelDropdown() {
    const key = activeKeys()[0]?.key;
    if (!key) return;
    try {
      const opts = activeProvider === 'claude'
        ? await fetchClaudeModels(key)
        : await fetchGeminiModels(key);
      const currentVal = modelSelect.value;
      modelSelect.innerHTML = '';
      for (const opt of opts) {
        const selected = opt.value === currentVal;
        modelSelect.appendChild(el('option', { value: opt.value, ...(selected ? { selected: 'selected' } : {}) }, [opt.label]));
      }
      if (!modelSelect.value && modelSelect.options.length > 0) {
        modelSelect.selectedIndex = 0;
      }
    } catch {
      // Keep hardcoded options
    }
  }

  /* ---------- Provider switch ---------- */
  function switchProvider(p) {
    if (activeProvider === 'claude') {
      claudeModel = modelSelect.value;
    } else {
      geminiModel = modelSelect.value;
    }

    activeProvider = p;
    geminiBtn.className = 'agent-provider-btn' + (p === 'gemini' ? ' active' : '');
    claudeBtn.className = 'agent-provider-btn' + (p === 'claude' ? ' active' : '');
    newKeyInput.placeholder = p === 'claude' ? 'Paste a Claude API key (sk-ant-...)...' : 'Paste a Gemini API key...';
    updateHint();
    updateModelDropdown();
    renderKeyList();
  }

  /* ---------- Cloud sync toggle ---------- */
  const cloudToggle = el('input', {
    type: 'checkbox',
    className: 'agent-settings-toggle',
    ...(cloudSyncEnabled ? { checked: 'checked' } : {}),
  });

  /* ---------- Save ---------- */
  const saveBtn = el('button', {
    className: 'agent-settings-save',
    type: 'button',
    on: {
      click: async () => {
        // Persist model from dropdown
        if (activeProvider === 'claude') {
          storage.setClaudeModel(modelSelect.value);
        } else {
          storage.setAgentModel(modelSelect.value);
        }
        storage.setAgentProvider(activeProvider);

        if (cloudToggle.checked) {
          await userData.saveAgentSettings({
            provider: activeProvider,
            keys: geminiKeys,
            model: storage.getAgentModel() || DEFAULT_MODEL,
            apiKey: geminiKeys.length > 0 ? geminiKeys[0].key : '',
            claudeKeys,
            claudeModel: storage.getClaudeModel() || DEFAULT_CLAUDE_MODEL,
          });
        } else {
          await userData.saveAgentSettings(null);
        }
        showToast('Settings saved', 'success');
        overlay.remove();
        onRefresh();
      },
    },
  }, ['Save']);

  /* ---------- Remove all keys (provider-scoped) ---------- */
  const removeAllBtn = el('button', {
    className: 'agent-settings-remove',
    type: 'button',
    on: {
      click: async () => {
        if (activeProvider === 'claude') {
          claudeKeys = [];
          storage.setClaudeKeys([]);
          showToast('All Claude API keys removed', 'info');
          renderKeyList();
        } else {
          geminiKeys = [];
          storage.setAgentKeys([]);
          await userData.saveAgentSettings(null);
          showToast('All API keys removed', 'info');
          overlay.remove();
          onRefresh();
        }
      },
    },
  }, ['Remove All Keys']);

  const closeBtn = el('button', {
    className: 'btn-icon agent-settings-close',
    type: 'button',
    on: { click: () => overlay.remove() },
  }, ['✕']);

  const modal = el('div', { className: 'modal agent-settings-modal' }, [
    el('div', { className: 'modal-header' }, [
      el('h3', {}, ['Agent Settings']),
      closeBtn,
    ]),
    el('div', { className: 'modal-body' }, [
      el('label', { className: 'agent-settings-label' }, ['AI Provider']),
      providerToggle,
      el('label', { className: 'agent-settings-label' }, ['API Key Ring']),
      hintPara,
      keyListContainer,
      el('div', { className: 'agent-keyring-add-form' }, [
        newKeyInput,
        newNicknameInput,
        el('label', { className: 'agent-keyring-billed-label' }, [
          billedToggle,
          ' This key has billing enabled',
        ]),
        addKeyBtn,
      ]),
      el('label', { className: 'agent-settings-label agent-settings-model-label' }, ['Model']),
      modelSelect,
      el('label', { className: 'agent-settings-label agent-settings-cloud-label' }, [
        cloudToggle,
        ' Sync keys across devices',
      ]),
      el('p', { className: 'agent-settings-hint' }, [
        'When enabled, your key ring and model are stored in your Google Drive so they work across all your devices.',
      ]),
      el('hr', { className: 'agent-settings-divider' }),
      buildVaultSection(),
    ]),
    el('div', { className: 'modal-footer' }, [
      (geminiKeys.length > 0 || claudeKeys.length > 0) ? removeAllBtn : el('span'),
      saveBtn,
    ]),
  ]);

  const overlay = el('div', {
    id: 'agent-settings-modal',
    className: 'modal-overlay',
    on: {
      click: (event) => { if (event.target === overlay) overlay.remove(); },
    },
  }, [modal]);

  document.body.appendChild(overlay);
  newKeyInput.focus();
}

/**
 * Build the vault section for the settings modal.
 * Shows different UI depending on vault state:
 *  - Not set up: setup form
 *  - Locked: unlock form
 *  - Unlocked: management options
 */
function buildVaultSection() {
  const isSetUp = vault.isVaultSetUp();
  const isUnlocked = vault.isVaultUnlocked();

  /* ---------- Not set up ---------- */
  if (!isSetUp) {
    const pw1 = el('input', { type: 'password', className: 'agent-settings-input', placeholder: 'Create vault password (min 8 chars)' });
    const pw2 = el('input', { type: 'password', className: 'agent-settings-input', placeholder: 'Confirm password' });

    return el('div', { className: 'agent-vault-section' }, [
      el('label', { className: 'agent-settings-label' }, ['🔐 Vault (optional)']),
      el('p', { className: 'agent-settings-hint' }, [
        'Encrypt your API keys with a password. Keys stay in your browser — Waymark and Google never see them.',
      ]),
      pw1, pw2,
      el('button', {
        className: 'agent-vault-setup-btn',
        type: 'button',
        on: {
          click: async () => {
            const p = pw1.value.trim();
            const c = pw2.value.trim();
            if (p.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
            if (p !== c) { showToast('Passwords do not match', 'error'); return; }
            const current = storage.getAgentKeys();
            const currentClaude = storage.getClaudeKeys();
            await vault.setupVault(p, {
              geminiKeys: current,
              claudeKeys: currentClaude,
              geminiModel: storage.getAgentModel() || '',
              claudeModel: storage.getClaudeModel() || '',
              provider: storage.getAgentProvider() || 'gemini',
            });
            // Clear plaintext keys (vault is now the source of truth)
            storage.setAgentKeys([]);
            storage.setClaudeKeys([]);
            showToast('Vault enabled — keys encrypted', 'success');
          },
        },
      }, ['Enable Vault']),
    ]);
  }

  /* ---------- Set up but locked ---------- */
  if (!isUnlocked) {
    const pwInput = el('input', { type: 'password', className: 'agent-settings-input', placeholder: 'Vault password' });
    return el('div', { className: 'agent-vault-section agent-vault-locked' }, [
      el('label', { className: 'agent-settings-label' }, ['🔐 Vault']),
      el('p', { className: 'agent-vault-status agent-vault-status-locked' }, ['Keys are encrypted']),
      pwInput,
      el('div', { className: 'agent-vault-btns' }, [
        el('button', {
          className: 'agent-vault-unlock-btn',
          type: 'button',
          on: {
            click: async () => {
              const ok = await vault.unlockVault(pwInput.value.trim());
              if (ok) {
                showToast('Vault unlocked', 'success');
              } else {
                showToast('Incorrect vault password', 'error');
                pwInput.value = '';
              }
            },
          },
        }, ['🔓 Unlock']),
        el('button', {
          className: 'agent-vault-clear-btn',
          type: 'button',
          on: {
            click: async () => {
              if (!confirm('Forget vault? Your encrypted keys will be deleted.')) return;
              vault.clearVault();
              showToast('Vault cleared', 'info');
            },
          },
        }, ['Forget Vault']),
      ]),
    ]);
  }

  /* ---------- Set up and unlocked ---------- */
  const newPw1 = el('input', { type: 'password', className: 'agent-settings-input', placeholder: 'New password (min 8 chars)' });
  const newPw2 = el('input', { type: 'password', className: 'agent-settings-input', placeholder: 'Confirm new password' });

  return el('div', { className: 'agent-vault-section agent-vault-unlocked' }, [
    el('label', { className: 'agent-settings-label' }, ['🔐 Vault']),
    el('p', { className: 'agent-vault-status agent-vault-status-unlocked' }, ['🔓 Keys are encrypted and unlocked this session']),
    el('div', { className: 'agent-vault-btns' }, [
      el('button', {
        className: 'agent-vault-lock-btn',
        type: 'button',
        on: {
          click: () => {
            vault.lockVault();
            showToast('Vault locked', 'info');
          },
        },
      }, ['🔐 Lock Now']),
      el('button', {
        className: 'agent-vault-clear-btn',
        type: 'button',
        on: {
          click: async () => {
            if (!confirm('Disable vault? Keys will be decrypted back to plain storage.')) return;
            const geminiKeys = vault.getGeminiKeys();
            const claudeKeys = vault.getClaudeKeys();
            vault.clearVault();
            // Restore keys to plaintext storage
            if (geminiKeys.length) storage.setAgentKeys(geminiKeys);
            if (claudeKeys.length) storage.setClaudeKeys(claudeKeys);
            showToast('Vault disabled. Keys restored.', 'info');
          },
        },
      }, ['Disable Vault']),
    ]),
    el('details', { className: 'agent-vault-change-pw' }, [
      el('summary', {}, ['Change password']),
      newPw1, newPw2,
      el('button', {
        className: 'agent-vault-setup-btn',
        type: 'button',
        on: {
          click: async () => {
            const p = newPw1.value.trim();
            const c = newPw2.value.trim();
            if (p.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
            if (p !== c) { showToast('Passwords do not match', 'error'); return; }
            const ok = await vault.saveVaultChanges({ });
            if (ok) {
              showToast('Password changed', 'success');
            } else {
              showToast('Could not change password — try locking and unlocking first', 'error');
            }
          },
        },
      }, ['Change Password']),
    ]),
  ]);
}

/**
 * Mask an API key for display: show the last 4 chars only.
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key || key.length < 8) return '····';
  return '····' + key.slice(-4);
}