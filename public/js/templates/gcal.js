/* ============================================================
   gcal.js — Google Calendar Events Template

   Renders a Google Sheet as a day-planner calendar view.
   Events are grouped by date into day sections, each showing
   a time badge, title, location chip, and type badge.

   Compatible with Google Calendar export sheets or any sheet
   with Event + Date + Time columns.
   ============================================================ */

import { el, editableCell, emitEdit, cell, registerTemplate } from './shared.js';

/* ---------- Type metadata ---------- */

const TYPE_META = {
  meeting:     { icon: '🤝', cls: 'gcal-type-meeting' },
  appointment: { icon: '📌', cls: 'gcal-type-appointment' },
  personal:    { icon: '🌿', cls: 'gcal-type-personal' },
  social:      { icon: '🎉', cls: 'gcal-type-social' },
  work:        { icon: '💼', cls: 'gcal-type-work' },
  other:       { icon: '📅', cls: 'gcal-type-other' },
};

/* ---------- Helpers (exported for unit tests) ---------- */

/**
 * Return an emoji icon for a calendar event type.
 * @param {string} type
 * @returns {string}
 */
export function evtTypeIcon(type) {
  const key = (type || '').toLowerCase().trim();
  return (TYPE_META[key] || TYPE_META.other).icon;
}

/**
 * Return the CSS class for an event type badge.
 * @param {string} type
 * @returns {string}
 */
export function evtTypeClass(type) {
  const key = (type || '').toLowerCase().trim();
  return (TYPE_META[key] || TYPE_META.other).cls;
}

/**
 * Format a YYYY-MM-DD date string as a readable day heading.
 * Returns e.g. "Mon, Jul 7" or "Today, Jul 7" / "Tomorrow, Jul 8".
 * @param {string} str   date string (YYYY-MM-DD)
 * @returns {string}
 */
