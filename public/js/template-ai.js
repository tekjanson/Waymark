/* ============================================================
   template-ai.js — AI overlay for template views
   Floating side-panel that lets users ask the AI to update
   the currently open Waymark sheet.
   ============================================================ */

import { el, showToast } from './ui.js';
import * as storage from './storage.js';
import { api } from './api-client.js';
import {
  DEFAULT_MODEL,
  MAX_OUTPUT_TOKENS,
  compactContextText,
  geminiHeaders,
  geminiUrl,
} from './agent/config.js';
import { renderMarkdown } from './agent/markdown.js';
import { captureStillFromCamera } from './camera-capture.js';

/* ---------- Constants ---------- */

const MAX_PREVIEW_ROWS = 5;
const MAX_PREVIEW_CHARS = 600;
const MAX_USER_MSG_CHARS = 600;
const MAX_PENDING_IMAGES = 2;
const MAX_IMAGE_EDGE = 1400;
const MAX_IMAGE_BYTES = 900 * 1024;

/** Tool declarations: only read_sheet and update_sheet (focused mode). */
const OVERLAY_TOOL_DECLARATIONS = [{
  functionDeclarations: [{
    name: 'read_sheet',
    description: 'Read the full contents of the current sheet to examine data before making changes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spreadsheet_id: {
          type: 'STRING',
          description: 'The spreadsheet ID of the current sheet.',
        },
      },
      required: ['spreadsheet_id'],
    },
  }, {
    name: 'update_sheet',
    description: 'Modify the current sheet. Use operation "append_rows" to add new rows at the bottom, or "update_cells" to change specific existing cells.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spreadsheet_id: {
          type: 'STRING',
          description: 'The spreadsheet ID of the current sheet.',
        },
        operation: {
          type: 'STRING',
          description: '"append_rows" to add rows, or "update_cells" to modify existing cells.',
        },
        rows: {
          type: 'ARRAY',
          description: 'Rows to append (for append_rows). Each row is an array of strings.',
          items: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        updates: {
          type: 'ARRAY',
          description: 'Cell updates (for update_cells). Each item has row (1-based data row), col (0-based), and value.',
          items: {
            type: 'OBJECT',
            properties: {
              row: { type: 'INTEGER', description: '1-based row index (not counting header)' },
              col: { type: 'INTEGER', description: '0-based column index' },
              value: { type: 'STRING', description: 'New cell value' },
            },
          },
        },
      },
      required: ['spreadsheet_id', 'operation'],
    },
  }],
}];

/* ---------- Module state ---------- */

let _panel = null;
let _backdrop = null;
let _chatBody = null;
let _context = null;   // { id, title, sheetTitle, values, templateKey, onRefresh }
let _isStreaming = false;
let _abortController = null;
let _pendingInlineImages = [];

/* ---------- Public API ---------- */

/**
 * Open the AI overlay panel for the given sheet.
 * @param {{ id: string, title: string, sheetTitle: string, values: string[][], templateKey: string, onRefresh: Function }} ctx
 */
export function show(ctx) {
  _context = ctx;
  // Close existing panel if open
  if (_panel) _close();
  try {
    _render();
  } catch (err) {
    showToast('Could not open AI panel', 'error');
    _panel = null;
    _backdrop = null;
  }
}

/**
 * Close the overlay programmatically.
 */
export function hide() {
  _close();
}

/* ---------- Rendering ---------- */

function _render() {
  const hasKeys = storage.getAgentKeys().length > 0;

  const header = el('div', { className: 'template-ai-header' }, [
    el('div', { className: 'template-ai-header-left' }, [
      el('span', { className: 'template-ai-sparkle' }, ['✨']),
      el('span', { className: 'template-ai-header-title' }, ['Ask AI']),
      el('span', { className: 'template-ai-sheet-name' }, [_context.title]),
    ]),
    el('button', {
      className: 'template-ai-close',
      'aria-label': 'Close AI panel',
      on: { click: _close },
    }, ['✕']),
  ]);

  _chatBody = el('div', { className: 'template-ai-body' });

  if (!hasKeys) {
    _chatBody.appendChild(_buildNoKeysState());
  } else {
    _chatBody.appendChild(_buildEmptyState());
  }

  const inputRow = _buildInputRow(hasKeys);

  _panel = el('div', {
    className: 'template-ai-panel',
    role: 'dialog',
    'aria-label': 'Ask AI to update this sheet',
  }, [header, _chatBody, inputRow]);

  _backdrop = el('div', {
    className: 'template-ai-backdrop',
    on: { click: _close },
  });

  document.body.appendChild(_backdrop);
  document.body.appendChild(_panel);

  // Focus the text input
  const input = _panel.querySelector('.template-ai-input');
  if (input && hasKeys) input.focus();

  // Escape key closes panel
  document.addEventListener('keydown', _handleKeyDown);

  // Animate in
  requestAnimationFrame(() => {
    _panel.classList.add('template-ai-panel-open');
    _backdrop.classList.add('template-ai-backdrop-open');
  });
}

