/* ============================================================
   config.js — Agent configuration and request helpers
   Shared constants and pure helper functions for the Waymark AI agent.
   ============================================================ */

import { TEMPLATES } from '../templates/index.js';
import {
  getAgentKeys,
  getAgentModel,
  getAgentProvider,
  getClaudeKeys,
  getClaudeModel,
  resetDailyKeyCounters,
} from '../storage.js';
import * as vault from './vault.js';

/* ---------- Constants ---------- */

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export const CLAUDE_API_BASE = 'https://api.anthropic.com/v1';
export const CLAUDE_ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-3-5';
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:3b';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

// Fallback list used when no API key is present yet (dropdown won't auto-refresh).
// The live list is always preferred once a key is available — see fetchGeminiModels().
export const GEMINI_MODEL_OPTIONS = [
  { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (free tier default)' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (balanced)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (best)' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (fast)' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  { value: 'gemini-flash-latest', label: 'Gemini Flash Latest (unstable alias)' },
];

/**
 * Pick the best free-tier default from any live model list.
 * Prefers the newest non-preview flash-lite model; falls back to flash, then first item.
 * Used to auto-advance the default when Google ships new models.
 * @param {Array<{value: string, label: string}>} opts
 * @returns {string} model id
 */
export function pickSmartDefault(opts) {
  // Sort helpers — higher version wins (e.g. 3.5 > 2.5 > 2.0). Unversioned IDs sort last (score 0).
  const version = v => { const m = v.match(/(\d+\.\d+)/); return m ? parseFloat(m[1]) : 0; };
  const versionSort = (a, b) => version(b.value) - version(a.value);
  const isPreview = v => /preview|exp|labs/i.test(v);

  const tiers = [
    // 1. Stable flash-lite (cheapest, best for free tier)
    opts.filter(o => /flash-lite/.test(o.value) && !isPreview(o.value)),
    // 2. Preview flash-lite (still cheap)
    opts.filter(o => /flash-lite/.test(o.value)),
    // 3. Stable flash (no lite, no pro)
    opts.filter(o => /flash/.test(o.value) && !/lite|pro/.test(o.value) && !isPreview(o.value)),
    // 4. Any flash
    opts.filter(o => /flash/.test(o.value)),
    // 5. Anything at all
    [...opts],
  ];

  for (const tier of tiers) {
    if (!tier.length) continue;
    return tier.sort(versionSort)[0].value;
  }
  return DEFAULT_MODEL;
}

export const CLAUDE_MODEL_OPTIONS = [
  { value: 'claude-haiku-3-5', label: 'Claude Haiku 3.5 (fastest, cheapest)' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (balanced)' },
  { value: 'claude-opus-4-5', label: 'Claude Opus 4.5 (best)' },
];

export const OLLAMA_MODEL_OPTIONS = [
  { value: 'qwen2.5-coder:3b', label: 'Qwen 2.5 Coder 3B (fastest)' },
  { value: 'mistral:latest', label: 'Mistral (balanced)' },
  { value: 'neural-chat:latest', label: 'Neural Chat (good reasoning)' },
];

export const BASE_SYSTEM_PROMPT = `You are the Waymark AI assistant. You help users organise their data by creating Google Sheets that Waymark renders as rich, interactive views.

Use the create_sheet tool whenever a user asks to create, build, set up, or organise something. Pick the best template — the system fills in column headers automatically.

Use the read_sheet tool whenever a user asks to see, view, check, open, summarize, or analyze the contents of an existing sheet. You need the spreadsheet ID — ask the user if you don't have it.

Use the search_sheets tool to find sheets in the user's Drive by name. Use it when the user mentions a sheet you don't recognize from context, or asks "what sheets do I have?" for a more comprehensive list.

Use the update_sheet tool to modify existing sheets. Use operation "append_rows" to add new rows, or "update_cells" to change specific cells. Always read_sheet first to understand the current column structure before updating.

When a user asks to add, change, edit, append, remove, or update items in a sheet that was just created or recently referenced in the conversation, treat that as a follow-up edit request. Reuse the existing sheet via read_sheet and update_sheet. Do NOT create a duplicate sheet. Do NOT simply repeat your previous answer.

Available templates: checklist (task lists), budget (finances), kanban (project boards), tracker (progress tracking), schedule (timetables), contacts (address books), inventory (stock management), log (activity logs), habit (habit tracking), timesheet (time tracking), crm (sales pipelines), meal (meal plans), travel (trip itineraries), roster (shift schedules), testcases (QA testing), recipe (cookbooks), poll (surveys), changelog (release notes), social (social feeds), flow (flow diagrams), automation (workflow automation), grading (gradebooks).

Guidelines:
- Populate with realistic example data (3–5 rows minimum) so the user sees the format.
- All cell values must be strings — numbers ("500"), dates ("2026-03-15").
- If unsure which template fits, ask or default to checklist (lists) or kanban (projects).
- When the user refers to "my sheet" or a sheet by name, use read_sheet with the spreadsheet ID.
- ALWAYS link to sheets using Waymark URLs: [Title](#/sheet/{spreadsheetId}). NEVER link to docs.google.com — keep users in Waymark.
- When a request spans multiple domains (e.g. "plan a vacation on a budget"), create MULTIPLE sheets — one per template that fits (e.g. a travel sheet AND a budget sheet). Call create_sheet multiple times.
- Be conversational and helpful.`;

export const MAX_CONTEXT_MESSAGES = 8;
export const MAX_CONTEXT_CHARS = 3600;
export const MAX_CONTEXT_SUMMARY_CHARS = 500;
export const MAX_AGGRESSIVE_CONTEXT_MESSAGES = 4;
export const MAX_USER_MESSAGE_CHARS = 900;
export const MAX_PLANNED_USER_MESSAGE_CHARS = 1200;
export const MAX_PLANNED_BRIEF_CHARS = 240;
export const MAX_ASSISTANT_MESSAGE_CHARS = 500;
export const MAX_CONTEXT_SHEETS = 12;
export const MAX_CONTEXT_FILE_CHARS = 800;
export const MAX_OUTPUT_TOKENS = 4096;
export const MAX_ESTIMATED_REQUEST_TOKENS = 3400;
export const MAX_RAW_CONVERSATION_TOKENS = 30000;

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
 * Build a Gemini API URL for the given model/action pair.
 * @param {string} model
 * @param {string} action
 * @param {string} [query]
 * @returns {string}
 */
export function geminiUrl(model, action, query = '') {
  const suffix = query ? `?${query}` : '';
  return `${GEMINI_API_BASE}/${encodeURIComponent(model)}:${action}${suffix}`;
}

/**
 * Build headers for Gemini API requests using the documented auth pattern.
 * @param {string} apiKey
 * @returns {Object}
 */
export function geminiHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'X-goog-api-key': apiKey,
  };
}

