/* ============================================================
   templates/checklist.js — Checklist: toggle done/undone,
   collapsible categories with progress + bulk actions,
   per-category "add item", new-category creation,
   date-picker due dates, all fields editable, delegated events
   ============================================================ */

import { el, cell, editableCell, dateCell, emitEdit, isEditLocked, groupByColumn, registerTemplate, delegateEvent, buildAddRowForm, buildDirSyncBtn } from './shared.js';

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

/**
 * Update the overall progress bar at the top of a categorized checklist.
 * @param {HTMLElement} container
 */
function updateOverallProgress(container) {
  const overall = container.querySelector('.checklist-overall');
  if (!overall) return;
  const rows = container.querySelectorAll('.checklist-row');
  const total = rows.length;
  let done = 0;
  for (const r of rows) { if (r.classList.contains('completed')) done++; }
  const pct = total ? Math.round((done / total) * 100) : 0;
  const fill = overall.querySelector('.checklist-overall-fill');
  const label = overall.querySelector('.checklist-overall-label');
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${done}/${total} done`;
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

  /* Suggest a Category column so flat checklists can adopt grouping (migration banner) */
  migrations: [
    { role: 'category', header: 'Category', description: 'Group items into categories' },
  ],

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Item',     colIndex: cols.text,     type: 'text',   placeholder: 'What needs to be done?', required: true },
      { role: 'status',   label: 'Status',   colIndex: cols.status,   type: 'text',   defaultValue: '', hidden: true },
      { role: 'category', label: 'Category', colIndex: cols.category, type: 'combo',  placeholder: 'Select or type a category…' },
      { role: 'date',     label: 'Due',      colIndex: cols.date,     type: 'date',     placeholder: 'Due date' },
      { role: 'notes',    label: 'Notes',    colIndex: cols.notes,    type: 'textarea', placeholder: 'Optional notes' },
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
      cols.date >= 0  ? dateCell('span', { className: 'checklist-item-date' }, date, rowIdx, cols.date) : null,
      cols.notes >= 0 ? editableCell('span', { className: 'checklist-item-notes', title: notes }, notes, rowIdx, cols.notes) : null,
    ]);
  },

  /** Build a category section header (caret, name, progress, bulk actions). */
  _buildCategoryHeader(cat, doneCount, totalCount) {
    const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
    return el('div', { className: 'checklist-group-header' }, [
      el('span', { className: 'checklist-caret', 'aria-hidden': 'true' }, ['\u25BE']),
      el('span', { className: 'checklist-group-header-text' }, [cat]),
      el('div', { className: 'checklist-group-progress' }, [
        el('div', { className: 'checklist-group-progress-fill', style: `width: ${pct}%` }),
        el('span', { className: 'checklist-group-progress-label' }, [`${doneCount}/${totalCount}`]),
      ]),
      el('button', { className: 'checklist-bulk-btn', dataset: { action: 'check' }, title: 'Check all', type: 'button' }, ['\u2713 All']),
      el('button', { className: 'checklist-bulk-btn', dataset: { action: 'uncheck' }, title: 'Uncheck all', type: 'button' }, ['\u2717 All']),
    ]);
  },

  render(container, rows, cols, template) {
    const canAdd = typeof template._onAddRow === 'function' && typeof template.addRowFields === 'function';
    const totalCols = template._totalColumns || 0;

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
      emitEdit(Number(rowEl.dataset.rowIdx), cols.status, nowComplete ? 'done' : '');
      const groupEl = rowEl.closest('.checklist-group');
      if (groupEl) updateGroupProgress(groupEl);
      updateOverallProgress(container);
    });

    /* Delegated bulk check/uncheck buttons */
    delegateEvent(container, 'click', '.checklist-bulk-btn', (e, btn) => {
      if (isEditLocked()) return;
      const groupEl = btn.closest('.checklist-group-header')?.nextElementSibling;
      if (!groupEl) return;
      const setDone = btn.dataset.action === 'check';
      for (const cb of groupEl.querySelectorAll('.checklist-checkbox')) {
        const rowEl = cb.closest('.checklist-row');
        if (!rowEl) continue;
        if (rowEl.classList.contains('completed') === setDone) continue;
        rowEl.classList.toggle('completed', setDone);
        cb.textContent = setDone ? '\u2713' : '';
        cb.setAttribute('aria-checked', String(setDone));
        emitEdit(Number(rowEl.dataset.rowIdx), cols.status, setDone ? 'done' : '');
      }
      updateGroupProgress(groupEl);
      updateOverallProgress(container);
    });

    /* Delegated collapse toggle on category headers (ignore bulk-button clicks) */
    delegateEvent(container, 'click', '.checklist-group-header', (e, header) => {
      if (e.target.closest('.checklist-bulk-btn')) return;
      const catEl = header.closest('.checklist-category');
      if (catEl) catEl.classList.toggle('collapsed');
    });

    /* ---- Flat mode (no category column) ---- */
    if (cols.category < 0) {
      for (let i = 0; i < rows.length; i++) {
        container.append(template._buildRow(rows[i], i + 1, cols));
      }
      if (canAdd) {
        container.append(buildAddRowForm(template, cols, totalCols, template._onAddRow));
      }
      return;
    }

    /* ---- Categorized mode ---- */
    const overallDone = rows.reduce((n, r) => n + (isComplete(cell(r, cols.status)) ? 1 : 0), 0);
    const overallPct = rows.length ? Math.round((overallDone / rows.length) * 100) : 0;
    container.append(el('div', { className: 'checklist-overall' }, [
      el('div', { className: 'checklist-overall-bar' }, [
        el('div', { className: 'checklist-overall-fill', style: `width: ${overallPct}%` }),
      ]),
      el('span', { className: 'checklist-overall-label' }, [`${overallDone}/${rows.length} done`]),
    ]));

    /* Group rows by category value */
    const groups = groupByColumn(rows, cols.category);
    const existingCategories = [...groups.keys()];

    for (const [cat, items] of groups) {
      const doneCount = items.filter(it => isComplete(cell(it.row, cols.status))).length;

      const catEl = el('div', { className: 'checklist-category' });
      catEl.append(template._buildCategoryHeader(cat, doneCount, items.length));

      const groupEl = el('div', { className: 'checklist-group' });
      for (const { row, originalIndex } of items) {
        groupEl.append(template._buildRow(row, originalIndex + 1, cols));
      }
      catEl.append(groupEl);

      /* Per-category "add item" — category pre-filled and hidden */
      if (canAdd) {
        const addItem = buildAddRowForm(template, cols, totalCols, template._onAddRow, {
          defaults: { category: cat },
          hiddenRoles: ['category'],
        });
        addItem.classList.add('checklist-add-item');
        catEl.append(addItem);
      }

      container.append(catEl);
    }

    /* New-category creator — category required + combo of existing names */
    if (canAdd) {
      const newCat = buildAddRowForm(template, cols, totalCols, template._onAddRow, {
        noun: 'Category',
        requiredRoles: ['category'],
        dynamicOptions: { category: ['', ...existingCategories] },
      });
      newCat.classList.add('checklist-new-category');
      container.append(newCat);
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
