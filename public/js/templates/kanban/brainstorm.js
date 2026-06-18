/* ============================================================
   kanban/brainstorm.js — Brainstorming mode for kanban ideas

   Enables interactive discussion and expansion of loose ideas
   before converting them to structured tasks. Supports idea
   creation, AI-driven discussion, and task promotion.
   ============================================================ */

import { el, editableCell, emitEdit, getUserName, showToast } from '../shared.js';
import { formatRelativeDate, nowTimestamp } from './helpers.js';

/* ---------- Brainstorm State ---------- */

let _brainstormIdeas = [];
let _brainstormMode = false;
let _currentIdeaIdx = null;

const BRAINSTORM_STORAGE_KEY = 'waymark_brainstorm_ideas';

/* ---------- Storage Helpers ---------- */

function saveBrainstormIdeas() {
  const data = JSON.stringify(_brainstormIdeas);
  try {
    localStorage.setItem(BRAINSTORM_STORAGE_KEY, data);
  } catch (e) {
    console.warn('Failed to save brainstorm ideas:', e);
  }
}

function loadBrainstormIdeas() {
  try {
    const data = localStorage.getItem(BRAINSTORM_STORAGE_KEY);
    _brainstormIdeas = data ? JSON.parse(data) : [];
  } catch (e) {
    console.warn('Failed to load brainstorm ideas:', e);
    _brainstormIdeas = [];
  }
}

/* ---------- Idea Model ---------- */

/**
 * Create a new brainstorm idea.
 * @param {string} title
 * @returns {Object} idea object
 */
