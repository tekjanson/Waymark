/* templates/habit.js — Habit Tracker: toggle days, all fields editable */

import { el, cell, editableCell, emitEdit, registerTemplate } from './shared.js';

const definition = {
  name: 'Habit Tracker',
  icon: '🔄',
  color: '#d97706',
  priority: 22,

  detect(lower) {
    return lower.some(h => /^(habit|routine|daily)/.test(h))
      && lower.some(h => /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|streak)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, days: [], streak: -1 };
    cols.text   = lower.findIndex(h => /^(habit|routine|daily|activity|task|name)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.streak = lower.findIndex(h => /^(streak|total|count|score)/.test(h));
    const dayPattern = /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/;
    for (let i = 0; i < lower.length; i++) {
      if (i !== cols.text && i !== cols.streak && dayPattern.test(lower[i])) {
        cols.days.push(i);
      }
    }
    return cols;
  },

  render(container, rows, cols) {
    // Header row
    const headerRow = el('div', { className: 'habit-grid-row habit-grid-header' });
    headerRow.append(el('div', { className: 'habit-grid-cell habit-name-cell' }, ['Habit']));
    for (const dayIdx of cols.days) {
      const abbr = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      headerRow.append(el('div', { className: 'habit-grid-cell habit-day-cell' }, [abbr[cols.days.indexOf(dayIdx)] || 'Day']));
    }
    if (cols.streak >= 0) headerRow.append(el('div', { className: 'habit-grid-cell habit-streak-cell' }, ['🔥']));
    container.append(headerRow);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const text = cell(row, cols.text) || row[0] || '—';
      const streak = cols.streak >= 0 ? cell(row, cols.streak) : '';

      const gridRow = el('div', { className: 'habit-grid-row' });
      gridRow.append(editableCell('div', { className: 'habit-grid-cell habit-name-cell' }, text, rowIdx, cols.text));

      for (const dayIdx of cols.days) {
        const val = cell(row, dayIdx);
        const checked = /^(✓|✔|x|yes|1|true|done)$/i.test(val.trim());
        const dayCell = el('div', {
          className: `habit-grid-cell habit-day-cell habit-toggle ${checked ? 'habit-checked' : ''}`,
          title: 'Click to toggle',
          dataset: { rowIdx: String(rowIdx), colIdx: String(dayIdx) },
        }, [checked ? '✓' : '']);

        dayCell.addEventListener('click', () => {
          const nowChecked = !dayCell.classList.contains('habit-checked');
          dayCell.classList.toggle('habit-checked', nowChecked);
          dayCell.textContent = nowChecked ? '✓' : '';
          emitEdit(rowIdx, dayIdx, nowChecked ? '✓' : '');
        });

        gridRow.append(dayCell);
      }

      if (cols.streak >= 0) {
        gridRow.append(editableCell('div', { className: 'habit-grid-cell habit-streak-cell' }, streak, rowIdx, cols.streak));
      }

      container.append(gridRow);
    }
  },
};

registerTemplate('habit', definition);
export default definition;
