/* ============================================================
   agent.js — Waymark AI user assistant
   Chat interface that helps users organise their data with
   Waymark-powered Google Sheets via the Gemini API.
   ============================================================ */

import { el, showToast } from './ui.js';
import * as storage from './storage.js';
import * as userData from './user-data.js';
import { api } from './api-client.js';
import {
  BASE_SYSTEM_PROMPT,
  DEFAULT_MODEL,
  MAX_AGGRESSIVE_CONTEXT_MESSAGES,
  MAX_ASSISTANT_MESSAGE_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_FILE_CHARS,
  MAX_CONTEXT_MESSAGES,
  MAX_CONTEXT_SHEETS,
  MAX_ESTIMATED_REQUEST_TOKENS,
  MAX_OUTPUT_TOKENS,
  MAX_PLANNED_BRIEF_CHARS,
  MAX_PLANNED_USER_MESSAGE_CHARS,
  MAX_RAW_CONVERSATION_TOKENS,
  MAX_USER_MESSAGE_CHARS,
  TOOL_DECLARATIONS,
  buildConversationSummary,
  buildPlannerBrief,
  buildRecentSheetHint,
  buildRequestBody,
  compactContextText,
  estimateRawConversationTokens,
  estimateRequestTokens,
  geminiHeaders,
  geminiUrl,
  getRecentConversationSheets,
  shouldUsePlannerRound,
} from './agent/config.js';
import { renderMarkdown } from './agent/markdown.js';
import { showSettingsModal } from './agent/settings.js';
import { runSlashCommand } from './agent/slash-commands.js';
import {
  appendSheetPreviewCard,
  buildEmptyState,
  buildFilePicker,
  buildMessage,
  buildWelcome,
  refreshContextBar,
  renderAgentUI,
} from './agent/view.js';
import {
  executeTool,
  removeRetryIndicator,
  removeToolIndicator,
  showRetryIndicator,
  showToolIndicator,
  toolCreateSheet,
} from './agent/tools.js';

/** Cached context string — refreshed once per _sendMessage call. */
let _cachedContext = '';

/**
 * Build a dynamic system prompt with fresh context.
 * Context is fetched once at the start of _sendMessage and cached.
 * @returns {string}
 */
function _getSystemPrompt() {
  return _cachedContext
    ? BASE_SYSTEM_PROMPT + '\n\n' + _cachedContext
    : BASE_SYSTEM_PROMPT;
}

function _geminiUrl(model, action, query = '') {
  return geminiUrl(model, action, query);
}

function _geminiHeaders(apiKey) {
  return geminiHeaders(apiKey);
}

function _buildRequestBody(contents) {
  return buildRequestBody(contents, _getSystemPrompt());
}

function _compactContextText(text, maxChars) {
  return compactContextText(text, maxChars);
}

function _buildConversationSummary(history, recentMessageLimit) {
  return buildConversationSummary(history, recentMessageLimit);
}

function _shouldUsePlannerRound(userText) {
  return shouldUsePlannerRound(userText);
}

/**
 * Throw before making a model call if the request is too large for the local budget.
 * @param {Object} body
 * @param {string} phase
 */
function _assertRequestWithinBudget(body, phase) {
  const estimatedTokens = estimateRequestTokens(body);
  if (estimatedTokens > MAX_ESTIMATED_REQUEST_TOKENS) {
    throw new Error(
      `${phase} would use about ${estimatedTokens} input tokens, which is above the local budget of ${MAX_ESTIMATED_REQUEST_TOKENS}. ` +
      'Clear older chat messages or simplify the request before trying again.'
    );
  }
}

/**
 * Refuse obviously oversized requests before any network activity.
 * @param {string} userMessage
 */
function _assertConversationWithinBudget(userMessage) {
  const estimatedTokens = estimateRawConversationTokens(_messages, userMessage, _getSystemPrompt());
  if (estimatedTokens > MAX_RAW_CONVERSATION_TOKENS) {
    throw new Error(
      `This conversation would use about ${estimatedTokens} input tokens, which is above the local budget of ${MAX_RAW_CONVERSATION_TOKENS}. ` +
      'Clear older chat messages or simplify the request before trying again.'
    );
  }
}

/**
 * Ask the model for a tiny execution brief when the request is complex enough
 * to benefit from one extra round-trip.
 * @param {string} apiKey
 * @param {number} keyIdx
 * @param {string} userText
 * @returns {Promise<string>}
 */
