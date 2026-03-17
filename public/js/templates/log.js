/* ============================================================
   templates/log.js — Activity Log: all fields editable inline
   ============================================================ */

import { el, cell, editableCell, registerTemplate } from './shared.js';

/** Number of entries to show per page */
const PAGE_SIZE = 50;

const definition = {
  name: 'Activity Log',
  icon: '📝',
  color: '#0891b2',
  priority: 15,
  itemNoun: 'Entry',
  defaultHeaders: ['Timestamp', 'Activity', 'Duration', 'Type'],

  detect(lower) {
    return lower.some(h => /^(timestamp|logged|entry.?date|log.?date|recorded|created.?at)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, timestamp: -1, type: -1, duration: -1 };
    cols.text      = lower.findIndex(h => /^(activity|action|event|entry|description|what|note|log)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) =>
      i !== lower.findIndex(h => /^(timestamp|logged|entry.?date|log.?date)/.test(h))
    );
    cols.timestamp = lower.findIndex(h => /^(timestamp|logged|entry.?date|log.?date|recorded|created.?at|date)/.test(h));
    cols.type      = lower.findIndex((h, i) => i !== cols.text && i !== cols.timestamp && /^(type|category|kind|tag|label)/.test(h));
    cols.duration  = lower.findIndex((h, i) => i !== cols.text && i !== cols.timestamp && /^(duration|time\b|length|minutes|hours)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',      label: 'Activity',  colIndex: cols.text,      type: 'text', placeholder: 'What happened?', required: true },
      { role: 'timestamp', label: 'Date',       colIndex: cols.timestamp, type: 'date', defaultValue: '__TODAY__' },
      { role: 'type',      label: 'Type',       colIndex: cols.type,      type: 'text', placeholder: 'Category / tag' },
      { role: 'duration',  label: 'Duration',   colIndex: cols.duration,  type: 'text', placeholder: 'e.g. 30 min' },
    ];
  },

  render(container, rows, cols) {
    /* Reverse chronological but track original indices for editing */
    const indexed = rows.map((row, i) => ({ row, originalIndex: i }));
    indexed.reverse();

    let shown = 0;

    function renderBatch(count) {
      const end = Math.min(shown + count, indexed.length);
      for (let j = shown; j < end; j++) {
        const { row, originalIndex } = indexed[j];
        const rowIdx = originalIndex + 1;
        const text      = cell(row, cols.text) || row[0] || '\u2014';
        const timestamp = cell(row, cols.timestamp);
        const type      = cell(row, cols.type);
        const duration  = cell(row, cols.duration);

        container.append(el('div', { className: 'template-log-entry' }, [
          el('div', { className: 'template-log-dot' }),
          el('div', { className: 'template-log-content' }, [
            el('div', { className: 'template-log-header' }, [
              cols.timestamp >= 0 ? editableCell('span', { className: 'template-log-time' }, timestamp, rowIdx, cols.timestamp) : null,
              cols.type >= 0      ? editableCell('span', { className: 'template-log-type' }, type, rowIdx, cols.type) : null,
              cols.duration >= 0  ? editableCell('span', { className: 'template-log-duration' }, duration, rowIdx, cols.duration) : null,
            ]),
            editableCell('div', { className: 'template-log-text' }, text, rowIdx, cols.text),
          ]),
        ]));
      }
      shown = end;
      updateMoreBtn();
    }

    /* "Load more" button */
    const moreBtn = el('button', {
      className: 'template-log-more btn btn-secondary',
      on: { click() { renderBatch(PAGE_SIZE); } },
    });
    function updateMoreBtn() {
      const remaining = indexed.length - shown;
      if (remaining > 0) {
        moreBtn.textContent = `Show more (${remaining} remaining)`;
        if (!moreBtn.parentNode) container.append(moreBtn);
      } else {
        moreBtn.remove();
      }
    }

    renderBatch(PAGE_SIZE);
  },
};

registerTemplate('log', definition);
export default definition;
