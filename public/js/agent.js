/* ============================================================
   agent.js — Browser-based AI coding agent
   Provides a chat interface for AI-assisted code generation
   using the Gemini API, running entirely in the frontend.
   ============================================================ */

import { el, showToast } from './ui.js';
import * as storage from './storage.js';

/* ---------- Constants ---------- */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

const SYSTEM_PROMPT = `You are the Waymark AI coding assistant. You help developers build and modify the Waymark application — a browser-based Google Sheets viewer/editor built with vanilla JavaScript (no frameworks, no build tools).

Key architecture rules you MUST follow:
- Vanilla JS only: no React, Vue, Tailwind, TypeScript, or build tools
- All DOM built via the el() factory function — never innerHTML with dynamic content
- ES Modules loaded directly in the browser via <script type="module">
- All Google API calls go through api-client.js — never import drive.js or sheets.js directly
- Template files only import from shared.js
- CSS uses custom properties from :root (var(--color-*), var(--radius), etc.)
- CSS class naming: .{key}-{element} — flat, no BEM
- No backend business logic — server only serves static files and brokers OAuth
- Tests use Playwright with flat test() calls, no describe() blocks, CSS selectors only

When generating code:
- Use the el() factory: el('div', { className: 'my-class', on: { click: handler } }, [children])
- Use async/await, never .then() chains
- Use module-scoped let variables, no classes or global state
- Add JSDoc @param/@returns on exported functions
- Follow the file comment header pattern with /* === filename.js — description === */

You provide helpful, accurate code following these patterns. Always show complete, working code blocks.`;

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
      el('h2', { className: 'agent-header-title' }, ['Waymark AI Agent']),
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
    el('h3', {}, ['Welcome to Waymark AI Agent']),
    el('p', {}, ['To get started, configure your Gemini API key in Settings.']),
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
    el('p', { className: 'agent-empty-text' }, ['Ask me anything about the Waymark codebase, or describe a feature to implement.']),
    el('div', { className: 'agent-suggestions' }, [
      _buildSuggestion('How do I add a new template?'),
      _buildSuggestion('Generate a render() function for a contacts template'),
      _buildSuggestion('Write a Playwright test for the budget view'),
      _buildSuggestion('Explain the el() factory pattern'),
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
    placeholder: apiKey ? 'Ask about the codebase or describe what to build...' : 'Configure API key in Settings first...',
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

  const keyInput = el('input', {
    type: 'password',
    className: 'agent-settings-input',
    placeholder: 'Enter your Gemini API key...',
    value: currentKey,
  });

  const modelSelect = el('select', { className: 'agent-settings-select' }, [
    el('option', { value: 'gemini-2.0-flash', selected: currentModel === 'gemini-2.0-flash' }, ['Gemini 2.0 Flash (fast)']),
    el('option', { value: 'gemini-2.0-flash-lite', selected: currentModel === 'gemini-2.0-flash-lite' }, ['Gemini 2.0 Flash Lite (fastest)']),
    el('option', { value: 'gemini-2.5-pro-preview-05-06', selected: currentModel === 'gemini-2.5-pro-preview-05-06' }, ['Gemini 2.5 Pro (best)']),
    el('option', { value: 'gemini-2.5-flash-preview-05-20', selected: currentModel === 'gemini-2.5-flash-preview-05-20' }, ['Gemini 2.5 Flash (balanced)']),
  ]);

  const saveBtn = el('button', {
    className: 'agent-settings-save',
    on: {
      click: () => {
        const key = keyInput.value.trim();
        if (key) {
          storage.setAgentApiKey(key);
          storage.setAgentModel(modelSelect.value);
          showToast('API key saved', 'success');
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
      click: () => {
        storage.setAgentApiKey('');
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

  // Build conversation contents
  const contents = [];

  // Add history
  for (const msg of _messages.slice(0, -1)) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    });
  }

  // Add current message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  const body = {
    contents,
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const errMsg = errData?.error?.message || `API ${res.status}`;
    throw new Error(errMsg);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];

  if (!candidate?.content?.parts?.length) {
    throw new Error('No response from AI');
  }

  return candidate.content.parts.map(p => p.text).join('');
}
