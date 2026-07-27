/* ============================================================
   templates/rfi.js — Construction RFI: Enterprise Kanban Board
   ============================================================ */

import {
  el, cell, editableCell, emitEdit, registerTemplate, buildDirSyncBtn,
  delegateEvent, parseGroups, buildAddRowForm, cycleStatus, lazySection,
  getUserName, isEditLocked, showToast, comboCell, textareaCell,
} from './shared.js';

const STATUS_CYCLE = ['Draft', 'Open', 'Pending', 'Closed'];
const PALETTE = ['#0284c7', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#d97706', '#0d9488', '#16a34a'];

/* ---------- Pure Helper Functions ---------- */

function assigneeColor(name) {
  if (!name) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function dueBadgeClass(dateStr) {
  if (!dateStr) return '';
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = (due - now) / (86400000);
  if (diff < 0) return 'rfi-due-overdue';
  if (diff < 2) return 'rfi-due-soon';
  if (diff < 7) return 'rfi-due-upcoming';
  return 'rfi-due-later';
}

function formatDue(dateStr) {
  if (!dateStr) return '';
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return dateStr;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((due - now) / (86400000));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `${diff}d`;
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- History-Aware Focus Modal ---------- */

let _activePopHandler = null;
let _hasModalHistoryEntry = false;

function openRfiModal(group, ctx) {
  const { cols, template, allAssignees } = ctx;
  const existing = document.querySelector('.rfi-modal-overlay');
  if (existing) {
    existing.remove();
    if (_activePopHandler) { window.removeEventListener('popstate', _activePopHandler); _activePopHandler = null; }
  }

  const { row, idx } = group;
  const rowIdx = idx + 1;
  const rfiNum = cell(row, cols.rfiNumber) || 'RFI-?';
  const subject = cell(row, cols.subject) || '—';
  const status = cell(row, cols.status) || 'Draft';
  const assigned = cols.assignedTo >= 0 ? cell(row, cols.assignedTo) : '';
  const due = cols.responseDue >= 0 ? cell(row, cols.responseDue) : '';
  const response = cols.officialResponse >= 0 ? cell(row, cols.officialResponse) : '';

  const overlay = el('div', { className: 'rfi-modal-overlay' });
  const modal = el('div', { className: 'rfi-modal' });
  const headerContent = el('div', { className: 'rfi-modal-header-content' });

  const titleWrap = el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } }, [
    editableCell('span', { className: 'rfi-modal-num' }, rfiNum, rowIdx, cols.rfiNumber),
    editableCell('span', { className: 'rfi-modal-title' }, subject, rowIdx, cols.subject),
  ]);
  headerContent.append(titleWrap);

  const headerMeta = el('div', { className: 'rfi-modal-header-meta' });
  const stageBadge = el('button', { className: `rfi-status-btn ${status.toLowerCase()}`, title: 'Click to change status' }, [status]);
  stageBadge.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isEditLocked()) return;
    const nextIdx = (STATUS_CYCLE.indexOf(stageBadge.textContent.trim()) + 1) % STATUS_CYCLE.length;
    const nextStatus = STATUS_CYCLE[nextIdx];
    stageBadge.textContent = nextStatus;
    stageBadge.className = `rfi-status-btn ${nextStatus.toLowerCase()}`;
    emitEdit(rowIdx, cols.status, nextStatus);
  });
  headerMeta.append(stageBadge);

  if (assigned) {
    headerMeta.append(el('span', { className: 'rfi-card-assignee', title: assigned }, [
      el('span', { className: 'rfi-avatar', style: { background: assigneeColor(assigned) } }, [assigned.charAt(0).toUpperCase()]),
      assigned,
    ]));
  }
  if (due) headerMeta.append(el('span', { className: `rfi-card-due ${dueBadgeClass(due)}`, title: due }, [formatDue(due)]));
  headerContent.append(headerMeta);

  const closeBtn = el('button', { className: 'rfi-modal-close', title: 'Close' }, ['✕']);
  function closeModal() {
    if (overlay.parentNode) overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (_activePopHandler) { window.removeEventListener('popstate', _activePopHandler); _activePopHandler = null; }
  }
  function closeFromUI() {
    closeModal();
    if (_hasModalHistoryEntry) { _hasModalHistoryEntry = false; history.back(); }
  }
  closeBtn.addEventListener('click', () => closeFromUI());
  modal.append(el('div', { className: 'rfi-modal-header' }, [headerContent, closeBtn]));

  const body = el('div', { className: 'rfi-modal-body' });
  body.append(buildRfiDetail(group, ctx));
  modal.append(body);
  overlay.append(modal);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFromUI(); });
  function onKey(e) { if (e.key === 'Escape' && !e.target.matches('input, textarea')) closeFromUI(); }
  document.addEventListener('keydown', onKey);

  if (!_hasModalHistoryEntry) { history.pushState({ rfiModal: true }, ''); _hasModalHistoryEntry = true; }
  function onPopState() { _hasModalHistoryEntry = false; closeModal(); }
  _activePopHandler = onPopState;
  window.addEventListener('popstate', onPopState);
  document.body.append(overlay);
}

