/* ============================================================
   view.js — Agent UI composition helpers
   DOM construction for the chat shell, messages, and input row.
   ============================================================ */

import { el } from '../ui.js';
import { renderMarkdown } from './markdown.js';
import { SLASH_COMMANDS } from './slash-commands.js';

/* ---------- UI Rendering ---------- */

/**
 * Render the agent chat shell into the given container.
 * @param {Object} args
 * @returns {{ chatBody: HTMLElement }}
 */
export function renderAgentUI(args) {
  const {
    container,
    messages,
    hasKeys,
    onShowSettings,
    onClearConversation,
    onSendMessage,
    onRunSlashCommand,
  } = args;

  const header = el('div', { className: 'agent-header' }, [
    el('div', { className: 'agent-header-left' }, [
      el('span', { className: 'agent-header-icon' }, ['🤖']),
      el('h2', { className: 'agent-header-title' }, ['Waymark AI']),
    ]),
    el('div', { className: 'agent-header-actions' }, [
      el('button', {
        className: 'agent-settings-btn',
        title: 'Configure API key',
        on: { click: onShowSettings },
      }, ['⚙️ Settings']),
      el('button', {
        className: 'agent-clear-btn',
        title: 'Clear conversation',
        on: { click: onClearConversation },
      }, ['🗑️ Clear']),
    ]),
  ]);

  const chatBody = el('div', { className: 'agent-chat-body' });

  if (!hasKeys) {
    chatBody.appendChild(buildWelcome(onShowSettings));
  } else if (messages.length === 0) {
    chatBody.appendChild(buildEmptyState(onSendMessage));
  } else {
    messages.forEach(msg => chatBody.appendChild(buildMessage(msg)));
  }

  const inputRow = buildInputRow({
    hasKeys,
    chatBody,
    onSendMessage,
    onRunSlashCommand,
  });

  const wrapper = el('div', { className: 'agent-container' }, [
    header,
    chatBody,
    inputRow,
  ]);

  container.appendChild(wrapper);
  return { chatBody };
}

/**
 * Build the welcome state shown before the user configures keys.
 * @param {Function} onShowSettings
 * @returns {HTMLElement}
 */
export function buildWelcome(onShowSettings) {
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
      on: { click: onShowSettings },
    }, ['⚙️ Configure API Key']),
  ]);
}

/**
 * Build the empty conversation state.
 * @param {Function} onSendMessage
 * @returns {HTMLElement}
 */
export function buildEmptyState(onSendMessage) {
  return el('div', { className: 'agent-empty' }, [
    el('p', { className: 'agent-empty-text' }, ['I can help you create and organise Google Sheets that Waymark renders as rich views. What would you like to build?']),
    el('div', { className: 'agent-suggestions' }, [
      buildSuggestion('Create a project board to track my tasks', onSendMessage),
      buildSuggestion('Build a weekly meal planner', onSendMessage),
      buildSuggestion('Set up a budget tracker for this month', onSendMessage),
      buildSuggestion('Make a recipe sheet for my favourite dishes', onSendMessage),
    ]),
  ]);
}

/**
 * Build a single chat message node.
 * @param {{ role: string, content: string }} msg
 * @returns {HTMLElement}
 */
