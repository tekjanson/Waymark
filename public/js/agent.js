/* ============================================================
   agent.js — Waymark AI user assistant
   Chat interface that helps users organise their data with
   Waymark-powered Google Sheets via the Gemini API.
   ============================================================ */

import { el, showToast } from './ui.js';
import * as storage from './storage.js';
import * as userData from './user-data.js';
import { api } from './api-client.js';
import { TEMPLATES } from './templates/index.js';

/* ---------- Constants ---------- */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

const SYSTEM_PROMPT = `You are the Waymark AI assistant. You help users organise their data by creating Google Sheets that Waymark renders as rich, interactive views.

Use the create_sheet tool whenever a user asks to create, build, set up, or organise something. Pick the best template — the system fills in column headers automatically.

Available templates: checklist (task lists), budget (finances), kanban (project boards), tracker (progress tracking), schedule (timetables), contacts (address books), inventory (stock management), log (activity logs), habit (habit tracking), timesheet (time tracking), crm (sales pipelines), meal (meal plans), travel (trip itineraries), roster (shift schedules), testcases (QA testing), recipe (cookbooks), poll (surveys), changelog (release notes), social (social feeds), flow (flow diagrams), automation (workflow automation), grading (gradebooks).

Guidelines:
- Populate with realistic example data (3–5 rows minimum) so the user sees the format.
- All cell values must be strings — numbers ("500"), dates ("2026-03-15").
- If unsure which template fits, ask or default to checklist (lists) or kanban (projects).
- Be conversational and helpful.`;

/** Maximum number of messages to keep in context for API calls */
const MAX_CONTEXT_MESSAGES = 20;

/**
 * Known template headers — derived from each template's `defaultHeaders`
 * property, which is the single source of truth in the template definition.
 * This is computed once at module load so agent.js never drifts out of sync.
 * @type {Record<string, string[]>}
 */
const KNOWN_HEADERS = Object.fromEntries(
  Object.entries(TEMPLATES)
    .filter(([, t]) => Array.isArray(t.defaultHeaders))
    .map(([k, t]) => [k, t.defaultHeaders])
);

/** Column order per template — compact reference for tool description */
const TEMPLATE_COLUMNS = Object.entries(KNOWN_HEADERS)
  .map(([k, cols]) => `${k}: ${cols.join(', ')}`)
  .join(' | ');