function _buildNoKeysState() {
  return el('div', { className: 'template-ai-no-keys' }, [
    el('div', { className: 'template-ai-no-keys-icon' }, ['🤖']),
    el('p', { className: 'template-ai-no-keys-text' }, ['AI is not configured yet.']),
    el('p', { className: 'template-ai-no-keys-hint' }, [
      'Add a Gemini API key via the ',
      el('a', {
        href: '#/agent',
        on: { click: _close },
      }, ['AI agent settings']),
      '.',
    ]),
  ]);
}

function _buildEmptyState() {
  const suggestions = [
    'Add 3 new items',
    'Summarize the current data',
    'Mark the first item as complete',
  ];

  return el('div', { className: 'template-ai-empty' }, [
    el('p', { className: 'template-ai-empty-prompt' }, [
      'What would you like to change about this sheet?'
    ]),
    el('div', { className: 'template-ai-suggestions' },
      suggestions.map(s => el('button', {
        className: 'template-ai-suggestion',
        on: {
          click: () => {
            const input = _panel.querySelector('.template-ai-input');
            if (input) {
              input.value = s;
              input.focus();
            }
          },
        },
      }, [s]))
    ),
  ]);
}

function _buildInputRow(hasKeys) {
  const input = el('textarea', {
    className: 'template-ai-input',
    placeholder: hasKeys ? 'Ask the AI to update this sheet…' : 'Configure API keys first',
    rows: 2,
    on: {
      keydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const val = input.value.trim();
          if (val) _sendMessage(val);
        }
      },
      input: () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      },
    },
  });
  input.disabled = !hasKeys;

  const sendBtn = el('button', {
    className: 'template-ai-send-btn',
    title: 'Send',
    on: {
      click: () => {
        if (_isStreaming && _abortController) {
          _abortController.abort();
          return;
        }
        const val = input.value.trim();
        if (val) _sendMessage(val);
      },
    },
  }, ['➤']);
  sendBtn.disabled = !hasKeys;

  const captureBtn = el('button', {
    className: 'template-ai-capture-btn',
    title: 'Take photo for this message',
    on: {
      click: () => { _captureAndQueueImage(); },
    },
  }, ['📷']);
  captureBtn.disabled = !hasKeys;

  const attachBtn = el('button', {
    className: 'template-ai-attach-btn',
    title: 'Attach photo(s) for this message',
    on: {
      click: () => { _pickAndQueueImages(); },
    },
  }, ['🖼']);
  attachBtn.disabled = !hasKeys;

  return el('div', { className: 'template-ai-input-row' }, [input, captureBtn, attachBtn, sendBtn]);
}

/* ---------- Close ---------- */

function _close() {
  if (!_panel) return;
  _isStreaming = false;
  _pendingInlineImages = [];
  if (_abortController) _abortController.abort();
  document.removeEventListener('keydown', _handleKeyDown);

  _panel.classList.remove('template-ai-panel-open');
  _backdrop.classList.remove('template-ai-backdrop-open');

  setTimeout(() => {
    _panel?.remove();
    _backdrop?.remove();
    _panel = null;
    _backdrop = null;
    _chatBody = null;
  }, 220);
}

function _handleKeyDown(e) {
  if (e.key === 'Escape') _close();
}

/* ---------- Messaging ---------- */