/**
 * Build a Claude API URL.
 * @returns {string}
 */
export function claudeUrl() {
  return `${CLAUDE_API_BASE}/messages`;
}

/**
 * Build an Ollama chat API URL from the base URL.
 * @param {string} baseUrl
 * @returns {string}
 */
export function ollamaChatUrl(baseUrl = DEFAULT_OLLAMA_BASE_URL) {
  return `${baseUrl}/api/chat`;
}

/**
 * Build headers for Anthropic Claude API requests.
 * @param {string} apiKey
 * @returns {Object}
 */
export function claudeHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': CLAUDE_ANTHROPIC_VERSION,
  };
}

/**
 * Collapse whitespace and cap text length so old chat history does not consume
 * the entire model budget.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function compactContextText(text, maxChars) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  const tail = Math.max(80, Math.floor(maxChars * 0.25));
  const head = Math.max(0, maxChars - tail - 3);
  return compact.slice(0, head).trimEnd() + '...' + compact.slice(-tail).trimStart();
}

/**
 * Infer likely template domains from a raw user request.
 * @param {string} text
 * @returns {string[]}
 */
export function inferTemplateHints(text) {
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
export function buildPlannerBrief(userText) {
  const text = String(userText ?? '').trim();
  if (!text) return '';

  const lower = text.toLowerCase();
  const hints = inferTemplateHints(text);
  const parts = [`Primary request: ${compactContextText(text, 240)}`];

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
export function shouldUsePlannerRound(userText) {
  const text = String(userText ?? '').trim();
  if (!text) return false;
  const hints = inferTemplateHints(text);
  return hints.length > 1
    || text.length > 220
    || (/\bfrom\b.+\bto\b/i.test(text) && /\$\s*\d|\bbudget\b/i.test(text));
}

/**
 * Rough token estimate using 4 chars/token. Good enough for early refusal.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * Estimate the token cost of a full request body.
 * @param {Object} body
 * @returns {number}
 */
export function estimateRequestTokens(body) {
  return estimateTokens(JSON.stringify(body));
}

/**
 * Estimate the raw conversation size before trimming.
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} userMessage
 * @param {string} systemPrompt
 * @returns {number}
 */
export function estimateRawConversationTokens(messages, userMessage, systemPrompt) {
  const rawHistory = messages
    .slice(0, -1)
    .map(msg => String(msg.content ?? ''))
    .join(' ');
  return estimateTokens(`${systemPrompt} ${rawHistory} ${String(userMessage ?? '')}`);
}

/**
 * Summarise older assistant replies into one cheap context message.
 * @param {Array<{role:string, content:string}>} history
 * @param {number} recentMessageLimit
 * @returns {string}
 */
export function buildConversationSummary(history, recentMessageLimit) {
  const olderHistory = history.slice(0, Math.max(0, history.length - recentMessageLimit));
  const olderAssistantText = olderHistory
    .filter(msg => msg.role === 'assistant')
    .map(msg => compactContextText(msg.content, MAX_ASSISTANT_MESSAGE_CHARS))
    .filter(Boolean)
    .join(' ');

  if (!olderAssistantText) return '';
  return `Earlier in this conversation: ${compactContextText(olderAssistantText, MAX_CONTEXT_SUMMARY_CHARS)}`;
}

/**
 * Build a Gemini request body from prepared contents.
 * @param {Array} contents
 * @param {string} systemPrompt
 * @returns {Object}
 */
export function buildRequestBody(contents, systemPrompt) {
  return {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };
}

/**
 * Extract recent sheet links mentioned in the conversation.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Array<{title: string, id: string}>}
 */
export function getRecentConversationSheets(messages) {
  const sheetPattern = /\[([^\]]+)\]\(#\/sheet\/([^)]+)\)/g;
  const seen = new Set();
  const recent = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const text = String(messages[i]?.content || '');
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
 * Build a compact hint for follow-up prompts that likely refer to a recent sheet.
 * @param {string} userText
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string}
 */
export function buildRecentSheetHint(userText, messages) {
  const text = String(userText ?? '').trim();
  if (!text) return '';

  const looksLikeFollowUp = /\b(that|this|it|those|them)\b/i.test(text)
    || /\b(add|update|change|edit|append|modify|remove)\b/i.test(text);
  if (!looksLikeFollowUp) return '';

  const recentSheets = getRecentConversationSheets(messages);
  if (!recentSheets.length) return '';

  const target = recentSheets[0];
  return `Recent target hint: the most likely sheet is "${target.title}" (id: ${target.id}). This is a follow-up edit request, so use read_sheet and update_sheet for that existing sheet instead of creating a duplicate. Do not repeat the previous answer.`;
}

/**
 * Known template headers — derived from each template's defaultHeaders property.
 * @type {Record<string, string[]>}
 */
export const KNOWN_HEADERS = Object.fromEntries(
  Object.entries(TEMPLATES)
    .filter(([k, t]) => {
      // Alert the developer console if a template module failed to load without crashing the app
      if (!t) {
        console.warn(`[Waymark Debug] Template rfi ${JSON.stringify(k,null,2)} or "${k}  failed to load or is undefined. It may have been blocked by an ad-blocker or network error.`);
        return false;
      }
      return Array.isArray(t.defaultHeaders);
    })
    .map(([k, t]) => [k, t.defaultHeaders])
);

const TEMPLATE_COLUMNS = Object.entries(KNOWN_HEADERS)
  .map(([k, cols]) => `${k}: ${cols.join(', ')}`)
  .join(' | ');

/* ============================================================
   Prompt-based tool protocol (provider-agnostic)
   ------------------------------------------------------------
   We do NOT use provider-native function calling. Instead the
   model is instructed to emit a fenced ```tool_call JSON block.
   We parse that from the model's TEXT output, run the tool, feed
   the result back as a plain text turn, and loop. This works the
   same for Gemini, Claude, and Ollama and needs no special API
   permissions.
   ============================================================ */

/** The fenced-block language tag the model must use to call a tool. */
export const TOOL_CALL_FENCE = 'tool_call';

/** Human/model-readable description of the available tools + calling format. */
export const TOOL_PROTOCOL_PROMPT = `# Tools

You can act on the user's Google Sheets by calling tools. You do this by writing a fenced code block tagged \`${TOOL_CALL_FENCE}\` containing a single JSON object, and NOTHING else in that reply:

\`\`\`${TOOL_CALL_FENCE}
{"tool": "create_sheet", "args": { ... }}
\`\`\`

Rules for calling tools:
- Emit the ${TOOL_CALL_FENCE} block ALONE — no prose before or after it in the same reply.
- Call exactly ONE tool per reply. The system runs it and replies with the result, then you may call another tool or answer the user.
- "args" must be valid JSON matching the tool below.
- When you have everything you need, reply to the user in normal conversational language with NO ${TOOL_CALL_FENCE} block. That plain reply is what the user sees.
- Never invent tool results. Wait for the system to return them.

Available tools:

1. create_sheet — Create a new Google Sheet. Headers are auto-filled from the template; you only provide data rows in the template's column order.
   args: {"template": string, "title": string, "data": string[][]}
   - template: one of checklist, budget, kanban, tracker, schedule, contacts, inventory, log, habit, timesheet, crm, meal, travel, roster, testcases, recipe, poll, changelog, social, flow, automation, grading
   - title: the spreadsheet title
   - data: rows (NO header row) — each row an array of strings in the template's column order
   Column order per template — ${TEMPLATE_COLUMNS}

2. read_sheet — Read an existing sheet by ID. Returns title, headers, and rows.
   args: {"spreadsheet_id": string}

3. search_sheets — Find the user's sheets by name (case-insensitive substring).
   args: {"query": string}

4. update_sheet — Modify an existing sheet. Read it first to learn the columns.
   args: {"spreadsheet_id": string, "operation": "append_rows" | "update_cells", "rows"?: string[][], "updates"?: [{"row": number, "column": string, "value": string}]}
   - operation "append_rows": provide "rows" (arrays of strings in column order) to add at the end.
   - operation "update_cells": provide "updates"; each has row (1-based data row), column (header name or 0-based index), and value.`;

/** Full agent system prompt = base instructions + tool protocol. */
export const AGENT_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}\n\n${TOOL_PROTOCOL_PROMPT}`;

/* ---------- Tool-call parsing (our protocol, not the provider's) ---------- */

/**
 * Extract the first tool call from a model's text reply.
 * Accepts a fenced ```tool_call block, a fenced ```json block whose object has a
 * "tool" key, or a bare JSON object with a "tool" key that is the whole reply.
 * @param {string} text
 * @returns {{ name: string, args: Object } | null}
 */
export function parseToolCall(text) {
  if (!text || typeof text !== 'string') return null;

  const candidates = [];
  const fenceRe = /```(?:tool_call|json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m[1]) candidates.push(m[1].trim());
  }
  // Also consider the whole trimmed reply as a bare JSON object.
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed);

  for (const raw of candidates) {
    const obj = _tryParseToolObject(raw);
    if (obj) return obj;
  }
  return null;
}

