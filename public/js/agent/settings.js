/* ============================================================
   settings.js — Agent settings modal
   API key ring and model configuration UI for the chat agent.
   Supports Gemini (Google) and Claude (Anthropic) providers.
   ============================================================ */

import { el, showToast } from '../ui.js';
import * as storage from '../storage.js';
import * as userData from '../user-data.js';
import * as vault from './vault.js';
import { api } from '../api-client.js';
import {
  DEFAULT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  GEMINI_MODEL_OPTIONS,
  CLAUDE_MODEL_OPTIONS,
  OLLAMA_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  fetchGeminiModels,
  fetchClaudeModels,
  fetchOpenAIModels,
  pickSmartDefault,
} from './config.js';
import {
  ALL_PROVIDERS,
  getProviderStatus,
  providerHasConfig,
  tierBadge,
  testProviderConnection,
} from '../ai-router.js';

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
  let openaiKeys = storage.getOpenAIKeys();
  let geminiModel = storage.getAgentModel() || DEFAULT_MODEL;
  let claudeModel = storage.getClaudeModel() || DEFAULT_CLAUDE_MODEL;
  let ollamaModel = storage.getOllamaModel() || DEFAULT_OLLAMA_MODEL;
  let openaiModel = storage.getOpenAIModel() || DEFAULT_OPENAI_MODEL;
  let ollamaBaseUrl = storage.getOllamaBaseUrl() || DEFAULT_OLLAMA_BASE_URL;
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

  const ollamaBtn = el('button', {
    className: 'agent-provider-btn' + (activeProvider === 'ollama' ? ' active' : ''),
    type: 'button',
    on: { click: () => switchProvider('ollama') },
  }, ['🟢 Ollama']);

  const openaiBtn = el('button', {
    className: 'agent-provider-btn' + (activeProvider === 'openai' ? ' active' : ''),
    type: 'button',
    on: { click: () => switchProvider('openai') },
  }, ['⚫ OpenAI']);

  const providerToggle = el('div', { className: 'agent-provider-toggle' }, [geminiBtn, claudeBtn, ollamaBtn, openaiBtn]);

  /* ---------- Key ring list ---------- */
  const keyListContainer = el('div', { className: 'agent-keyring-list' });

  function activeKeys() {
    if (activeProvider === 'ollama') return [];
    // When keys sheet is unlocked, show its keys; otherwise localStorage ring
    if (vault.isVaultSetUp() && vault.isVaultUnlocked()) {
      if (activeProvider === 'claude') return vault.getClaudeKeys();
      if (activeProvider === 'gemini') return vault.getGeminiKeys();
      if (activeProvider === 'openai') {
        const vk = vault.getOpenAIKeys();
        if (vk.length) return vk;
      }
    }
    if (activeProvider === 'claude') return claudeKeys;
    if (activeProvider === 'openai') return openaiKeys;
    return geminiKeys;
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
              } else if (activeProvider === 'openai') {
                openaiKeys = openaiKeys.filter((_, i) => i !== index);
                storage.setOpenAIKeys(openaiKeys);
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
    } else if (activeProvider === 'claude') {
      hintPara.append(
        'Add your Anthropic Claude API key. ',
        el('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, ['Get a key →'])
      );
    } else if (activeProvider === 'openai') {
      hintPara.append(
        'Add your OpenAI API key — the only provider that can generate photorealistic images (gpt-image-1 / DALL·E 3). ',
        el('a', { href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener' }, ['Get a key →'])
      );
    } else {
      hintPara.append('No API key is required. Point Waymark at your local Ollama server and choose a local model.');
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
      click: async () => {
        const key = newKeyInput.value.trim();
        if (!key) { showToast('Please enter an API key', 'error'); return; }

        const nickname = newNicknameInput.value.trim();
        const isBilled = billedToggle.checked;

        /* If a keys sheet (Vault) is linked and unlocked, persist the key to
           that Google Sheet for all providers, including OpenAI. The write is
           awaited so the success badge only shows once Sheets confirms. */
        if (vault.isVaultSetUp() && vault.isVaultUnlocked()) {
          const ok = await vault.addKeyToSheet({
            key, nickname, isBilled, provider: activeProvider,
          });
          if (ok) {
            // Mirror OpenAI into the localStorage ring too so the router can use
            // it immediately before the next vault hydrate.
            if (activeProvider === 'openai' && !openaiKeys.some(k => k.key === key)) {
              openaiKeys.push({
                key, nickname: nickname || `Key ${openaiKeys.length + 1}`,
                addedAt: new Date().toISOString(), requestsToday: 0,
                lastUsed: null, lastError: null, isBilled,
              });
              storage.setOpenAIKeys(openaiKeys);
            }
            newKeyInput.value = '';
            newNicknameInput.value = '';
            billedToggle.checked = false;
            renderKeyList();
            _refreshModelDropdown().catch(() => {});
            showToast(
              activeProvider === 'openai'
                ? '🔑 OpenAI Vault: Synced'
                : 'Key added to your passwords sheet',
              'success',
            );
            return;
          }
          // Fall through to localStorage if sheet write fails
          showToast('Could not write to sheet — saved locally instead', 'error');
        }

        if (activeProvider === 'claude') {
          if (claudeKeys.some(k => k.key === key)) { showToast('This key is already in your ring', 'error'); return; }
          claudeKeys.push({
            key,
            nickname: nickname || `Key ${claudeKeys.length + 1}`,
            addedAt: new Date().toISOString(),
            requestsToday: 0,
            lastUsed: null,
            lastError: null,
            isBilled,
          });
          storage.setClaudeKeys(claudeKeys);
        } else if (activeProvider === 'openai') {
          if (openaiKeys.some(k => k.key === key)) { showToast('This key is already in your ring', 'error'); return; }
          openaiKeys.push({
            key,
            nickname: nickname || `Key ${openaiKeys.length + 1}`,
            addedAt: new Date().toISOString(),
            requestsToday: 0,
            lastUsed: null,
            lastError: null,
            isBilled,
          });
          storage.setOpenAIKeys(openaiKeys);
        } else {
          if (geminiKeys.some(k => k.key === key)) { showToast('This key is already in your ring', 'error'); return; }
          geminiKeys.push({
            key,
            nickname: nickname || `Key ${geminiKeys.length + 1}`,
            addedAt: new Date().toISOString(),
            requestsToday: 0,
            lastUsed: null,
            lastError: null,
            isBilled,
          });
          storage.setAgentKeys(geminiKeys);
        }

        newKeyInput.value = '';
        newNicknameInput.value = '';
        billedToggle.checked = false;
        renderKeyList();
        _refreshModelDropdown().catch(() => {});
        showToast('Key added to ring', 'success');
      },
    },
  }, ['+ Add Key']);

  const addKeyForm = el('div', { className: 'agent-keyring-add-form' }, [
    newKeyInput,
    newNicknameInput,
    el('label', { className: 'agent-keyring-billed-label' }, [
      billedToggle,
      ' This key has billing enabled',
    ]),
    addKeyBtn,
  ]);

  /* ---------- Model dropdown — immediately hardcoded, async-refreshed ---------- */
  const modelSelect = el('select', { className: 'agent-settings-select' }, []);
  const baseUrlInput = el('input', {
    type: 'text',
    className: 'agent-settings-input',
    value: ollamaBaseUrl,
    placeholder: 'http://127.0.0.1:11434',
  });
  const ollamaSettingsRow = el('div', { className: 'agent-ollama-settings' }, [
    el('label', { className: 'agent-settings-label' }, ['Ollama Base URL']),
    baseUrlInput,
    el('p', { className: 'agent-settings-hint' }, ['Point Waymark at your local Ollama server, for example http://127.0.0.1:11434.']),
  ]);

  function updateModelDropdown() {
    modelSelect.innerHTML = '';
    let opts = GEMINI_MODEL_OPTIONS;
    let current = geminiModel;
    if (activeProvider === 'claude') {
      opts = CLAUDE_MODEL_OPTIONS;
      current = claudeModel;
    } else if (activeProvider === 'ollama') {
      opts = OLLAMA_MODEL_OPTIONS;
      current = ollamaModel;
    } else if (activeProvider === 'openai') {
      opts = OPENAI_MODEL_OPTIONS;
      current = openaiModel;
    }
    for (const opt of opts) {
      modelSelect.appendChild(el('option', { value: opt.value, ...(current === opt.value ? { selected: 'selected' } : {}) }, [opt.label]));
    }
    _refreshModelDropdown().catch(() => {});
  }
  switchProvider(activeProvider);

  /** Async: replace dropdown options with live model list from provider API. */
  async function _refreshModelDropdown() {
    if (activeProvider === 'ollama') return;
    const key = activeKeys()[0]?.key;
    if (!key) return;
    try {
      let opts;
      if (activeProvider === 'claude') opts = await fetchClaudeModels(key);
      else if (activeProvider === 'openai') opts = await fetchOpenAIModels(key);
      else opts = await fetchGeminiModels(key);
      const currentVal = modelSelect.value;
      modelSelect.innerHTML = '';
      for (const opt of opts) {
        const selected = opt.value === currentVal;
        modelSelect.appendChild(el('option', { value: opt.value, ...(selected ? { selected: 'selected' } : {}) }, [opt.label]));
      }
      // Saved model not in live list — auto-pick the best available and persist it
      if (!modelSelect.value && opts.length > 0) {
        const best = activeProvider === 'gemini' ? pickSmartDefault(opts) : opts[0].value;
        modelSelect.value = best;
        if (!modelSelect.value) modelSelect.selectedIndex = 0;
        if (activeProvider === 'gemini') {
          geminiModel = modelSelect.value;
          storage.setAgentModel(modelSelect.value);
        } else if (activeProvider === 'claude') {
          claudeModel = modelSelect.value;
          storage.setClaudeModel(modelSelect.value);
        } else if (activeProvider === 'openai') {
          openaiModel = modelSelect.value;
          storage.setOpenAIModel(modelSelect.value);
        }
      }
    } catch {
      // Keep hardcoded options
    }
  }

  /* ---------- Provider switch ---------- */
  function switchProvider(p) {
    if (activeProvider === 'claude') {
      claudeModel = modelSelect.value;
    } else if (activeProvider === 'ollama') {
      ollamaModel = modelSelect.value;
    } else if (activeProvider === 'openai') {
      openaiModel = modelSelect.value;
    } else {
      geminiModel = modelSelect.value;
    }

    activeProvider = p;
    geminiBtn.className = 'agent-provider-btn' + (p === 'gemini' ? ' active' : '');
    claudeBtn.className = 'agent-provider-btn' + (p === 'claude' ? ' active' : '');
    ollamaBtn.className = 'agent-provider-btn' + (p === 'ollama' ? ' active' : '');
    openaiBtn.className = 'agent-provider-btn' + (p === 'openai' ? ' active' : '');
    newKeyInput.placeholder = p === 'claude'
      ? 'Paste a Claude API key (sk-ant-...)...'
      : p === 'openai'
        ? 'Paste an OpenAI API key (sk-...)...'
        : 'Paste a Gemini API key...';
    addKeyForm.style.display = p === 'ollama' ? 'none' : '';
    keyListContainer.style.display = p === 'ollama' ? 'none' : '';
    ollamaSettingsRow.style.display = p === 'ollama' ? '' : 'none';
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
        } else if (activeProvider === 'ollama') {
          storage.setOllamaModel(modelSelect.value);
          storage.setOllamaBaseUrl(baseUrlInput.value.trim() || DEFAULT_OLLAMA_BASE_URL);
        } else if (activeProvider === 'openai') {
          storage.setOpenAIModel(modelSelect.value);
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
            ollamaModel: storage.getOllamaModel() || DEFAULT_OLLAMA_MODEL,
            ollamaBaseUrl: storage.getOllamaBaseUrl() || DEFAULT_OLLAMA_BASE_URL,
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
        } else if (activeProvider === 'openai') {
          openaiKeys = [];
          storage.setOpenAIKeys([]);
          showToast('All OpenAI API keys removed', 'info');
          renderKeyList();
        } else if (activeProvider === 'ollama') {
          showToast('No API keys are needed for Ollama', 'info');
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

  /* ---------- Cost-aware routing section ---------- */
  function badgeClass(badge) {
    if (badge === 'LOCAL/FREE' || badge === 'FREE TIER') return 'free';
    if (badge === '$') return 'low';
    if (badge === '$$') return 'mid';
    return 'high';
  }

  function buildRoutingSection() {
    const container = el('div', { className: 'agent-routing-section' });

    function render() {
      container.innerHTML = '';
      container.append(
        el('label', { className: 'agent-settings-label' }, ['Active Providers — cost-aware routing']),
        el('p', { className: 'agent-settings-hint' }, [
          'Enable any mix of providers. Each task runs on the cheapest capable provider: local/free first, then paid tiers. Photorealistic image generation needs OpenAI.',
        ]),
      );

      const statuses = getProviderStatus();
      for (const s of statuses) {
        const enableToggle = el('input', {
          type: 'checkbox',
          className: 'agent-provider-enable',
          ...(s.enabled ? { checked: 'checked' } : {}),
          ...(s.configured ? {} : { disabled: 'disabled' }),
        });
        enableToggle.addEventListener('change', () => {
          const current = new Set(
            storage.getEnabledProviders()
            || getProviderStatus().filter(x => x.configured).map(x => x.provider)
          );
          if (enableToggle.checked) current.add(s.provider);
          else current.delete(s.provider);
          storage.setEnabledProviders([...current]);
        });

        const row = el('div', { className: 'agent-provider-row' }, [
          el('label', { className: 'agent-provider-enable-label' }, [enableToggle, ` ${s.label}`]),
          el('span', { className: `agent-tier-badge agent-tier-${badgeClass(s.badge)}` }, [s.badge]),
          el('span', { className: s.configured ? 'agent-provider-configured' : 'agent-provider-unconfigured' }, [
            s.configured ? 'configured' : 'not configured',
          ]),
          el('button', {
            className: 'agent-provider-test-btn',
            type: 'button',
            ...(s.configured ? {} : { disabled: 'disabled' }),
            on: {
              click: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = 'Testing…';
                const result = await testProviderConnection(s.provider);
                btn.textContent = result.ok ? '✓ OK' : '✕ Fail';
                showToast(`${s.label}: ${result.message}`, result.ok ? 'success' : 'error');
                setTimeout(() => { btn.textContent = 'Test'; btn.disabled = false; }, 2500);
              },
            },
          }, ['Test']),
        ]);
        container.append(row);

        if (s.provider === 'gemini') {
          const tier = storage.getGeminiTier();
          const tierSel = el('select', { className: 'agent-gemini-tier-select' }, [
            el('option', { value: 'free', ...(tier === 'free' ? { selected: 'selected' } : {}) }, ['Free Tier']),
            el('option', { value: 'paid', ...(tier === 'paid' ? { selected: 'selected' } : {}) }, ['Paid Tier']),
          ]);
          tierSel.addEventListener('change', () => { storage.setGeminiTier(tierSel.value); render(); });
          container.append(el('div', { className: 'agent-provider-subrow' }, [
            el('span', { className: 'agent-provider-subrow-label' }, ['Gemini billing tier']),
            tierSel,
            el('span', { className: 'agent-settings-hint' }, [' Free Tier cannot generate photorealistic images.']),
          ]));
        }
      }
    }

    render();
    return container;
  }

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
      addKeyForm,
      el('label', { className: 'agent-settings-label agent-settings-model-label' }, ['Model']),
      modelSelect,
      ollamaSettingsRow,
      el('label', { className: 'agent-settings-label agent-settings-cloud-label' }, [
        cloudToggle,
        ' Sync keys across devices',
      ]),
      el('p', { className: 'agent-settings-hint' }, [
        'When enabled, your key ring and model are stored in your Google Drive so they work across all your devices.',
      ]),
      el('hr', { className: 'agent-settings-divider' }),
      buildRoutingSection(),
      el('hr', { className: 'agent-settings-divider' }),
      buildKeysSheetSection(onRefresh),
    ]),
    el('div', { className: 'modal-footer' }, [
      (activeProvider === 'ollama' || (geminiKeys.length === 0 && claudeKeys.length === 0 && openaiKeys.length === 0)) ? el('span') : removeAllBtn,
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
 * Build the Keys Sheet section — lets the user link a Waymark passwords sheet
 * that holds their AI API keys (Gemini / Claude rows), optionally encrypted.
 * @param {Function} [onRefresh] callback re-run after the vault state changes
 */
function buildKeysSheetSection(onRefresh) {
  const isLinked   = vault.isVaultSetUp();
  const isUnlocked = vault.isVaultUnlocked();
  const sheetName  = vault.getLinkedSheetName();
  const sheetId    = vault.getLinkedSheetId();

  /* Close/reopen the settings modal by id (the overlay is created by the
     caller after this function returns, so we can't capture it directly). */
  const closeModal = () => document.getElementById('agent-settings-modal')?.remove();
  const reopen = () => { closeModal(); showSettingsModal(onRefresh); };

  /* ---------- Not linked yet ---------- */
  if (!isLinked) {
    const idInput = el('input', {
      type: 'text',
      className: 'agent-settings-input',
      placeholder: 'Paste passwords sheet URL or spreadsheet ID…',
    });

    return el('div', { className: 'agent-vault-section' }, [
      el('label', { className: 'agent-settings-label' }, ['🔑 AI Keys Sheet (recommended)']),
      el('p', { className: 'agent-settings-hint' }, [
        'Store your API keys in a Waymark ',
        el('strong', {}, ['Passwords']),
        ' sheet. Add rows named "Gemini API Key" and "Claude API Key". Encrypt the Password column — Waymark and Google never see your keys.',
      ]),
      el('div', { className: 'agent-vault-btns' }, [
        el('button', {
          className: 'agent-vault-setup-btn',
          type: 'button',
          on: {
            click: async () => {
              // Close the modal first so the picker isn't obscured by it
              closeModal();
              try {
                const files = await api.picker.pickSpreadsheets({ includeSharedDrives: false });
                if (files?.[0]) {
                  vault.linkSheet(files[0].id, files[0].name);
                  showToast(`Linked: ${files[0].name}`, 'success');
                }
              } catch {
                showToast('Could not open Drive picker', 'error');
              }
              // Re-open settings so user can see the linked sheet status
              showSettingsModal(onRefresh);
            },
          },
        }, ['📂 Pick from Drive']),
        idInput,
        el('button', {
          className: 'agent-vault-setup-btn',
          type: 'button',
          on: {
            click: () => {
              const raw = idInput.value.trim();
              if (!raw) { showToast('Paste a sheet URL or ID', 'error'); return; }
              const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
              const id = match ? match[1] : raw;
              vault.linkSheet(id, id);
              showToast('Sheet linked — unlock to load keys', 'success');
              reopen();
            },
          },
        }, ['Link Sheet']),
      ]),
    ]);
  }

  /* ---------- Linked but locked ---------- */
  if (!isUnlocked) {
    const hasBio = vault.hasBiometricVault(sheetId);
    const isMobile = vault.isMobileWeb();
    const pwInput = el('input', {
      type: 'password',
      className: 'agent-settings-input',
      placeholder: 'Sheet password (leave empty if not encrypted)',
    });
    const statusText = `🔐 ${sheetName}`;

    const bioBtnSlot = el('div', { className: 'agent-vault-bio-slot' });
    if (hasBio) {
      const bioBtn = el('button', {
        className: 'agent-vault-bio-btn',
        type: 'button',
        on: {
          click: async () => {
            bioBtn.disabled = true;
            bioBtn.textContent = '🫆 Verifying…';
            const ok = await vault.unlockVaultWithBiometrics();
            if (ok) {
              const g = vault.getGeminiKeys().length;
              const c = vault.getClaudeKeys().length;
              showToast(`Unlocked with biometrics — ${g} Gemini key${g !== 1 ? 's' : ''}, ${c} Claude key${c !== 1 ? 's' : ''}`, 'success');
              if (typeof onRefresh === 'function') onRefresh();
              reopen();
            } else {
              bioBtn.disabled = false;
              bioBtn.textContent = '🫆 Unlock with Biometrics';
              showToast('Biometric unlock failed or cancelled', 'error');
            }
          },
        },
      }, ['🫆 Unlock with Biometrics']);
      bioBtnSlot.appendChild(bioBtn);
    }

    const enrollSlot = el('div', { className: 'agent-vault-bio-enroll-slot' });
    let enrollCb = null;
    if (!hasBio) {
      vault.isBiometricSupported().then((supported) => {
        if (!supported) return;
        enrollCb = el('input', {
          type: 'checkbox',
          className: 'agent-vault-bio-enroll-checkbox',
        });
        if (isMobile) enrollCb.checked = true;
        enrollSlot.innerHTML = '';
        enrollSlot.appendChild(el('label', { className: 'agent-vault-bio-enroll-label' }, [
          enrollCb,
          el('span', {}, [isMobile ? '📱 Enable biometric unlock on mobile web' : '🫆 Enable biometric unlock on this device']),
        ]));
      }).catch(() => {});
    }

    return el('div', { className: 'agent-vault-section agent-vault-locked' }, [
      el('label', { className: 'agent-settings-label' }, ['🔑 AI Keys Sheet']),
      el('p', { className: 'agent-vault-status agent-vault-status-locked' }, [statusText]),
      el('p', { className: 'agent-settings-hint' }, [
        'Enter the sheet password to decrypt your keys, or leave empty if the Password column is not encrypted. ',
        el('a', {
          href: `#/sheet/${sheetId}`,
          on: { click: () => closeModal() },
        }, ['Open sheet →']),
      ]),
      bioBtnSlot,
      pwInput,
      enrollSlot,
      el('div', { className: 'agent-vault-btns' }, [
        el('button', {
          className: 'agent-vault-unlock-btn',
          type: 'button',
          on: {
            click: async () => {
              const pw = pwInput.value.trim();
              const shouldEnroll = Boolean(enrollCb && enrollCb.checked);
              let enrolled = false;
              if (shouldEnroll && pw) {
                enrolled = await vault.enrollBiometricVault(pw);
              }
              const ok = await vault.unlockVault(pw);
              if (ok) {
                if (shouldEnroll && !enrolled) {
                  enrolled = await vault.enrollBiometricVault(pw);
                }
                const g = vault.getGeminiKeys().length;
                const c = vault.getClaudeKeys().length;
                showToast(`Unlocked — ${g} Gemini key${g !== 1 ? 's' : ''}, ${c} Claude key${c !== 1 ? 's' : ''}`, 'success');
                if (typeof onRefresh === 'function') onRefresh();
                reopen();
              } else {
                if (enrolled) {
                  vault.clearBiometricVault();
                }
                showToast('Incorrect password or could not read sheet', 'error');
                pwInput.value = '';
              }
            },
          },
        }, ['🔓 Unlock']),
        el('button', {
          className: 'agent-vault-clear-btn',
          type: 'button',
          on: {
            click: () => {
              vault.unlinkSheet();
              showToast('Sheet unlinked', 'info');
              reopen();
            },
          },
        }, ['Unlink']),
      ]),
    ]);
  }

  /* ---------- Linked and unlocked ---------- */
  const gCount = vault.getGeminiKeys().length;
  const cCount = vault.getClaudeKeys().length;
  const hasBioUnlocked = vault.hasBiometricVault(sheetId);
  const bioManageSlot = el('div', { className: 'agent-vault-bio-manage' });
  if (hasBioUnlocked) {
    bioManageSlot.appendChild(el('button', {
      className: 'agent-vault-bio-disable-btn agent-vault-clear-btn',
      type: 'button',
      on: {
        click: () => {
          vault.clearBiometricVault();
          showToast('Biometric unlock disabled on this device', 'info');
          reopen();
        },
      },
    }, ['🫆 Disable Biometrics']));
  } else {
    vault.isBiometricSupported().then((supported) => {
      if (!supported) return;
      bioManageSlot.innerHTML = '';
      const needsPwInput = !vault.hasKnownVaultPassword(sheetId);
      const bioPwInput = needsPwInput ? el('input', {
        type: 'password',
        className: 'agent-settings-input agent-vault-bio-pw-input',
        placeholder: 'Sheet password for biometrics…',
      }) : null;
      if (bioPwInput) bioManageSlot.appendChild(bioPwInput);
      bioManageSlot.appendChild(el('button', {
        className: 'agent-vault-bio-enable-btn agent-vault-setup-btn',
        type: 'button',
        on: {
          click: async () => {
            const explicitPw = bioPwInput ? bioPwInput.value.trim() : undefined;
            if (needsPwInput && !explicitPw) {
              showToast('Enter your sheet password to enable biometric unlock', 'error');
              bioPwInput?.focus();
              return;
            }
            const ok = await vault.enrollBiometricVault(explicitPw);
            if (ok) {
              if (explicitPw) {
                const verified = await vault.unlockVault(explicitPw);
                if (!verified) {
                  vault.clearBiometricVault();
                  showToast('Incorrect sheet password — biometrics not enabled', 'error');
                  return;
                }
              }
              showToast('Biometric unlock enabled on this device', 'success');
              reopen();
            } else {
              showToast('Could not enroll biometrics', 'error');
            }
          },
        },
      }, ['🫆 Enable Biometric Unlock']));
    }).catch(() => {});
  }

  return el('div', { className: 'agent-vault-section agent-vault-unlocked' }, [
    el('label', { className: 'agent-settings-label' }, ['🔑 AI Keys Sheet']),
    el('p', { className: 'agent-vault-status agent-vault-status-unlocked' }, [
      `🔓 ${sheetName} — ${gCount} Gemini key${gCount !== 1 ? 's' : ''}, ${cCount} Claude key${cCount !== 1 ? 's' : ''}${hasBioUnlocked ? ' · 🫆 Biometrics Ready' : ''}`,
    ]),
    el('p', { className: 'agent-settings-hint' }, [
      'Keys are loaded from the sheet for this session. ',
      el('a', { href: `#/sheet/${sheetId}`, on: { click: () => closeModal() } }, ['Open sheet →']),
    ]),
    el('div', { className: 'agent-vault-btns' }, [
      el('button', {
        className: 'agent-vault-lock-btn',
        type: 'button',
        on: {
          click: () => {
            vault.lockVault();
            showToast('Keys cleared from memory — sheet still linked', 'info');
            reopen();
          },
        },
      }, ['🔐 Lock']),
      bioManageSlot,
      el('button', {
        className: 'agent-vault-clear-btn',
        type: 'button',
        on: {
          click: () => {
            vault.unlinkSheet();
            showToast('Sheet unlinked', 'info');
            reopen();
          },
        },
      }, ['Unlink']),
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