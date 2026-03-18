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
const DEFAULT_MODEL = 'gemini-flash-latest';

/**
 * Build a Gemini API URL for the given model/action pair.
 * @param {string} model
 * @param {string} action
 * @param {string} [query]
 * @returns {string}
 */
function _geminiUrl(model, action, query = '') {
  const suffix = query ? `?${query}` : '';
  return `${GEMINI_API_BASE}/${encodeURIComponent(model)}:${action}${suffix}`;
}

/**
 * Build headers for Gemini API requests using the documented auth pattern.
 * @param {string} apiKey
 * @returns {Object}
 */
function _geminiHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'X-goog-api-key': apiKey,
  };
}

const BASE_SYSTEM_PROMPT = `You are the Waymark AI assistant. You help users organise their data by creating Google Sheets that Waymark renders as rich, interactive views.

Use the create_sheet tool whenever a user asks to create, build, set up, or organise something. Pick the best template — the system fills in column headers automatically.

Use the read_sheet tool whenever a user asks to see, view, check, open, summarize, or analyze the contents of an existing sheet. You need the spreadsheet ID — ask the user if you don't have it.

Use the search_sheets tool to find sheets in the user's Drive by name. Use it when the user mentions a sheet you don't recognize from context, or asks "what sheets do I have?" for a more comprehensive list.

Use the update_sheet tool to modify existing sheets. Use operation "append_rows" to add new rows, or "update_cells" to change specific cells. Always read_sheet first to understand the current column structure before updating.

Available templates: checklist (task lists), budget (finances), kanban (project boards), tracker (progress tracking), schedule (timetables), contacts (address books), inventory (stock management), log (activity logs), habit (habit tracking), timesheet (time tracking), crm (sales pipelines), meal (meal plans), travel (trip itineraries), roster (shift schedules), testcases (QA testing), recipe (cookbooks), poll (surveys), changelog (release notes), social (social feeds), flow (flow diagrams), automation (workflow automation), grading (gradebooks).

Guidelines:
- Populate with realistic example data (3–5 rows minimum) so the user sees the format.
- All cell values must be strings — numbers ("500"), dates ("2026-03-15").
- If unsure which template fits, ask or default to checklist (lists) or kanban (projects).
- When the user refers to "my sheet" or a sheet by name, use read_sheet with the spreadsheet ID.
- ALWAYS link to sheets using Waymark URLs: [Title](#/sheet/{spreadsheetId}). NEVER link to docs.google.com — keep users in Waymark.
- When a request spans multiple domains (e.g. "plan a vacation on a budget"), create MULTIPLE sheets — one per template that fits (e.g. a travel sheet AND a budget sheet). Call create_sheet multiple times.
- Be conversational and helpful.`;

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

/**
 * Collapse whitespace and cap text length so old chat history does not consume
 * the entire model budget.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function _compactContextText(text, maxChars) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  const tail = Math.max(80, Math.floor(maxChars * 0.25));
  const head = Math.max(0, maxChars - tail - 3);
  return compact.slice(0, head).trimEnd() + '...' + compact.slice(-tail).trimStart();
}

const PLANNER_TEMPLATE_HINTS = [{
  template: 'travel',
  patterns: [/\btrip\b/i, /\btravel\b/i, /\bvacation\b/i, /\bitinerary\b/i, /\broad\s*trip\b/i, /\bflight\b/i, /\bhotel\b/i],
}, {
  template: 'budget',
  patterns: [/\bbudget\b/i, /\bcost\b/i, /\bexpense\b/i, /\bspend\b/i, /\bfinance\b/i, /\$\s*\d/i],
}, {
  template: 'checklist',
  patterns: [/\bpacking\b/i, /\bchecklist\b/i, /\bto\s*do\b/i, /\bbring\b/i],
}, {
  template: 'schedule',
  patterns: [/\bschedule\b/i, /\btimeline\b/i, /\bcalendar\b/i],
}, {
  template: 'contacts',
  patterns: [/\bcontact\b/i, /\bphone\b/i, /\baddress\b/i],
}];

/**
 * Infer likely template domains from a raw user request.
 * @param {string} text
 * @returns {string[]}
 */