function _buildSystemPrompt() {
  const { id, title, templateKey, values } = _context;
  const headers = values?.[0] || [];
  const dataRows = (values || []).slice(1);
  const rowCount = dataRows.length;

  const previewLines = dataRows.slice(0, MAX_PREVIEW_ROWS)
    .map(row => row.map(c => String(c ?? '').slice(0, 60)).join(' | '))
    .join('\n');
  const preview = compactContextText(previewLines, MAX_PREVIEW_CHARS);

  const parts = [
    'You are the Waymark AI assistant helping to update a specific Google Sheet that is currently open.',
    `Current sheet: "${title}" (spreadsheet ID: ${id})`,
    `Template type: ${templateKey || 'checklist'}`,
    `Columns: ${headers.join(', ')}`,
    rowCount > 0
      ? `Current data (${rowCount} row${rowCount !== 1 ? 's' : ''}):\n${preview}`
      : 'No data rows yet.',
    '',
    'Your job: help the user update this sheet\'s data.',
    'Use read_sheet to review data before making changes.',
    'Use update_sheet (append_rows or update_cells) to modify the sheet.',
    'Do NOT create new spreadsheets. Do NOT reference other sheets.',
    `After making changes, briefly confirm. Reference this sheet as: [${title}](#/sheet/${id})`,
  ];

  return parts.join('\n');
}

async function _sendMessage(text) {
  if (!text.trim() || _isStreaming) return;

  const keyEntry = _getNextKey();
  if (!keyEntry) {
    showToast('Configure API keys in the AI agent settings first', 'error');
    return;
  }

  // Clear empty/suggestion state on first message
  const empty = _chatBody.querySelector('.template-ai-empty');
  if (empty) empty.remove();

  const userText = compactContextText(text.trim(), MAX_USER_MSG_CHARS);
  const pendingImages = [..._pendingInlineImages];
  const userParts = pendingImages.length
    ? _buildInlineImageParts(userText, pendingImages)
    : [{ text: userText }];
  const userDisplayText = pendingImages.length
    ? `${userText}\n\n[Attached ${pendingImages.length} photo${pendingImages.length > 1 ? 's' : ''}]`
    : userText;

  // Append user bubble
  _chatBody.appendChild(_buildMessageEl('user', userDisplayText));
  _chatBody.scrollTop = _chatBody.scrollHeight;
  _pendingInlineImages = [];

  // Clear input
  const input = _panel.querySelector('.template-ai-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  // Create streaming assistant bubble
  const liveWrapper = el('div', { className: 'template-ai-message template-ai-message-assistant' });
  const liveContent = el('div', { className: 'template-ai-message-content' });
  const typingDots = el('div', { className: 'template-ai-typing' }, [
    el('span', {}, ['·']), el('span', {}, ['·']), el('span', {}, ['·']),
  ]);
  liveContent.appendChild(typingDots);
  liveWrapper.appendChild(liveContent);
  _chatBody.appendChild(liveWrapper);
  _chatBody.scrollTop = _chatBody.scrollHeight;

  // Switch send btn to stop
  const sendBtn = _panel.querySelector('.template-ai-send-btn');
  if (sendBtn) { sendBtn.textContent = '⏹'; sendBtn.title = 'Stop'; }

  _abortController = new AbortController();
  const signal = _abortController.signal;
  _isStreaming = true;
  let accumulated = '';
  let dotsRemoved = false;
  let renderPending = false;

  const scheduleRender = () => {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      liveContent.innerHTML = '';
      renderMarkdown(liveContent, accumulated);
      _chatBody.scrollTop = _chatBody.scrollHeight;
    });
  };

  const model = storage.getAgentModel() || DEFAULT_MODEL;
  const systemPrompt = _buildSystemPrompt();
  const contents = [{
    role: 'user',
    parts: userParts,
  }];
  const body = {
    contents,
    tools: OVERLAY_TOOL_DECLARATIONS,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };

  try {
    const streamUrl = geminiUrl(model, 'streamGenerateContent', 'alt=sse');
    let res;

    try {
      res = await fetch(streamUrl, {
        method: 'POST',
        headers: geminiHeaders(keyEntry.key),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      // Fall back to buffered endpoint (proxy may reject SSE)
      const response = await _callBuffered(keyEntry.key, body);
      liveContent.innerHTML = '';
      renderMarkdown(liveContent, response);
      storage.recordKeyUsage(keyEntry.idx);
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }

    storage.recordKeyUsage(keyEntry.idx);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        let parsed;
        try { parsed = JSON.parse(jsonStr); } catch { continue; }

        const candidate = parsed.candidates?.[0];
        if (!candidate?.content?.parts) continue;

        // Function call detected — switch to buffered
        const fc = candidate.content.parts.find(p => p.functionCall);
        if (fc) {
          reader.cancel();
          const response = await _callBuffered(keyEntry.key, body);
          liveContent.innerHTML = '';
          renderMarkdown(liveContent, response);
          return;
        }

        for (const part of candidate.content.parts) {
          if (part.text) {
            if (!dotsRemoved) { typingDots.remove(); dotsRemoved = true; }
            accumulated += part.text;
            scheduleRender();
          }
        }
      }
    }

    // Final render
    liveContent.innerHTML = '';
    renderMarkdown(liveContent, accumulated);

  } catch (err) {
    if (err.name === 'AbortError' && accumulated) {
      liveContent.innerHTML = '';
      renderMarkdown(liveContent, accumulated);
    } else if (err.name !== 'AbortError') {
      liveWrapper.remove();
      _chatBody.appendChild(_buildMessageEl('assistant', `⚠️ Error: ${err.message}`));
      showToast('AI error: ' + err.message, 'error');
    } else {
      liveWrapper.remove();
    }
  } finally {
    _isStreaming = false;
    _abortController = null;
    if (sendBtn) { sendBtn.textContent = '➤'; sendBtn.title = 'Send'; }
  }
}

