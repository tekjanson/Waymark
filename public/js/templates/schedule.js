/* ============================================================
   templates/schedule.js \u2014 Schedule: time-sorted + conflict detection
   ============================================================ */

import { el, cell, editableCell, groupByColumn, delegateEvent, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Parse a time string like "2:00 PM" into minutes since midnight */
function parseTime(str) {
  if (!str) return -1;
  const m = str.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
  if (!m) return -1;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || '0');
  const period = (m[3] || '').toLowerCase();
  if (period === 'pm' && h < 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

const definition = {
  name: 'Schedule',
  icon: '\uD83D\uDCC5',
  color: '#8b5cf6',
  priority: 20,
  itemNoun: 'Event',

  detect(lower) {
    return lower.some(h => /^(time\b|start\s*time|end\s*time|slot|period|block)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, time: -1, day: -1, location: -1, end: -1 };
    cols.text     = lower.findIndex(h => /^(activity|event|class|subject|meeting|task|name|title|description|what)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== lower.findIndex(h => /^(time|start)/.test(h)));
    cols.time     = lower.findIndex(h => /^(time|start|hour|slot|from|period|block)/.test(h));
    cols.day      = lower.findIndex(h => /^(day|date|when|weekday)/.test(h));
    cols.location = lower.findIndex(h => /^(location|where|room|place|venue)/.test(h));
    cols.end      = lower.findIndex((h, i) => i !== cols.time && /^(end|to|until|finish)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Activity', colIndex: cols.text,     type: 'text', placeholder: 'Event or task', required: true },
      { role: 'time',     label: 'Time',     colIndex: cols.time,     type: 'text', placeholder: '9:00 AM' },
      { role: 'day',      label: 'Day',      colIndex: cols.day,      type: 'text', placeholder: 'Monday' },
      { role: 'location', label: 'Location', colIndex: cols.location, type: 'text', placeholder: 'Where?' },
    ];
  },

  render(container, rows, cols) {
    const groups = groupByColumn(rows, cols.day, 'Unscheduled');

    /* --- Today button --- */
    const todayName = DAY_NAMES[new Date().getDay()];
    const toolbar = el('div', { className: 'schedule-toolbar' });
    const todayBtn = el('button', { className: 'schedule-today-btn' }, ['Today']);
    todayBtn.addEventListener('click', () => {
      const target = container.querySelector(`[data-day="${todayName}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toolbar.append(todayBtn);
    container.append(toolbar);

    for (const [day, dayItems] of groups) {
      const section = el('div', {
        className: 'template-schedule-day',
        dataset: { day: day.toLowerCase() },
      });
      section.append(el('div', { className: 'template-schedule-day-label' }, [day]));

      /* sort items by start time */
      dayItems.sort((a, b) => parseTime(cell(a.row, cols.time)) - parseTime(cell(b.row, cols.time)));

      /* detect conflicts: same start time or overlapping ranges */
      const conflictSet = new Set();
      for (let i = 0; i < dayItems.length; i++) {
        const startA = parseTime(cell(dayItems[i].row, cols.time));
        if (startA < 0) continue;
        const endA = cols.end >= 0 ? parseTime(cell(dayItems[i].row, cols.end)) : -1;
        for (let j = i + 1; j < dayItems.length; j++) {
          const startB = parseTime(cell(dayItems[j].row, cols.time));
          if (startB < 0) continue;
          let overlap = startA === startB;
          if (!overlap && endA > 0) overlap = startB < endA;
          if (overlap) {
            conflictSet.add(dayItems[i].originalIndex);
            conflictSet.add(dayItems[j].originalIndex);
          }
        }
      }

      for (const { row, originalIndex } of dayItems) {
        const rowIdx = originalIndex + 1;
        const text     = cell(row, cols.text) || row[0] || '\u2014';
        const time     = cell(row, cols.time);
        const location = cell(row, cols.location);
        const hasConflict = conflictSet.has(originalIndex);

        section.append(el('div', {
          className: 'template-schedule-block' + (hasConflict ? ' schedule-conflict' : ''),
        }, [
          cols.time >= 0
            ? editableCell('span', { className: 'template-schedule-time' }, time, rowIdx, cols.time)
            : null,
          el('div', { className: 'template-schedule-event' }, [
            editableCell('span', { className: 'template-schedule-event-name' }, text, rowIdx, cols.text),
            cols.location >= 0
              ? editableCell('span', { className: 'template-schedule-location' }, location, rowIdx, cols.location)
              : null,
          ]),
          hasConflict
            ? el('span', { className: 'schedule-conflict-badge' }, ['\u26A0 Conflict'])
            : null,
        ]));
      }

      container.append(section);
    }
  },
};

registerTemplate('schedule', definition);
export default definition;