async function _fetchPlannerMicroBrief(apiKey, keyIdx, userText) {
  const model = storage.getAgentModel() || DEFAULT_MODEL;
  const url = geminiUrl(model, 'generateContent');
  const compactUserText = compactContextText(userText, MAX_USER_MESSAGE_CHARS);
  const plannerBody = {
    contents: [{
      role: 'user',
      parts: [{
        text: 'Compress this request into one tiny execution brief. Mention likely templates, key constraints, and whether multiple sheets are needed. Plain text only. 80 words max. Request: ' + compactUserText,
      }],
    }],
    systemInstruction: {
      parts: [{ text: 'You are a planning compressor for Waymark. Output one short plain-text execution brief only. No markdown. No intro. No bullets unless essential.' }],
    },
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: 120,
    },
  };

  _assertRequestWithinBudget(plannerBody, 'Planner round');
  const data = await _fetchGemini(url, plannerBody, keyIdx);
  storage.recordKeyUsage(keyIdx);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ').trim();
  return compactContextText(text, MAX_PLANNED_BRIEF_CHARS);
}

/**
 * Build the final user message sent to the model.
 * @param {string} userText
 * @returns {string}
 */
function _buildPlannedUserMessage(userText) {
  const compactUserText = compactContextText(userText, MAX_USER_MESSAGE_CHARS);
  const plannerBrief = buildPlannerBrief(compactUserText);
  const recentSheetHint = buildRecentSheetHint(compactUserText, _messages);
  if (!plannerBrief && !recentSheetHint) return compactUserText;
  return compactContextText(
    [
      plannerBrief ? `Planner brief: ${plannerBrief}` : '',
      recentSheetHint,
      `User request: ${compactUserText}`,
    ].filter(Boolean).join(' '),
    MAX_PLANNED_USER_MESSAGE_CHARS
  );
}

/**
 * Refresh the context block: current date, user name, and their sheets.
 * Called once per user message to keep context fresh without duplicate API calls.
 */
async function _refreshContext() {
  const parts = [];

  // Current date
  const now = new Date();
  parts.push(`Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`);

  // User identity
  const user = api.auth.getUser();
  if (user?.name) {
    parts.push(`The user's name is ${user.name}.`);
  }

  // User's sheets — fetched from Drive
  try {
    const sheets = await api.drive.getAllSheets();
    if (sheets.length) {
      const sheetList = sheets.slice(0, MAX_CONTEXT_SHEETS).map(s =>
        s.folder ? `"${s.name}" (id: ${s.id}, folder: ${s.folder})` : `"${s.name}" (id: ${s.id})`
      ).join(', ');
      parts.push(`The user has ${sheets.length} sheet(s) in Drive.`);
      parts.push(`A few relevant sheet examples: ${sheetList}.`);
      parts.push('If the user mentions a sheet that is not listed here, use search_sheets to find it by name before using read_sheet or update_sheet.');
    }
  } catch {
    // Non-critical — continue without sheet list
  }

  const recentSheets = getRecentConversationSheets(_messages);
  if (recentSheets.length) {
    const recentList = recentSheets
      .map(sheet => `"${sheet.title}" (id: ${sheet.id})`)
      .join(', ');
    parts.push(`Recent sheet references from this conversation: ${recentList}.`);
    parts.push('If the user says "that sheet", "that checklist", "it", or asks to add/change items in something you just created, resolve that to the most relevant recent sheet ID and prefer update_sheet over creating a duplicate.');
  }

  // Context files — user-pinned sheets to include in every request
  const contextFiles = storage.getAgentContextFiles();
  if (contextFiles.length) {
    const fileSummaries = [];
    for (const file of contextFiles.slice(0, 5)) {
      try {
        const sheet = await api.sheets.getSpreadsheet(file.id);
        const headers = sheet.values?.[0] || [];
        const dataRows = (sheet.values || []).slice(1);
        const preview = dataRows.slice(0, 5).map(row =>
          row.map(cell => String(cell ?? '').slice(0, 60)).join(' | ')
        ).join(' ; ');
        const summary = `"${file.name}" (id: ${file.id}, ${dataRows.length} rows, columns: ${headers.join(', ')}): ${compactContextText(preview, MAX_CONTEXT_FILE_CHARS)}`;
        fileSummaries.push(summary);
      } catch {
        fileSummaries.push(`"${file.name}" (id: ${file.id}) — could not load`);
      }
    }
    parts.push(`The user has pinned ${contextFiles.length} file(s) to this conversation's context.`);
    parts.push(`Pinned files: ${fileSummaries.join(' | ')}`);
    parts.push('When the user references these files, use their IDs directly without calling search_sheets. Use read_sheet for full data or update_sheet to modify them.');
  }

  _cachedContext = parts.join(' ');
}