/**
 * Call Gemini with function-call handling (non-streaming, for tool execution).
 * @param {string} apiKey
 * @param {Object} body
 * @returns {Promise<string>}
 */
async function _callBuffered(apiKey, body) {
  const model = storage.getAgentModel() || DEFAULT_MODEL;
  const url = geminiUrl(model, 'generateContent');
  let iterContents = [...body.contents];

  for (let round = 0; round < 5; round++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({ ...body, contents: iterContents }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      throw new Error('No response from AI. Try again.');
    }

    // Check for function call
    const fc = candidate.content.parts.find(p => p.functionCall);
    if (fc) {
      // Show tool indicator in chat
      const toolMsg = _appendToolIndicator(fc.functionCall.name);

      // Execute the tool
      let toolResult;
      try {
        toolResult = await _executeTool(fc.functionCall.name, fc.functionCall.args || {});
      } catch (err) {
        toolResult = { error: err.message };
      }

      // Remove indicator
      toolMsg?.remove();

      // Add model turn + tool result to contents
      iterContents = [
        ...iterContents,
        { role: 'model', parts: candidate.content.parts },
        {
          role: 'user',
          parts: [{
            functionResponse: {
              name: fc.functionCall.name,
              response: toolResult,
            },
          }],
        },
      ];
      continue;
    }

    return candidate.content.parts.map(p => p.text || '').join('').trim();
  }

  throw new Error('Too many tool calls — try a simpler request.');
}

/**
 * Execute an overlay tool.
 * @param {string} name
 * @param {Object} args
 * @returns {Promise<Object>}
 */
async function _executeTool(name, args) {
  if (name === 'read_sheet') {
    const sheet = await api.sheets.getSpreadsheet(args.spreadsheet_id || _context.id);
    const headers = sheet.values?.[0] || [];
    const dataRows = (sheet.values || []).slice(1).slice(0, 100);
    return { headers, rows: dataRows, totalRows: (sheet.values || []).slice(1).length };
  }

  if (name === 'update_sheet') {
    const sheetId = args.spreadsheet_id || _context.id;
    const sheetTitle = _context.sheetTitle || 'Sheet1';

    if (args.operation === 'append_rows') {
      if (!Array.isArray(args.rows) || args.rows.length === 0) {
        throw new Error('append_rows requires a non-empty rows array');
      }
      const sheet = await api.sheets.getSpreadsheet(sheetId);
      const headers = sheet.values?.[0] || [];
      const headerCount = headers.length;
      const cleanRows = args.rows.map(row => {
        const r = (Array.isArray(row) ? row : []).map(c => String(c ?? ''));
        while (r.length < headerCount) r.push('');
        return r.slice(0, headerCount);
      });
      const existingRowCount = (sheet.values || []).slice(1).length;
      for (let i = 0; i < cleanRows.length; i++) {
        const rowIndex = existingRowCount + 1 + i; // 1-based, offset header
        for (let j = 0; j < cleanRows[i].length; j++) {
          await api.sheets.updateCell(sheetId, sheetTitle, rowIndex, j, cleanRows[i][j]);
        }
      }
      _triggerRefresh();
      return { appended: cleanRows.length, totalRows: existingRowCount + cleanRows.length };
    }

    if (args.operation === 'update_cells') {
      if (!Array.isArray(args.updates) || args.updates.length === 0) {
        throw new Error('update_cells requires a non-empty updates array');
      }
      for (const u of args.updates) {
        await api.sheets.updateCell(sheetId, sheetTitle, u.row, u.col, String(u.value ?? ''));
      }
      _triggerRefresh();
      return { updated: args.updates.length };
    }

    throw new Error(`Unknown operation "${args.operation}" — use append_rows or update_cells`);
  }

  throw new Error(`Unknown tool: ${name}`);
}