/** Tool definitions for Gemini function calling */
const TOOL_DECLARATIONS = [{
  functionDeclarations: [{
    name: 'create_sheet',
    description: 'Create a new Google Sheet. Headers are auto-filled from the template. ' +
      'Provide data rows matching the column order for the chosen template. ' +
      'Column order per template — ' + TEMPLATE_COLUMNS,
    parameters: {
      type: 'OBJECT',
      properties: {
        template: {
          type: 'STRING',
          description: 'Template key: checklist, budget, kanban, tracker, schedule, contacts, inventory, log, habit, timesheet, crm, meal, travel, roster, testcases, recipe, poll, changelog, social, flow, automation, grading',
        },
        title: {
          type: 'STRING',
          description: 'The title for the new spreadsheet (e.g. "My Budget Tracker", "Project Tasks")',
        },
        data: {
          type: 'ARRAY',
          description: 'Data rows (NO headers — auto-filled). Each row is an array of strings matching the template column order.',
          items: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
      },
      required: ['template', 'title', 'data'],
    },
  }],
}];

/* ---------- State ---------- */

let _messages = [];
let _container = null;
let _chatBody = null;
let _isStreaming = false;

/* ---------- Public API ---------- */

/**
 * Initialise and render the agent chat UI into the given container.
 * @param {HTMLElement} container
 */
export function show(container) {
  _container = container;
  _container.innerHTML = '';
  // Sync API key from Drive if available and not already in localStorage
  const driveSettings = userData.getAgentSettings();
  if (driveSettings?.apiKey && !storage.getAgentApiKey()) {
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
  const apiKey = storage.getAgentApiKey();
  const model = storage.getAgentModel() || DEFAULT_MODEL;

  const header = el('div', { className: 'agent-header' }, [
    el('div', { className: 'agent-header-left' }, [
      el('span', { className: 'agent-header-icon' }, ['🤖']),
      el('h2', { className: 'agent-header-title' }, ['Waymark AI']),
    ]),
    el('div', { className: 'agent-header-actions' }, [
      el('button', {
        className: 'agent-settings-btn',
        title: 'Configure API key',
        on: { click: _showSettings },
      }, ['⚙️ Settings']),
      el('button', {
        className: 'agent-clear-btn',
        title: 'Clear conversation',
        on: { click: _clearConversation },
      }, ['🗑️ Clear']),
    ]),
  ]);

  _chatBody = el('div', { className: 'agent-chat-body' });

  if (!apiKey) {
    _chatBody.appendChild(_buildWelcome());
  } else if (_messages.length === 0) {
    _chatBody.appendChild(_buildEmptyState());
  } else {
    _messages.forEach(msg => _chatBody.appendChild(_buildMessage(msg)));
  }

  const inputRow = _buildInputRow(apiKey);

  const wrapper = el('div', { className: 'agent-container' }, [
    header,
    _chatBody,
    inputRow,
  ]);

  _container.appendChild(wrapper);
}

function _buildWelcome() {
  return el('div', { className: 'agent-welcome' }, [
    el('div', { className: 'agent-welcome-icon' }, ['🤖']),
    el('h3', {}, ['Welcome to Waymark AI']),
    el('p', {}, ['I can help you create and organise Google Sheets — budgets, project boards, meal plans, and more. Set up your API key to get started.']),
    el('p', { className: 'agent-welcome-hint' }, [
      'Get a free API key at ',
      el('a', {
        href: 'https://aistudio.google.com/apikey',
        target: '_blank',
        rel: 'noopener',
      }, ['aistudio.google.com/apikey']),
    ]),
    el('button', {
      className: 'agent-welcome-btn',
      on: { click: _showSettings },
    }, ['⚙️ Configure API Key']),
  ]);
}

function _buildEmptyState() {
  return el('div', { className: 'agent-empty' }, [
    el('p', { className: 'agent-empty-text' }, ['I can help you create and organise Google Sheets that Waymark renders as rich views. What would you like to build?']),
    el('div', { className: 'agent-suggestions' }, [
      _buildSuggestion('Create a project board to track my tasks'),
      _buildSuggestion('Build a weekly meal planner'),
      _buildSuggestion('Set up a budget tracker for this month'),
      _buildSuggestion('Make a recipe sheet for my favourite dishes'),
    ]),
  ]);
}

function _buildSuggestion(text) {
  return el('button', {
    className: 'agent-suggestion',
    on: { click: () => _sendMessage(text) },
  }, [text]);
}

function _buildInputRow(apiKey) {
  const inputAttrs = {
    className: 'agent-input',
    placeholder: apiKey ? 'Describe what you\'d like to create or organise...' : 'Configure API key in Settings first...',
    rows: 1,
    on: {
      keydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _sendMessage(input.value);
        }
      },
      input: () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
      },
    },
  };
  if (!apiKey) inputAttrs.disabled = 'disabled';

  const input = el('textarea', inputAttrs);

  const sendAttrs = {
    className: 'agent-send-btn',
    title: 'Send message',
    on: { click: () => _sendMessage(input.value) },
  };
  if (!apiKey) sendAttrs.disabled = 'disabled';

  const sendBtn = el('button', sendAttrs, ['➤']);

  return el('div', { className: 'agent-input-row' }, [input, sendBtn]);
}

/* ---------- Message Rendering ---------- */

function _buildMessage(msg) {
  const isUser = msg.role === 'user';
  const wrapper = el('div', {
    className: 'agent-message ' + (isUser ? 'agent-message-user' : 'agent-message-assistant'),
  });

  const avatar = el('div', { className: 'agent-message-avatar' }, [isUser ? '👤' : '🤖']);
  const content = el('div', { className: 'agent-message-content' });

  if (isUser) {
    content.appendChild(el('p', {}, [msg.content]));
  } else {
    _renderMarkdown(content, msg.content);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  return wrapper;
}

/**
 * Render markdown-like content (code blocks, inline code, paragraphs).
 * @param {HTMLElement} container
 * @param {string} text
 */
function _renderMarkdown(container, text) {
  const parts = text.split(/(```[\s\S]*?```)/g);

  parts.forEach(part => {
    if (part.startsWith('```')) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (match) {
        const lang = match[1] || '';
        const code = match[2].trim();
        container.appendChild(_buildCodeBlock(code, lang));
      }
    } else if (part.trim()) {
      const lines = part.split('\n\n');
      lines.forEach(line => {
        if (!line.trim()) return;
        const p = el('p', {});
        _renderInlineMarkdown(p, line.trim());
        container.appendChild(p);
      });
    }
  });
}

/**
 * Handle inline markdown: bold, inline code, links.
 * @param {HTMLElement} parent
 * @param {string} text
 */