/* ---------- Card & Detail Builders ---------- */

function buildRfiDetail(group, ctx) {
  const { cols, allAssignees } = ctx;
  const { row, idx } = group;
  const rowIdx = idx + 1;
  const detail = el('div', { className: 'rfi-card-detail' });

  const metaGrid = el('div', { className: 'rfi-detail-meta' });
  if (cols.assignedTo >= 0) {
    metaGrid.append(el('div', { className: 'rfi-detail-field' }, [
      el('span', { className: 'rfi-detail-field-label' }, ['Assigned To']),
      comboCell('span', { className: 'rfi-detail-field-value' }, cell(row, cols.assignedTo), rowIdx, cols.assignedTo, allAssignees),
    ]));
  }
  if (cols.responseDue >= 0) {
    metaGrid.append(el('div', { className: 'rfi-detail-field' }, [
      el('span', { className: 'rfi-detail-field-label' }, ['Response Due']),
      editableCell('span', { className: 'rfi-detail-field-value' }, cell(row, cols.responseDue), rowIdx, cols.responseDue),
    ]));
  }
  if (metaGrid.children.length > 0) detail.append(metaGrid);

  if (cols.officialResponse >= 0) {
    detail.append(el('div', { className: 'rfi-detail-section' }, [
      el('div', { className: 'rfi-detail-label' }, ['Official Response']),
      textareaCell('div', { className: 'rfi-detail-desc rfi-response-box' }, cell(row, cols.officialResponse) || 'Click to enter official response...', rowIdx, cols.officialResponse),
    ]));
  }

  if (group.notes.length > 0 || cols.note >= 0) {
    const noteSection = el('div', { className: 'rfi-detail-section' }, [el('div', { className: 'rfi-detail-label' }, ['Discussion & Notes'])]);
    const noteList = el('div', { className: 'rfi-note-list' });
    for (const n of group.notes) {
      const nRowIdx = n.idx + 1;
      const noteText = cell(n.row, cols.note);
      const noteBy = cols.assignedTo >= 0 ? cell(n.row, cols.assignedTo) : '';
      const noteDate = cols.responseDue >= 0 ? cell(n.row, cols.responseDue) : '';
      noteList.append(el('div', { className: 'rfi-note' }, [
        el('div', { className: 'rfi-note-header' }, [
          el('span', { className: 'rfi-note-author' }, [noteBy || 'Anonymous']),
          noteDate ? el('span', { className: 'rfi-note-date' }, [noteDate]) : null,
        ]),
        textareaCell('div', { className: 'rfi-note-text' }, noteText, nRowIdx, cols.note),
      ]));
    }
    noteSection.append(noteList);

    if (cols.note >= 0 && typeof ctx.template._onInsertAfterRow === 'function') {
      const addTrigger = el('button', { className: 'rfi-add-inline-trigger' }, ['+ Note']);
      const addForm = el('div', { className: 'rfi-add-note-form hidden' });
      const noteInput = el('textarea', { className: 'rfi-add-inline-input', placeholder: 'Add discussion note...', rows: '2' });
      const nameInput = el('input', { type: 'text', className: 'rfi-add-inline-input', placeholder: 'Your name', value: getUserName(), style: { maxWidth: '120px' } });
      const addBtn = el('button', { className: 'rfi-add-inline-btn' }, ['Add']);

      function submitNote() {
        const val = noteInput.value.trim();
        if (!val) return;
        const lastIdx = Math.max(group.idx, ...group.notes.map(n => n.idx));
        const newRow = new Array(ctx.template._totalColumns || 0).fill('');
        newRow[cols.note] = val;
        if (cols.assignedTo >= 0) newRow[cols.assignedTo] = nameInput.value.trim();
        if (cols.responseDue >= 0) newRow[cols.responseDue] = nowTimestamp();
        noteInput.value = '';
        addForm.classList.add('hidden');
        addTrigger.classList.remove('hidden');
        ctx.template._onInsertAfterRow(lastIdx + 1, [newRow]);
      }

      noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitNote(); } });
      addBtn.addEventListener('click', submitNote);
      addTrigger.addEventListener('click', () => { addTrigger.classList.add('hidden'); addForm.classList.remove('hidden'); noteInput.focus(); });
      addForm.append(noteInput, nameInput, addBtn);
      noteSection.append(addTrigger, addForm);
    }
    detail.append(noteSection);
  }

  return detail;
}