/**
 * Try to parse a JSON string into a normalised tool-call object.
 * @param {string} raw
 * @returns {{ name: string, args: Object } | null}
 */
function _tryParseToolObject(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const name = parsed.tool || parsed.name || parsed.tool_name;
  if (!name || typeof name !== 'string') return null;
  const args = parsed.args || parsed.arguments || parsed.parameters || parsed.input || {};
  return { name, args: (args && typeof args === 'object') ? args : {} };
}

/**
 * Remove tool_call blocks from text so they are never shown to the user.
 * Also strips an unterminated trailing fence that can appear mid-stream.
 * @param {string} text
 * @returns {string}
 */
export function stripToolCalls(text) {
  if (!text || typeof text !== 'string') return '';

  // Remove complete fenced blocks that are actually tool calls. A ```tool_call
  // fence is always removed; a plain ```json fence is removed only when its body
  // parses to a tool object, so genuine JSON shown to the user is preserved.
  let out = text.replace(/```(tool_call|json)?\s*([\s\S]*?)```/gi, (full, lang, inner) => {
    if (lang && lang.toLowerCase() === 'tool_call') return '';
    return _tryParseToolObject((inner || '').trim()) ? '' : full;
  });

  // Drop an unterminated tool_call fence still being streamed.
  out = out.replace(/```tool_call[\s\S]*$/i, '');

  // A bare, unfenced JSON tool object that is the whole reply.
  const trimmed = out.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}') && _tryParseToolObject(trimmed)) {
    return '';
  }

  return out;
}

/**
 * Build the plain-text turn that feeds a tool result back to the model.
 * @param {string} name
 * @param {Object} result
 * @returns {string}
 */
export function buildToolResultText(name, result) {
  let json;
  try {
    json = JSON.stringify(result);
  } catch {
    json = '{"error":"result could not be serialised"}';
  }
  return `Tool result for ${name}:\n${json}\n\n`
    + `If the task is complete, reply to the user in plain language with NO tool_call block. `
    + `Otherwise call the next tool.`;
}

/**
 * Convert Gemini-format contents array to Claude messages array.
 * Handles simple user/model turns; skips function role entries.
 * @param {Array<{role:string, parts:Array}>} geminiContents
 * @returns {Array<{role:string, content:string}>}
 */
export function convertGeminiContentsToClaudeMessages(geminiContents) {
  return geminiContents
    .filter(c => c.role === 'user' || c.role === 'model')
    .map(c => ({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: (c.parts || []).map(p => p.text || '').join(''),
    }))
    .filter(m => m.content.length > 0);
}

/**
 * Build a Claude API request body from Gemini-format contents.
 * @param {Array} geminiContents
 * @param {string} systemPrompt
 * @param {string} model
 * @returns {Object}
 */
export function buildClaudeRequestBody(geminiContents, systemPrompt, model) {
  const messages = convertGeminiContentsToClaudeMessages(geminiContents);
  return {
    model,
    system: systemPrompt,
    messages,
    max_tokens: MAX_OUTPUT_TOKENS,
  };
}

/**
 * Build an Ollama API request body from Gemini-format contents.
 * @param {Array} geminiContents
 * @param {string} systemPrompt
 * @param {string} model
 * @returns {Object}
 */
export function buildOllamaRequestBody(geminiContents, systemPrompt, model) {
  const messages = convertGeminiContentsToClaudeMessages(geminiContents);
  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    stream: false,
  };
}

/* ---------- Key Rotation (shared by agent.js and templates via shared.js) ---------- */

/** Module-level date cache to detect day rollovers without importing Date every call. */
let _lastKeyResetDate = null;

/**
 * Return available API keys sorted by preference using the LRU strategy.
 * The server-injected key (window.__WAYMARK_API_KEY) is appended as a
 * last-resort fallback with idx -1.
 *
 * Sort order:
 *   1. Keys without recent errors (no error in last 60 s) come first.
 *   2. For pro/expensive models, billed keys are preferred within group 1.
 *   3. Within each group, LRU: key with fewest requests today comes first.
 *   4. If ALL keys have recent errors, the one with the oldest error is returned
 *      so callers always have something to try rather than getting an empty array.
 *   5. Server key appended at end (no idx tracking needed).
 *
 * Daily counters are reset automatically when the calendar date changes.
 *
 * @param {{ model?: string }} [opts]
 * @returns {Array<{ key: string, idx: number }>}
 */
export function pickBestKey(opts = {}) {
  const keys = getAgentKeys();

  // Reset daily counters if the calendar date has changed
  const today = new Date().toISOString().slice(0, 10);
  if (_lastKeyResetDate !== today) {
    if (keys.length > 0) resetDailyKeyCounters();
    _lastKeyResetDate = today;
  }

  const entries = [];

  // Vault keys first (Drive-synced passwords sheet). When the vault is set up
  // and unlocked, its keys are the user's cross-device source of truth — used
  // by Ask AI and every template AI helper (calorie photo/voice, etc.).
  // idx = -1 → no localStorage usage tracking (vault tracks its own).
  if (vault.isVaultSetUp() && vault.isVaultUnlocked()) {
    const provider = getAgentProvider();
    // These Gemini helpers hit the Gemini endpoint, so prefer Gemini vault keys;
    // fall back to whichever the active provider exposes.
    const vaultKeys = provider === 'claude'
      ? (vault.getClaudeKeys?.() || [])
      : (vault.getGeminiKeys?.() || []);
    const now = Date.now();
    const usable = vaultKeys
      .map(k => ({ ...k, hasRecentError: !!(k.lastError && (now - new Date(k.lastError).getTime()) < 60000) }))
      .filter(k => !k.hasRecentError);
    const pool = (usable.length > 0 ? usable : vaultKeys)
      .slice()
      .sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
    for (const k of pool) if (k.key) entries.push({ key: k.key, idx: -1 });
  }

  if (keys.length > 0) {
    const model = opts.model || getAgentModel() || DEFAULT_MODEL;
    const isExpensiveModel = /pro/i.test(model);
    const now = Date.now();

    const annotated = keys.map((k, i) => ({
      ...k,
      idx: i,
      hasRecentError: !!(k.lastError && (now - new Date(k.lastError).getTime()) < 60000),
    }));

    const available = annotated.filter(k => !k.hasRecentError);

    if (available.length === 0) {
      // All keys errored — return the one with the oldest error so the caller can still try
      const fallback = [...annotated].sort(
        (a, b) => new Date(a.lastError || 0).getTime() - new Date(b.lastError || 0).getTime()
      );
      entries.push({ key: fallback[0].key, idx: fallback[0].idx });
    } else {
      // Billed keys first for expensive models
      if (isExpensiveModel) {
        const billed = available.filter(k => k.isBilled)
          .sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
        const free = available.filter(k => !k.isBilled)
          .sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
        for (const k of [...billed, ...free]) entries.push({ key: k.key, idx: k.idx });
      } else {
        const sorted = [...available].sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
        for (const k of sorted) entries.push({ key: k.key, idx: k.idx });
      }
    }
  }

  // Server-injected key as last-resort fallback (no usage tracking)
  const serverKey = window.__WAYMARK_API_KEY;
  if (serverKey) entries.push({ key: serverKey, idx: -1 });

  return entries;
}

/**
 * Return the best available Claude key using the same LRU strategy as pickBestKey.
 * @returns {{ key: string, idx: number } | null}
 */
export function pickBestClaudeKey() {
  const keys = getClaudeKeys();
  if (!keys.length) return null;

  const now = Date.now();
  const annotated = keys.map((k, i) => ({
    ...k,
    idx: i,
    hasRecentError: !!(k.lastError && (now - new Date(k.lastError).getTime()) < 60000),
  }));

  const available = annotated.filter(k => !k.hasRecentError);
  const pool = available.length > 0 ? available : annotated;
  pool.sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
  return { key: pool[0].key, idx: pool[0].idx };
}

/**
 * Return the best key for the current provider and vault state.
 * When vault is active and unlocked, returns from vault keys.
 * Falls back to localStorage keys when no vault.
 * @returns {{ key: string, idx: number } | null}
 */
export function pickBestActiveKey() {
  const provider = getAgentProvider();
  if (vault.isVaultSetUp() && vault.isVaultUnlocked()) {
    const keys = provider === 'claude' ? vault.getClaudeKeys() : vault.getGeminiKeys();
    if (!keys.length) return null;
    const now = Date.now();
    const annotated = keys.map((k, i) => ({
      ...k, idx: i,
      hasRecentError: !!(k.lastError && (now - new Date(k.lastError).getTime()) < 60000),
    }));
    const pool = annotated.filter(k => !k.hasRecentError);
    const sorted = (pool.length > 0 ? pool : annotated)
      .sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
    // idx: -1 marks a vault-sourced key so localStorage usage/error recorders
    // and 429-retry lookups skip it (they operate on the localStorage ring).
    return { key: sorted[0].key, idx: -1 };
  }
  if (provider === 'claude') return pickBestClaudeKey();
  const keys = pickBestKey();
  return keys.length > 0 ? keys[0] : null;
}

/* ---------- Dynamic Model Fetching ---------- */

/** In-memory model list cache — survives for the session only */
const _modelCache = new Map();
const MODEL_CACHE_MS = 3_600_000; // 1 hour

/**
 * Fetch the list of available Gemini models for a given API key.
 * Caches results per key for the session. Falls back to GEMINI_MODEL_OPTIONS on error.
 * @param {string} apiKey
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
export async function fetchGeminiModels(apiKey) {
  if (!apiKey) return GEMINI_MODEL_OPTIONS;
  const cacheKey = `gemini:${apiKey.slice(-6)}`;
  const hit = _modelCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < MODEL_CACHE_MS) return hit.models;

  try {
    const res = await fetch(`${GEMINI_API_BASE}?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return GEMINI_MODEL_OPTIONS;
    const { models = [] } = await res.json();
    const opts = models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({ value: m.name.replace('models/', ''), label: m.displayName || _humanizeModelId(m.name) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!opts.length) return GEMINI_MODEL_OPTIONS;
    _modelCache.set(cacheKey, { models: opts, ts: Date.now() });
    return opts;
  } catch {
    return GEMINI_MODEL_OPTIONS;
  }
}

/**
 * Fetch the list of available Claude models for a given API key.
 * Caches results per key for the session. Falls back to CLAUDE_MODEL_OPTIONS on error.
 * @param {string} apiKey
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
export async function fetchClaudeModels(apiKey) {
  if (!apiKey) return CLAUDE_MODEL_OPTIONS;
  const cacheKey = `claude:${apiKey.slice(-6)}`;
  const hit = _modelCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < MODEL_CACHE_MS) return hit.models;

  try {
    const res = await fetch(`${CLAUDE_API_BASE}/models`, {
      headers: claudeHeaders(apiKey),
    });
    if (!res.ok) return CLAUDE_MODEL_OPTIONS;
    const { data = [] } = await res.json();
    const opts = data
      .filter(m => m.type === 'model')
      .map(m => ({ value: m.id, label: m.display_name || _humanizeModelId(m.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!opts.length) return CLAUDE_MODEL_OPTIONS;
    _modelCache.set(cacheKey, { models: opts, ts: Date.now() });
    return opts;
  } catch {
    return CLAUDE_MODEL_OPTIONS;
  }
}

/**
 * Convert a model ID to a human-readable label as a fallback.
 * @param {string} id e.g. "models/gemini-2.5-pro" or "claude-haiku-3-5"
 * @returns {string}
 */
function _humanizeModelId(id) {
  return id.replace('models/', '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Re-export vault so agent.js can import a single path */
export { vault };

/* ---------- System Prompt Builder (shared by agent.js and templates) ---------- */

/**
 * Compose a final system prompt from a base prompt and optional context addition.
 * This is the standard way to build system prompts across all AI callers so
 * context shaping stays consistent.
 *
 * @param {string} [basePrompt]    — base instructions (defaults to BASE_SYSTEM_PROMPT)
 * @param {string} [contextBlock]  — additional context to append (e.g. today's date, user name)
 * @returns {string}
 */
export function buildAgentSystemPrompt(basePrompt = BASE_SYSTEM_PROMPT, contextBlock = '') {
  return contextBlock ? `${basePrompt}\n\n${contextBlock}` : basePrompt;
}