/* ---------- State ---------- */

let _messages = [];
let _container = null;
let _chatBody = null;
let _contextBar = null;
let _isStreaming = false;
let _abortController = null;
let _lastKeyResetDate = null;

/* ---------- Key Rotation ---------- */

/**
 * Pick the next key from the ring using least-recently-used strategy.
 * Billed keys are preferred for expensive models.
 * Returns { key, idx } or null if ring is empty.
 * @returns {{ key: string, idx: number } | null}
 */
function _getNextKey() {
  const keys = storage.getAgentKeys();
  if (keys.length === 0) return null;

  // Reset daily counters if new day
  const today = new Date().toISOString().slice(0, 10);
  if (_lastKeyResetDate !== today) {
    storage.resetDailyKeyCounters();
    _lastKeyResetDate = today;
  }

  const model = storage.getAgentModel() || DEFAULT_MODEL;
  const isExpensiveModel = /pro/i.test(model);

  // Filter out keys that errored in the last 60 seconds
  const now = Date.now();
  const available = keys.map((k, i) => ({ ...k, idx: i }))
    .filter(k => !k.lastError || (now - new Date(k.lastError).getTime()) > 60000);

  if (available.length === 0) {
    // All keys recently errored — return the one with oldest error
    const all = keys.map((k, i) => ({ ...k, idx: i }));
    all.sort((a, b) => new Date(a.lastError || 0).getTime() - new Date(b.lastError || 0).getTime());
    return { key: all[0].key, idx: all[0].idx };
  }

  // For expensive models, prefer billed keys
  if (isExpensiveModel) {
    const billed = available.filter(k => k.isBilled);
    if (billed.length > 0) {
      billed.sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
      return { key: billed[0].key, idx: billed[0].idx };
    }
  }

  // LRU: pick key with fewest requests today
  available.sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
  return { key: available[0].key, idx: available[0].idx };
}

/* ---------- Public API ---------- */

/**
 * Initialise and render the agent chat UI into the given container.
 * @param {HTMLElement} container
 */
export function show(container) {
  _container = container;
  _container.innerHTML = '';
  // Sync API keys from Drive if available and not already in localStorage
  const driveSettings = userData.getAgentSettings();
  if (driveSettings?.keys?.length && storage.getAgentKeys().length === 0) {
    storage.setAgentKeys(driveSettings.keys);
    storage.setAgentModel(driveSettings.model || DEFAULT_MODEL);
  } else if (driveSettings?.apiKey && storage.getAgentKeys().length === 0) {
    // Legacy single-key Drive sync
    storage.setAgentApiKey(driveSettings.apiKey);
    storage.setAgentModel(driveSettings.model || DEFAULT_MODEL);
  }
  // Restore conversation from localStorage
  const saved = storage.getAgentConversation();
  if (saved.length && _messages.length === 0) {
    _messages = saved;
  }
  _renderUI();
}

/**
 * Clean up when navigating away.
 */
export function hide() {
  _isStreaming = false;
}

/* ---------- UI Rendering ---------- */

function _renderUI() {
  const hasKeys = storage.getAgentKeys().length > 0;
  const rendered = renderAgentUI({
    container: _container,
    messages: _messages,
    hasKeys,
    onShowSettings: _showSettings,
    onClearConversation: _clearConversation,
    onSendMessage: _sendMessage,
    onRunSlashCommand: _runSlashCommand,
    onAttachFile: _openFilePicker,
    onRemoveFile: _removeContextFile,
  });
  _chatBody = rendered.chatBody;
  _contextBar = rendered.contextBar;
}

function _buildWelcome() {
  return buildWelcome(_showSettings);
}

function _buildEmptyState() {
  return buildEmptyState(_sendMessage);
}

/* ---------- Slash Commands ---------- */

/**
 * Execute a slash command. Injected as a system message so no API call is
 * needed. Returns the chat feedback text or null if command is unknown.
 * @param {string} name  - e.g. 'new', 'list', 'open', 'clear', 'keys', 'help'
 * @param {string[]} args
 * @returns {Promise<string | null>}
 */
async function _runSlashCommand(name, args) {
  return runSlashCommand(name, args, {
    clearConversation: _clearConversation,
    showSettings: _showSettings,
    listSheets: () => api.drive.getAllSheets(),
    createBlankSheet: ({ template, title }) => _toolCreateSheet({ template, title, data: [['']] }),
    appendSheetPreviewCard: _appendSheetPreviewCard,
  });
}