function buildCard(group, ctx) {
  const { cols, expandedCards } = ctx;
  const { row, idx } = group;
  const rowIdx = idx + 1;
  const rfiNum = cell(row, cols.rfiNumber) || 'RFI-?';
  const subject = cell(row, cols.subject) || '—';
  const status = cell(row, cols.status) || 'Draft';
  const assigned = cols.assignedTo >= 0 ? cell(row, cols.assignedTo) : '';
  const due = cols.responseDue >= 0 ? cell(row, cols.responseDue) : '';
  const response = cols.officialResponse >= 0 ? cell(row, cols.officialResponse) : '';
  const hasNotes = group.notes.length > 0;
  const hasDetail = response || hasNotes || assigned || due;

  const card = el('div', { className: 'rfi-card', draggable: 'true' });
  card.dataset.rowIdx = String(rowIdx);
  if (assigned) card.style.borderLeftColor = assigneeColor(assigned);
  if (expandedCards.has(rowIdx)) card.classList.add('rfi-card-expanded');

  const cardHeader = el('div', { className: 'rfi-card-header' });
  cardHeader.append(
    editableCell('span', { className: 'rfi-card-num' }, rfiNum, rowIdx, cols.rfiNumber),
    editableCell('span', { className: 'rfi-card-title' }, subject, rowIdx, cols.subject),
    el('button', { className: 'rfi-card-open', title: 'Open in focus modal' }, ['⛶'])
  );
  if (hasDetail) cardHeader.append(el('button', { className: 'rfi-card-expand', title: 'Expand details' }, [expandedCards.has(rowIdx) ? '▴' : '▾']));
  card.append(cardHeader);

  const preview = el('div', { className: 'rfi-card-preview' });
  if (response) preview.append(el('div', { className: 'rfi-card-desc' }, [response]));

  const meta = el('div', { className: 'rfi-card-meta' });
  meta.append(el('button', { className: `rfi-status-btn ${status.toLowerCase()}`, title: 'Click to change status' }, [status]));

  if (assigned) {
    meta.append(el('span', { className: 'rfi-card-assignee', title: assigned }, [
      el('span', { className: 'rfi-avatar', style: { background: assigneeColor(assigned) } }, [assigned.charAt(0).toUpperCase()]),
      assigned,
    ]));
  }
  if (due) meta.append(el('span', { className: `rfi-card-due ${dueBadgeClass(due)}`, title: due }, [formatDue(due)]));
  if (hasNotes) meta.append(el('span', { className: 'rfi-card-subtask-count' }, [`💬 ${group.notes.length}`]));

  preview.append(meta);
  card.append(preview);

  if (hasDetail && expandedCards.has(rowIdx)) card.append(buildRfiDetail(group, ctx));
  return card;
}

/* ---------- Main Template Definition ---------- */

let _activeAssignee = null;
let _activeSort = 'default';
let _expandedCards = new Set();
let _collapsedLanes = new Set();
let _dragCard = null, _dragRowIdx = null;
let _touchCard = null, _touchRowIdx = null, _touchLongPressTimer = null, _touchStartX = 0, _touchStartY = 0, _touchDragActive = false;

function _handleTouchMove(e) {
  if (!_touchDragActive || !_touchCard) return;
  e.preventDefault();
  const t = e.touches[0];
  _touchCard.style.visibility = 'hidden';
  const target = document.elementFromPoint(t.clientX, t.clientY);
  _touchCard.style.visibility = '';
  document.querySelectorAll('.rfi-lane-dragover').forEach(l => l.classList.remove('rfi-lane-dragover'));
  const lane = target && target.closest('.rfi-column');
  if (lane) lane.classList.add('rfi-lane-dragover');
}

