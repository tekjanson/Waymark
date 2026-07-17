/* ============================================================
   model-adapter.js — Lightweight model provider abstraction
   
   Enables low-friction swap between Gemini and Claude by
   centralizing request building and credential management.
   Supports: Gemini (Google), Claude (Anthropic), Ollama (local).
   ============================================================ */

import * as vault from './vault.js';
import * as storage from '../storage.js';
import {
  CLAUDE_API_BASE,
  CLAUDE_ANTHROPIC_VERSION,
  GEMINI_API_BASE,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_MODEL,
  buildClaudeRequestBody,
  buildOllamaRequestBody,
  buildRequestBody,
  claudeHeaders,
  claudeUrl,
  geminiHeaders,
  geminiUrl,
  normalizeOllamaBaseUrl,
  ollamaChatUrl,
  pickBestClaudeKey,
  pickBestKey,
} from './config.js';

/* ---------- Types & Constants ---------- */

export const PROVIDERS = {
  GEMINI:  'gemini',
  CLAUDE:  'claude',
  OLLAMA:  'ollama',
};

const PROVIDER_CONFIG = {
  [PROVIDERS.GEMINI]: {
    name: 'Google Gemini',
    icon: '🔵',
    fetchKeys: () => {
      if (vault.isVaultSetUp() && vault.isVaultUnlocked()) {
        return vault.getGeminiKeys();
      }
      return storage.getAgentKeys();
    },
    getModel: () => storage.getAgentModel() || DEFAULT_MODEL,
    buildUrl: (model, action, query) => geminiUrl(model, action, query),
    buildHeaders: (apiKey) => geminiHeaders(apiKey),
    buildRequestBody: (contents, systemPrompt, model) => buildRequestBody(contents, systemPrompt),
    defaultModel: DEFAULT_MODEL,
  },
  [PROVIDERS.CLAUDE]: {
    name: 'Anthropic Claude',
    icon: '🟣',
    fetchKeys: () => {
      if (vault.isVaultSetUp() && vault.isVaultUnlocked()) {
        return vault.getClaudeKeys();
      }
      return storage.getClaudeKeys();
    },
    getModel: () => storage.getClaudeModel() || DEFAULT_CLAUDE_MODEL,
    buildUrl: () => claudeUrl(),
    buildHeaders: (apiKey) => claudeHeaders(apiKey),
    buildRequestBody: (contents, systemPrompt, model) => buildClaudeRequestBody(contents, systemPrompt, model),
    defaultModel: DEFAULT_CLAUDE_MODEL,
  },
  [PROVIDERS.OLLAMA]: {
    name: 'Ollama (local)',
    icon: '🟢',
    fetchKeys: () => [],
    getModel: () => storage.getOllamaModel() || 'llama2',
    buildUrl: () => {
      const baseUrl = storage.getOllamaBaseUrl() || 'http://localhost:11434';
      return ollamaChatUrl(baseUrl);
    },
    buildHeaders: () => ({ 'Content-Type': 'application/json' }),
    buildRequestBody: (contents, systemPrompt, model) => buildOllamaRequestBody(contents, systemPrompt, model),
    defaultModel: 'llama2',
  },
};

/* ---------- Current Provider ---------- */

let _currentProvider = null;

/**
 * Get the currently configured provider.
 * Falls back to storage or env.
 * @returns {string} One of: 'gemini', 'claude', 'ollama'
 */
export function getCurrentProvider() {
  if (_currentProvider) return _currentProvider;
  const stored = storage.getAgentProvider() || 'gemini';
  _currentProvider = stored;
  return stored;
}

/**
 * Switch to a different provider.
 * @param {string} provider — One of: 'gemini', 'claude', 'ollama'
 */
export function setCurrentProvider(provider) {
  if (!PROVIDER_CONFIG[provider]) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  _currentProvider = provider;
  storage.setAgentProvider(provider);
}

/**
 * Get metadata about a provider.
 * @param {string} [provider] — defaults to current
 * @returns {Object} config object
 */
export function getProviderConfig(provider) {
  const p = provider || getCurrentProvider();
  const cfg = PROVIDER_CONFIG[p];
  if (!cfg) throw new Error(`Unknown provider: ${p}`);
  return cfg;
}

/* ---------- Key Management Facade ---------- */

/**
 * Fetch API keys for the current provider.
 * Checks vault first (if unlocked), then falls back to localStorage.
 * @returns {Array<{key: string, nickname: string, ...}>}
 */
export function getApiKeys() {
  const provider = getCurrentProvider();
  const cfg = PROVIDER_CONFIG[provider];
  return cfg?.fetchKeys() || [];
}

/**
 * Get the current model for the active provider.
 * @returns {string}
 */
export function getActiveModel() {
  const provider = getCurrentProvider();
  const cfg = PROVIDER_CONFIG[provider];
  return cfg?.getModel?.() || cfg?.defaultModel || DEFAULT_MODEL;
}

/**
 * Pick the best available API key for the current provider.
 * Uses the same LRU strategy as the agent (in config.js).
 * @param {Object} [opts] — e.g. { model: 'claude-opus' }
 * @returns {{key: string, idx: number}} or throws if no keys
 */
export function pickBestApiKey(opts = {}) {
  const provider = getCurrentProvider();
  
  if (provider === PROVIDERS.CLAUDE) {
    return pickBestClaudeKey(opts);
  }
  
  if (provider === PROVIDERS.OLLAMA) {
    return { key: '', idx: -1 }; // No auth needed for local Ollama
  }
  
  // Gemini (or default)
  return pickBestKey(opts);
}