/* ---------- Message Rendering ---------- */

/**
 * Append an inline sheet preview card to the chat body.
 * @param {{ spreadsheetId: string, title: string, template: string, rowCount: number }} result
 */
function _appendSheetPreviewCard(result) {
  appendSheetPreviewCard(_chatBody, result);
}

/**
 * Build a chat message node for either user or assistant content.
 * @param {{ role: string, content: string }} msg
 * @returns {HTMLElement}
 */
function _buildMessage(msg) {
  return buildMessage(msg);
}

/**
 * Render markdown-like content (code blocks, inline code, paragraphs).
 * @param {HTMLElement} container
 * @param {string} text
 */
function _renderMarkdown(container, text) {
  renderMarkdown(container, text);
}

/* ---------- Settings Modal ---------- */

function _showSettings() {
  showSettingsModal(() => show(_container));
}

/* ---------- Context Files ---------- */

/**
 * Open the file picker overlay to select a Drive sheet to add to context.
 */
async function _openFilePicker() {
  try {
    const sheets = await api.drive.getAllSheets();
    const picker = buildFilePicker(sheets, (file) => {
      const current = storage.getAgentContextFiles();
      if (current.some(f => f.id === file.id)) return;
      current.push({ id: file.id, name: file.name });
      storage.setAgentContextFiles(current);
      refreshContextBar(_contextBar);
    });
    _container.appendChild(picker);
  } catch {
    showToast('Could not load your sheets', 'error');
  }
}

/**
 * Remove a file from the context files list.
 * @param {string} fileId
 */
function _removeContextFile(fileId) {
  const current = storage.getAgentContextFiles();
  storage.setAgentContextFiles(current.filter(f => f.id !== fileId));
  refreshContextBar(_contextBar);
}

/* ---------- Conversation Logic ---------- */

function _persistConversation() {
  storage.setAgentConversation(_messages);
}

/**
 * Build a model request once so we can short-circuit before any network call.
 * @param {string} apiKey
 * @param {number} keyIdx
 * @param {string} userMessage
 * @returns {Promise<{model:string, url:string, contents:Array, body:Object}>}
 */
async function _prepareModelRequest(apiKey, keyIdx, userMessage) {
  const model = storage.getAgentModel() || DEFAULT_MODEL;
  const baseUrl = _geminiUrl(model, 'generateContent');
  _assertConversationWithinBudget(userMessage);
  let plannedUserText = _buildPlannedUserMessage(userMessage);

  const buildBudgetedRequest = (text) => {
    let contents = _buildContents(text, MAX_CONTEXT_MESSAGES);
    let body = _buildRequestBody(contents);

    if (estimateRequestTokens(body) > MAX_ESTIMATED_REQUEST_TOKENS) {
      contents = _buildContents(text, MAX_AGGRESSIVE_CONTEXT_MESSAGES);
      body = _buildRequestBody(contents);
    }

    return { contents, body };
  };

  if (_shouldUsePlannerRound(userMessage)) {
    try {
      const microBrief = await _fetchPlannerMicroBrief(apiKey, keyIdx, userMessage);
      if (microBrief) {
        plannedUserText = _compactContextText(
          `Planner brief: ${microBrief} User request: ${_compactContextText(userMessage, MAX_USER_MESSAGE_CHARS)}`,
          MAX_PLANNED_USER_MESSAGE_CHARS
        );
      }
    } catch {
      // Deterministic planner brief already exists, so continue without failing the main request.
    }
  }

  const { contents, body } = buildBudgetedRequest(plannedUserText);

  _assertRequestWithinBudget(body, 'This request');
  return { model, url: baseUrl, contents, body };
}

function _clearConversation() {
  _messages = [];
  _persistConversation();
  if (_chatBody) {
    _chatBody.innerHTML = '';
    const hasKeys = storage.getAgentKeys().length > 0;
    _chatBody.appendChild(hasKeys ? _buildEmptyState() : _buildWelcome());
  }
}

