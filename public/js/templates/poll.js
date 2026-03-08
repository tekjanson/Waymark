/* ============================================================
   templates/poll.js — Poll / Survey: all fields editable inline
   ============================================================ */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Poll / Survey',
  icon: '📊',
  color: '#be185d',
  priority: 18,
  itemNoun: 'Option',

  detect(lower) {
    return lower.some(h => /^(vote|votes|response|responses|poll|ballot|tally)/.test(h))
      && lower.some(h => /^(option|choice|answer|candidate|selection|question|item)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, votes: -1, percent: -1, notes: -1 };
    cols.votes   = lower.findIndex(h => /^(vote|votes|count|tally|responses?|score)/.test(h));
    cols.text    = lower.findIndex((h, i) => i !== cols.votes && /^(option|choice|answer|candidate|selection|question|item|name)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.votes);
    cols.percent = lower.findIndex((h, i) => i !== cols.votes && i !== cols.text && /^(percent|%|share|ratio|proportion)/.test(h));
    cols.notes   = lower.findIndex((h, i) => i !== cols.votes && i !== cols.text && i !== cols.percent && /^(notes?|comment|detail|info)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',    label: 'Option',   colIndex: cols.text,    type: 'text',   placeholder: 'Choice or answer', required: true },
      { role: 'votes',   label: 'Votes',    colIndex: cols.votes,   type: 'number', placeholder: '0', defaultValue: '0' },
      { role: 'percent', label: 'Percent',   colIndex: cols.percent, type: 'text',   placeholder: 'e.g. 25%' },
      { role: 'notes',   label: 'Notes',     colIndex: cols.notes,   type: 'text',   placeholder: 'Optional notes' },
    ];
  },

  render(container, rows, cols) {
    let maxVotes = 0, totalVotes = 0;
    for (const row of rows) {
      const v = parseInt(cell(row, cols.votes)) || 0;
      if (v > maxVotes) maxVotes = v;
      totalVotes += v;
    }

    container.append(el('div', { className: 'poll-total' }, [`${totalVotes} total votes`]));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const text = cell(row, cols.text) || row[0] || '—';
      const votes = parseInt(cell(row, cols.votes)) || 0;
      const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
      const barWidth = maxVotes > 0 ? Math.round((votes / maxVotes) * 100) : 0;
      const notes = cell(row, cols.notes);

      container.append(el('div', { className: 'poll-row' }, [
        el('div', { className: 'poll-row-label' }, [
          editableCell('span', { className: 'poll-option-text' }, text, rowIdx, cols.text),
          cols.notes >= 0 ? editableCell('span', { className: 'poll-option-notes' }, notes, rowIdx, cols.notes) : null,
        ]),
        el('div', { className: 'poll-bar-wrap' }, [
          el('div', { className: 'poll-bar', style: { width: `${barWidth}%` } }),
        ]),
        el('div', { className: 'poll-row-stats' }, [
          editableCell('span', { className: 'poll-votes-count' }, String(votes), rowIdx, cols.votes),
          el('span', { className: 'poll-pct' }, [`${pct}%`]),
        ]),
      ]));
    }
  },
};

registerTemplate('poll', definition);
export default definition;