function _handleTouchEnd(e) {
  clearTimeout(_touchLongPressTimer);
  document.removeEventListener('touchmove', _handleTouchMove);
  document.removeEventListener('touchend', _handleTouchEnd);
  document.body.classList.remove('rfi-touch-dragging');
  document.querySelectorAll('.rfi-lane-dragover').forEach(l => l.classList.remove('rfi-lane-dragover'));

  if (_touchCard && _touchDragActive && _touchRowIdx != null) {
    const t = e.changedTouches[0];
    _touchCard.style.visibility = 'hidden';
    const target = document.elementFromPoint(t.clientX, t.clientY);
    _touchCard.style.visibility = '';
    const lane = target && target.closest('.rfi-column');
    if (lane && lane.dataset.status) {
      const nextStatus = lane.dataset.status;
      const prevBadge = _touchCard.querySelector('.rfi-status-btn');
      if (prevBadge && prevBadge.textContent.trim() !== nextStatus) {
        emitEdit(_touchRowIdx, Number(lane.dataset.statusCol), nextStatus);
        prevBadge.textContent = nextStatus;
        prevBadge.className = `rfi-status-btn ${nextStatus.toLowerCase()}`;
      }
    }
  }
  if (_touchCard) _touchCard.classList.remove('rfi-card-dragging');
  _touchCard = null; _touchRowIdx = null; _touchDragActive = false;
}