async function _sendMessage(text) {
  if (!text || !text.trim() || _isStreaming) return;

  const keyEntry = _getNextKey();
  if (!keyEntry) {
    showToast('Configure your API keys in Settings first', 'error');
    return;
  }

  // Refresh context (date, user, sheets) once per message
  await _refreshContext();

  const userText = text.trim();

  // Clear empty state / suggestions
  const empty = _chatBody.querySelector('.agent-empty');
  if (empty) empty.remove();
  const welcome = _chatBody.querySelector('.agent-welcome');
  if (welcome) welcome.remove();

  // Add user message
  _messages.push({ role: 'user', content: userText });
  _chatBody.appendChild(_buildMessage({ role: 'user', content: userText }));

  let preparedRequest;
  try {
    preparedRequest = await _prepareModelRequest(keyEntry.key, keyEntry.idx, userText);
  } catch (err) {
    const errorMsg = { role: 'assistant', content: '⚠️ Error: ' + err.message };
    _messages.push(errorMsg);
    _chatBody.appendChild(_buildMessage(errorMsg));
    _chatBody.scrollTop = _chatBody.scrollHeight;
    _persistConversation();
    showToast('AI error: ' + err.message, 'error');
    return;
  }

  // Clear input
  const input = _container.querySelector('.agent-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  // Scroll to bottom
  _chatBody.scrollTop = _chatBody.scrollHeight;

  // Create live assistant message bubble for streaming
  const liveWrapper = el('div', {
    className: 'agent-message agent-message-assistant',
  });
  const liveAvatar = el('div', { className: 'agent-message-avatar' }, ['🤖']);
  const liveContent = el('div', { className: 'agent-message-content' });
  // Start with typing dots until first chunk arrives
  const typingDots = el('div', { className: 'agent-typing-dots' }, [
    el('span', {}, ['·']), el('span', {}, ['·']), el('span', {}, ['·']),
  ]);
  liveContent.appendChild(typingDots);
  liveWrapper.appendChild(liveAvatar);
  liveWrapper.appendChild(liveContent);
  _chatBody.appendChild(liveWrapper);
  _chatBody.scrollTop = _chatBody.scrollHeight;

  // Switch send button to stop button
  const sendBtn = _container.querySelector('.agent-send-btn');
  let originalSendText = '';
  if (sendBtn) {
    originalSendText = sendBtn.textContent;
    sendBtn.textContent = '⏹';
    sendBtn.title = 'Stop generating';
    sendBtn.className = 'agent-send-btn agent-stop-btn';
  }

  // Set up abort controller
  _abortController = new AbortController();
  const signal = _abortController.signal;

  // Handle stop button click
  const stopHandler = () => {
    if (_abortController) _abortController.abort();
  };
  if (sendBtn) {
    sendBtn.removeAttribute('disabled');
    sendBtn.onclick = stopHandler;
  }

  _isStreaming = true;
  let accumulated = '';
  let dotsRemoved = false;
  let renderPending = false;

  /** Debounced re-render of markdown content */
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      liveContent.innerHTML = '';
      _renderMarkdown(liveContent, accumulated);
      _chatBody.scrollTop = _chatBody.scrollHeight;
    });
  }

  try {
    const response = await _streamCallGemini(
      keyEntry.key,
      keyEntry.idx,
      preparedRequest,
      (chunk) => {
        // Remove typing dots on first chunk
        if (!dotsRemoved) {
          typingDots.remove();
          dotsRemoved = true;
        }
        accumulated += chunk;
        scheduleRender();
      },
      signal,
    );

    // Final render with complete text
    liveContent.innerHTML = '';
    _renderMarkdown(liveContent, response);

    _messages.push({ role: 'assistant', content: response });
    _chatBody.scrollTop = _chatBody.scrollHeight;
    _persistConversation();
  } catch (err) {
    // If aborted and we have partial text, keep it
    if (err.name === 'AbortError' && accumulated) {
      liveContent.innerHTML = '';
      _renderMarkdown(liveContent, accumulated);
      _messages.push({ role: 'assistant', content: accumulated });
      _persistConversation();
    } else if (err.name !== 'AbortError') {
      liveWrapper.remove();
      showToast('AI error: ' + err.message, 'error');
      const errorMsg = { role: 'assistant', content: '⚠️ Error: ' + err.message };
      _messages.push(errorMsg);
      _chatBody.appendChild(_buildMessage(errorMsg));
    } else {
      // Aborted with no content — remove the empty bubble
      liveWrapper.remove();
    }
  } finally {
    _isStreaming = false;
    _abortController = null;

    // Restore send button
    if (sendBtn) {
      sendBtn.textContent = originalSendText || '➤';
      sendBtn.title = 'Send message';
      sendBtn.className = 'agent-send-btn';
      sendBtn.onclick = () => {
        const inp = _container.querySelector('.agent-input');
        if (inp) _sendMessage(inp.value);
      };
    }
  }
}

/* ---------- Gemini API ---------- */