function _renderInlineMarkdown(parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      parent.appendChild(el('code', { className: 'agent-inline-code' }, [token.slice(1, -1)]));
    } else if (token.startsWith('**')) {
      parent.appendChild(el('strong', {}, [token.slice(2, -2)]));
    } else if (token.startsWith('*')) {
      parent.appendChild(el('em', {}, [token.slice(1, -1)]));
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function _buildCodeBlock(code, lang) {
  const copyBtn = el('button', {
    className: 'agent-code-copy',
    title: 'Copy to clipboard',
    on: {
      click: () => {
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
        });
      },
    },
  }, ['📋 Copy']);

  const header = el('div', { className: 'agent-code-header' }, [
    el('span', { className: 'agent-code-lang' }, [lang || 'code']),
    copyBtn,
  ]);

  const pre = el('pre', { className: 'agent-code-pre' }, [
    el('code', { className: 'agent-code' }, [code]),
  ]);

  return el('div', { className: 'agent-code-block' }, [header, pre]);
}

/* ---------- Settings Modal ---------- */

function _showSettings() {
  const existingModal = document.getElementById('agent-settings-modal');
  if (existingModal) existingModal.remove();

  const currentKey = storage.getAgentApiKey() || '';
  const currentModel = storage.getAgentModel() || DEFAULT_MODEL;
  const driveSettings = userData.getAgentSettings();
  const cloudSyncEnabled = driveSettings !== null;

  const keyInput = el('input', {
    type: 'password',
    className: 'agent-settings-input',
    placeholder: 'Enter your Gemini API key...',
    value: currentKey,
  });

  const modelSelect = el('select', { className: 'agent-settings-select' }, [
    el('option', { value: 'gemini-2.0-flash', selected: currentModel === 'gemini-2.0-flash' }, ['Gemini 2.0 Flash (fast)']),
    el('option', { value: 'gemini-2.0-flash-lite', selected: currentModel === 'gemini-2.0-flash-lite' }, ['Gemini 2.0 Flash Lite (fastest)']),
    el('option', { value: 'gemini-2.5-flash-preview-05-20', selected: currentModel === 'gemini-2.5-flash-preview-05-20' }, ['Gemini 2.5 Flash (balanced)']),
    el('option', { value: 'gemini-2.5-pro-preview-05-06', selected: currentModel === 'gemini-2.5-pro-preview-05-06' }, ['Gemini 2.5 Pro (best)']),
    el('option', { value: 'gemini-flash-latest', selected: currentModel === 'gemini-flash-latest' }, ['Gemini Flash Latest']),
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
        const key = keyInput.value.trim();
        if (key) {
          storage.setAgentApiKey(key);
          storage.setAgentModel(modelSelect.value);
          // Sync to Drive if cloud toggle is checked
          if (cloudToggle.checked) {
            await userData.saveAgentSettings({ apiKey: key, model: modelSelect.value });
          } else {
            await userData.saveAgentSettings(null);
          }
          showToast('Settings saved', 'success');
          overlay.remove();
          show(_container);
        } else {
          showToast('Please enter an API key', 'error');
        }
      },
    },
  }, ['Save']);

  const removeBtn = el('button', {
    className: 'agent-settings-remove',
    on: {
      click: async () => {
        storage.setAgentApiKey('');
        await userData.saveAgentSettings(null);
        showToast('API key removed', 'info');
        overlay.remove();
        show(_container);
      },
    },
  }, ['Remove Key']);

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
      el('label', { className: 'agent-settings-label' }, ['Gemini API Key']),
      keyInput,
      el('p', { className: 'agent-settings-hint' }, [
        'Your key is stored locally in your browser. ',
        el('a', {
          href: 'https://aistudio.google.com/apikey',
          target: '_blank',
          rel: 'noopener',
        }, ['Get a free key →']),
      ]),
      el('label', { className: 'agent-settings-label agent-settings-model-label' }, ['Model']),
      modelSelect,
      el('label', { className: 'agent-settings-label agent-settings-cloud-label' }, [
        cloudToggle,
        ' Sync API key across devices',
      ]),
      el('p', { className: 'agent-settings-hint' }, [
        'When enabled, your API key and model are stored in your Google Drive so they work across all your devices.',
      ]),
    ]),
    el('div', { className: 'modal-footer' }, [
      currentKey ? removeBtn : el('span'),
      saveBtn,
    ]),
  ]);

  const overlay = el('div', {
    id: 'agent-settings-modal',
    className: 'modal-overlay',
    on: {
      click: (e) => { if (e.target === overlay) overlay.remove(); },
    },
  }, [modal]);

  document.body.appendChild(overlay);
  keyInput.focus();
}