export function fmtEvtDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  if (isNaN(d.getTime())) return str;

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const target   = new Date(d);    target.setHours(0, 0, 0, 0);

  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (target.getTime() === today.getTime())    return `Today, ${monthDay}`;
  if (target.getTime() === tomorrow.getTime()) return `Tomorrow, ${monthDay}`;

  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${weekday}, ${monthDay}`;
}

/**
 * Format a HH:MM time string as 12-hour with AM/PM.
 * @param {string} str  e.g. "09:30" or "14:00"
 * @returns {string}    e.g. "9:30 AM" or "2:00 PM"
 */
export function fmtEvtTime(str) {
  if (!str || !str.includes(':')) return str || '';
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return str;
  const period = h < 12 ? 'AM' : 'PM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Sort an array of event data rows by date + start time, ascending.
 * Each row is a string[] with dateIdx and startIdx columns.
 * @param {string[][]} dataRows
 * @param {number}     dateIdx
 * @param {number}     startIdx
 * @returns {string[][]}
 */
export function sortByDateTime(dataRows, dateIdx, startIdx) {
  return [...dataRows].sort((a, b) => {
    const da = `${a[dateIdx] || ''}T${a[startIdx] || '00:00'}`;
    const db = `${b[dateIdx] || ''}T${b[startIdx] || '00:00'}`;
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Calendar Events',
  icon: '📅',
  color: '#2563eb',
  priority: 35,
  itemNoun: 'Event',
  defaultHeaders: ['Event', 'Date', 'Start Time', 'End Time', 'Location', 'Type', 'Description'],

  detect(lower) {
    const hasEvent = lower.some(h => /^(event|appointment|meeting|title|subject)$/.test(h));
    const hasDate  = lower.some(h => /^(date|event.?date|start.?date|day)$/.test(h));
    const hasTime  = lower.some(h => /^(time|start.?time|end.?time|from|to)$/.test(h));
    return hasEvent && (hasDate || hasTime);
  },

  columns(lower) {
    const cols = { text: -1, date: -1, start: -1, end: -1, location: -1, type: -1, desc: -1 };
    const used = () => new Set(Object.values(cols).filter(v => v >= 0));

    cols.text     = lower.findIndex(h => /^(event|appointment|title|subject|meeting)$/.test(h));
    if (cols.text === -1) cols.text = 0;

    cols.date     = lower.findIndex((h, i) => !used().has(i) && /^(date|event.?date|day|start.?date)$/.test(h));
    cols.start    = lower.findIndex((h, i) => !used().has(i) && /^(start.?time|start|from|time)$/.test(h));
    cols.end      = lower.findIndex((h, i) => !used().has(i) && /^(end.?time|end|to|until|finish)$/.test(h));
    cols.location = lower.findIndex((h, i) => !used().has(i) && /^(location|place|venue|where|room)$/.test(h));
    cols.type     = lower.findIndex((h, i) => !used().has(i) && /^(type|category|kind|tag|label)$/.test(h));
    cols.desc     = lower.findIndex((h, i) => !used().has(i) && /^(description|notes?|detail|agenda|memo)$/.test(h));

    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Event',       colIndex: cols.text,     type: 'text', placeholder: 'Event name',   required: true },
      { role: 'date',     label: 'Date',         colIndex: cols.date,     type: 'date', placeholder: 'YYYY-MM-DD' },
      { role: 'start',    label: 'Start Time',   colIndex: cols.start,    type: 'text', placeholder: 'HH:MM' },
      { role: 'end',      label: 'End Time',     colIndex: cols.end,      type: 'text', placeholder: 'HH:MM' },
      { role: 'location', label: 'Location',     colIndex: cols.location, type: 'text', placeholder: 'Location' },
      { role: 'type',     label: 'Type',         colIndex: cols.type,     type: 'text', placeholder: 'Meeting' },
      { role: 'desc',     label: 'Description',  colIndex: cols.desc,     type: 'text', placeholder: 'Details' },
    ];
  },

  render(container, rows, cols) {
    // rows is already data-only (no header row — checklist.js slices it off)
    const dataRows = rows
      .map((row, i) => ({ row, rowIdx: i + 1 }))
      .filter(({ row }) => row.some(v => v));

    // Sort by date + start time
    const sorted = [...dataRows].sort((a, b) => {
      const da = `${a.row[cols.date] || ''}T${a.row[cols.start] || '00:00'}`;
      const db = `${b.row[cols.date] || ''}T${b.row[cols.start] || '00:00'}`;
      return da < db ? -1 : da > db ? 1 : 0;
    });

    // Group by date
    const groups = new Map();
    for (const item of sorted) {
      const d = cell(item.row, cols.date) || 'Undated';
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(item);
    }

    container.innerHTML = '';

    if (!groups.size) {
      container.appendChild(
        el('div', { className: 'gcal-empty' }, ['No events scheduled']),
      );
      return;
    }

    for (const [date, evtItems] of groups) {
      // Day section header
      const dayHeader = el('div', { className: 'gcal-day-header' }, [
        el('span', { className: 'gcal-day-label' }, [fmtEvtDate(date)]),
        el('span', { className: 'gcal-day-count' }, [
          `${evtItems.length} event${evtItems.length > 1 ? 's' : ''}`,
        ]),
      ]);
      container.appendChild(dayHeader);

      const daySection = el('div', { className: 'gcal-day-section' });

      for (const { row, rowIdx } of evtItems) {
        const typeVal  = cell(row, cols.type);
        const startVal = cell(row, cols.start);
        const endVal   = cell(row, cols.end);
        const locVal   = cell(row, cols.location);
        const descVal  = cell(row, cols.desc);

        // Time badge
        const timeParts = [];
        if (startVal) timeParts.push(fmtEvtTime(startVal));
        if (endVal)   timeParts.push(fmtEvtTime(endVal));
        const timeStr = timeParts.join(' – ');

        // Build card chips
        const chips = [];
        if (typeVal) {
          chips.push(el('span', { className: `gcal-type-badge ${evtTypeClass(typeVal)}` }, [
            evtTypeIcon(typeVal), ' ', typeVal,
          ]));
        }
        if (locVal) {
          chips.push(el('span', { className: 'gcal-location-chip' }, ['📍 ', locVal]));
        }
        if (descVal) {
          chips.push(el('span', { className: 'gcal-desc-chip' }, [descVal]));
        }

        // Title — editable
        const titleEl = editableCell('span', { className: 'gcal-event-title' },
          cell(row, cols.text), rowIdx, cols.text,
          {
            renderContent: (w) => { w.textContent = cell(row, cols.text) || 'Untitled'; },
            onCommit: (v, w) => { w.textContent = v; emitEdit(rowIdx, cols.text, v); },
          },
        );

        const card = el('div', { className: 'gcal-event-card' }, [
          el('div', { className: 'gcal-event-time' }, [timeStr || 'All day']),
          el('div', { className: 'gcal-event-body' }, [
            titleEl,
            chips.length ? el('div', { className: 'gcal-event-chips' }, chips) : null,
          ].filter(Boolean)),
        ]);

        daySection.appendChild(card);
      }

      container.appendChild(daySection);
    }
  },
};

registerTemplate('gcal', definition);

export { definition };