/**
 * Call the Gemini API with conversation history and key rotation.
 * @param {string} apiKey
 * @param {number} keyIdx — index into the key ring
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function _callGemini(apiKey, keyIdx, userMessage) {
  const request = typeof userMessage === 'string'
    ? await _prepareModelRequest(apiKey, keyIdx, userMessage)
    : userMessage;
  const { url, contents, body } = request;

  const data = await _fetchGemini(url, body, keyIdx);
  storage.recordKeyUsage(keyIdx);
  const candidate = data.candidates?.[0];

  if (!candidate?.content?.parts?.length) {
    throw new Error('No response from AI. Try again, or clear older chat messages to reduce context size.');
  }

  // Check for function call in response
  const functionCall = candidate.content.parts.find(p => p.functionCall);
  if (functionCall) {
    return _handleToolCall(apiKey, keyIdx, url, contents, candidate.content, functionCall.functionCall);
  }

  return candidate.content.parts.map(p => p.text || '').join('');
}

/**
 * Stream the Gemini API response, calling onChunk for each text fragment.
 * Returns the full accumulated text if successful.
 * If a function call is detected, stops streaming and delegates to _handleToolCall.
 * @param {string} apiKey
 * @param {number} keyIdx
 * @param {string} userMessage
 * @param {function(string): void} onChunk — called with each text fragment
 * @param {AbortSignal} signal — abort signal to cancel streaming
 * @returns {Promise<string>}
 */
async function _streamCallGemini(apiKey, keyIdx, userMessage, onChunk, signal) {
  const request = typeof userMessage === 'string'
    ? await _prepareModelRequest(apiKey, keyIdx, userMessage)
    : userMessage;
  const { model, contents, body } = request;
  const streamUrl = _geminiUrl(model, 'streamGenerateContent', 'alt=sse');

  let res;
  try {
    res = await fetch(streamUrl, {
      method: 'POST',
      headers: _geminiHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Streaming failed (likely proxy blocking SSE) — fall back to buffered
    return _callGemini(apiKey, keyIdx, request);
  }

  // Non-200 — fall back to buffered endpoint for proper error handling
  if (!res.ok) {
    return _callGemini(apiKey, keyIdx, request);
  }

  storage.recordKeyUsage(keyIdx);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        let parsed;
        try { parsed = JSON.parse(jsonStr); } catch { continue; }

        const candidate = parsed.candidates?.[0];
        if (!candidate?.content?.parts) continue;

        // Check for function call
        const fc = candidate.content.parts.find(p => p.functionCall);
        if (fc) {
          // Abort the stream reader and re-run via the buffered endpoint so we
          // execute a complete function call rather than a partial streamed one.
          reader.cancel();
          return _callGemini(apiKey, keyIdx, request);
        }

        // Extract text chunks
        for (const part of candidate.content.parts) {
          if (part.text) {
            accumulated += part.text;
            onChunk(part.text);
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // User clicked stop — return whatever we have
      return accumulated;
    }
    // Stream read error — if we have partial text, return it; otherwise throw
    if (accumulated) return accumulated;
    throw err;
  }

  if (!accumulated) {
    throw new Error('No response from AI. Try again, or clear older chat messages to reduce context size.');
  }

  return accumulated;
}

/**
 * Build contents array with context management — summarise older messages and
 * keep only the most recent conversational turns at full fidelity.
 * @param {string} userMessage
 * @param {number} [recentMessageLimit]
 * @returns {Array}
 */
function _buildContents(userMessage, recentMessageLimit = MAX_CONTEXT_MESSAGES) {
  const contents = [];
  const finalUserText = _compactContextText(userMessage, MAX_PLANNED_USER_MESSAGE_CHARS);
  const history = _messages.slice(0, -1);
  const recentHistory = recentMessageLimit > 0 ? history.slice(-recentMessageLimit) : [];
  const summaryText = _buildConversationSummary(history, recentMessageLimit);
  let remainingChars = Math.max(0, MAX_CONTEXT_CHARS - finalUserText.length - summaryText.length);
  const selected = [];

  if (summaryText) {
    contents.push({
      role: 'model',
      parts: [{ text: summaryText }],
    });
  }

  for (let i = recentHistory.length - 1; i >= 0; i--) {
    if (selected.length >= recentMessageLimit) break;
    if (remainingChars <= 0) break;

    const msg = recentHistory[i];
    const maxChars = Math.min(
      remainingChars,
      msg.role === 'user' ? MAX_USER_MESSAGE_CHARS : MAX_ASSISTANT_MESSAGE_CHARS
    );
    const text = _compactContextText(msg.content, maxChars);
    if (!text) continue;

    selected.unshift({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text }],
    });
    remainingChars -= text.length;
  }

  contents.push(...selected);
  contents.push({
    role: 'user',
    parts: [{ text: finalUserText }],
  });

  return contents;
}

