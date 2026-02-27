/* templates/schedule.js — Schedule: all fields editable inline */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Schedule',
  icon: '📅',
  color: '#8b5cf6',
  priority: 20,

  detect(lower) {
    return lower.some(h => /^(time\b|start\b|end\b|from\b|to\b|slot|period|block)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, time: -1, day: -1, location: -1 };
    cols.text     = lower.findIndex(h => /^(activity|event|class|subject|meeting|task|name|title|description|what)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== lower.findIndex(h => /^(time|start)/.test(h)));
    cols.time     = lower.findIndex(h => /^(time|start|hour|slot|from|period|block)/.test(h));
    cols.day      = lower.findIndex(h => /^(day|date|when|weekday)/.test(h));
    cols.location = lower.findIndex(h => /^(location|where|room|place|venue)/.test(h));
    return cols;
  },

  render(container, rows, cols) {
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const day = cols.day >= 0 ? cell(row, cols.day) || 'Unscheduled' : 'Schedule';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push({ row, originalIndex: i });
    }

    for (const [day, dayItems] of groups) {
      const section = el('div', { className: 'template-schedule-day' });
      section.append(el('div', { className: 'template-schedule-day-label' }, [day]));

      for (const { row, originalIndex } of dayItems) {
        const rowIdx = originalIndex + 1;
        const text     = cell(row, cols.text) || row[0] || '—';
        const time     = cell(row, cols.time);
        const location = cell(row, cols.location);

        section.append(el('div', { className: 'template-schedule-block' }, [
          cols.time >= 0
            ? editableCell('span', { className: 'template-schedule-time' }, time, rowIdx, cols.time)
            : null,
          el('div', { className: 'template-schedule-event' }, [
            editableCell('span', { className: 'template-schedule-event-name' }, text, rowIdx, cols.text),
            cols.location >= 0
              ? editableCell('span', { className: 'template-schedule-location' }, location, rowIdx, cols.location)
              : null,
          ]),
        ]));
      }

      container.append(section);
    }
  },
};

registerTemplate('schedule', definition);
export default definition;
