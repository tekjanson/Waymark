/* templates/tracker.js — Progress Tracker: all fields editable inline */

import { el, cell, editableCell, emitEdit, parseProgress, registerTemplate } from './shared.js';

const definition = {
  name: 'Progress Tracker',
  icon: '📊',
  color: '#2563eb',
  priority: 20,

  detect(lower) {
    return lower.some(h => /^(progress|percent|%|score|rating|level|grade|completion)/.test(h))
      && lower.some(h => /^(item|task|name|goal|metric|title|description|activity|habit)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, progress: -1, target: -1, notes: -1 };
    cols.text     = lower.findIndex(h => /^(item|task|name|goal|metric|title|description)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.progress = lower.findIndex(h => /^(progress|percent|%|score|rating|level|grade|completion|current)/.test(h));
    cols.target   = lower.findIndex((h, i) => i !== cols.text && i !== cols.progress && /^(target|goal|max|total|out.of|capacity)/.test(h));
    cols.notes    = lower.findIndex((h, i) => i !== cols.text && i !== cols.progress && i !== cols.target && /^(notes?|comment|detail|info|status)/.test(h));
    return cols;
  },

  render(container, rows, cols) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const text     = cell(row, cols.text) || row[0] || '—';
      const rawProg  = cell(row, cols.progress);
      const rawTarget = cell(row, cols.target);
      const notes    = cell(row, cols.notes);

      let pct = parseProgress(rawProg, rawTarget);

      const barColor = pct >= 100 ? 'var(--color-success)' :
                       pct >= 50  ? 'var(--color-primary)' :
                       pct >= 25  ? 'var(--color-warning)' : 'var(--color-error)';

      const bar = el('div', { className: 'template-tracker-bar', style: { width: `${Math.min(pct, 100)}%`, background: barColor } });
      const pctEl = el('span', { className: 'template-tracker-pct' }, [`${Math.round(pct)}%`]);

      const progressCell = editableCell('div', {
        className: 'template-tracker-bar-wrap',
        title: 'Click to update progress',
      }, rawProg || '0', rowIdx, cols.progress, {
        renderContent(wrapper) {
          wrapper.textContent = '';
          wrapper.append(bar);
        },
        onCommit(value) {
          const newPct = parseProgress(value, rawTarget);
          const newColor = newPct >= 100 ? 'var(--color-success)' :
                           newPct >= 50  ? 'var(--color-primary)' :
                           newPct >= 25  ? 'var(--color-warning)' : 'var(--color-error)';
          bar.style.width = `${Math.min(newPct, 100)}%`;
          bar.style.background = newColor;
          pctEl.textContent = `${Math.round(newPct)}%`;
        },
      });

      container.append(el('div', { className: 'template-tracker-row' }, [
        el('div', { className: 'template-tracker-info' }, [
          editableCell('span', { className: 'template-tracker-label' }, text, rowIdx, cols.text),
          cols.notes >= 0 ? editableCell('span', { className: 'template-tracker-notes' }, notes, rowIdx, cols.notes) : null,
        ]),
        progressCell,
        pctEl,
      ]));
    }
  },
};

registerTemplate('tracker', definition);
export default definition;
