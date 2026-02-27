/* templates/checklist.js — Checklist: toggle done/undone, all fields editable */

import { el, cell, editableCell, emitEdit, registerTemplate } from './shared.js';

const definition = {
  name: 'Checklist',
  icon: '✓',
  color: '#16a34a',
  priority: 10,

  detect(lower) {
    return lower.some(h => /^(status|done|complete|check|✓|✔)/.test(h));
  },

  columns(lower) {
    const cols = { status: -1, text: -1, date: -1, notes: -1 };
    cols.status = lower.findIndex(h => /^(status|done|complete|check|✓|✔)/.test(h));
    cols.text   = lower.findIndex(h => /^(item|task|name|description|title|what|to.?do|chore)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.status);
    cols.date   = lower.findIndex(h => /^(date|due|when|deadline|day)/.test(h));
    cols.notes  = lower.findIndex(h => /^(notes?|comment|detail|info)/.test(h));
    return cols;
  },

  isComplete(val) {
    return /^(true|yes|done|x|1|✓|✔|complete)$/i.test((val || '').trim());
  },

  render(container, rows, cols, template) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const statusRaw = cell(row, cols.status).toLowerCase().trim();
      const completed = template.isComplete(statusRaw);
      const text      = cell(row, cols.text) || row[0] || '—';
      const date      = cell(row, cols.date);
      const notes     = cell(row, cols.notes);

      const checkbox = el('span', {
        className: 'checklist-checkbox',
        role: 'checkbox',
        'aria-checked': String(completed),
        tabindex: '0',
      }, [completed ? '✓' : '']);

      const rowEl = el('div', {
        className: `checklist-row${completed ? ' completed' : ''}`,
        dataset: { rowIdx: String(rowIdx) },
      }, [
        checkbox,
        editableCell('span', { className: 'checklist-item-text' }, text, rowIdx, cols.text),
        cols.date >= 0  ? editableCell('span', { className: 'checklist-item-date' }, date, rowIdx, cols.date) : null,
        cols.notes >= 0 ? editableCell('span', { className: 'checklist-item-notes', title: notes }, notes, rowIdx, cols.notes) : null,
      ]);

      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowComplete = !rowEl.classList.contains('completed');
        rowEl.classList.toggle('completed', nowComplete);
        checkbox.textContent = nowComplete ? '✓' : '';
        checkbox.setAttribute('aria-checked', String(nowComplete));
        emitEdit(rowIdx, cols.status, nowComplete ? 'done' : '');
      });

      container.append(rowEl);
    }
  },
};

registerTemplate('checklist', definition);
export default definition;
