/* ============================================================
   kanban/index.js — Enhanced Kanban Board (barrel)

   Features: expandable cards, project grouping & filtering,
   sub-tasks, notes with authors, due-date urgency, labels,
   sort within lanes, archive toggle, lane progress.

   Performance: lazy detail rendering, lane-level virtualization,
   delegated event handling for scaling to thousands of items.
   ============================================================ */

import {
  el, cell, emitEdit, registerTemplate, buildAddRowForm,
  parseGroups, delegateEvent, cycleStatus, lazySection, getUserName,
} from '../shared.js';
import { LANE_LABELS, LANE_PAGE_SIZE, projectColor, priRank, STATUS_PREFIX, nowTimestamp, formatRelativeDate } from './helpers.js';
import { buildCard, buildCardDetail } from './cards.js';
import { openCardModal } from './modal.js';

/* ---------- Module state (persists across auto-refresh) ---------- */

let _activeProject = null;
let _activeSort = 'default';
let _showArchived = false;
let _expandedCards = new Set();
/** Collapsed lane keys */
let _collapsedLanes = new Set();
/** Hidden lane keys — lanes not shown at all */
let _hiddenLanes = new Set();
/** Per-lane render counts: how many cards are currently shown */
let _laneRendered = {};

/* ---------- Drag-and-drop state ---------- */

