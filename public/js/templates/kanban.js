/* ============================================================
   templates/kanban.js — Enhanced Kanban Board

   Features: expandable cards, project grouping & filtering,
   sub-tasks, notes with authors, due-date urgency, labels,
   sort within lanes, archive toggle, lane progress.

   Performance: lazy detail rendering, lane-level virtualization,
   delegated event handling for scaling to thousands of items.
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, buildAddRowForm, getUserName, comboCell, textareaCell } from './shared.js';

/* ---------- Constants ---------- */

const PROJECT_PALETTE = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
  '#d97706', '#0d9488', '#0891b2', '#4f46e5', '#16a34a',
];

const LANE_LABELS = {
  backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress',
  done: 'Done', archived: 'Archived',
};

/** Number of cards rendered per lane before showing "Show more" */
const LANE_PAGE_SIZE = 50;

/* ---------- Module state (persists across auto-refresh) ---------- */

let _activeProject = null;
let _activeSort = 'default';
let _showArchived = false;
let _expandedCards = new Set();
/** Per-lane render counts: how many cards are currently shown */
let _laneRendered = {};

/* ---------- Drag-and-drop state ---------- */

let _dragCard = null;     // DOM element being dragged
let _dragRowIdx = null;   // 1-based row index of dragged card

/* ---------- Helpers ---------- */

/**
 * Deterministic color for a project name.
 * @param {string} name
 * @returns {string} hex color
 */
function projectColor(name) {
  if (!name) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return PROJECT_PALETTE[Math.abs(hash) % PROJECT_PALETTE.length];
}

/**
 * Numeric rank for sorting by priority (lower = more urgent).
 * @param {string} val
 * @returns {number}
 */
function priRank(val) {
  const v = (val || '').toLowerCase().trim();
  if (v === 'p0' || v === 'critical') return 0;
  if (v === 'p1' || v === 'high') return 1;
  if (v === 'p2' || v === 'medium') return 2;
  if (v === 'p3' || v === 'low') return 3;
  return 4;
}

/**
 * CSS class for due-date urgency.
 * @param {string} dateStr
 * @returns {string}
 */
function dueBadgeClass(dateStr) {
  if (!dateStr) return '';
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = (due - now) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'kanban-due-overdue';
  if (diff < 2) return 'kanban-due-soon';
  if (diff < 7) return 'kanban-due-upcoming';
  return 'kanban-due-later';
}

/**
 * Human-friendly due-date label.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDue(dateStr) {
  if (!dateStr) return '';
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return dateStr;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((due - now) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `${diff}d`;
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ---------- Group parser ---------- */

/**
 * Parse flat rows into task groups with sub-tasks and notes.
 * Uses §4.7 contiguous row-grouping: blank Task column = child of previous parent.
 *
 * @param {string[][]} rows  — data rows (header excluded)
 * @param {Object}     cols  — column index map
 * @returns {Array<{row: string[], idx: number, subtasks: Array, notes: Array}>}
 */
