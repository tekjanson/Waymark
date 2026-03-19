/* ============================================================
   settings.js — Agent settings modal
   API key ring and model configuration UI for the chat agent.
   ============================================================ */

import { el, showToast } from '../ui.js';
import * as storage from '../storage.js';
import * as userData from '../user-data.js';
import { DEFAULT_MODEL } from './config.js';

/* ---------- Settings Modal ---------- */

/**
 * Show the agent settings modal.
 * @param {Function} onRefresh
 */
export function showSettingsModal(onRefresh) {
  const existingModal = document.getElementById('agent-settings-modal');
  if (existingModal) existingModal.remove();

  const keys = storage.getAgentKeys();
  const currentModel = storage.getAgentModel() || DEFAULT_MODEL;
  const driveSettings = userData.getAgentSettings();
  const cloudSyncEnabled = driveSettings !== null;

  const keyListContainer = el('div', { className: 'agent-keyring-list' });

  function renderKeyList() {
    keyListContainer.innerHTML = '';
    const currentKeys = storage.getAgentKeys();
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
              const updated = storage.getAgentKeys().filter((_, keyIndex) => keyIndex !== index);
              storage.setAgentKeys(updated);
              renderKeyList();
            },
          },
        }, ['✕']),
      ]);
      keyListContainer.appendChild(row);
    });
  }
  renderKeyList();

  const newKeyInput = el('input', {
    type: 'password',
    className: 'agent-settings-input',
    placeholder: 'Paste a Gemini API key...',
  });

  const newNicknameInput = el('input', {
    type: 'text',
    className: 'agent-settings-input agent-keyring-nickname-input',
    placeholder: 'Nickname (optional, e.g. "Personal")',
  });

  const billedToggle = el('input', {
    type: 'checkbox',
    className: 'agent-settings-toggle',
  });

  const addKeyBtn = el('button', {
    className: 'agent-keyring-add-btn',
    on: {
      click: () => {
        const key = newKeyInput.value.trim();
        if (!key) { showToast('Please enter an API key', 'error'); return; }
        const current = storage.getAgentKeys();
        if (current.some(existing => existing.key === key)) { showToast('This key is already in your ring', 'error'); return; }
        current.push({
          key,
          nickname: newNicknameInput.value.trim() || `Key ${current.length + 1}`,
          addedAt: new Date().toISOString(),
          requestsToday: 0,
          lastUsed: null,
          lastError: null,
          isBilled: billedToggle.checked,
        });
        storage.setAgentKeys(current);
        newKeyInput.value = '';
        newNicknameInput.value = '';
        billedToggle.checked = false;
        renderKeyList();
        showToast('Key added to ring', 'success');
      },
    },
  }, ['+ Add Key']);

  const modelSelect = el('select', { className: 'agent-settings-select' }, [
    el('option', { value: 'gemini-flash-latest', selected: currentModel === 'gemini-flash-latest' }, ['Gemini Flash Latest']),
    el('option', { value: 'gemini-2.0-flash', selected: currentModel === 'gemini-2.0-flash' }, ['Gemini 2.0 Flash (fast)']),
    el('option', { value: 'gemini-2.0-flash-lite', selected: currentModel === 'gemini-2.0-flash-lite' }, ['Gemini 2.0 Flash Lite (fastest)']),
    el('option', { value: 'gemini-2.5-flash-preview-05-20', selected: currentModel === 'gemini-2.5-flash-preview-05-20' }, ['Gemini 2.5 Flash (balanced)']),
    el('option', { value: 'gemini-2.5-pro-preview-05-06', selected: currentModel === 'gemini-2.5-pro-preview-05-06' }, ['Gemini 2.5 Pro (best)']),
  ]);

  const toggleAttrs = {
    type: 'checkbox',
    className: 'agent-settings-toggle',
  };
  if (cloudSyncEnabled) toggleAttrs.checked = 'checked';
  const cloudToggle = el('input', toggleAttrs);

  const saveBtn = el('button', {
    className: 'agent-settings-save',
    on: {
      click: async () => {
        const current = storage.getAgentKeys();
        storage.setAgentModel(modelSelect.value);
        if (cloudToggle.checked) {
          await userData.saveAgentSettings({
            apiKey: current.length > 0 ? current[0].key : '',
            model: modelSelect.value,
            keys: current,
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

  const removeAllBtn = el('button', {
    className: 'agent-settings-remove',
    on: {
      click: async () => {
        storage.setAgentKeys([]);
        await userData.saveAgentSettings(null);
        showToast('All API keys removed', 'info');
        overlay.remove();
        onRefresh();
      },
    },
  }, ['Remove All Keys']);

  const closeBtn = el('button', {
    className: 'btn-icon agent-settings-close',
    on: { click: () => overlay.remove() },
  }, ['✕']);

  const modal = el('div', { className: 'modal agent-settings-modal' }, [
    el('div', { className: 'modal-header' }, [
      el('h3', {}, ['Agent Settings']),
      closeBtn,
    ]),
    el('div', { className: 'modal-body' }, [
      el('label', { className: 'agent-settings-label' }, ['API Key Ring']),
      el('p', { className: 'agent-settings-hint' }, [
        'Add multiple free Gemini API keys to rotate between them automatically. ',
        el('a', {
          href: 'https://aistudio.google.com/apikey',
          target: '_blank',
          rel: 'noopener',
        }, ['Get a free key →']),
      ]),
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
    ]),
    el('div', { className: 'modal-footer' }, [
      keys.length > 0 ? removeAllBtn : el('span'),
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
 * Mask an API key for display: show the last 4 chars only.
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key || key.length < 8) return '····';
  return '····' + key.slice(-4);
}