let _dragCard = null;     // DOM element being dragged
let _dragRowIdx = null;   // 1-based row index of dragged card

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
      reporter: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.stage       = lower.findIndex(h => /^(stage|column|lane|board|status|swim)/.test(h) || /backlog|in.?progress|to.?do|doing/.test(h));
    cols.text        = lower.findIndex((h, i) => !used().includes(i) && /^(task|story|ticket|item|feature|issue|title|name)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => !used().includes(i));
    cols.description = lower.findIndex((h, i) => !used().includes(i) && /^(desc|detail|body|summary)/.test(h));
    cols.project     = lower.findIndex((h, i) => !used().includes(i) && /^(project|epic|group|module|sprint|milestone|workstream)/.test(h));
    cols.assignee    = lower.findIndex((h, i) => !used().includes(i) && /^(assign|owner|who|person|dev|member)/.test(h));
    cols.reporter    = lower.findIndex((h, i) => !used().includes(i) && /^(report|created.?by|filed.?by|submitt|author|requester|raised)/.test(h));
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
      { role: 'stage',       label: 'Stage',        colIndex: cols.stage,       type: 'select', options: ['Backlog', 'To Do', 'In Progress', 'QA', 'Done'], defaultValue: 'Backlog' },
      { role: 'project',     label: 'Project',      colIndex: cols.project,     type: 'combo',  placeholder: 'Select or type new…' },
      { role: 'assignee',    label: 'Assignee',     colIndex: cols.assignee,    type: 'combo',  placeholder: 'Select or type new…' },
      { role: 'priority',    label: 'Priority',     colIndex: cols.priority,    type: 'select', options: ['P0', 'P1', 'P2', 'P3'], defaultValue: 'P2' },
      { role: 'due',         label: 'Due Date',     colIndex: cols.due,         type: 'date' },
      { role: 'label',       label: 'Label',        colIndex: cols.label,       type: 'combo',  placeholder: 'Select or type new…' },
      { role: 'reporter',    label: 'Reported By',  colIndex: cols.reporter,    type: 'combo',  placeholder: 'Select or type…' },
    ];
  },

  stageStates: ['Backlog', 'To Do', 'In Progress', 'QA', 'Done', 'Rejected'],

  stageClass(val) {
    const v = (val || '').toLowerCase().trim();
    if (/^(archived|archive)/.test(v)) return 'archived';
    if (/^(reject|declined|refused|denied|wontfix|won't.?fix|invalid)/.test(v)) return 'rejected';
    if (/^(done|complete|finished|closed|shipped)/.test(v)) return 'done';
    if (/^(qa|review|testing|verify|verification)/.test(v)) return 'qa';
    if (/^(in.?progress|doing|active|wip|started)/.test(v)) return 'inprogress';
    if (/^(to.?do|ready|planned|next|queued)/.test(v)) return 'todo';
    return 'backlog';
  },

  /* ---------- Directory View (multi-board summary) ---------- */

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'kanban-directory' });

    // Title bar
    const titleBar = el('div', { className: 'kanban-dir-title-bar' });
    titleBar.append(
      el('span', { className: 'kanban-dir-title-icon' }, ['📋']),
      el('span', { className: 'kanban-dir-title' }, ['Project Boards']),
      el('span', { className: 'kanban-dir-count' }, [`${sheets.length} board${sheets.length !== 1 ? 's' : ''}`]),
    );
    wrapper.append(titleBar);

    // Build entries with stats
    const stageKeys = ['backlog', 'todo', 'inprogress', 'done', 'rejected'];
    const stageLabels = { backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress', done: 'Done', rejected: 'Rejected' };
    const stageColors = { backlog: '#94a3b8', todo: '#3b82f6', inprogress: '#f59e0b', done: '#22c55e', rejected: '#dc2626' };

    const entries = sheets.map(sheet => {
      const cols = sheet.cols;
      const rows = sheet.rows || [];
      const total = rows.length;

      // Count items per stage
      const stageCounts = {};
      for (const key of stageKeys) stageCounts[key] = 0;
      const topPriority = [];

      for (const row of rows) {
        const stageVal = cols.stage >= 0 ? (row[cols.stage] || '') : '';
        const classified = definition.stageClass(stageVal);
        if (classified !== 'archived') {
          stageCounts[classified] = (stageCounts[classified] || 0) + 1;
        }
        // Collect high-priority items (P0, P1)
        if (cols.priority >= 0) {
          const p = (row[cols.priority] || '').toUpperCase();
          if (p === 'P0' || p === 'P1') {
            topPriority.push({
              title: cols.text >= 0 ? (row[cols.text] || '(untitled)') : '(untitled)',
              priority: p,
              stage: stageVal || 'Backlog',
            });
          }
        }
      }

      const activeCount = total - (stageCounts.done || 0) - (stageCounts.rejected || 0);
      const doneCount = stageCounts.done || 0;
      const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

      return { id: sheet.id, name: sheet.name, total, activeCount, doneCount, pct, stageCounts, topPriority: topPriority.slice(0, 3) };
    });

    // Grid
    const grid = el('div', { className: 'kanban-dir-grid' });

    for (const entry of entries) {
      const card = el('div', {
        className: 'kanban-dir-card',
        dataset: { entryId: entry.id, entryName: entry.name },
      });

      // Header
      const header = el('div', { className: 'kanban-dir-card-header' });
      header.append(
        el('span', { className: 'kanban-dir-card-name' }, [entry.name]),
        el('span', { className: 'kanban-dir-card-count' }, [`${entry.total} item${entry.total !== 1 ? 's' : ''}`]),
      );
      card.append(header);

      // Progress bar
      const pctText = `${entry.pct}% complete`;
      const progressWrap = el('div', { className: 'kanban-dir-progress-wrap' });
      progressWrap.append(
        el('div', { className: 'kanban-dir-progress-track' }, [
          el('div', { className: 'kanban-dir-progress-fill', style: `width: ${entry.pct}%` }),
        ]),
        el('span', { className: 'kanban-dir-progress-label' }, [pctText]),
      );
      card.append(progressWrap);

      // Stage bar (stacked horizontal bar)
      const barTotal = Object.values(entry.stageCounts).reduce((a, b) => a + b, 0) || 1;
      const stageBar = el('div', { className: 'kanban-dir-stage-bar' });
      for (const key of stageKeys) {
        const count = entry.stageCounts[key] || 0;
        if (count === 0) continue;
        const widthPct = (count / barTotal) * 100;
        stageBar.append(el('div', {
          className: `kanban-dir-bar-seg kanban-dir-bar-${key}`,
          style: `width: ${widthPct}%; background: ${stageColors[key]}`,
          title: `${stageLabels[key]}: ${count}`,
        }));
      }
      card.append(stageBar);

      // Legend
      const legend = el('div', { className: 'kanban-dir-legend' });
      for (const key of stageKeys) {
        const count = entry.stageCounts[key] || 0;
        if (count === 0) continue;
        legend.append(el('span', { className: 'kanban-dir-legend-item' }, [
          el('span', { className: 'kanban-dir-legend-dot', style: `background: ${stageColors[key]}` }),
          `${stageLabels[key]} ${count}`,
        ]));
      }
      card.append(legend);

      // Top priority items
      if (entry.topPriority.length > 0) {
        const priSection = el('div', { className: 'kanban-dir-priorities' });
        priSection.append(el('span', { className: 'kanban-dir-pri-label' }, ['🔥 Priority']));
        const priList = el('ul', { className: 'kanban-dir-pri-list' });
        for (const item of entry.topPriority) {
          priList.append(el('li', { className: 'kanban-dir-pri-item' }, [
            el('span', { className: `kanban-dir-pri-badge kanban-dir-pri-${item.priority.toLowerCase()}` }, [item.priority]),
            ` ${item.title}`,
          ]));
        }
        priSection.append(priList);
        card.append(priSection);
      }

      grid.append(card);
    }

    // Delegated click on grid cards → navigate to that board
    delegateEvent(grid, 'click', '.kanban-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },

  /* ---------- Main render ---------- */

  render(container, rows, cols, template) {
    const groups = parseGroups(rows, cols.text, {
      initGroup: () => ({ subtasks: [], notes: [] }),
      classifyChild: (child, parent) => {
        const noteVal = cols.note >= 0 ? cell(child.row, cols.note) : '';
        if (noteVal) parent.notes.push(child);
        else parent.subtasks.push(child);
      },
    });

    // Collect unique project names and assignees for combo dropdowns
    const allProjects = cols.project >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.project)).filter(Boolean))].sort()
      : [];
    const allAssignees = cols.assignee >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.assignee)).filter(Boolean))].sort()
      : [];
    const allReporters = cols.reporter >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.reporter)).filter(Boolean))].sort()
      : [];
    // Collect unique labels from data + known defaults
    const knownLabels = ['feature', 'bug', 'infra', 'design', 'docs'];
    const dataLabels = cols.label >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.label)).filter(Boolean))]
      : [];
    const allLabels = [...new Set([...dataLabels, ...knownLabels])].sort();

    /** Shared render context passed to card/modal builders */
    const ctx = { cols, template, allProjects, allAssignees, allReporters, allLabels, expandedCards: _expandedCards };

    // Project filter pills list (same as allProjects for toolbar)
    const projects = allProjects;

    /* ---- Toolbar: filter pills + sort + archive toggle ---- */

    const toolbar = el('div', { className: 'kanban-toolbar' });

    // Project filter pills (delegated on filterBar)
    if (projects.length > 0) {
      const filterBar = el('div', { className: 'kanban-filter-bar' });

      filterBar.append(el('button', {
        className: `kanban-filter-pill ${!_activeProject ? 'active' : ''}`,
        dataset: { project: '' },
      }, ['All']));

      for (const proj of projects) {
        const color = projectColor(proj);
        filterBar.append(el('button', {
          className: `kanban-filter-pill ${_activeProject === proj ? 'active' : ''}`,
          style: `--pill-color: ${color}`,
          dataset: { project: proj },
        }, [proj]));
      }

      // Single delegated listener for all filter pills
      delegateEvent(filterBar, 'click', '.kanban-filter-pill', (e, pill) => {
        const proj = pill.dataset.project;
        _activeProject = proj || null;
        filterBar.querySelectorAll('.kanban-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        updateBoard();
      });

      toolbar.append(filterBar);
    }

    // Sort + Archive controls
    const controls = el('div', { className: 'kanban-controls' });

    const sortLabel = el('label', { className: 'kanban-sort-label' }, ['Sort:']);
    const sortSelect = el('select', { className: 'kanban-sort-select' });
    [['default', 'Default'], ['priority', 'Priority'], ['due', 'Due Date'], ['reporter', 'Reporter']].forEach(([val, txt]) => {
      const opt = el('option', { value: val }, [txt]);
      if (val === _activeSort) opt.selected = true;
      sortSelect.append(opt);
    });
    sortSelect.addEventListener('change', () => { _activeSort = sortSelect.value; updateBoard(); });
    controls.append(sortLabel, sortSelect);

    const archiveLabel = el('label', { className: 'kanban-archive-toggle' });
    const archiveCheck = el('input', { type: 'checkbox', className: 'kanban-archive-checkbox' });
    archiveCheck.checked = _showArchived;
    archiveCheck.addEventListener('change', () => { _showArchived = archiveCheck.checked; updateBoard(); });
    archiveLabel.append(archiveCheck, ' Show Archived');
    controls.append(archiveLabel);

    // Lane visibility toggle
    const laneVisWrap = el('div', { className: 'kanban-lane-vis-wrap' });
    const laneVisBtn = el('button', { className: 'kanban-lane-vis-btn', title: 'Show/hide lanes' }, ['⚙ Lanes']);
    const laneVisPanel = el('div', { className: 'kanban-lane-vis-panel hidden' });

    const coreLanes = ['backlog', 'todo', 'inprogress', 'qa', 'done', 'rejected'];
    for (const lk of coreLanes) {
      const lbl = el('label', { className: 'kanban-lane-vis-item' });
      const cb = el('input', { type: 'checkbox', dataset: { lane: lk } });
      cb.checked = !_hiddenLanes.has(lk);
      cb.addEventListener('change', () => {
        if (cb.checked) _hiddenLanes.delete(lk);
        else _hiddenLanes.add(lk);
        updateBoard();
      });
      lbl.append(cb, ` ${LANE_LABELS[lk]}`);
      laneVisPanel.append(lbl);
    }

    laneVisBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      laneVisPanel.classList.toggle('hidden');
    });
    // Close panel on outside click
    document.addEventListener('click', (e) => {
      if (!laneVisWrap.contains(e.target)) laneVisPanel.classList.add('hidden');
    });
    laneVisWrap.append(laneVisBtn, laneVisPanel);
    controls.append(laneVisWrap);

    toolbar.append(controls);

    /* ---- AI agent status indicator ---- */
    if (cols.assignee >= 0 && cols.due >= 0) {
      let latestAIDateStr = '';
      let latestAIAuthor = '';
      // Scan all sub-rows (notes + subtasks) for AI-authored entries
      for (const group of groups) {
        for (const child of [...group.notes, ...group.subtasks]) {
          const a = cell(child.row, cols.assignee);
          if (a && a.toLowerCase() === 'ai') {
            const d = cell(child.row, cols.due);
            if (d && d > latestAIDateStr) {
              latestAIDateStr = d;
              latestAIAuthor = a;
            }
          }
        }
      }
      // Also check task rows assigned to AI
      if (!latestAIDateStr) {
        for (const group of groups) {
          const a = cell(group.row, cols.assignee);
          if (a && a.toLowerCase() === 'ai') {
            const d = cell(group.row, cols.due);
            if (d && d > latestAIDateStr) {
              latestAIDateStr = d;
              latestAIAuthor = a;
            }
          }
        }
      }

      if (latestAIDateStr) {
        const hasTime = /\d{2}:\d{2}/.test(latestAIDateStr);
        const aiDate = hasTime ? new Date(latestAIDateStr.replace(' ', 'T')) : new Date(latestAIDateStr + 'T00:00:00');
        if (!isNaN(aiDate.getTime())) {
          const isActive = (Date.now() - aiDate.getTime()) < 15 * 60 * 1000;
          toolbar.append(el('div', {
            className: `kanban-ai-status ${isActive ? 'kanban-ai-active' : 'kanban-ai-offline'}`,
          }, [
            el('span', { className: 'kanban-ai-dot' }),
            el('span', {}, [isActive ? '🤖 AI Active' : '🤖 AI Offline']),
            el('span', { className: 'kanban-ai-time' }, [
              `Last: ${latestAIAuthor} · ${formatRelativeDate(latestAIDateStr)}`,
            ]),
          ]));
        }
      }
    }

    container.append(toolbar);

    /* ---- Board element ---- */

    const boardEl = el('div', { className: 'kanban-board' });
    container.append(boardEl);

    // Build a lookup from group index to group for delegated events
    const groupMap = new Map();
    for (const g of groups) groupMap.set(g.idx + 1, g);

    /**
     * Insert a status-change note sub-row below a card's group.
     * Bundles the stage change atomically with the note insertion to
     * prevent the replaceSheetData call from reverting the stage edit.
     *
     * @param {number} rowIdx — 1-based row index of the card
     * @param {string} fromStage — previous stage label
     * @param {string} toStage — new stage label
     * @returns {boolean} true if the note was inserted (stage is bundled)
     */
    function insertStageNote(rowIdx, fromStage, toStage) {
      if (typeof template._onInsertAfterRow !== 'function') return false;
      if (cols.note < 0) return false;
      const group = groupMap.get(rowIdx);
      if (!group) return false;

      const lastIdx = Math.max(
        group.idx,
        ...group.subtasks.map(s => s.idx),
        ...group.notes.map(n => n.idx),
      );
      const afterValuesIdx = lastIdx + 1;

      const newRow = new Array(template._totalColumns || 0).fill('');
      if (cols.note >= 0) newRow[cols.note] = `${STATUS_PREFIX}${fromStage || 'Backlog'} → ${toStage}`;
      if (cols.assignee >= 0) newRow[cols.assignee] = getUserName() || 'System';
      if (cols.due >= 0) newRow[cols.due] = nowTimestamp();

      // Bundle the stage change as a pending edit so it's written atomically
      // with the note row — prevents replaceSheetData from reverting the stage.
      // Note: group.idx is 0-based in data rows (header excluded), but
      // _onInsertAfterRow operates on the full values array (header at [0]),
      // so we add 1 to account for the header row.
      const pendingEdits = [];
      if (cols.stage >= 0) {
        pendingEdits.push({ rowIdx: group.idx + 1, colIdx: cols.stage, value: toStage });
      }
      template._onInsertAfterRow(afterValuesIdx, [newRow], pendingEdits);
      return true;
    }

    // Card element cache: avoids recreating DOM on filter/sort
    const cardCache = new Map();

    /** Pre-build card elements for all groups */
    function getCardEl(group, laneKey) {
      const key = `${group.idx + 1}-${laneKey}`;
      if (cardCache.has(key)) return cardCache.get(key);
      const cardEl = buildCard(group, ctx, laneKey);
      cardCache.set(key, cardEl);
      return cardEl;
    }

    /** Stable lane references for reuse across updates */
    const laneEls = {};
    const laneBodyEls = {};

    function buildLaneSkeleton(laneKey) {
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
          // Capture previous stage from badge before updating
          const prevBadge = _dragCard ? _dragCard.querySelector('.kanban-stage-btn') : null;
          const prevStage = prevBadge ? prevBadge.textContent.trim() : '';
          // Bundle both the stage change and the note insertion atomically
          const noteInserted = (prevStage && prevStage !== stageValue)
            ? insertStageNote(_dragRowIdx, prevStage, stageValue)
            : false;
          if (!noteInserted) emitEdit(_dragRowIdx, cols.stage, stageValue);
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

      /* ---- Delegated click handlers on lane ---- */

      // Stage badge dropdown — shows available stages to pick from
      delegateEvent(lane, 'click', '.kanban-stage-btn', (e, btn) => {
        const card = btn.closest('.kanban-card');
        if (!card) return;
        e.stopPropagation();
        const rowIdx = Number(card.dataset.rowIdx);
        if (!rowIdx) return;

        // If a dropdown already exists, close it
        const existing = btn.parentElement.querySelector('.kanban-stage-dropdown');
        if (existing) { existing.remove(); return; }

        // Close any other open stage dropdowns
        document.querySelectorAll('.kanban-stage-dropdown').forEach(d => d.remove());

        const current = btn.textContent.trim();
        const dropdown = el('div', { className: 'kanban-stage-dropdown' });
        for (const state of template.stageStates) {
          const cls = template.stageClass(state);
          const item = el('button', {
            className: `kanban-stage-dropdown-item kanban-stage-${cls}${state === current ? ' active' : ''}`,
          }, [state]);
          item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            dropdown.remove();
            if (state === current) return;
            btn.textContent = state;
            btn.className = `kanban-stage-btn kanban-stage-${cls}`;
            const noteInserted = insertStageNote(rowIdx, current, state);
            if (!noteInserted) emitEdit(rowIdx, cols.stage, state);
          });
          dropdown.append(item);
        }
        btn.parentElement.style.position = 'relative';
        btn.parentElement.append(dropdown);

        // Close on outside click
        const closeDropdown = (ev) => {
          if (!dropdown.contains(ev.target) && ev.target !== btn) {
            dropdown.remove();
            document.removeEventListener('click', closeDropdown, true);
          }
        };
        setTimeout(() => document.addEventListener('click', closeDropdown, true), 0);
      });

      // Priority dot cycling
      const priStates = ['P0', 'P1', 'P2', 'P3'];
      const priClassify = v => (v || '').toLowerCase().trim();
      delegateEvent(lane, 'click', '.kanban-pri-dot', (e, dot) => {
        const card = dot.closest('.kanban-card');
        if (!card) return;
        e.stopPropagation();
        const rowIdx = Number(card.dataset.rowIdx);
        if (!rowIdx || cols.priority < 0) return;
        const next = cycleStatus(dot, priStates, priClassify, 'kanban-pri-dot kanban-pri-');
        dot.title = `Priority: ${next} (click to change)`;
        emitEdit(rowIdx, cols.priority, next);
      });

      // Archive button
      delegateEvent(lane, 'click', '.kanban-archive-btn', (e, btn) => {
        e.stopPropagation();
        const card = btn.closest('.kanban-card');
        const rowIdx = Number(card.dataset.rowIdx);
        if (!rowIdx) return;
        const prevBadge = card.querySelector('.kanban-stage-btn');
        const prev = prevBadge ? prevBadge.textContent.trim() : LANE_LABELS[laneKey] || laneKey;
        card.classList.add('kanban-card-archiving');
        setTimeout(() => card.remove(), 300);
        if (!insertStageNote(rowIdx, prev, 'Archived')) emitEdit(rowIdx, cols.stage, 'Archived');
      });

      // Unarchive / Restore button
      delegateEvent(lane, 'click', '.kanban-unarchive-btn', (e, btn) => {
        e.stopPropagation();
        const card = btn.closest('.kanban-card');
        const rowIdx = Number(card.dataset.rowIdx);
        if (!rowIdx) return;
        const prev = LANE_LABELS[laneKey] || laneKey;
        card.classList.add('kanban-card-archiving');
        setTimeout(() => card.remove(), 300);
        // Restore rejected tickets to Backlog, archived tickets to Done
        const destination = laneKey === 'rejected' ? 'Backlog' : 'Done';
        if (!insertStageNote(rowIdx, prev, destination)) emitEdit(rowIdx, cols.stage, destination);
      });

      // Reject button
      delegateEvent(lane, 'click', '.kanban-reject-btn', (e, btn) => {
        e.stopPropagation();
        const card = btn.closest('.kanban-card');
        const rowIdx = Number(card.dataset.rowIdx);
        if (!rowIdx) return;
        const prevBadge = card.querySelector('.kanban-stage-btn');
        const prev = prevBadge ? prevBadge.textContent.trim() : LANE_LABELS[laneKey] || laneKey;
        card.classList.add('kanban-card-archiving');
        setTimeout(() => card.remove(), 300);
        if (!insertStageNote(rowIdx, prev, 'Rejected')) emitEdit(rowIdx, cols.stage, 'Rejected');
      });

      // Open modal button
      delegateEvent(lane, 'click', '.kanban-card-open', (e, btn) => {
        e.stopPropagation();
        const card = btn.closest('.kanban-card');
        const rowIdx = Number(card.dataset.rowIdx);
        const group = groupMap.get(rowIdx);
        if (group) openCardModal(group, ctx);
      });

      // Expand/collapse button
      delegateEvent(lane, 'click', '.kanban-card-expand', (e, btn) => {
        e.stopPropagation();
        const card = btn.closest('.kanban-card');
        const rowIdx = Number(card.dataset.rowIdx);
        if (!rowIdx) return;
        const expanded = _expandedCards.has(rowIdx);

        if (expanded) {
          _expandedCards.delete(rowIdx);
          const detail = card.querySelector('.kanban-card-detail');
          if (detail) detail.classList.add('hidden');
          card.classList.remove('kanban-card-expanded');
          btn.textContent = '▾';
        } else {
          _expandedCards.add(rowIdx);
          // Lazy detail rendering: build on first expand
          const group = groupMap.get(rowIdx);
          if (group) {
            lazySection(card, '.kanban-card-detail', () => buildCardDetail(group, ctx));
          }
          card.classList.add('kanban-card-expanded');
          btn.textContent = '▴';
        }
      });

      /* ---- Delegated drag handlers on lane (dragstart / dragend bubble) ---- */
      delegateEvent(lane, 'dragstart', '.kanban-card', (e, card) => {
        _dragCard = card;
        _dragRowIdx = Number(card.dataset.rowIdx);
        card.classList.add('kanban-card-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(_dragRowIdx));
      });
      delegateEvent(lane, 'dragend', '.kanban-card', (e, card) => {
        card.classList.remove('kanban-card-dragging');
        document.querySelectorAll('.kanban-lane-dragover').forEach(l => l.classList.remove('kanban-lane-dragover'));
        _dragCard = null;
        _dragRowIdx = null;
      });

      // Card body container (cleared on filter/sort, not the lane itself)
      const laneBody = el('div', { className: 'kanban-lane-body' });
      lane.append(laneBody);

      // Per-lane add button
      if (typeof template._onAddRow === 'function' && typeof template.addRowFields === 'function') {
        const laneForm = buildAddRowForm(template, cols, template._totalColumns || 0, template._onAddRow, {
          defaults: { stage: LANE_LABELS[laneKey] || laneKey, project: _activeProject || '' },
          dynamicOptions: {
            project: ['', ...allProjects],
            assignee: ['', ...allAssignees],
            reporter: ['', ...allReporters],
            label: ['', ...allLabels],
          },
        });
        laneForm.classList.add('add-row-lane');
        lane.append(laneForm);
      }

      laneEls[laneKey] = lane;
      laneBodyEls[laneKey] = laneBody;
      return lane;
    }

    /** All possible lane keys */
    const allLaneKeys = ['backlog', 'todo', 'inprogress', 'qa', 'done', 'rejected', 'archived'];

    // Build lane skeletons once (delegated handlers survive across updates)
    for (const laneKey of allLaneKeys) {
      buildLaneSkeleton(laneKey);
    }

    /**
     * Update the board: toggle lane visibility, populate cards, update counts.
     * Reuses cached card elements — avoids full DOM rebuild on filter/sort.
     */
    function updateBoard() {
      // Determine visible lanes
      const allLanes = _showArchived
        ? ['backlog', 'todo', 'inprogress', 'qa', 'done', 'rejected', 'archived']
        : ['backlog', 'todo', 'inprogress', 'qa', 'done', 'rejected'];
      const laneOrder = allLanes.filter(lk => !_hiddenLanes.has(lk));

      // Update grid class based on visible lane count
      const visibleCount = laneOrder.length;
      for (let i = 1; i <= 7; i++) boardEl.classList.toggle(`kanban-board-${i}`, visibleCount === i);

      // Detach all lanes, then re-append in order (preserves skeleton)
      boardEl.innerHTML = '';

      // Filter by project
      const filtered = _activeProject
        ? groups.filter(g => cell(g.row, cols.project) === _activeProject)
        : groups;

      // Progress stats
      const totalParent = filtered.length;
      const doneParent = filtered.filter(g => template.stageClass(cell(g.row, cols.stage)) === 'done').length;

      for (const laneKey of laneOrder) {
        const lane = laneEls[laneKey];
        const laneBody = laneBodyEls[laneKey];

        let items = filtered.filter(g => template.stageClass(cell(g.row, cols.stage)) === laneKey);

        // Sort
        if (_activeSort === 'priority') {
          items.sort((a, b) => priRank(cell(a.row, cols.priority)) - priRank(cell(b.row, cols.priority)));
        } else if (_activeSort === 'due') {
          items.sort((a, b) => (cell(a.row, cols.due) || 'z').localeCompare(cell(b.row, cols.due) || 'z'));
        } else if (_activeSort === 'reporter') {
          items.sort((a, b) => (cell(a.row, cols.reporter) || 'z').localeCompare(cell(b.row, cols.reporter) || 'z'));
        }

        // Update lane header: remove old header, insert new one
        const oldHeader = lane.querySelector('.kanban-lane-header');
        if (oldHeader) oldHeader.remove();

        const headerChildren = [
          el('button', {
            className: 'kanban-lane-collapse',
            title: _collapsedLanes.has(laneKey) ? 'Expand lane' : 'Collapse lane',
          }, [_collapsedLanes.has(laneKey) ? '▸' : '▾']),
          el('span', { className: 'kanban-lane-title' }, [LANE_LABELS[laneKey] || laneKey]),
          el('span', { className: 'kanban-lane-count' }, [String(items.length)]),
        ];
        if (laneKey === 'done' && totalParent > 0) {
          const pct = Math.round((doneParent / totalParent) * 100);
          headerChildren.push(el('div', { className: 'kanban-lane-progress' }, [
            el('div', { className: 'kanban-lane-progress-bar', style: `width: ${pct}%` }),
          ]));
        }
        lane.insertBefore(el('div', { className: 'kanban-lane-header' }, headerChildren), lane.firstChild);

        // Apply collapsed state
        const isCollapsed = _collapsedLanes.has(laneKey);
        lane.classList.toggle('kanban-lane-collapsed', isCollapsed);
        laneBody.classList.toggle('hidden', isCollapsed);
        const addForm = lane.querySelector('.add-row-lane');
        if (addForm) addForm.classList.toggle('hidden', isCollapsed);

        // Collapse toggle (delegated on header)
        const collapseBtn = lane.querySelector('.kanban-lane-collapse');
        if (collapseBtn) {
          collapseBtn.onclick = (e) => {
            e.stopPropagation();
            if (_collapsedLanes.has(laneKey)) _collapsedLanes.delete(laneKey);
            else _collapsedLanes.add(laneKey);
            updateBoard();
          };
        }

        // Clear lane body and re-populate with cached card elements
        laneBody.innerHTML = '';

        const limit = _laneRendered[laneKey] || LANE_PAGE_SIZE;
        const visibleItems = items.slice(0, limit);
        const remaining = items.length - visibleItems.length;

        for (const group of visibleItems) {
          laneBody.append(getCardEl(group, laneKey));
        }

        if (remaining > 0) {
          const showMoreBtn = el('button', { className: 'kanban-show-more' }, [
            `Show ${Math.min(remaining, LANE_PAGE_SIZE)} more of ${remaining} remaining`,
          ]);
          showMoreBtn.addEventListener('click', () => {
            _laneRendered[laneKey] = limit + LANE_PAGE_SIZE;
            updateBoard();
          });
          laneBody.append(showMoreBtn);
        }

        boardEl.append(lane);
      }
    }

    /* ---- Initial build ---- */
    updateBoard();
  },
};

registerTemplate('kanban', definition);
export default definition;