const definition = {
  name: 'Construction RFI',
  icon: '📋',
  color: '#0284c7',
  priority: 25,
  itemNoun: 'RFI',
  defaultHeaders: ['RFI Number', 'Subject', 'Status', 'Assigned To', 'Response Due', 'Official Response', 'Note'],

  detect(lower) {
    return lower.some(h => /^(rfi|rfi\s*number|reference|id)/.test(h)) && lower.some(h => /^(status|state|stage)/.test(h));
  },

  columns(lower) {
    const cols = { rfiNumber: -1, subject: -1, status: -1, assignedTo: -1, responseDue: -1, officialResponse: -1, note: -1 };
    cols.rfiNumber        = lower.findIndex(h => /^(rfi|rfi\s*number|reference|id)/.test(h));
    cols.status           = lower.findIndex(h => /^(status|state|stage)/.test(h));
    cols.subject          = lower.findIndex((h, i) => i !== cols.rfiNumber && i !== cols.status && /^(subject|question|title|topic|summary)/.test(h));
    if (cols.subject === -1) cols.subject = lower.findIndex((_, i) => i !== cols.rfiNumber && i !== cols.status);
    cols.assignedTo       = lower.findIndex(h => /^(assigned|assignee|owner|dri|to)/.test(h));
    cols.responseDue      = lower.findIndex(h => /^(due|response\s*due|deadline|date)/.test(h));
    cols.officialResponse = lower.findIndex(h => /^(official\s*response|response|answer|reply|solution)/.test(h));
    cols.note             = lower.findIndex(h => /^(note|comment|remark|discussion)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'rfiNumber',        label: 'RFI Number',        colIndex: cols.rfiNumber,        type: 'text',   placeholder: 'e.g. RFI-001', required: true },
      { role: 'subject',          label: 'Subject',           colIndex: cols.subject,          type: 'text',   placeholder: 'Question or subject', required: true },
      { role: 'status',           label: 'Status',            colIndex: cols.status,           type: 'select', options: STATUS_CYCLE, defaultValue: 'Open' },
      { role: 'assignedTo',       label: 'Assigned To',       colIndex: cols.assignedTo,       type: 'combo',  placeholder: 'Select or type name...' },
      { role: 'responseDue',      label: 'Response Due',      colIndex: cols.responseDue,      type: 'date' },
      { role: 'officialResponse', label: 'Official Response', colIndex: cols.officialResponse, type: 'text',   placeholder: 'Enter answer...' },
    ];
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'rfi-directory' });
    const titleBar = el('div', { className: 'rfi-dir-title-bar' }, [
      el('span', { className: 'rfi-dir-icon' }, ['📋']),
      el('span', { className: 'rfi-dir-title' }, ['Construction RFI Boards']),
      el('span', { className: 'rfi-dir-count' }, [`${sheets.length} board${sheets.length !== 1 ? 's' : ''}`]),
      buildDirSyncBtn(wrapper),
    ]);
    wrapper.append(titleBar);

    const grid = el('div', { className: 'rfi-dir-grid' });
    const colors = { Draft: '#94a3b8', Open: '#3b82f6', Pending: '#f59e0b', Closed: '#22c55e' };

    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      const total = rows.length;
      const counts = { Draft: 0, Open: 0, Pending: 0, Closed: 0 };
      for (const row of rows) {
        const s = sheet.cols.status >= 0 ? (row[sheet.cols.status] || 'Draft') : 'Draft';
        if (counts[s] !== undefined) counts[s]++;
      }
      const closed = counts.Closed || 0;
      const pct = total > 0 ? Math.round((closed / total) * 100) : 0;

      const card = el('div', { className: 'rfi-dir-card', dataset: { entryId: sheet.id, entryName: sheet.name } }, [
        el('div', { className: 'rfi-dir-card-header' }, [
          el('span', { className: 'rfi-dir-card-name' }, [sheet.name]),
          el('span', { className: 'rfi-dir-card-count' }, [`${total} RFI${total !== 1 ? 's' : ''}`]),
        ]),
        el('div', { className: 'rfi-dir-progress-wrap' }, [
          el('div', { className: 'rfi-dir-progress-track' }, [el('div', { className: 'rfi-dir-progress-fill', style: `width: ${pct}%` })]),
          el('span', { className: 'rfi-dir-progress-label' }, [`${pct}% closed`]),
        ]),
      ]);

      const stageBar = el('div', { className: 'rfi-dir-stage-bar' });
      const legend = el('div', { className: 'rfi-dir-legend' });
      for (const key of STATUS_CYCLE) {
        const c = counts[key] || 0;
        if (c > 0) {
          stageBar.append(el('div', { className: 'rfi-dir-bar-seg', style: `width: ${(c / total) * 100}%; background: ${colors[key]}` }));
          legend.append(el('span', { className: 'rfi-dir-legend-item' }, [
            el('span', { className: 'rfi-dir-legend-dot', style: `background: ${colors[key]}` }),
            `${key}: ${c}`,
          ]));
        }
      }
      card.append(stageBar, legend);
      grid.append(card);
    }

    delegateEvent(grid, 'click', '.rfi-dir-card', (_e, card) => navigateFn('sheet', card.dataset.entryId, card.dataset.entryName));
    wrapper.append(grid);
    container.append(wrapper);
  },

  render(container, rows, cols, template) {
    const groups = parseGroups(rows, cols.rfiNumber, {
      initGroup: () => ({ notes: [] }),
      classifyChild: (child, parent) => { if (cols.note >= 0 && cell(child.row, cols.note)) parent.notes.push(child); },
    });

    const allAssignees = cols.assignedTo >= 0 ? [...new Set(groups.map(g => cell(g.row, cols.assignedTo)).filter(Boolean))].sort() : [];
    const ctx = { cols, template, allAssignees, expandedCards: _expandedCards };

    /* ---- Toolbar & Summary Bar ---- */
    const toolbar = el('div', { className: 'rfi-toolbar' });

    if (allAssignees.length > 0) {
      const filterBar = el('div', { className: 'rfi-filter-bar' });
      filterBar.append(el('button', { className: `rfi-filter-pill ${!_activeAssignee ? 'active' : ''}`, dataset: { assignee: '' } }, ['All Assignees']));
      for (const name of allAssignees) {
        filterBar.append(el('button', {
          className: `rfi-filter-pill ${_activeAssignee === name ? 'active' : ''}`,
          style: `--pill-color: ${assigneeColor(name)}`,
          dataset: { assignee: name },
        }, [name]));
      }
      delegateEvent(filterBar, 'click', '.rfi-filter-pill', (e, pill) => {
        _activeAssignee = pill.dataset.assignee || null;
        filterBar.querySelectorAll('.rfi-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        updateBoard();
      });
      toolbar.append(filterBar);
    }

    const controls = el('div', { className: 'rfi-controls' });
    const sortLabel = el('label', { className: 'rfi-sort-label' }, ['Sort:']);
    const sortSelect = el('select', { className: 'rfi-sort-select' });
    [['default', 'Default'], ['due', 'Due Date'], ['rfiNumber', 'RFI Number']].forEach(([val, txt]) => {
      const opt = el('option', { value: val }, [txt]);
      if (val === _activeSort) opt.selected = true;
      sortSelect.append(opt);
    });
    sortSelect.addEventListener('change', () => { _activeSort = sortSelect.value; updateBoard(); });
    controls.append(sortLabel, sortSelect);
    toolbar.append(controls);

    const counts = STATUS_CYCLE.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
    for (const g of groups) {
      const s = cell(g.row, cols.status) || 'Draft';
      if (counts[s] !== undefined) counts[s]++;
    }
    const summaryBar = el('div', { className: 'rfi-summary-bar' }, [
      el('div', { className: 'rfi-badge rfi-badge-open' }, ['Total Open: ', el('span', { className: 'count-open' }, [String(counts['Open'])])]),
      el('div', { className: 'rfi-badge rfi-badge-pending' }, ['Pending: ', el('span', { className: 'count-pending' }, [String(counts['Pending'])])]),
      el('div', { className: 'rfi-badge rfi-badge-closed' }, ['Closed: ', el('span', { className: 'count-closed' }, [String(counts['Closed'])])]),
    ]);
    toolbar.append(summaryBar);
    container.append(toolbar);

    /* ---- Kanban Board & Swim-Lanes ---- */
    const boardEl = el('div', { className: 'rfi-kanban' });
    container.append(boardEl);

    const groupMap = new Map();
    for (const g of groups) groupMap.set(g.idx + 1, g);

    const laneEls = {}, laneBodyEls = {};
    function buildLaneSkeleton(statusKey) {
      const lane = el('div', { className: `rfi-column rfi-column-${statusKey.toLowerCase()}`, dataset: { status: statusKey, statusCol: cols.status } });
      
      lane.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; lane.classList.add('rfi-lane-dragover'); });
      lane.addEventListener('dragleave', () => lane.classList.remove('rfi-lane-dragover'));
      lane.addEventListener('drop', (e) => {
        e.preventDefault();
        lane.classList.remove('rfi-lane-dragover');
        if (isEditLocked() || !_dragRowIdx || cols.status < 0) return;
        const prevBadge = _dragCard ? _dragCard.querySelector('.rfi-status-btn') : null;
        if (prevBadge && prevBadge.textContent.trim() !== statusKey) {
          emitEdit(_dragRowIdx, cols.status, statusKey);
          if (_dragCard) {
            _dragCard.classList.remove('rfi-card-dragging');
            const addForm = lane.querySelector('.add-row-lane');
            if (addForm) lane.insertBefore(_dragCard, addForm); else lane.append(_dragCard);
            prevBadge.textContent = statusKey;
            prevBadge.className = `rfi-status-btn ${statusKey.toLowerCase()}`;
          }
        }
        _dragCard = null; _dragRowIdx = null;
      });

      delegateEvent(lane, 'click', '.rfi-status-btn', (e, btn) => {
        e.stopPropagation();
        if (isEditLocked()) return;
        const card = btn.closest('.rfi-card');
        const rowIdx = Number(card.dataset.rowIdx);
        const nextIdx = (STATUS_CYCLE.indexOf(btn.textContent.trim()) + 1) % STATUS_CYCLE.length;
        const nextStatus = STATUS_CYCLE[nextIdx];
        btn.textContent = nextStatus;
        btn.className = `rfi-status-btn ${nextStatus.toLowerCase()}`;
        emitEdit(rowIdx, cols.status, nextStatus);
      });

      delegateEvent(lane, 'click', '.rfi-card-open', (e, btn) => {
        e.stopPropagation();
        const card = btn.closest('.rfi-card');
        const group = groupMap.get(Number(card.dataset.rowIdx));
        if (group) openRfiModal(group, ctx);
      });

      delegateEvent(lane, 'click', '.rfi-card-expand', (e, btn) => {
        e.stopPropagation();
        const card = btn.closest('.rfi-card');
        const rowIdx = Number(card.dataset.rowIdx);
        if (_expandedCards.has(rowIdx)) {
          _expandedCards.delete(rowIdx);
          const detail = card.querySelector('.rfi-card-detail');
          if (detail) detail.classList.add('hidden');
          card.classList.remove('rfi-card-expanded');
          btn.textContent = '▾';
        } else {
          _expandedCards.add(rowIdx);
          const group = groupMap.get(rowIdx);
          if (group) lazySection(card, '.rfi-card-detail', () => buildRfiDetail(group, ctx));
          card.classList.add('rfi-card-expanded');
          btn.textContent = '▴';
        }
      });

      delegateEvent(lane, 'dragstart', '.rfi-card', (e, card) => {
        if (isEditLocked()) { e.preventDefault(); return; }
        _dragCard = card; _dragRowIdx = Number(card.dataset.rowIdx);
        card.classList.add('rfi-card-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(_dragRowIdx));
      });
      delegateEvent(lane, 'dragend', '.rfi-card', (e, card) => {
        card.classList.remove('rfi-card-dragging');
        document.querySelectorAll('.rfi-lane-dragover').forEach(l => l.classList.remove('rfi-lane-dragover'));
        _dragCard = null; _dragRowIdx = null;
      });

      const laneBody = el('div', { className: 'rfi-lane-body' });
      lane.append(laneBody);

      if (typeof template._onAddRow === 'function' && typeof template.addRowFields === 'function') {
        const laneForm = buildAddRowForm(template, cols, template._totalColumns || 0, template._onAddRow, {
          defaults: { status: statusKey, assignedTo: _activeAssignee || '' },
          dynamicOptions: { assignedTo: ['', ...allAssignees] },
        });
        laneForm.classList.add('add-row-lane');
        lane.append(laneForm);
      }

      laneEls[statusKey] = lane;
      laneBodyEls[statusKey] = laneBody;
      return lane;
    }

    for (const s of STATUS_CYCLE) buildLaneSkeleton(s);

    boardEl.addEventListener('touchstart', (e) => {
      if (isEditLocked()) return;
      const card = e.target.closest('.rfi-card');
      if (!card) return;
      clearTimeout(_touchLongPressTimer);
      _touchStartX = e.touches[0].clientX; _touchStartY = e.touches[0].clientY;
      _touchCard = card; _touchRowIdx = Number(card.dataset.rowIdx); _touchDragActive = false;
      _touchLongPressTimer = setTimeout(() => {
        _touchDragActive = true;
        card.classList.add('rfi-card-dragging');
        document.body.classList.add('rfi-touch-dragging');
        if (navigator.vibrate) navigator.vibrate(40);
        document.addEventListener('touchmove', _handleTouchMove, { passive: false });
        document.addEventListener('touchend', _handleTouchEnd);
      }, 500);
    }, { passive: true });

    boardEl.addEventListener('touchmove', (e) => {
      if (!_touchDragActive && _touchCard) {
        if (Math.abs(e.touches[0].clientX - _touchStartX) > 10 || Math.abs(e.touches[0].clientY - _touchStartY) > 10) {
          clearTimeout(_touchLongPressTimer); _touchCard = null; _touchRowIdx = null;
        }
      }
    }, { passive: true });
    boardEl.addEventListener('touchend', () => { if (!_touchDragActive) { clearTimeout(_touchLongPressTimer); _touchCard = null; _touchRowIdx = null; } }, { passive: true });

    function updateBoard() {
      boardEl.innerHTML = '';
      const filtered = _activeAssignee ? groups.filter(g => cell(g.row, cols.assignedTo) === _activeAssignee) : groups;

      for (const statusKey of STATUS_CYCLE) {
        const lane = laneEls[statusKey];
        const laneBody = laneBodyEls[statusKey];
        let items = filtered.filter(g => (cell(g.row, cols.status) || 'Draft') === statusKey);

        if (_activeSort === 'due') items.sort((a, b) => (cell(a.row, cols.responseDue) || 'z').localeCompare(cell(b.row, cols.responseDue) || 'z'));
        else if (_activeSort === 'rfiNumber') items.sort((a, b) => (cell(a.row, cols.rfiNumber) || '').localeCompare(cell(b.row, cols.rfiNumber) || ''));

        const oldHeader = lane.querySelector('.rfi-lane-header');
        if (oldHeader) oldHeader.remove();
        lane.insertBefore(el('div', { className: 'rfi-lane-header' }, [
          el('span', { className: 'rfi-lane-title' }, [statusKey]),
          el('span', { className: 'rfi-lane-count' }, [String(items.length)]),
        ]), lane.firstChild);

        laneBody.innerHTML = '';
        for (const group of items) laneBody.append(buildCard(group, ctx));
        boardEl.append(lane);
      }
    }

    updateBoard();
  },
};

registerTemplate('rfi', definition);
export default definition;