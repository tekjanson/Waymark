/* ============================================================
   config.js — Agent configuration and request helpers
   Shared constants and pure helper functions for the Waymark AI agent.
   ============================================================ */

import { TEMPLATES } from '../templates/index.js';
import {
  getAgentKeys,
  getAgentModel,
  resetDailyKeyCounters,
} from '../storage.js';

/* ---------- Constants ---------- */

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_MODEL = 'gemini-flash-latest';

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
    tools: TOOL_DECLARATIONS,
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
    .filter(([, t]) => Array.isArray(t.defaultHeaders))
    .map(([k, t]) => [k, t.defaultHeaders])
);

const TEMPLATE_COLUMNS = Object.entries(KNOWN_HEADERS)
  .map(([k, cols]) => `${k}: ${cols.join(', ')}`)
  .join(' | ');

/** Tool definitions for Gemini function calling */
export const TOOL_DECLARATIONS = [{
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