/* ---------- Conversation Logic ---------- */

function _persistConversation() {
  storage.setAgentConversation(_messages);
}

function _clearConversation() {
  _messages = [];
  _persistConversation();
  if (_chatBody) {
    _chatBody.innerHTML = '';
    const apiKey = storage.getAgentApiKey();
    _chatBody.appendChild(apiKey ? _buildEmptyState() : _buildWelcome());
  }
}

async function _sendMessage(text) {
  if (!text || !text.trim() || _isStreaming) return;

  const apiKey = storage.getAgentApiKey();
  if (!apiKey) {
    showToast('Configure your API key in Settings first', 'error');
    return;
  }

  const userText = text.trim();

  // Clear empty state / suggestions
  const empty = _chatBody.querySelector('.agent-empty');
  if (empty) empty.remove();
  const welcome = _chatBody.querySelector('.agent-welcome');
  if (welcome) welcome.remove();

  // Add user message
  _messages.push({ role: 'user', content: userText });
  _chatBody.appendChild(_buildMessage({ role: 'user', content: userText }));

  // Clear input
  const input = _container.querySelector('.agent-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  // Scroll to bottom
  _chatBody.scrollTop = _chatBody.scrollHeight;

  // Show typing indicator
  const typing = el('div', { className: 'agent-message agent-message-assistant agent-typing' }, [
    el('div', { className: 'agent-message-avatar' }, ['🤖']),
    el('div', { className: 'agent-message-content' }, [
      el('div', { className: 'agent-typing-dots' }, [
        el('span', {}, ['·']),
        el('span', {}, ['·']),
        el('span', {}, ['·']),
      ]),
    ]),
  ]);
  _chatBody.appendChild(typing);
  _chatBody.scrollTop = _chatBody.scrollHeight;

  // Call Gemini API
  _isStreaming = true;
  try {
    const response = await _callGemini(apiKey, userText);
    typing.remove();

    _messages.push({ role: 'assistant', content: response });
    const msgEl = _buildMessage({ role: 'assistant', content: response });
    _chatBody.appendChild(msgEl);
    _chatBody.scrollTop = _chatBody.scrollHeight;
    _persistConversation();
  } catch (err) {
    typing.remove();
    showToast('AI error: ' + err.message, 'error');

    const errorMsg = { role: 'assistant', content: '⚠️ Error: ' + err.message };
    _messages.push(errorMsg);
    _chatBody.appendChild(_buildMessage(errorMsg));
  } finally {
    _isStreaming = false;
  }
}

/* ---------- Gemini API ---------- */

/**
 * Call the Gemini API with conversation history.
 * @param {string} apiKey
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function _callGemini(apiKey, userMessage) {
  const model = storage.getAgentModel() || DEFAULT_MODEL;
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

  // Build conversation contents with context trimming
  const contents = _buildContents(userMessage);

  const body = {
    contents,
    tools: TOOL_DECLARATIONS,
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 8192,
    },
  };

  const data = await _fetchGemini(url, body);
  const candidate = data.candidates?.[0];

  if (!candidate?.content?.parts?.length) {
    throw new Error('No response from AI');
  }

  // Check for function call in response
  const functionCall = candidate.content.parts.find(p => p.functionCall);
  if (functionCall) {
    return _handleToolCall(apiKey, url, contents, candidate.content, functionCall.functionCall);
  }

  return candidate.content.parts.map(p => p.text || '').join('');
}

/**
 * Build contents array with context management — trim old messages.
 * @param {string} userMessage
 * @returns {Array}
 */
function _buildContents(userMessage) {
  const contents = [];
  // Take recent messages, skipping the last (it's the just-added user msg)
  const history = _messages.slice(0, -1);
  const trimmed = history.length > MAX_CONTEXT_MESSAGES
    ? history.slice(-MAX_CONTEXT_MESSAGES)
    : history;

  for (const msg of trimmed) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
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
 * @returns {Promise<string>}
 */
async function _handleToolCall(apiKey, url, contents, modelContent, functionCall) {
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
      parts: [{ text: SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 8192,
    },
  };

  const data = await _fetchGemini(url, followUp);
  const candidate = data.candidates?.[0];

  if (!candidate?.content?.parts?.length) {
    // Tool succeeded but model gave no text — construct a response
    if (result && !result.error) {
      return `✅ Created sheet "${result.title}" successfully!\n\n[Open in Waymark](#/sheet/${result.spreadsheetId})`;
    }
    throw new Error('No response from AI after tool execution');
  }

  return candidate.content.parts.map(p => p.text || '').join('');
}

/**
 * Execute a registered tool function.
 * @param {string} name
 * @param {Object} args
 * @returns {Promise<Object>}
 */
async function _executeTool(name, args) {
  if (name === 'create_sheet') {
    return _toolCreateSheet(args);
  }
  throw new Error(`Unknown tool: ${name}`);
}

/* ---------- Tool: create_sheet ---------- */

/**
 * Tool: create_sheet — creates a new Google Sheet.
 * Template enum selects headers programmatically; AI only provides data rows.
 * @param {{ template: string, title: string, data: string[][] }} args
 * @returns {Promise<Object>}
 */
async function _toolCreateSheet({ template, title, data }) {
  if (!title || !data || !data.length) {
    throw new Error('Missing title or data');
  }

  // Look up headers from known templates
  const headers = KNOWN_HEADERS[template];
  if (!headers) {
    throw new Error(`Unknown template "${template}". Use one of: ${Object.keys(KNOWN_HEADERS).join(', ')}`);
  }

  // Build rows: headers + data
  const headerCount = headers.length;
  const cleanData = data.map(row => {
    const clean = (Array.isArray(row) ? row : []).map(cell => String(cell ?? ''));
    // Pad/trim to match header count
    while (clean.length < headerCount) clean.push('');
    return clean.slice(0, headerCount);
  });

  const allRows = [headers, ...cleanData];
  const result = await api.sheets.createSpreadsheet(title, allRows);

  return {
    spreadsheetId: result.spreadsheetId,
    title,
    template,
    rowCount: cleanData.length,
    columns: headers,
  };
}

/**
 * Show an inline indicator that a tool is executing.
 * @param {string} toolName
 * @param {Object} args
 */
function _showToolIndicator(toolName, args) {
  if (!_chatBody) return;
  const label = toolName === 'create_sheet'
    ? `Creating ${args.template || ''} sheet "${args.title || 'Untitled'}"...`
    : `Running ${toolName}...`;
  const indicator = el('div', { className: 'agent-tool-indicator' }, [
    el('span', { className: 'agent-tool-icon' }, ['🔧']),
    el('span', {}, [label]),
  ]);
  _chatBody.appendChild(indicator);
  _chatBody.scrollTop = _chatBody.scrollHeight;
}

/** Remove tool execution indicator from chat. */
function _removeToolIndicator() {
  if (!_chatBody) return;
  const ind = _chatBody.querySelector('.agent-tool-indicator');
  if (ind) ind.remove();
}

/**
 * Fetch from Gemini API with rate-limit handling.
 * @param {string} url
 * @param {Object} body
 * @returns {Promise<Object>}
 */
async function _fetchGemini(url, body) {
  const fetchOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };

  const res = await fetch(url, fetchOpts);

  if (res.status === 429) {
    const errData = await res.json().catch(() => ({}));
    const errMsg = errData?.error?.message || '';

    // Billing/hard quota — retrying won't help
    if (/exceeded your current quota/i.test(errMsg) && !/per minute/i.test(errMsg)) {
      throw new Error(
        'Your Gemini API quota is exhausted. To fix this:\n' +
        '• Wait until your quota resets (usually daily)\n' +
        '• Or visit ai.google.dev to upgrade your plan\n' +
        '• Or switch to a different model in Settings'
      );
    }

    // Per-minute rate limit — wait and retry
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
      throw new Error('Invalid API key. Check your key in Settings.');
    }
    if (res.status === 403) {
      throw new Error('API key does not have permission. Check your key at ai.google.dev.');
    }
    throw new Error(errMsg);
  }

  return res.json();
}

/** Show a "retrying" indicator in the chat body. */
function _showRetryIndicator(seconds) {
  if (!_chatBody) return;
  const indicator = el('div', { className: 'agent-tool-indicator', id: 'agent-retry-indicator' }, [
    el('span', { className: 'agent-tool-icon' }, ['⏳']),
    el('span', {}, [`Rate limited — retrying in ${seconds}s...`]),
  ]);
  _chatBody.appendChild(indicator);
  _chatBody.scrollTop = _chatBody.scrollHeight;
}

/** Remove the retry indicator. */
function _removeRetryIndicator() {
  document.getElementById('agent-retry-indicator')?.remove();
}