export function buildMessage(msg) {
  const isUser = msg.role === 'user';
  const wrapper = el('div', {
    className: 'agent-message ' + (isUser ? 'agent-message-user' : 'agent-message-assistant'),
  });

  const avatar = el('div', { className: 'agent-message-avatar' }, [isUser ? '👤' : '🤖']);
  const content = el('div', { className: 'agent-message-content' });

  if (isUser) {
    content.appendChild(el('p', {}, [msg.content]));
  } else {
    renderMarkdown(content, msg.content);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(content);
  return wrapper;
}

/**
 * Append a system message to the chat body.
 * @param {HTMLElement} chatBody
 * @param {string} text
 */
export function appendSystemMessage(chatBody, text) {
  const wrapper = el('div', { className: 'agent-message agent-message-system' });
  const content = el('div', { className: 'agent-message-content' });
  renderMarkdown(content, text);
  wrapper.appendChild(content);
  chatBody.appendChild(wrapper);
  chatBody.scrollTop = chatBody.scrollHeight;
}

/**
 * Append an inline sheet preview card to the chat body.
 * @param {HTMLElement} chatBody
 * @param {{ spreadsheetId: string, title: string, template: string, rowCount: number }} result
 */
export function appendSheetPreviewCard(chatBody, result) {
  const { spreadsheetId, title, template, rowCount } = result;

  const badge = el('span', { className: 'agent-card-badge' }, [template || 'sheet']);
  const cardTitle = el('div', { className: 'agent-card-title' }, [title]);
  const cardMeta = el('div', { className: 'agent-card-meta' }, [
    badge,
    el('span', { className: 'agent-card-rows' }, [
      rowCount != null ? `${rowCount} row${rowCount !== 1 ? 's' : ''}` : 'empty',
    ]),
  ]);

  const openBtn = el('a', {
    className: 'agent-card-open-btn',
    href: `#/sheet/${spreadsheetId}`,
  }, ['Open sheet →']);

  const card = el('div', { className: 'agent-sheet-card' }, [
    el('div', { className: 'agent-card-body' }, [cardTitle, cardMeta]),
    openBtn,
  ]);

  chatBody.appendChild(card);
  chatBody.scrollTop = chatBody.scrollHeight;
}

/**
 * Build the chat input row and slash command palette.
 * @param {Object} args
 * @returns {HTMLElement}
 */
function buildInputRow(args) {
  const { hasKeys, chatBody, onSendMessage, onRunSlashCommand } = args;
  let paletteVisible = false;
  let selectedIdx = -1;
  const palette = el('div', { className: 'agent-slash-palette hidden' });

  function hidePalette() {
    palette.classList.add('hidden');
    paletteVisible = false;
    selectedIdx = -1;
  }

  function updatePalette(query) {
    const lowerQuery = query.slice(1).toLowerCase();
    const matches = SLASH_COMMANDS.filter(cmd =>
      cmd.name.startsWith(lowerQuery) || cmd.syntax.includes(lowerQuery)
    );
    palette.innerHTML = '';
    if (!matches.length) {
      hidePalette();
      return;
    }
    matches.forEach((cmd, index) => {
      const item = el('div', {
        className: 'agent-slash-item',
        on: {
          mousedown: (event) => {
            event.preventDefault();
            input.value = cmd.syntax + ' ';
            input.focus();
            hidePalette();
          },
        },
      }, [
        el('span', { className: 'agent-slash-name' }, [cmd.syntax]),
        el('span', { className: 'agent-slash-label' }, [cmd.label]),
      ]);
      if (index === selectedIdx) item.classList.add('agent-slash-selected');
      palette.appendChild(item);
    });
    palette.classList.remove('hidden');
    paletteVisible = true;
    selectedIdx = -1;
  }

  function selectInPalette(delta) {
    const items = palette.querySelectorAll('.agent-slash-item');
    if (!items.length) return;
    selectedIdx = Math.max(0, Math.min(items.length - 1, selectedIdx + delta));
    items.forEach((item, index) => {
      item.classList.toggle('agent-slash-selected', index === selectedIdx);
    });
  }

  function applyPaletteSelection() {
    const items = palette.querySelectorAll('.agent-slash-item');
    if (selectedIdx < 0 || selectedIdx >= items.length) return false;
    items[selectedIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  }

  async function submitInput() {
    const val = input.value.trim();
    if (!val) return;
    if (val.startsWith('/')) {
      const [rawCmd, ...args] = val.slice(1).split(/\s+/);
      const cmdName = rawCmd.toLowerCase();
      input.value = '';
      input.style.height = 'auto';
      hidePalette();
      const feedback = await onRunSlashCommand(cmdName, args);
      if (feedback) appendSystemMessage(chatBody, feedback);
      return;
    }
    onSendMessage(val);
  }

  const inputAttrs = {
    className: 'agent-input',
    placeholder: hasKeys ? 'Type / for commands or describe what you\'d like to create…' : 'Configure API key in Settings first...',
    rows: 1,
    on: {
      keydown: async (event) => {
        if (paletteVisible) {
          if (event.key === 'ArrowDown') { event.preventDefault(); selectInPalette(1); return; }
          if (event.key === 'ArrowUp') { event.preventDefault(); selectInPalette(-1); return; }
          if (event.key === 'Escape') { event.preventDefault(); hidePalette(); return; }
          if (event.key === 'Enter' && !event.shiftKey) {
            if (applyPaletteSelection()) { event.preventDefault(); return; }
          }
          if (event.key === 'Tab') { event.preventDefault(); selectInPalette(1); return; }
        }

        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          await submitInput();
        }
      },
      input: () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
        const val = input.value;
        if (val.startsWith('/') && val.length > 0 && !val.includes(' ')) {
          updatePalette(val);
        } else {
          hidePalette();
        }
      },
      blur: () => {
        setTimeout(hidePalette, 150);
      },
    },
  };
  if (!hasKeys) inputAttrs.disabled = 'disabled';

  const input = el('textarea', inputAttrs);

  const sendAttrs = {
    className: 'agent-send-btn',
    title: 'Send message',
    on: {
      click: submitInput,
    },
  };
  if (!hasKeys) sendAttrs.disabled = 'disabled';

  const sendBtn = el('button', sendAttrs, ['➤']);
  return el('div', { className: 'agent-input-row' }, [palette, input, sendBtn]);
}

/**
 * Build a suggestion button.
 * @param {string} text
 * @param {Function} onSendMessage
 * @returns {HTMLElement}
 */
function buildSuggestion(text, onSendMessage) {
  return el('button', {
    className: 'agent-suggestion',
    on: { click: () => onSendMessage(text) },
  }, [text]);
}