/**
 * Handle a tool/function call from the model.
 * Executes the tool, sends results back, returns final text.
 * @param {string} apiKey
 * @param {string} url
 * @param {Array} contents
 * @param {Object} modelContent — the model's response content with the function call
 * @param {{ name: string, args: Object }} functionCall
 * @param {number} [chainDepth]
 * @returns {Promise<string>}
 */
async function _handleToolCall(apiKey, keyIdx, url, contents, modelContent, functionCall, chainDepth = 0) {
  if (chainDepth >= 5) {
    throw new Error('AI requested too many chained tool calls in one turn. Try again with a smaller request.');
  }

  const { name, args } = functionCall;

  // Show tool execution indicator
  _showToolIndicator(name, args);

  // Execute the tool
  let result;
  try {
    result = await _executeTool(name, args);
  } catch (err) {
    result = { error: err.message };
  }

  // Remove tool indicator
  _removeToolIndicator();

  // Show an inline preview card immediately after sheet creation
  if (name === 'create_sheet' && result && !result.error) {
    _appendSheetPreviewCard(result);
  }

  // Send tool result back to model for final response
  const followUp = {
    contents: [
      ...contents,
      modelContent,
      {
        role: 'function',
        parts: [{
          functionResponse: {
            name,
            response: { content: result },
          },
        }],
      },
    ],
    tools: TOOL_DECLARATIONS,
    systemInstruction: {
      parts: [{ text: _getSystemPrompt() }],
    },
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };

  const data = await _fetchGemini(url, followUp, keyIdx);
  storage.recordKeyUsage(keyIdx);
  const candidate = data.candidates?.[0];

  const nextFunctionCall = candidate?.content?.parts?.find(p => p.functionCall);
  if (nextFunctionCall) {
    return _handleToolCall(
      apiKey,
      keyIdx,
      url,
      followUp.contents,
      candidate.content,
      nextFunctionCall.functionCall,
      chainDepth + 1
    );
  }

  const finalText = candidate?.content?.parts?.map(p => p.text || '').join('').trim() || '';
  if (!candidate?.content?.parts?.length || !finalText) {
    // Tool succeeded but model gave no usable text — construct a response.
    if (result && !result.error) {
      if (name === 'create_sheet') {
        return `✅ Created sheet "${result.title}" successfully!\n\n[Open in Waymark](#/sheet/${result.spreadsheetId})`;
      }
      if (name === 'read_sheet') {
        return `📄 Read sheet "${result.title}" — ${result.totalRows} data rows, columns: ${result.headers.join(', ')}`;
      }
      if (name === 'search_sheets') {
        return result.results.length
          ? `🔍 Found ${result.results.length} sheet(s) matching "${result.query}".`
          : `🔍 No sheets found matching "${result.query}".`;
      }
      if (name === 'update_sheet') {
        if (result.operation === 'append_rows') {
          return `✅ Added ${result.rowsAdded} row(s) to "${result.title}".\n\n[Open in Waymark](#/sheet/${result.spreadsheetId})`;
        }
        return `✅ Updated ${result.cellsUpdated} cell(s) in "${result.title}".\n\n[Open in Waymark](#/sheet/${result.spreadsheetId})`;
      }
      return `✅ Tool ${name} completed successfully.`;
    }
    throw new Error('No response from AI after tool execution. Try again, or clear older chat messages to reduce context size.');
  }

  return finalText;
}

/**
 * Execute a registered tool function.
 * @param {string} name
 * @param {Object} args
 * @returns {Promise<Object>}
 */
async function _executeTool(name, args) {
  return executeTool(name, args);
}

/* ---------- Tool: create_sheet ---------- */

/**
 * Tool: create_sheet — creates a new Google Sheet.
 * Template enum selects headers programmatically; AI only provides data rows.
 * @param {{ template: string, title: string, data: string[][] }} args
 * @returns {Promise<Object>}
 */
async function _toolCreateSheet({ template, title, data }) {
  return toolCreateSheet({ template, title, data });
}

/* ---------- Tool: read_sheet ---------- */

/**
 * Tool: read_sheet — reads contents of an existing Google Sheet.
 * @param {{ spreadsheet_id: string }} args
 * @returns {Promise<Object>}
 */
async function _toolReadSheet({ spreadsheet_id }) {
  return executeTool('read_sheet', { spreadsheet_id });
}

/* ---------- Tool: update_sheet ---------- */