/** Show an inline tool-activity indicator in the chat. Returns the element. */
function _appendToolIndicator(toolName) {
  const label = toolName === 'update_sheet' ? 'Updating sheet…' : 'Reading sheet…';
  const el_ = el('div', { className: 'template-ai-tool-indicator' }, [
    el('span', { className: 'template-ai-tool-dots' }, [
      el('span', {}, ['·']), el('span', {}, ['·']), el('span', {}, ['·']),
    ]),
    el('span', {}, [label]),
  ]);
  _chatBody.appendChild(el_);
  _chatBody.scrollTop = _chatBody.scrollHeight;
  return el_;
}

/** Trigger sheet refresh & show toast confirmation. */
function _triggerRefresh() {
  showToast('Sheet updated ✓', 'success');
  if (typeof _context.onRefresh === 'function') {
    _context.onRefresh();
  }
}

/* ---------- Key rotation ---------- */

function _getNextKey() {
  const keys = storage.getAgentKeys();
  if (keys.length === 0) return null;

  const now = Date.now();
  const available = keys
    .map((k, i) => ({ ...k, idx: i }))
    .filter(k => !k.lastError || (now - new Date(k.lastError).getTime()) > 60000);

  const pool = available.length ? available : keys.map((k, i) => ({ ...k, idx: i }));
  pool.sort((a, b) => (a.requestsToday || 0) - (b.requestsToday || 0));
  return { key: pool[0].key, idx: pool[0].idx };
}

/* ---------- Message element builder ---------- */

function _buildMessageEl(role, content) {
  const wrapper = el('div', {
    className: `template-ai-message template-ai-message-${role}`,
  });
  const contentEl = el('div', { className: 'template-ai-message-content' });
  renderMarkdown(contentEl, content);
  wrapper.appendChild(contentEl);
  return wrapper;
}

/* ---------- Photo Attachments ---------- */

async function _pickAndQueueImages() {
  try {
    const files = await _pickImageFiles();
    await _queuePreparedImages(files, { sourceLabel: 'Attached' });
  } catch (err) {
    showToast(err.message || 'Could not attach photos', 'error');
  }
}

async function _captureAndQueueImage() {
  try {
    const file = await captureStillFromCamera({ title: 'Take Photo' });
    if (!file) return;
    await _queuePreparedImages([file], { sourceLabel: 'Captured' });
  } catch (err) {
    showToast(err.message || 'Could not capture photo', 'error');
  }
}

async function _queuePreparedImages(files, { sourceLabel }) {
  if (!files || files.length === 0) return;

  const selected = files.slice(0, MAX_PENDING_IMAGES);
  const prepared = [];
  for (const file of selected) {
    prepared.push(await _prepareInlineImage(file));
  }

  _pendingInlineImages = prepared;
  showToast(
    `${sourceLabel} ${prepared.length} photo${prepared.length > 1 ? 's' : ''} for this message`,
    'success'
  );
}

function _pickImageFiles(options = {}) {
  const { capture = '', multiple = true } = options;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = !!multiple;
    if (capture) {
      input.setAttribute('capture', capture);
      input.capture = capture;
    }
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

async function _prepareInlineImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Only image files can be attached');
  }

  const bitmap = await _loadImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);

  let quality = 0.85;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let base64 = dataUrl.split(',')[1] || '';
  let bytes = Math.floor((base64.length * 3) / 4);

  while (bytes > MAX_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    base64 = dataUrl.split(',')[1] || '';
    bytes = Math.floor((base64.length * 3) / 4);
  }

  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Image "${file.name}" is too large after compression. Try a smaller photo.`);
  }

  return {
    name: file.name,
    mimeType: 'image/jpeg',
    data: base64,
  };
}

async function _loadImageBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to data URL path.
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not read image "${file.name}"`));

    const reader = new FileReader();
    reader.onload = () => {
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error(`Could not read image "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

function _buildInlineImageParts(userText, images) {
  return [
    { text: userText },
    ...images.map(img => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data,
      },
    })),
  ];
}