function _inferTemplateHints(text) {
  const hints = [];
  for (const rule of PLANNER_TEMPLATE_HINTS) {
    if (rule.patterns.some(pattern => pattern.test(text))) {
      hints.push(rule.template);
    }
  }
  return hints;
}

/**
 * Create a compact planning brief so the model sees the request as smaller,
 * structured work packets instead of one large blob.
 * @param {string} userText
 * @returns {string}
 */
function _buildPlannerBrief(userText) {
  const text = String(userText ?? '').trim();
  if (!text) return '';

  const lower = text.toLowerCase();
  const hints = _inferTemplateHints(text);
  const parts = [`Primary request: ${_compactContextText(text, 240)}`];

  if (hints.length) {
    parts.push(`Detected domains: ${hints.join(', ')}.`);
  }

  const budgetMatch = text.match(/(?:under|within|around|about|for)\s+\$?([\d,]+(?:\.\d+)?)/i)
    || text.match(/\$([\d,]+(?:\.\d+)?)/)
    || text.match(/\b([\d,]+(?:\.\d+)?)\s+budget\b/i);
  if (budgetMatch?.[1]) {
    parts.push(`Budget constraint: ${budgetMatch[1].replace(/,/g, '')}.`);
  }

  if (/\bfrom\b.+\bto\b/i.test(text)) {
    parts.push('The request includes a route or start/end locations.');
  }

  if (hints.length > 1) {
    parts.push(`Execution plan: create separate sheets for ${hints.join(', ')} instead of merging everything into one sheet.`);
  } else if (/\bcreate\b|\bplan\b|\borganize\b|\bbuild\b/i.test(lower)) {
    parts.push('Execution plan: prefer tool use and structured sheets over prose-only answers.');
  }

  if (/\bmy\s+sheet\b|\bfind\b|\bopen\b|\bsearch\b/i.test(lower)) {
    parts.push('Use search_sheets first if the sheet ID is unknown.');
  }

  return parts.join(' ');
}

/**
 * Determine whether a prompt is complex enough to justify one cheap planning call.
 * @param {string} userText
 * @returns {boolean}
 */
function _shouldUsePlannerRound(userText) {
  const text = String(userText ?? '').trim();
  if (!text) return false;
  const hints = _inferTemplateHints(text);
  return hints.length > 1
    || text.length > 220
    || (/\bfrom\b.+\bto\b/i.test(text) && /\$\s*\d|\bbudget\b/i.test(text));
}

/**
 * Rough token estimate using 4 chars/token. Good enough for early refusal.
 * @param {string} text
 * @returns {number}
 */
function _estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * Estimate the token cost of a full request body.
 * @param {Object} body
 * @returns {number}
 */
function _estimateRequestTokens(body) {
  return _estimateTokens(JSON.stringify(body));
}

/**
 * Estimate the raw conversation size before trimming so obviously oversized
 * chats fail locally instead of spending a planner/model call first.
 * @param {string} userMessage
 * @returns {number}
 */
function _estimateRawConversationTokens(userMessage) {
  const rawHistory = _messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map(msg => String(msg.content ?? ''))
    .join(' ');
  return _estimateTokens(`${_getSystemPrompt()} ${rawHistory} ${String(userMessage ?? '')}`);
}

/**
 * Throw before making a model call if the request is too large for the local budget.
 * @param {Object} body
 * @param {string} phase
 */