export function createIdea(title) {
  const idea = {
    id: `idea-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: title || 'New Idea',
    description: '',
    discussion: [],
    status: 'brainstorm', // brainstorm -> refined -> task
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
    creator: getUserName() || 'System',
    tags: [],
  };
  _brainstormIdeas.push(idea);
  saveBrainstormIdeas();
  return idea;
}

/**
 * Add a discussion entry to an idea.
 * @param {string} ideaId
 * @param {string} content
 * @param {string} author
 */
export function addDiscussionEntry(ideaId, content, author = null) {
  const idea = _brainstormIdeas.find(i => i.id === ideaId);
  if (!idea) return;
  idea.discussion.push({
    timestamp: nowTimestamp(),
    author: author || getUserName() || 'System',
    content: content,
  });
  idea.updatedAt = nowTimestamp();
  saveBrainstormIdeas();
}

/**
 * Update idea title or description.
 * @param {string} ideaId
 * @param {string} field
 * @param {string} value
 */
export function updateIdea(ideaId, field, value) {
  const idea = _brainstormIdeas.find(i => i.id === ideaId);
  if (!idea) return;
  if (field === 'title' || field === 'description') {
    idea[field] = value;
    idea.updatedAt = nowTimestamp();
    saveBrainstormIdeas();
  }
}

/**
 * Mark an idea as refined and ready for task conversion.
 * @param {string} ideaId
 */
export function refineIdea(ideaId) {
  const idea = _brainstormIdeas.find(i => i.id === ideaId);
  if (!idea) return;
  idea.status = 'refined';
  idea.updatedAt = nowTimestamp();
  saveBrainstormIdeas();
}

/**
 * Convert a refined idea to a task row.
 * @param {string} ideaId
 * @param {Object} cols - column mapping
 * @returns {Array} new task row
 */
export function ideaToTaskRow(ideaId, cols) {
  const idea = _brainstormIdeas.find(i => i.id === ideaId);
  if (!idea) return null;

  const totalCols = Math.max(...Object.values(cols).filter(v => v >= 0)) + 1;
  const row = new Array(totalCols).fill('');

  if (cols.text >= 0) row[cols.text] = idea.title;
  if (cols.description >= 0) {
    const discussionSummary = idea.discussion
      .map(e => `${e.author}: ${e.content}`)
      .join('\n');
    row[cols.description] = idea.description || discussionSummary || '';
  }
  if (cols.stage >= 0) row[cols.stage] = 'Backlog';
  if (cols.assignee >= 0) row[cols.assignee] = getUserName() || '';

  return row;
}

/**
 * Delete a brainstorm idea.
 * @param {string} ideaId
 */
export function deleteIdea(ideaId) {
  _brainstormIdeas = _brainstormIdeas.filter(i => i.id !== ideaId);
  saveBrainstormIdeas();
}

/* ---------- UI Builders ---------- */

/**
 * Build an idea card element.
 * @param {Object} idea
 * @param {Function} onExpandFn
 * @returns {HTMLElement}
 */
function buildIdeaCard(idea, onExpandFn) {
  const card = el('div', { className: 'kanban-idea-card', dataset: { ideaId: idea.id } });

  // Header with title
  const header = el('div', { className: 'kanban-idea-header' });
  header.append(el('span', { className: 'kanban-idea-status' }, [idea.status === 'refined' ? '✓' : '💡']));
  header.append(editableCell('span', { className: 'kanban-idea-title' }, idea.title, idea.id, 'title'));

  // Meta: created, author
  const meta = el('div', { className: 'kanban-idea-meta' }, [
    el('span', { className: 'kanban-idea-creator' }, [`By ${idea.creator}`]),
    el('span', { className: 'kanban-idea-date' }, [formatRelativeDate(idea.createdAt)]),
  ]);
  header.append(meta);

  card.append(header);

  // Description preview
  if (idea.description) {
    card.append(el('div', { className: 'kanban-idea-desc' }, [idea.description]));
  }

  // Discussion count badge
  const discussionCount = idea.discussion.length;
  const discussionBadge = el('div', { className: 'kanban-idea-discuss-badge' }, [
    `💬 ${discussionCount} message${discussionCount !== 1 ? 's' : ''}`,
  ]);
  card.append(discussionBadge);

  // Expand button
  const expandBtn = el('button', {
    className: 'kanban-idea-expand-btn',
    title: 'Expand and discuss',
  }, ['Expand →']);
  expandBtn.addEventListener('click', () => onExpandFn(idea));
  card.append(expandBtn);

  return card;
}

/**
 * Build the brainstorm ideas grid view.
 * @param {Array} ideas
 * @param {Function} onExpandFn
 * @returns {HTMLElement}
 */
function buildIdeasGrid(ideas, onExpandFn) {
  const grid = el('div', { className: 'kanban-ideas-grid' });

  for (const idea of ideas) {
    grid.append(buildIdeaCard(idea, onExpandFn));
  }

  return grid;
}

/**
 * Build the idea discussion panel.
 * @param {Object} idea
 * @param {Function} onAddDiscussionFn
 * @param {Function} onRefineIdea
 * @param {Function} onConvertToTaskFn
 * @returns {HTMLElement}
 */
function buildIdeaDiscussionPanel(idea, onAddDiscussionFn, onRefineIdea, onConvertToTaskFn) {
  const panel = el('div', { className: 'kanban-idea-discussion-panel' });

  // Header
  const header = el('div', { className: 'kanban-idea-panel-header' });
  header.append(el('span', { className: 'kanban-idea-panel-icon' }, ['💡']));
  header.append(editableCell('h3', { className: 'kanban-idea-panel-title' }, idea.title, idea.id, 'title'));

  // Status indicator
  const statusSpan = el('span', {
    className: `kanban-idea-status-indicator ${idea.status === 'refined' ? 'refined' : 'brainstorm'}`,
  }, [idea.status === 'refined' ? '✓ Refined' : '🔄 Brainstorm']);
  header.append(statusSpan);

  panel.append(header);

  // Description field
  const descDiv = el('div', { className: 'kanban-idea-desc-field' });
  descDiv.append(el('label', {}, ['Description']));
  const descArea = el('textarea', {
    className: 'kanban-idea-desc-textarea',
    placeholder: 'Expand on this idea...',
    value: idea.description || '',
  });
  descArea.addEventListener('blur', () => {
    const newVal = descArea.value;
    if (newVal !== idea.description) {
      updateIdea(idea.id, 'description', newVal);
    }
  });
  descDiv.append(descArea);
  panel.append(descDiv);

  // Discussion thread
  const discussionDiv = el('div', { className: 'kanban-idea-discussion-thread' });
  discussionDiv.append(el('h4', {}, ['Discussion']));

  const threadContent = el('div', { className: 'kanban-idea-thread-content' });
  for (const entry of idea.discussion) {
    const entryEl = el('div', { className: 'kanban-idea-discussion-entry' });
    entryEl.append(el('div', { className: 'kanban-idea-entry-header' }, [
      el('strong', {}, [entry.author]),
      el('span', { className: 'kanban-idea-entry-time' }, [formatRelativeDate(entry.timestamp)]),
    ]));
    entryEl.append(el('div', { className: 'kanban-idea-entry-content' }, [entry.content]));
    threadContent.append(entryEl);
  }
  discussionDiv.append(threadContent);

  // Add discussion input
  const inputDiv = el('div', { className: 'kanban-idea-add-discussion' });
  const input = el('input', {
    type: 'text',
    className: 'kanban-idea-discuss-input',
    placeholder: 'Add a thought or AI-generated expansion...',
  });
  const addBtn = el('button', { className: 'kanban-idea-discuss-btn' }, ['Add']);
  addBtn.addEventListener('click', () => {
    const content = input.value.trim();
    if (content) {
      onAddDiscussionFn(idea.id, content);
      input.value = '';
      // Rebuild discussion to show new entry
      threadContent.innerHTML = '';
      for (const entry of idea.discussion) {
        const entryEl = el('div', { className: 'kanban-idea-discussion-entry' });
        entryEl.append(el('div', { className: 'kanban-idea-entry-header' }, [
          el('strong', {}, [entry.author]),
          el('span', { className: 'kanban-idea-entry-time' }, [formatRelativeDate(entry.timestamp)]),
        ]));
        entryEl.append(el('div', { className: 'kanban-idea-entry-content' }, [entry.content]));
        threadContent.append(entryEl);
      }
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });
  inputDiv.append(input, addBtn);
  discussionDiv.append(inputDiv);

  panel.append(discussionDiv);

  // Action buttons
  const actionsDiv = el('div', { className: 'kanban-idea-panel-actions' });

  const refineBtn = el('button', {
    className: `kanban-idea-refine-btn ${idea.status === 'refined' ? 'refined' : ''}`,
  }, [idea.status === 'refined' ? '✓ Refined' : 'Mark Refined']);
  refineBtn.addEventListener('click', () => {
    onRefineIdea(idea.id);
    statusSpan.textContent = '✓ Refined';
    statusSpan.classList.add('refined');
    statusSpan.classList.remove('brainstorm');
    refineBtn.textContent = '✓ Refined';
    refineBtn.classList.add('refined');
  });
  actionsDiv.append(refineBtn);

  if (idea.status === 'refined') {
    const convertBtn = el('button', { className: 'kanban-idea-convert-btn' }, ['Convert to Task']);
    convertBtn.addEventListener('click', () => onConvertToTaskFn(idea.id));
    actionsDiv.append(convertBtn);
  }

  const deleteBtn = el('button', { className: 'kanban-idea-delete-btn' }, ['Delete']);
  deleteBtn.addEventListener('click', () => {
    if (confirm('Delete this idea?')) {
      deleteIdea(idea.id);
      onConvertToTaskFn(null); // Trigger close/refresh
    }
  });
  actionsDiv.append(deleteBtn);

  panel.append(actionsDiv);

  return panel;
}

/* ---------- Mode Manager ---------- */

/**
 * Toggle brainstorm mode on/off and render the appropriate view.
 * @param {HTMLElement} container
 * @param {Object} cols - kanban column mapping
 * @param {Function} onConvertToTaskFn - callback when idea is converted to task
 */
export function toggleBrainstormMode(container, cols, onConvertToTaskFn) {
  loadBrainstormIdeas();
  _brainstormMode = !_brainstormMode;

  if (_brainstormMode) {
    renderBrainstormView(container, cols, onConvertToTaskFn);
  } else {
    container.innerHTML = '';
    _currentIdeaIdx = null;
  }
}

/**
 * Render the brainstorm view.
 * @param {HTMLElement} container
 * @param {Object} cols
 * @param {Function} onConvertToTaskFn
 */
export function renderBrainstormView(container, cols, onConvertToTaskFn) {
  loadBrainstormIdeas();
  container.innerHTML = '';

  const brainstormView = el('div', { className: 'kanban-brainstorm-view' });

  // Header with title and new idea button
  const headerDiv = el('div', { className: 'kanban-brainstorm-header' });
  headerDiv.append(el('h2', { className: 'kanban-brainstorm-title' }, ['💭 Brainstorm Mode']));

  const newIdeaBtn = el('button', { className: 'kanban-new-idea-btn' }, ['+ New Idea']);
  newIdeaBtn.addEventListener('click', () => {
    const title = prompt('Idea title:');
    if (title) {
      createIdea(title);
      renderBrainstormView(container, cols, onConvertToTaskFn);
    }
  });
  headerDiv.append(newIdeaBtn);
  brainstormView.append(headerDiv);

  // Ideas grid or detail view
  const contentDiv = el('div', { className: 'kanban-brainstorm-content' });

  if (_currentIdeaIdx !== null && _brainstormIdeas[_currentIdeaIdx]) {
    const idea = _brainstormIdeas[_currentIdeaIdx];

    const backBtn = el('button', { className: 'kanban-idea-back-btn' }, ['← Back to Ideas']);
    backBtn.addEventListener('click', () => {
      _currentIdeaIdx = null;
      renderBrainstormView(container, cols, onConvertToTaskFn);
    });
    contentDiv.append(backBtn);

    const discussionPanel = buildIdeaDiscussionPanel(
      idea,
      (ideaId, content) => {
        addDiscussionEntry(ideaId, content);
      },
      (ideaId) => {
        refineIdea(ideaId);
      },
      (ideaId) => {
        if (ideaId) {
          const taskRow = ideaToTaskRow(ideaId, cols);
          if (taskRow) {
            onConvertToTaskFn(taskRow, idea.title);
            deleteIdea(ideaId);
            showToast('Idea converted to task!', 'success');
            _currentIdeaIdx = null;
            renderBrainstormView(container, cols, onConvertToTaskFn);
          }
        } else {
          renderBrainstormView(container, cols, onConvertToTaskFn);
        }
      }
    );
    contentDiv.append(discussionPanel);
  } else {
    // Grid view
    if (_brainstormIdeas.length === 0) {
      contentDiv.append(el('div', { className: 'kanban-brainstorm-empty' }, [
        '💭 No ideas yet. Start brainstorming!',
      ]));
    } else {
      const ideasGrid = buildIdeasGrid(_brainstormIdeas, (idea) => {
        _currentIdeaIdx = _brainstormIdeas.indexOf(idea);
        renderBrainstormView(container, cols, onConvertToTaskFn);
      });
      contentDiv.append(ideasGrid);
    }
  }

  brainstormView.append(contentDiv);
  container.append(brainstormView);
}

/**
 * Check if brainstorm mode is active.
 * @returns {boolean}
 */
export function isBrainstormMode() {
  return _brainstormMode;
}

/**
 * Get all brainstorm ideas.
 * @returns {Array}
 */
export function getAllIdeas() {
  loadBrainstormIdeas();
  return _brainstormIdeas;
}