/**
 * Tool: search_sheets — search user's Drive for spreadsheets by name.
 * @param {{ query: string }} args
 * @returns {Promise<Object>}
 */
async function _toolSearchSheets({ query }) {
  return executeTool('search_sheets', { query });
}

/**
 * Tool: update_sheet — modifies an existing Google Sheet.
 * Supports append_rows (add rows at end) and update_cells (change specific cells).
 * @param {{ spreadsheet_id: string, operation: string, rows?: string[][], updates?: Array }} args
 * @returns {Promise<Object>}
 */
async function _toolUpdateSheet({ spreadsheet_id, operation, rows, updates }) {
  return executeTool('update_sheet', { spreadsheet_id, operation, rows, updates });
}

/**
 * Show an inline indicator that a tool is executing.
 * @param {string} toolName
 * @param {Object} args
 */
function _showToolIndicator(toolName, args) {
  showToolIndicator(_chatBody, toolName, args);
}

/** Remove tool execution indicator from chat. */
function _removeToolIndicator() {
  removeToolIndicator(_chatBody);
}

/**
 * Fetch from Gemini API with rate-limit handling.
 * @param {string} url
 * @param {Object} body
 * @returns {Promise<Object>}
 */
async function _fetchGemini(url, body, keyIdx) {
  const currentKey = storage.getAgentKeys()[keyIdx]?.key || '';
  const fetchOpts = {
    method: 'POST',
    headers: _geminiHeaders(currentKey),
    body: JSON.stringify(body),
  };

  const res = await fetch(url, fetchOpts);

  if (res.status === 429) {
    const errData = await res.json().catch(() => ({}));
    const errMsg = errData?.error?.message || '';
    const hardQuotaExceeded = /exceeded your current quota/i.test(errMsg) && !/per minute/i.test(errMsg);

    // Mark this key as errored
    storage.recordKeyError(keyIdx);

    // Try the next key in the ring before surfacing quota/rate-limit errors.
    const keys = storage.getAgentKeys();
    if (keys.length > 1) {
      const next = _getNextKey();
      if (next && next.idx !== keyIdx) {
        _showRetryIndicator(0, true); // indicate key rotation
        const model = storage.getAgentModel() || DEFAULT_MODEL;
        const rotatedUrl = _geminiUrl(model, 'generateContent');
        const retryRes = await fetch(rotatedUrl, {
          method: 'POST',
          headers: _geminiHeaders(next.key),
          body: JSON.stringify(body),
        });
        _removeRetryIndicator();
        if (retryRes.ok) {
          storage.recordKeyUsage(next.idx);
          return retryRes.json();
        }
        // Rotated key also failed — mark it and fall through.
        storage.recordKeyError(next.idx);
      }
    }

    // Billing/hard quota — retrying the same key won't help once rotation fails.
    if (hardQuotaExceeded) {
      throw new Error(
        'Your Gemini API quota is exhausted. To fix this:\n' +
        '• Wait until your quota resets (usually daily)\n' +
        '• Or visit ai.google.dev to upgrade your plan\n' +
        '• Or switch to a different model in Settings'
      );
    }

    // Single key or all keys exhausted — wait and retry original
    const retryMatch = errMsg.match(/retry in ([\d.]+)s/i);
    const delay = retryMatch ? Math.min(parseFloat(retryMatch[1]), 60) : 15;

    _showRetryIndicator(Math.ceil(delay));
    await new Promise(r => setTimeout(r, delay * 1000));
    _removeRetryIndicator();

    const retry = await fetch(url, fetchOpts);
    if (retry.ok) return retry.json();

    if (retry.status === 429) {
      throw new Error(
        'Gemini API is rate-limiting requests. Try again in a minute, or switch to a different model in Settings.'
      );
    }
    const retryData = await retry.json().catch(() => ({}));
    throw new Error(retryData?.error?.message || `API error ${retry.status}`);
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const errMsg = errData?.error?.message || `API error ${res.status}`;
    if (res.status === 400 && /api.?key/i.test(errMsg)) {
      storage.recordKeyError(keyIdx);
      throw new Error('Invalid API key. Check your key in Settings.');
    }
    if (res.status === 403) {
      storage.recordKeyError(keyIdx);
      throw new Error('API key does not have permission. Check your key at ai.google.dev.');
    }
    throw new Error(errMsg);
  }

  return res.json();
}

/** Show a "retrying" indicator in the chat body. */
function _showRetryIndicator(seconds, rotating) {
  showRetryIndicator(_chatBody, seconds, rotating);
}

/** Remove the retry indicator. */
function _removeRetryIndicator() {
  removeRetryIndicator();
}