function _assertRequestWithinBudget(body, phase) {
  const estimatedTokens = _estimateRequestTokens(body);
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
  const estimatedTokens = _estimateRawConversationTokens(userMessage);
  if (estimatedTokens > MAX_ESTIMATED_REQUEST_TOKENS) {
    throw new Error(
      `This conversation would use about ${estimatedTokens} input tokens, which is above the local budget of ${MAX_ESTIMATED_REQUEST_TOKENS}. ` +
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
  const url = _geminiUrl(model, 'generateContent');
  const compactUserText = _compactContextText(userText, MAX_USER_MESSAGE_CHARS);
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
  return _compactContextText(text, MAX_PLANNED_BRIEF_CHARS);
}

/**
 * Build the final user message sent to the model.
 * @param {string} userText
 * @returns {string}
 */
function _buildPlannedUserMessage(userText) {
  const compactUserText = _compactContextText(userText, MAX_USER_MESSAGE_CHARS);
  const plannerBrief = _buildPlannerBrief(compactUserText);
  if (!plannerBrief) return compactUserText;
  return _compactContextText(
    `Planner brief: ${plannerBrief} User request: ${compactUserText}`,
    MAX_PLANNED_USER_MESSAGE_CHARS
  );
}

/**
 * Extract recent sheet links mentioned in the conversation so follow-up prompts
 * like "that checklist" can be grounded to a concrete spreadsheet ID.
 * @returns {Array<{title: string, id: string}>}
 */
function _getRecentConversationSheets() {
  const sheetPattern = /\[([^\]]+)\]\(#\/sheet\/([^)]+)\)/g;
  const seen = new Set();
  const recent = [];

  for (let i = _messages.length - 1; i >= 0; i--) {
    const text = String(_messages[i]?.content || '');
    let match;
    while ((match = sheetPattern.exec(text)) !== null) {
      const title = match[1].trim();
      const id = match[2].trim();
      const key = `${title}::${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push({ title, id });
      if (recent.length >= 5) return recent;
    }
  }

  return recent;
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

  const recentSheets = _getRecentConversationSheets();
  if (recentSheets.length) {
    const recentList = recentSheets
      .map(sheet => `"${sheet.title}" (id: ${sheet.id})`)
      .join(', ');
    parts.push(`Recent sheet references from this conversation: ${recentList}.`);
    parts.push('If the user says "that sheet", "that checklist", "it", or asks to add/change items in something you just created, resolve that to the most relevant recent sheet ID and prefer update_sheet over creating a duplicate.');
  }

  _cachedContext = parts.join(' ');
}

/** Maximum number of messages to keep in context for API calls */
const MAX_CONTEXT_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 3600;
const MAX_USER_MESSAGE_CHARS = 900;
const MAX_PLANNED_USER_MESSAGE_CHARS = 1200;
const MAX_PLANNED_BRIEF_CHARS = 240;
const MAX_ASSISTANT_MESSAGE_CHARS = 500;
const MAX_CONTEXT_SHEETS = 12;
const MAX_ESTIMATED_REQUEST_TOKENS = 3400;

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
  }, {
    name: 'read_sheet',
    description: 'Read the contents of an existing Google Sheet by its spreadsheet ID. ' +
      'Returns the sheet title, column headers, and all data rows.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spreadsheet_id: {
          type: 'STRING',
          description: 'The Google Sheets spreadsheet ID (from the URL or from a previous create_sheet result)',
        },
      },
      required: ['spreadsheet_id'],
    },
  }, {
    name: 'search_sheets',
    description: 'Search the user\'s Google Drive for spreadsheets by name. ' +
      'Returns matching sheets with their IDs, names, and folder locations. ' +
      'Use this when the user refers to a sheet you don\'t have the ID for.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Search term to match against sheet names (case-insensitive substring match)',
        },
      },
      required: ['query'],
    },
  }, {
    name: 'update_sheet',
    description: 'Update an existing Google Sheet. Supports two operations: ' +
      '"append_rows" adds new rows at the bottom, "update_cells" changes specific cells. ' +
      'Use read_sheet first to see the current data and column order before updating.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spreadsheet_id: {
          type: 'STRING',
          description: 'The Google Sheets spreadsheet ID to update',
        },
        operation: {
          type: 'STRING',
          description: 'Either "append_rows" to add rows at the end, or "update_cells" to change specific cells',
        },
        rows: {
          type: 'ARRAY',
          description: 'For append_rows: array of new rows to add (each row is an array of strings matching column order)',
          items: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        updates: {
          type: 'ARRAY',
          description: 'For update_cells: array of cell updates. Each has row (1-based data row, excluding header), column (column name or 0-based index), and value.',
          items: {
            type: 'OBJECT',
            properties: {
              row: { type: 'NUMBER', description: '1-based data row number (1 = first data row after header)' },
              column: { type: 'STRING', description: 'Column name (matching header) or 0-based column index as string' },
              value: { type: 'STRING', description: 'New cell value' },
            },
          },
        },
      },
      required: ['spreadsheet_id', 'operation'],
    },
  }],
}];

/* ---------- State ---------- */

let _messages = [];
let _container = null;
let _chatBody = null;
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
  const keys = storage.getAgentKeys();
  const hasKeys = keys.length > 0;
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

  if (!hasKeys) {
    _chatBody.appendChild(_buildWelcome());
  } else if (_messages.length === 0) {
    _chatBody.appendChild(_buildEmptyState());
  } else {
    _messages.forEach(msg => _chatBody.appendChild(_buildMessage(msg)));
  }

  const inputRow = _buildInputRow(hasKeys);

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

function _buildInputRow(hasKeys) {
  const inputAttrs = {
    className: 'agent-input',
    placeholder: hasKeys ? 'Describe what you\'d like to create or organise...' : 'Configure API key in Settings first...',
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
  if (!hasKeys) inputAttrs.disabled = 'disabled';

  const input = el('textarea', inputAttrs);

  const sendAttrs = {
    className: 'agent-send-btn',
    title: 'Send message',
    on: { click: () => _sendMessage(input.value) },
  };
  if (!hasKeys) sendAttrs.disabled = 'disabled';

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

/** Mask an API key for display: show last 4 chars. */
function _maskKey(key) {
  if (!key || key.length < 8) return '····';
  return '····' + key.slice(-4);
}

function _showSettings() {
  const existingModal = document.getElementById('agent-settings-modal');
  if (existingModal) existingModal.remove();

  const keys = storage.getAgentKeys();
  const currentModel = storage.getAgentModel() || DEFAULT_MODEL;
  const driveSettings = userData.getAgentSettings();
  const cloudSyncEnabled = driveSettings !== null;

  /* --- Key list --- */
  const keyListContainer = el('div', { className: 'agent-keyring-list' });

  function _renderKeyList() {
    keyListContainer.innerHTML = '';
    const currentKeys = storage.getAgentKeys();
    if (currentKeys.length === 0) {
      keyListContainer.appendChild(
        el('p', { className: 'agent-keyring-empty' }, ['No API keys configured. Add one below.'])
      );
      return;
    }
    currentKeys.forEach((k, i) => {
      const row = el('div', { className: 'agent-keyring-row' }, [
        el('div', { className: 'agent-keyring-info' }, [
          el('span', { className: 'agent-keyring-nickname' }, [k.nickname || `Key ${i + 1}`]),
          el('span', { className: 'agent-keyring-masked' }, [_maskKey(k.key)]),
          el('span', { className: 'agent-keyring-usage' }, [`${k.requestsToday || 0} today`]),
          k.isBilled ? el('span', { className: 'agent-keyring-badge agent-keyring-billed' }, ['Billed']) : null,
        ]),
        el('button', {
          className: 'agent-keyring-remove',
          title: 'Remove this key',
          on: {
            click: () => {
              const updated = storage.getAgentKeys().filter((_, j) => j !== i);
              storage.setAgentKeys(updated);
              _renderKeyList();
            },
          },
        }, ['✕']),
      ]);
      keyListContainer.appendChild(row);
    });
  }
  _renderKeyList();

  /* --- Add key form --- */
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
        if (current.some(k => k.key === key)) { showToast('This key is already in your ring', 'error'); return; }
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
        _renderKeyList();
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
        show(_container);
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
        show(_container);
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
      click: (e) => { if (e.target === overlay) overlay.remove(); },
    },
  }, [modal]);

  document.body.appendChild(overlay);
  newKeyInput.focus();
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

  const contents = _buildContents(plannedUserText);
  const body = {
    contents,
    tools: TOOL_DECLARATIONS,
    systemInstruction: {
      parts: [{ text: _getSystemPrompt() }],
    },
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 8192,
    },
  };

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
          // Abort the stream reader and delegate to tool handler
          reader.cancel();
          const bufferedUrl = _geminiUrl(model, 'generateContent');
          return _handleToolCall(apiKey, keyIdx, bufferedUrl, contents, candidate.content, fc.functionCall);
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
 * Build contents array with context management — trim old messages.
 * @param {string} userMessage
 * @returns {Array}
 */
function _buildContents(userMessage) {
  const contents = [];
  const finalUserText = _compactContextText(userMessage, MAX_PLANNED_USER_MESSAGE_CHARS);
  let remainingChars = Math.max(0, MAX_CONTEXT_CHARS - finalUserText.length);
  const history = _messages.slice(0, -1);
  const selected = [];

  for (let i = history.length - 1; i >= 0; i--) {
    if (selected.length >= MAX_CONTEXT_MESSAGES) break;
    if (remainingChars <= 0) break;

    const msg = history[i];
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
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 8192,
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

  if (!candidate?.content?.parts?.length) {
    // Tool succeeded but model gave no text — construct a response
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
  if (name === 'read_sheet') {
    return _toolReadSheet(args);
  }
  if (name === 'search_sheets') {
    return _toolSearchSheets(args);
  }
  if (name === 'update_sheet') {
    return _toolUpdateSheet(args);
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

/* ---------- Tool: read_sheet ---------- */

/**
 * Tool: read_sheet — reads contents of an existing Google Sheet.
 * @param {{ spreadsheet_id: string }} args
 * @returns {Promise<Object>}
 */
async function _toolReadSheet({ spreadsheet_id }) {
  if (!spreadsheet_id) {
    throw new Error('Missing spreadsheet_id');
  }

  const sheet = await api.sheets.getSpreadsheet(spreadsheet_id);

  const headers = sheet.values?.[0] || [];
  const dataRows = (sheet.values || []).slice(1);

  // Cap rows sent to the model to stay within token limits
  const MAX_ROWS = 100;
  const truncated = dataRows.length > MAX_ROWS;
  const rows = truncated ? dataRows.slice(0, MAX_ROWS) : dataRows;

  return {
    spreadsheetId: spreadsheet_id,
    title: sheet.title,
    sheetTitle: sheet.sheetTitle,
    headers,
    rows,
    totalRows: dataRows.length,
    truncated,
  };
}

/* ---------- Tool: update_sheet ---------- */

/**
 * Tool: search_sheets — search user's Drive for spreadsheets by name.
 * @param {{ query: string }} args
 * @returns {Promise<Object>}
 */
async function _toolSearchSheets({ query }) {
  if (!query) {
    throw new Error('Missing search query');
  }

  const allSheets = await api.drive.getAllSheets();
  const lowerQuery = query.toLowerCase();
  const matches = allSheets.filter(s => s.name.toLowerCase().includes(lowerQuery));

  return {
    query,
    results: matches.slice(0, 20).map(s => ({
      id: s.id,
      name: s.name,
      folder: s.folder || '',
    })),
    totalMatches: matches.length,
  };
}

/**
 * Tool: update_sheet — modifies an existing Google Sheet.
 * Supports append_rows (add rows at end) and update_cells (change specific cells).
 * @param {{ spreadsheet_id: string, operation: string, rows?: string[][], updates?: Array }} args
 * @returns {Promise<Object>}
 */
async function _toolUpdateSheet({ spreadsheet_id, operation, rows, updates }) {
  if (!spreadsheet_id) {
    throw new Error('Missing spreadsheet_id');
  }
  if (!operation) {
    throw new Error('Missing operation — use "append_rows" or "update_cells"');
  }

  // Read the current sheet to get sheetTitle and headers
  const sheet = await api.sheets.getSpreadsheet(spreadsheet_id);
  const sheetTitle = sheet.sheetTitle || 'Sheet1';
  const headers = sheet.values?.[0] || [];

  if (operation === 'append_rows') {
    if (!rows || !rows.length) {
      throw new Error('append_rows requires a non-empty "rows" array');
    }

    const cleanRows = rows.map(row => {
      const clean = (Array.isArray(row) ? row : []).map(cell => String(cell ?? ''));
      while (clean.length < headers.length) clean.push('');
      return clean.slice(0, headers.length);
    });

    await api.sheets.appendRows(spreadsheet_id, sheetTitle, cleanRows);

    return {
      spreadsheetId: spreadsheet_id,
      title: sheet.title,
      operation: 'append_rows',
      rowsAdded: cleanRows.length,
    };
  }

  if (operation === 'update_cells') {
    if (!updates || !updates.length) {
      throw new Error('update_cells requires a non-empty "updates" array');
    }

    let cellsUpdated = 0;
    for (const u of updates) {
      const dataRow = Number(u.row);
      if (!Number.isFinite(dataRow) || dataRow < 1) {
        throw new Error(`Invalid row number: ${u.row} — must be 1-based data row`);
      }

      // Resolve column: accept column name (header match) or numeric index
      let colIdx;
      const colNum = Number(u.column);
      if (Number.isFinite(colNum)) {
        colIdx = colNum;
      } else {
        colIdx = headers.findIndex(h =>
          h.toLowerCase() === String(u.column).toLowerCase()
        );
        if (colIdx === -1) {
          throw new Error(`Unknown column "${u.column}". Available: ${headers.join(', ')}`);
        }
      }

      // row is 1-based data row → actual sheet row = dataRow (0-based = header) + dataRow
      const sheetRow = dataRow; // 0-based: header = 0, first data = 1
      await api.sheets.updateCell(spreadsheet_id, sheetTitle, sheetRow, colIdx, String(u.value ?? ''));
      cellsUpdated++;
    }

    return {
      spreadsheetId: spreadsheet_id,
      title: sheet.title,
      operation: 'update_cells',
      cellsUpdated,
    };
  }

  throw new Error(`Unknown operation "${operation}". Use "append_rows" or "update_cells".`);
}

/**
 * Show an inline indicator that a tool is executing.
 * @param {string} toolName
 * @param {Object} args
 */
function _showToolIndicator(toolName, args) {
  if (!_chatBody) return;
  let label;
  if (toolName === 'create_sheet') {
    label = `Creating ${args.template || ''} sheet "${args.title || 'Untitled'}"...`;
  } else if (toolName === 'read_sheet') {
    label = `Reading sheet...`;
  } else if (toolName === 'search_sheets') {
    label = `Searching for sheets...`;
  } else if (toolName === 'update_sheet') {
    label = `Updating sheet...`;
  } else {
    label = `Running ${toolName}...`;
  }
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
  if (!_chatBody) return;
  const msg = rotating
    ? 'Rate limited — switching to next key…'
    : `Rate limited — retrying in ${seconds}s...`;
  const indicator = el('div', { className: 'agent-tool-indicator', id: 'agent-retry-indicator' }, [
    el('span', { className: 'agent-tool-icon' }, ['⏳']),
    el('span', {}, [msg]),
  ]);
  _chatBody.appendChild(indicator);
  _chatBody.scrollTop = _chatBody.scrollHeight;
}

/** Remove the retry indicator. */
function _removeRetryIndicator() {
  document.getElementById('agent-retry-indicator')?.remove();
}
