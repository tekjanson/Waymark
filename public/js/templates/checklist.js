/* ============================================================
   templates/checklist.js — Checklist: toggle done/undone,
   category-level progress bars, bulk check/uncheck,
   all fields editable, delegated events
   ============================================================ */

import { el, cell, editableCell, emitEdit, isEditLocked, groupByColumn, registerTemplate, delegateEvent, buildDirSyncBtn } from './shared.js';

/* ---------- Helpers ---------- */

/** Check if a cell value represents "complete" */
function isComplete(val) {
  return /^(true|yes|done|x|1|\u2713|\u2714|complete)$/i.test((val || '').trim());
}

/**
 * Update the category progress bar for the group containing an element.
 * @param {HTMLElement} groupEl
 */
function updateGroupProgress(groupEl) {
  const bar = groupEl.previousElementSibling?.querySelector('.checklist-group-progress');
  if (!bar) return;
  const rows = groupEl.querySelectorAll('.checklist-row');
  const total = rows.length;
  let done = 0;
  for (const r of rows) { if (r.classList.contains('completed')) done++; }
  const pct = total ? Math.round((done / total) * 100) : 0;
  const fill = bar.querySelector('.checklist-group-progress-fill');
  const label = bar.querySelector('.checklist-group-progress-label');
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${done}/${total}`;
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Checklist',
  icon: '\u2713',
  color: '#16a34a',
  priority: 10,
  itemNoun: 'Item',
  defaultHeaders: ['Item', 'Status', 'Category', 'Due', 'Notes'],

  detect(lower) {
    return lower.some(h => /^(status|done|complete|check|\u2713|\u2714)/.test(h));
  },

  columns(lower) {
    const cols = { status: -1, text: -1, date: -1, notes: -1, category: -1 };
    cols.status   = lower.findIndex(h => /^(status|done|complete|check|\u2713|\u2714)/.test(h));
    cols.text     = lower.findIndex(h => /^(item|task|name|description|title|what|to.?do|chore)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.status);
    cols.date     = lower.findIndex(h => /^(date|due|when|deadline|day)/.test(h));
    cols.notes    = lower.findIndex(h => /^(notes?|comment|detail|info)/.test(h));
    cols.category = lower.findIndex(h => /^(category|type|group|section|aisle|store|department)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Item',     colIndex: cols.text,     type: 'text',   placeholder: 'What needs to be done?', required: true },
      { role: 'status',   label: 'Status',   colIndex: cols.status,   type: 'text',   defaultValue: '', hidden: true },
      { role: 'date',     label: 'Due',      colIndex: cols.date,     type: 'date',   placeholder: 'Due date' },
      { role: 'notes',    label: 'Notes',    colIndex: cols.notes,    type: 'text',   placeholder: 'Optional notes' },
      { role: 'category', label: 'Category', colIndex: cols.category, type: 'text',   placeholder: 'Category' },
    ];
  },

  isComplete,

  /** Build a single checklist-row element (no per-row listeners) */
  _buildRow(row, rowIdx, cols) {
    const statusRaw = cell(row, cols.status).toLowerCase().trim();
    const completed = isComplete(statusRaw);
    const text      = cell(row, cols.text) || row[0] || '\u2014';
    const date      = cell(row, cols.date);
    const notes     = cell(row, cols.notes);

    const checkbox = el('span', {
      className: 'checklist-checkbox',
      role: 'checkbox',
      'aria-checked': String(completed),
      tabindex: '0',
    }, [completed ? '\u2713' : '']);

    return el('div', {
      className: `checklist-row${completed ? ' completed' : ''}`,
      dataset: { rowIdx: String(rowIdx) },
    }, [
      checkbox,
      editableCell('span', { className: 'checklist-item-text' }, text, rowIdx, cols.text),
      cols.date >= 0  ? editableCell('span', { className: 'checklist-item-date' }, date, rowIdx, cols.date) : null,
      cols.notes >= 0 ? editableCell('span', { className: 'checklist-item-notes', title: notes }, notes, rowIdx, cols.notes) : null,
    ]);
  },

  render(container, rows, cols, template) {
    /* Delegated checkbox toggle — single listener for all rows */
    delegateEvent(container, 'click', '.checklist-checkbox', (e, checkbox) => {
      e.stopPropagation();
      if (isEditLocked()) return;
      const rowEl = checkbox.closest('.checklist-row');
      if (!rowEl) return;
      const nowComplete = !rowEl.classList.contains('completed');
      rowEl.classList.toggle('completed', nowComplete);
      checkbox.textContent = nowComplete ? '\u2713' : '';
      checkbox.setAttribute('aria-checked', String(nowComplete));
      const rowIdx = Number(rowEl.dataset.rowIdx);
      emitEdit(rowIdx, cols.status, nowComplete ? 'done' : '');
      // Update group progress bar if in categorized mode
      const groupEl = rowEl.closest('.checklist-group');
      if (groupEl) updateGroupProgress(groupEl);
    });

    /* Delegated bulk check/uncheck buttons */
    delegateEvent(container, 'click', '.checklist-bulk-btn', (e, btn) => {
      if (isEditLocked()) return;
      const groupEl = btn.closest('.checklist-group-header')?.nextElementSibling;
      if (!groupEl) return;
      const setDone = btn.dataset.action === 'check';
      const checkboxes = groupEl.querySelectorAll('.checklist-checkbox');
      for (const cb of checkboxes) {
        const rowEl = cb.closest('.checklist-row');
        if (!rowEl) continue;
        const alreadyDone = rowEl.classList.contains('completed');
        if (alreadyDone === setDone) continue;
        rowEl.classList.toggle('completed', setDone);
        cb.textContent = setDone ? '\u2713' : '';
        cb.setAttribute('aria-checked', String(setDone));
        const rowIdx = Number(rowEl.dataset.rowIdx);
        emitEdit(rowIdx, cols.status, setDone ? 'done' : '');
      }
      updateGroupProgress(groupEl);
    });

    /* If no category column, render flat */
    if (cols.category < 0) {
      for (let i = 0; i < rows.length; i++) {
        container.append(template._buildRow(rows[i], i + 1, cols));
      }
      return;
    }

    /* Group rows by category */
    const groups = groupByColumn(rows, cols.category);

    for (const [cat, items] of groups) {
      const doneCount = items.filter(it => isComplete(cell(it.row, cols.status))).length;
      const totalCount = items.length;
      const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

      /* Section header with progress + bulk buttons */
      container.append(el('div', { className: 'checklist-group-header' }, [
        el('span', { className: 'checklist-group-header-text' }, [cat]),
        el('div', { className: 'checklist-group-progress' }, [
          el('div', { className: 'checklist-group-progress-fill', style: `width: ${pct}%` }),
          el('span', { className: 'checklist-group-progress-label' }, [`${doneCount}/${totalCount}`]),
        ]),
        el('button', { className: 'checklist-bulk-btn', dataset: { action: 'check' }, title: 'Check all' }, ['\u2713 All']),
        el('button', { className: 'checklist-bulk-btn', dataset: { action: 'uncheck' }, title: 'Uncheck all' }, ['\u2717 All']),
      ]));

      /* Group container for items */
      const groupEl = el('div', { className: 'checklist-group' });
      for (const { row, originalIndex } of items) {
        groupEl.append(template._buildRow(row, originalIndex + 1, cols));
      }
      container.append(groupEl);
    }
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'checklist-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'checklist-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'checklist-dir-icon tmpl-dir-icon' }, ['\u2713']),
      el('span', { className: 'checklist-dir-title tmpl-dir-title' }, ['Checklists']),
      el('span', { className: 'checklist-dir-count tmpl-dir-count' }, [
        `${sheets.length} checklist${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'checklist-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      const cols = sheet.cols || {};
      let done = 0;
      for (const row of rows) { if (isComplete(cell(row, cols.status))) done++; }
      const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;

      grid.append(el('div', {
        className: 'checklist-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'checklist-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'checklist-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} item${rows.length !== 1 ? 's' : ''} \u2022 ${pct}% done`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.checklist-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('checklist', definition);
export default definition;