function parseGroups(rows, cols) {
  const groups = [];
  let current = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const taskName = cell(row, cols.text);

    if (taskName) {
      current = { row, idx: i, subtasks: [], notes: [] };
      groups.push(current);
    } else if (current) {
      const noteVal = cols.note >= 0 ? cell(row, cols.note) : '';
      const descVal = cols.description >= 0 ? cell(row, cols.description) : '';
      if (noteVal) {
        current.notes.push({ row, idx: i });
      } else if (descVal) {
        current.subtasks.push({ row, idx: i });
      }
    }
  }
  return groups;
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Kanban Board',
  icon: '📋',
  color: '#0284c7',
  priority: 23,
  itemNoun: 'Task',

  detect(lower) {
    return lower.some(h => /^(stage|column|lane|board|swim)/.test(h) || /backlog|in.?progress|to.?do|doing/.test(h))
      && lower.some(h => /^(task|story|ticket|item|feature|issue|title|name|description)/.test(h));
  },

  columns(lower) {
    const cols = {
      text: -1, description: -1, stage: -1, project: -1,
      assignee: -1, priority: -1, due: -1, label: -1, note: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.stage       = lower.findIndex(h => /^(stage|column|lane|board|status|swim)/.test(h) || /backlog|in.?progress|to.?do|doing/.test(h));
    cols.text        = lower.findIndex((h, i) => !used().includes(i) && /^(task|story|ticket|item|feature|issue|title|name)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => !used().includes(i));
    cols.description = lower.findIndex((h, i) => !used().includes(i) && /^(desc|detail|body|summary)/.test(h));
    cols.project     = lower.findIndex((h, i) => !used().includes(i) && /^(project|epic|group|module|sprint|milestone|workstream)/.test(h));
    cols.assignee    = lower.findIndex((h, i) => !used().includes(i) && /^(assign|owner|who|person|dev|member)/.test(h));
    cols.priority    = lower.findIndex((h, i) => !used().includes(i) && /^(priority|urgency|importance|p[0-4])/.test(h));
    cols.due         = lower.findIndex((h, i) => !used().includes(i) && /^(due|deadline|target.?date|by|date)/.test(h));
    cols.label       = lower.findIndex((h, i) => !used().includes(i) && /^(label|tag|type|kind|category)/.test(h));
    cols.note        = lower.findIndex((h, i) => !used().includes(i) && /^(note|comment|remark|feedback)/.test(h));

    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',        label: 'Task',        colIndex: cols.text,        type: 'text',   placeholder: 'Task title', required: true },
      { role: 'description', label: 'Description',  colIndex: cols.description, type: 'textarea', placeholder: 'Details (optional)' },
      { role: 'stage',       label: 'Stage',        colIndex: cols.stage,       type: 'select', options: ['Backlog', 'To Do', 'In Progress', 'Done'], defaultValue: 'Backlog' },
      { role: 'project',     label: 'Project',      colIndex: cols.project,     type: 'combo',  placeholder: 'Select or type new…' },
      { role: 'assignee',    label: 'Assignee',     colIndex: cols.assignee,    type: 'combo',  placeholder: 'Select or type new…' },
      { role: 'priority',    label: 'Priority',     colIndex: cols.priority,    type: 'select', options: ['P0', 'P1', 'P2', 'P3'], defaultValue: 'P2' },
      { role: 'due',         label: 'Due Date',     colIndex: cols.due,         type: 'date' },
      { role: 'label',       label: 'Label',        colIndex: cols.label,       type: 'select', options: ['', 'feature', 'bug', 'infra', 'design', 'docs'] },
    ];
  },

  stageStates: ['Backlog', 'To Do', 'In Progress', 'Done'],

  stageClass(val) {
    const v = (val || '').toLowerCase().trim();
    if (/^(archived|archive)/.test(v)) return 'archived';
    if (/^(done|complete|finished|closed|shipped)/.test(v)) return 'done';
    if (/^(in.?progress|doing|active|wip|started)/.test(v)) return 'inprogress';
    if (/^(to.?do|ready|planned|next|queued)/.test(v)) return 'todo';
    return 'backlog';
  },

  /* ---------- Main render ---------- */

  render(container, rows, cols, template) {
    const groups = parseGroups(rows, cols);

    // Collect unique project names
    const projects = cols.project >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.project)).filter(Boolean))].sort()
      : [];

    // Collect unique project names and assignees for combo dropdowns
    const allProjects = cols.project >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.project)).filter(Boolean))].sort()
      : [];
    const allAssignees = cols.assignee >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.assignee)).filter(Boolean))].sort()
      : [];

    /* ---- Toolbar: filter pills + sort + archive toggle ---- */

    const toolbar = el('div', { className: 'kanban-toolbar' });

    // Project filter pills
    if (projects.length > 0) {
      const filterBar = el('div', { className: 'kanban-filter-bar' });

      const allPill = el('button', {
        className: `kanban-filter-pill ${!_activeProject ? 'active' : ''}`,
      }, ['All']);
      allPill.addEventListener('click', () => {
        _activeProject = null;
        filterBar.querySelectorAll('.kanban-filter-pill').forEach(p => p.classList.remove('active'));
        allPill.classList.add('active');
        buildBoard();
      });
      filterBar.append(allPill);

      for (const proj of projects) {
        const color = projectColor(proj);
        const pill = el('button', {
          className: `kanban-filter-pill ${_activeProject === proj ? 'active' : ''}`,
          style: `--pill-color: ${color}`,
        }, [proj]);
        pill.addEventListener('click', () => {
          _activeProject = proj;
          filterBar.querySelectorAll('.kanban-filter-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          buildBoard();
        });
        filterBar.append(pill);
      }

      toolbar.append(filterBar);
    }

    // Sort + Archive controls
    const controls = el('div', { className: 'kanban-controls' });

    const sortLabel = el('label', { className: 'kanban-sort-label' }, ['Sort:']);
    const sortSelect = el('select', { className: 'kanban-sort-select' });
    [['default', 'Default'], ['priority', 'Priority'], ['due', 'Due Date']].forEach(([val, txt]) => {
      const opt = el('option', { value: val }, [txt]);
      if (val === _activeSort) opt.selected = true;
      sortSelect.append(opt);
    });
    sortSelect.addEventListener('change', () => { _activeSort = sortSelect.value; buildBoard(); });
    controls.append(sortLabel, sortSelect);

    const archiveLabel = el('label', { className: 'kanban-archive-toggle' });
    const archiveCheck = el('input', { type: 'checkbox', className: 'kanban-archive-checkbox' });
    archiveCheck.checked = _showArchived;
    archiveCheck.addEventListener('change', () => { _showArchived = archiveCheck.checked; buildBoard(); });
    archiveLabel.append(archiveCheck, ' Show Archived');
    controls.append(archiveLabel);

    toolbar.append(controls);
    container.append(toolbar);

    /* ---- Board element (rebuilt on filter/sort/archive changes) ---- */

    const boardEl = el('div', { className: 'kanban-board' });
    container.append(boardEl);

    function buildBoard() {
      boardEl.innerHTML = '';

      // Filter by project
      const filtered = _activeProject
        ? groups.filter(g => cell(g.row, cols.project) === _activeProject)
        : groups;

      // Choose lane order
      const laneOrder = _showArchived
        ? ['backlog', 'todo', 'inprogress', 'done', 'archived']
        : ['backlog', 'todo', 'inprogress', 'done'];

      if (_showArchived) boardEl.classList.add('kanban-board-5');
      else boardEl.classList.remove('kanban-board-5');

      // Progress stats (for Done lane header)
      const totalParent = filtered.length;
      const doneParent = filtered.filter(g => template.stageClass(cell(g.row, cols.stage)) === 'done').length;

      // Build a lookup from group index to group for delegated events
      const groupMap = new Map();
      for (const g of groups) groupMap.set(g.idx + 1, g);

      for (const laneKey of laneOrder) {
        let items = filtered.filter(g => template.stageClass(cell(g.row, cols.stage)) === laneKey);

        // Sort
        if (_activeSort === 'priority') {
          items.sort((a, b) => priRank(cell(a.row, cols.priority)) - priRank(cell(b.row, cols.priority)));
        } else if (_activeSort === 'due') {
          items.sort((a, b) => (cell(a.row, cols.due) || 'z').localeCompare(cell(b.row, cols.due) || 'z'));
        }

        const lane = el('div', { className: `kanban-lane kanban-lane-${laneKey}` });

        /* ---- Delegated drag-and-drop on lane ---- */
        lane.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          lane.classList.add('kanban-lane-dragover');
        });
        lane.addEventListener('dragleave', () => {
          lane.classList.remove('kanban-lane-dragover');
        });
        lane.addEventListener('drop', (e) => {
          e.preventDefault();
          lane.classList.remove('kanban-lane-dragover');
          if (_dragRowIdx && cols.stage >= 0) {
            const stageValue = LANE_LABELS[laneKey] || laneKey;
            emitEdit(_dragRowIdx, cols.stage, stageValue);
            if (_dragCard) {
              _dragCard.classList.remove('kanban-card-dragging');
              const addForm = lane.querySelector('.add-row-lane');
              if (addForm) lane.insertBefore(_dragCard, addForm);
              else lane.append(_dragCard);
              const badge = _dragCard.querySelector('.kanban-stage-btn');
              if (badge) {
                badge.textContent = stageValue;
                badge.className = `kanban-stage-btn kanban-stage-${template.stageClass(stageValue)}`;
              }
            }
            _dragCard = null;
            _dragRowIdx = null;
          }
        });

        /* ---- Delegated click handler on lane ---- */
        lane.addEventListener('click', (e) => {
          const target = /** @type {HTMLElement} */ (e.target);

          // Stage badge cycling
          if (target.classList.contains('kanban-stage-btn') && target.closest('.kanban-card')) {
            e.stopPropagation();
            const card = target.closest('.kanban-card');
            const rowIdx = Number(card.dataset.rowIdx);
            if (!rowIdx) return;
            const states = template.stageStates;
            const cur = target.textContent.trim();
            const si = states.findIndex(s => s.toLowerCase() === cur.toLowerCase());
            const next = states[(si + 1) % states.length];
            target.textContent = next;
            target.className = `kanban-stage-btn kanban-stage-${template.stageClass(next)}`;
            emitEdit(rowIdx, cols.stage, next);
            return;
          }

          // Archive button
          if (target.classList.contains('kanban-archive-btn')) {
            e.stopPropagation();
            const card = target.closest('.kanban-card');
            const rowIdx = Number(card.dataset.rowIdx);
            if (!rowIdx) return;
            card.classList.add('kanban-card-archiving');
            setTimeout(() => card.remove(), 300);
            emitEdit(rowIdx, cols.stage, 'Archived');
            return;
          }

          // Unarchive button
          if (target.classList.contains('kanban-unarchive-btn')) {
            e.stopPropagation();
            const card = target.closest('.kanban-card');
            const rowIdx = Number(card.dataset.rowIdx);
            if (!rowIdx) return;
            card.classList.add('kanban-card-archiving');
            setTimeout(() => card.remove(), 300);
            emitEdit(rowIdx, cols.stage, 'Done');
            return;
          }

          // Open modal button
          if (target.classList.contains('kanban-card-open')) {
            e.stopPropagation();
            const card = target.closest('.kanban-card');
            const rowIdx = Number(card.dataset.rowIdx);
            const group = groupMap.get(rowIdx);
            if (group) openCardModal(group, cols, template);
            return;
          }

          // Expand/collapse button
          if (target.classList.contains('kanban-card-expand')) {
            e.stopPropagation();
            const card = target.closest('.kanban-card');
            const rowIdx = Number(card.dataset.rowIdx);
            if (!rowIdx) return;
            const expanded = _expandedCards.has(rowIdx);

            if (expanded) {
              _expandedCards.delete(rowIdx);
              const detail = card.querySelector('.kanban-card-detail');
              if (detail) detail.classList.add('hidden');
              card.classList.remove('kanban-card-expanded');
              target.textContent = '▾';
            } else {
              _expandedCards.add(rowIdx);
              // Lazy detail rendering: build on first expand
              let detail = card.querySelector('.kanban-card-detail');
              if (!detail) {
                const group = groupMap.get(rowIdx);
                if (group) {
                  detail = buildCardDetail(group, cols, template);
                  card.append(detail);
                }
              } else {
                detail.classList.remove('hidden');
              }
              card.classList.add('kanban-card-expanded');
              target.textContent = '▴';
            }
            return;
          }
        });

        /* ---- Delegated drag handlers on lane (dragstart / dragend bubble) ---- */
        lane.addEventListener('dragstart', (e) => {
          const card = /** @type {HTMLElement} */ (e.target).closest?.('.kanban-card');
          if (!card) return;
          _dragCard = card;
          _dragRowIdx = Number(card.dataset.rowIdx);
          card.classList.add('kanban-card-dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(_dragRowIdx));
        });
        lane.addEventListener('dragend', (e) => {
          const card = /** @type {HTMLElement} */ (e.target).closest?.('.kanban-card');
          if (card) card.classList.remove('kanban-card-dragging');
          document.querySelectorAll('.kanban-lane-dragover').forEach(l => l.classList.remove('kanban-lane-dragover'));
          _dragCard = null;
          _dragRowIdx = null;
        });

        // Lane header
        const headerChildren = [
          el('span', { className: 'kanban-lane-title' }, [LANE_LABELS[laneKey] || laneKey]),
          el('span', { className: 'kanban-lane-count' }, [String(items.length)]),
        ];

        if (laneKey === 'done' && totalParent > 0) {
          const pct = Math.round((doneParent / totalParent) * 100);
          headerChildren.push(el('div', { className: 'kanban-lane-progress' }, [
            el('div', { className: 'kanban-lane-progress-bar', style: `width: ${pct}%` }),
          ]));
        }
        lane.append(el('div', { className: 'kanban-lane-header' }, headerChildren));

        // Virtualized card rendering: render first LANE_PAGE_SIZE cards
        const limit = _laneRendered[laneKey] || LANE_PAGE_SIZE;
        const visibleItems = items.slice(0, limit);
        const remaining = items.length - visibleItems.length;

        for (const group of visibleItems) {
          lane.append(buildCard(group, cols, template, laneKey));
        }

        // "Show more" button if there are remaining items
        if (remaining > 0) {
          const showMoreBtn = el('button', { className: 'kanban-show-more' }, [
            `Show ${Math.min(remaining, LANE_PAGE_SIZE)} more of ${remaining} remaining`,
          ]);
          showMoreBtn.addEventListener('click', () => {
            _laneRendered[laneKey] = (limit) + LANE_PAGE_SIZE;
            buildBoard();
          });
          lane.append(showMoreBtn);
        }

        // Per-lane add button
        if (typeof template._onAddRow === 'function' && typeof template.addRowFields === 'function') {
          const laneForm = buildAddRowForm(template, cols, template._totalColumns || 0, template._onAddRow, {
            defaults: { stage: LANE_LABELS[laneKey] || laneKey, project: _activeProject || '' },
            dynamicOptions: {
              project: ['', ...allProjects],
              assignee: ['', ...allAssignees],
            },
          });
          laneForm.classList.add('add-row-lane');
          lane.append(laneForm);
        }

        boardEl.append(lane);
      }
    }

    /* ---- Card builder (lightweight — no detail panel, no per-card listeners) ---- */

    function buildCard(group, cols, template, laneKey) {
      const { row, idx } = group;
      const rowIdx = idx + 1;
      const taskName = cell(row, cols.text) || '—';
      const desc = cols.description >= 0 ? cell(row, cols.description) : '';
      const stage = cell(row, cols.stage);
      const project = cols.project >= 0 ? cell(row, cols.project) : '';
      const assignee = cols.assignee >= 0 ? cell(row, cols.assignee) : '';
      const priority = cols.priority >= 0 ? cell(row, cols.priority) : '';
      const due = cols.due >= 0 ? cell(row, cols.due) : '';
      const labelVal = cols.label >= 0 ? cell(row, cols.label) : '';

      const hasSubtasks = group.subtasks.length > 0;
      const hasNotes = group.notes.length > 0;
      const hasDetail = desc || hasSubtasks || hasNotes;

      const card = el('div', { className: 'kanban-card', draggable: 'true' });
      card.dataset.rowIdx = String(rowIdx);

      // Project color accent on left border
      if (project) {
        card.style.borderLeftColor = projectColor(project);
        card.classList.add('kanban-card-project');
      }

      // Expanded state (restore from module state)
      if (_expandedCards.has(rowIdx)) card.classList.add('kanban-card-expanded');

      /* -- Card header: priority dot + title + open + expand toggle -- */
      const cardHeader = el('div', { className: 'kanban-card-header' });

      if (priority) {
        cardHeader.append(el('span', {
          className: `kanban-pri-dot kanban-pri-${priority.toLowerCase().trim()}`,
        }));
      }

      cardHeader.append(editableCell('span', { className: 'kanban-card-title' }, taskName, rowIdx, cols.text));

      // Open in focus modal button (delegated click on lane)
      cardHeader.append(el('button', {
        className: 'kanban-card-open',
        title: 'Open in focus view',
      }, ['⛶']));

      if (hasDetail) {
        cardHeader.append(el('button', {
          className: 'kanban-card-expand',
          title: 'Expand details',
        }, [_expandedCards.has(rowIdx) ? '▴' : '▾']));
      }

      card.append(cardHeader);

      /* -- Card preview: description snippet + badges -- */
      const preview = el('div', { className: 'kanban-card-preview' });

      if (desc) {
        preview.append(el('div', { className: 'kanban-card-desc' }, [desc]));
      }

      const meta = el('div', { className: 'kanban-card-meta' });

      // Stage badge (delegated click on lane)
      meta.append(el('button', {
        className: `kanban-stage-btn kanban-stage-${template.stageClass(stage)}`,
        title: 'Click to cycle stage',
      }, [stage || 'Backlog']));

      // Project badge
      if (project) {
        meta.append(el('span', {
          className: 'kanban-card-project-badge',
          style: `--project-color: ${projectColor(project)}`,
        }, [project]));
      }

      // Assignee
      if (assignee && cols.assignee >= 0) {
        const initial = assignee.charAt(0).toUpperCase();
        meta.append(el('span', { className: 'kanban-card-assignee', title: assignee }, [
          el('span', { className: 'kanban-avatar' }, [initial]),
          assignee,
        ]));
      }

      // Due date chip
      if (due) {
        meta.append(el('span', {
          className: `kanban-card-due ${dueBadgeClass(due)}`,
          title: due,
        }, [formatDue(due)]));
      }

      // Label tag
      if (labelVal) {
        meta.append(el('span', {
          className: `kanban-card-label kanban-label-${labelVal.toLowerCase().trim()}`,
        }, [labelVal]));
      }

      // Sub-task progress indicator
      if (hasSubtasks) {
        const stDone = group.subtasks.filter(st => template.stageClass(cell(st.row, cols.stage)) === 'done').length;
        meta.append(el('span', { className: 'kanban-card-subtask-count' }, [`☑ ${stDone}/${group.subtasks.length}`]));
      }

      preview.append(meta);

      // Archive button (Done lane only) — delegated click handler on lane
      if (laneKey === 'done') {
        preview.append(el('button', { className: 'kanban-archive-btn', title: 'Archive this task' }, ['📦 Archive']));
      }

      // Unarchive button (Archived lane only) — delegated click handler on lane
      if (laneKey === 'archived') {
        preview.append(el('button', { className: 'kanban-unarchive-btn', title: 'Restore to Done' }, ['♻️ Restore']));
      }

      card.append(preview);

      /* -- Lazy expandable detail: only built on first expand (delegated) -- */
      if (hasDetail && _expandedCards.has(rowIdx)) {
        // Restore previously expanded detail
        card.append(buildCardDetail(group, cols, template));
      }
      // Otherwise detail is built lazily by the delegated click handler

      return card;
    }

    /* ---- Detail panel (description, sub-tasks, notes) ---- */

    function buildCardDetail(group, cols, template) {
      const detail = el('div', { className: 'kanban-card-detail' });
      const { row, idx } = group;
      const rowIdx = idx + 1;

      // Full description (multiline textarea)
      const desc = cols.description >= 0 ? cell(row, cols.description) : '';
      if (cols.description >= 0) {
        detail.append(el('div', { className: 'kanban-detail-section' }, [
          el('div', { className: 'kanban-detail-label' }, ['Description']),
          textareaCell('div', { className: 'kanban-detail-desc' }, desc, rowIdx, cols.description),
        ]));
      }

      // Editable metadata row (due, label, assignee, priority)
      const metaGrid = el('div', { className: 'kanban-detail-meta' });
      if (cols.due >= 0) {
        metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
          el('span', { className: 'kanban-detail-field-label' }, ['Due']),
          editableCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.due), rowIdx, cols.due),
        ]));
      }
      if (cols.label >= 0) {
        metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
          el('span', { className: 'kanban-detail-field-label' }, ['Label']),
          editableCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.label), rowIdx, cols.label),
        ]));
      }
      if (cols.project >= 0) {
        metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
          el('span', { className: 'kanban-detail-field-label' }, ['Project']),
          comboCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.project), rowIdx, cols.project, allProjects),
        ]));
      }
      if (cols.assignee >= 0) {
        metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
          el('span', { className: 'kanban-detail-field-label' }, ['Assignee']),
          comboCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.assignee), rowIdx, cols.assignee, allAssignees),
        ]));
      }
      if (metaGrid.children.length > 0) detail.append(metaGrid);

      // Sub-tasks section
      if (group.subtasks.length > 0 || cols.description >= 0) {
        const stDone = group.subtasks.filter(st => template.stageClass(cell(st.row, cols.stage)) === 'done').length;
        const stTotal = group.subtasks.length;

        const stHeader = el('div', { className: 'kanban-detail-label' }, ['Sub-tasks']);
        if (stTotal > 0) {
          stHeader.append(el('span', { className: 'kanban-subtask-progress-text' }, [` ${stDone}/${stTotal}`]));
        }

        const stSection = el('div', { className: 'kanban-detail-section' }, [stHeader]);

        // Progress bar
        if (stTotal > 0) {
          const pct = Math.round((stDone / stTotal) * 100);
          stSection.append(el('div', { className: 'kanban-subtask-progress' }, [
            el('div', { className: 'kanban-subtask-progress-bar', style: `width: ${pct}%` }),
          ]));
        }

        // Sub-task list
        const stList = el('div', { className: 'kanban-subtask-list' });
        for (const st of group.subtasks) {
          const stRowIdx = st.idx + 1;
          const stDesc = cell(st.row, cols.description);
          const stStage = cell(st.row, cols.stage);
          const stAssignee = cols.assignee >= 0 ? cell(st.row, cols.assignee) : '';
          const isDone = template.stageClass(stStage) === 'done';

          const check = el('button', {
            className: `kanban-subtask-check ${isDone ? 'checked' : ''}`,
          }, [isDone ? '✓' : '']);

          const stRow = el('div', { className: `kanban-subtask-row ${isDone ? 'completed' : ''}` }, [
            check,
            editableCell('span', { className: 'kanban-subtask-text' }, stDesc, stRowIdx, cols.description),
            stAssignee ? el('span', { className: 'kanban-subtask-assignee' }, [stAssignee]) : null,
          ]);

          check.addEventListener('click', () => {
            const newStage = isDone ? 'To Do' : 'Done';
            check.classList.toggle('checked');
            check.textContent = isDone ? '' : '✓';
            stRow.classList.toggle('completed');
            emitEdit(stRowIdx, cols.stage, newStage);

            /* Update subtask progress counter and bar */
            const section = check.closest('.kanban-detail-section');
            if (section) {
              const allChecks = section.querySelectorAll('.kanban-subtask-check');
              const done = section.querySelectorAll('.kanban-subtask-check.checked').length;
              const total = allChecks.length;
              const progText = section.querySelector('.kanban-subtask-progress-text');
              if (progText) progText.textContent = ` ${done}/${total}`;
              const progBar = section.querySelector('.kanban-subtask-progress-bar');
              if (progBar) progBar.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
            }
          });

          stList.append(stRow);
        }

        stSection.append(stList);

        // Add sub-task inline form
        if (cols.description >= 0 && typeof template._onInsertAfterRow === 'function') {
          const addTrigger = el('button', { className: 'kanban-add-inline-trigger' }, ['+ Sub-task']);
          const addForm = el('div', { className: 'kanban-add-inline hidden' });
          const addInput = el('input', {
            type: 'text', className: 'kanban-add-inline-input', placeholder: 'Sub-task description…',
          });
          const addBtn = el('button', { className: 'kanban-add-inline-btn' }, ['Add']);

          function submitSubtask() {
            const val = addInput.value.trim();
            if (!val) return;
            const lastIdx = Math.max(group.idx, ...group.subtasks.map(s => s.idx), ...group.notes.map(n => n.idx));
            const afterValuesIdx = lastIdx + 1;
            const newRow = new Array(template._totalColumns || 0).fill('');
            if (cols.description >= 0) newRow[cols.description] = val;
            if (cols.stage >= 0) newRow[cols.stage] = 'To Do';
            addInput.value = '';
            addForm.classList.add('hidden');
            addTrigger.classList.remove('hidden');
            template._onInsertAfterRow(afterValuesIdx, [newRow]);
          }

          addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitSubtask(); }
            if (e.key === 'Escape') { addForm.classList.add('hidden'); addTrigger.classList.remove('hidden'); }
          });
          addBtn.addEventListener('click', submitSubtask);

          addTrigger.addEventListener('click', () => {
            addTrigger.classList.add('hidden');
            addForm.classList.remove('hidden');
            addInput.focus();
          });

          addForm.append(addInput, addBtn);
          stSection.append(addTrigger, addForm);
        }

        detail.append(stSection);
      }

      // Notes section
      if (group.notes.length > 0 || cols.note >= 0) {
        const noteSection = el('div', { className: 'kanban-detail-section' }, [
          el('div', { className: 'kanban-detail-label' }, ['Notes']),
        ]);

        const noteList = el('div', { className: 'kanban-note-list' });
        for (const n of group.notes) {
          const nRowIdx = n.idx + 1;
          const noteText = cell(n.row, cols.note);
          const noteBy = cols.assignee >= 0 ? cell(n.row, cols.assignee) : '';
          const noteDate = cols.due >= 0 ? cell(n.row, cols.due) : '';

          noteList.append(el('div', { className: 'kanban-note' }, [
            el('div', { className: 'kanban-note-header' }, [
              el('span', { className: 'kanban-note-author' }, [noteBy || 'Anonymous']),
              noteDate ? el('span', { className: 'kanban-note-date' }, [noteDate]) : null,
            ]),
            editableCell('div', { className: 'kanban-note-text' }, noteText, nRowIdx, cols.note),
          ]));
        }
        noteSection.append(noteList);

        // Add note inline form
        if (cols.note >= 0 && typeof template._onInsertAfterRow === 'function') {
          const addTrigger = el('button', { className: 'kanban-add-inline-trigger' }, ['+ Note']);
          const addForm = el('div', { className: 'kanban-add-note-form hidden' });
          const noteInput = el('input', {
            type: 'text', className: 'kanban-add-inline-input', placeholder: 'Add a note…',
          });
          const nameInput = el('input', {
            type: 'text', className: 'kanban-add-inline-input kanban-add-note-name',
            placeholder: 'Your name', value: getUserName(),
          });
          const addBtn = el('button', { className: 'kanban-add-inline-btn' }, ['Add']);

          function submitNote() {
            const noteVal = noteInput.value.trim();
            if (!noteVal) return;
            const lastIdx = Math.max(group.idx, ...group.subtasks.map(s => s.idx), ...group.notes.map(n => n.idx));
            const afterValuesIdx = lastIdx + 1;
            const newRow = new Array(template._totalColumns || 0).fill('');
            if (cols.note >= 0) newRow[cols.note] = noteVal;
            if (cols.assignee >= 0) newRow[cols.assignee] = nameInput.value.trim();
            if (cols.due >= 0) newRow[cols.due] = new Date().toISOString().slice(0, 10);
            noteInput.value = '';
            nameInput.value = '';
            addForm.classList.add('hidden');
            addTrigger.classList.remove('hidden');
            template._onInsertAfterRow(afterValuesIdx, [newRow]);
          }

          noteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
            if (e.key === 'Escape') { addForm.classList.add('hidden'); addTrigger.classList.remove('hidden'); }
          });
          nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
            if (e.key === 'Escape') { addForm.classList.add('hidden'); addTrigger.classList.remove('hidden'); }
          });
          addBtn.addEventListener('click', submitNote);

          addTrigger.addEventListener('click', () => {
            addTrigger.classList.add('hidden');
            addForm.classList.remove('hidden');
            noteInput.focus();
          });

          addForm.append(noteInput, nameInput, addBtn);
          noteSection.append(addTrigger, addForm);
        }

        detail.append(noteSection);
      }

      return detail;
    }

    /* ---- Focus modal ---- */

    function openCardModal(group, cols, template) {
      // Close any existing modal
      const existing = document.querySelector('.kanban-modal-overlay');
      if (existing) existing.remove();

      const { row, idx } = group;
      const rowIdx = idx + 1;
      const taskName = cell(row, cols.text) || '—';
      const stage = cell(row, cols.stage);
      const project = cols.project >= 0 ? cell(row, cols.project) : '';
      const priority = cols.priority >= 0 ? cell(row, cols.priority) : '';
      const assignee = cols.assignee >= 0 ? cell(row, cols.assignee) : '';
      const due = cols.due >= 0 ? cell(row, cols.due) : '';
      const labelVal = cols.label >= 0 ? cell(row, cols.label) : '';

      const overlay = el('div', { className: 'kanban-modal-overlay' });
      const modal = el('div', { className: 'kanban-modal' });

      /* -- Header with title and badges -- */
      const headerContent = el('div', { className: 'kanban-modal-header-content' });

      // Editable title
      headerContent.append(editableCell('div', { className: 'kanban-modal-title' }, taskName, rowIdx, cols.text));

      // Header meta: stage, project, priority, assignee, due, label
      const headerMeta = el('div', { className: 'kanban-modal-header-meta' });

      const stageBadge = el('button', {
        className: `kanban-stage-btn kanban-stage-${template.stageClass(stage)}`,
        title: 'Click to cycle stage',
      }, [stage || 'Backlog']);
      stageBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        const states = template.stageStates;
        const cur = stageBadge.textContent.trim();
        const si = states.findIndex(s => s.toLowerCase() === cur.toLowerCase());
        const next = states[(si + 1) % states.length];
        stageBadge.textContent = next;
        stageBadge.className = `kanban-stage-btn kanban-stage-${template.stageClass(next)}`;
        emitEdit(rowIdx, cols.stage, next);
      });
      headerMeta.append(stageBadge);

      if (project) {
        headerMeta.append(el('span', {
          className: 'kanban-card-project-badge',
          style: `--project-color: ${projectColor(project)}`,
        }, [project]));
      }

      if (priority) {
        headerMeta.append(el('span', {
          className: `kanban-pri-dot kanban-pri-${priority.toLowerCase().trim()}`,
        }));
      }

      if (due) {
        headerMeta.append(el('span', {
          className: `kanban-card-due ${dueBadgeClass(due)}`,
          title: due,
        }, [formatDue(due)]));
      }

      if (labelVal) {
        headerMeta.append(el('span', {
          className: `kanban-card-label kanban-label-${labelVal.toLowerCase().trim()}`,
        }, [labelVal]));
      }

      if (assignee) {
        const initial = assignee.charAt(0).toUpperCase();
        headerMeta.append(el('span', { className: 'kanban-card-assignee', title: assignee }, [
          el('span', { className: 'kanban-avatar' }, [initial]),
          assignee,
        ]));
      }

      headerContent.append(headerMeta);

      const closeBtn = el('button', { className: 'kanban-modal-close', title: 'Close' }, ['✕']);
      closeBtn.addEventListener('click', () => overlay.remove());

      modal.append(el('div', { className: 'kanban-modal-header' }, [headerContent, closeBtn]));

      /* -- Body: full detail panel -- */
      const body = el('div', { className: 'kanban-modal-body' });
      body.append(buildCardDetail(group, cols, template));
      modal.append(body);

      overlay.append(modal);

      // Close on backdrop click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });

      // Close on Escape (but not while editing an input/textarea)
      function onKey(e) {
        if (e.key === 'Escape') {
          if (e.target.matches('input, textarea')) return;
          overlay.remove();
          document.removeEventListener('keydown', onKey);
        }
      }
      document.addEventListener('keydown', onKey);

      document.body.append(overlay);
    }

    /* ---- Initial build ---- */
    buildBoard();
  },
};

registerTemplate('kanban', definition);
export default definition;