/* ---------- Request Building Facade ---------- */

/**
 * Build a complete HTTP request for the current provider.
 * @param {Object} params
 * @param {Array} params.contents — Gemini-format contents (messages)
 * @param {string} params.systemPrompt — System prompt
 * @param {string} [params.model] — Model override (uses active model if omitted)
 * @returns {{url: string, method: string, headers: Object, body: string}} HTTP request
 */
export function buildRequest(params) {
  const { contents, systemPrompt, model } = params;
  const provider = getCurrentProvider();
  const cfg = PROVIDER_CONFIG[provider];
  
  if (!cfg) {
    throw new Error(`No adapter for provider: ${provider}`);
  }
  
  const apiKey = provider === PROVIDERS.OLLAMA ? '' : pickBestApiKey({ model }).key;
  const activeModel = model || getActiveModel();
  
  const requestBody = cfg.buildRequestBody(contents, systemPrompt, activeModel);
  const url = provider === PROVIDERS.GEMINI
    ? cfg.buildUrl(activeModel, 'generateContent', 'key=' + apiKey)
    : cfg.buildUrl();
  
  const headers = cfg.buildHeaders(apiKey);
  
  return {
    url,
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  };
}

/* ---------- Response Parsing ---------- */

/**
 * Extract text content from a provider-specific response.
 * Handles: Gemini format, Claude format, Ollama format.
 * @param {Object} response
 * @param {string} provider
 * @returns {string} The text content
 */
export function extractResponseText(response, provider) {
  const p = provider || getCurrentProvider();
  
  if (p === PROVIDERS.CLAUDE) {
    // Claude returns { content: [{type: 'text', text: '...'}] }
    return response.content?.[0]?.text || '';
  }
  
  if (p === PROVIDERS.OLLAMA) {
    // Ollama returns { message: {role: 'assistant', content: '...'} }
    return response.message?.content || '';
  }
  
  // Gemini returns { candidates: [{content: {parts: [{text: '...'}]}}] }
  return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Extract tool calls from a provider-specific response.
 * @param {Object} response
 * @param {string} [provider]
 * @returns {Array<{name: string, args: Object}>}
 */
export function extractToolCalls(response, provider) {
  const p = provider || getCurrentProvider();
  
  if (p === PROVIDERS.CLAUDE) {
    // Claude: [{ type: 'tool_use', name: '...', input: {...} }]
    const toolUses = response.content?.filter(c => c.type === 'tool_use') || [];
    return toolUses.map(t => ({ name: t.name, args: t.input }));
  }
  
  if (p === PROVIDERS.OLLAMA) {
    // Ollama typically doesn't support tool calls in the same way
    return [];
  }
  
  // Gemini: { functionCalls: [{name: '...', args: {...}}] }
  return response.candidates?.[0]?.content?.parts
    ?.filter(p => p.functionCall)
    ?.map(p => ({ name: p.functionCall.name, args: p.functionCall.args })) || [];
}

/**
 * Check if a response indicates the provider should stop processing.
 * (e.g., finish_reason, stop_reason)
 * @param {Object} response
 * @param {string} [provider]
 * @returns {boolean}
 */
export function isResponseFinished(response, provider) {
  const p = provider || getCurrentProvider();
  
  if (p === PROVIDERS.CLAUDE) {
    return response.stop_reason === 'end_turn' || response.stop_reason === 'tool_use';
  }
  
  if (p === PROVIDERS.OLLAMA) {
    // Ollama streams; typically done when streaming ends
    return !!response.done;
  }
  
  // Gemini
  const reason = response.candidates?.[0]?.finishReason;
  return reason === 'STOP' || reason === 'MAX_TOKENS';
}

/* ---------- Vault Integration ---------- */

/**
 * Check if vault (Password Manager sheet) is set up.
 * @returns {boolean}
 */
export function isVaultSetUp() {
  return vault.isVaultSetUp();
}

/**
 * Check if vault is currently unlocked and keys are in memory.
 * @returns {boolean}
 */
export function isVaultUnlocked() {
  return vault.isVaultUnlocked();
}

/**
 * Unlock the vault (prompt user for password if encrypted).
 * @param {string} password — vault unlock password
 * @returns {Promise<boolean>} true on success
 */
export async function unlockVault(password) {
  return await vault.unlockVault(password);
}

/**
 * Lock the vault (evict keys and encryption key from memory).
 */
export function lockVault() {
  vault.lockVault();
}

/**
 * Link a passwords sheet as the keys source.
 * @param {string} sheetId — spreadsheet ID
 * @param {string} [name] — friendly name
 */
export function linkVaultSheet(sheetId, name) {
  vault.linkSheet(sheetId, name);
}

/**
 * Unlink the vault sheet.
 */
export function unlinkVaultSheet() {
  vault.unlinkSheet();
}

/**
 * Get the linked vault sheet ID.
 * @returns {string|null}
 */
export function getLinkedVaultSheetId() {
  return vault.getLinkedSheetId();
}

/**
 * Get the linked vault sheet name.
 * @returns {string}
 */
export function getLinkedVaultSheetName() {
  return vault.getLinkedSheetName();
}

/**
 * Add a new API key to the vault (and in-memory session).
 * @param {Object} keyEntry — {key, nickname, provider, isBilled?}
 * @returns {Promise<boolean>}
 */
export async function addKeyToVault(keyEntry) {
  return await vault.addKeyToSheet(keyEntry);
}

