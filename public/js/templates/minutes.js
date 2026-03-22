/* ============================================================
   templates/minutes.js — Meeting Minutes: rows grouped by meeting
   ============================================================ */

import { el, cell, editableCell, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

/** Parse comma/semicolon-separated attendees into an array of trimmed names */
function parseAttendees(raw) {
  if (!raw) return [];
  return raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
}

/** Format ISO date string to "Jan 15, 2026", or return raw value if not a date */
function formatMeetingDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Meeting Minutes',
  icon: '📝',
  color: '#0ea5e9',
  priority: 19,
  itemNoun: 'Agenda Item',
  defaultHeaders: ['Meeting', 'Date', 'Attendees', 'Agenda', 'Decision', 'Action Item', 'Owner', 'Due'],

  detect(lower) {
    return lower.some(h => /^(meeting|session|minutes)/.test(h))
      && lower.some(h => /^(agenda|topic|item|discussion)/.test(h));
  },

  columns(lower) {
    const cols = {
      meeting: -1, date: -1, attendees: -1,
      agenda: -1, decision: -1, actionItem: -1,
      owner: -1, due: -1,
    };
    cols.meeting    = lower.findIndex(h => /^(meeting|session|title|minutes)/.test(h));
    if (cols.meeting === -1) cols.meeting = 0;
    cols.date       = lower.findIndex(h => /^(date|when|day|scheduled)/.test(h));
    cols.attendees  = lower.findIndex(h => /^(attendees?|participants?|people|members?|invitees?)/.test(h));
    cols.agenda     = lower.findIndex(h => /^(agenda|topic|item|discussion|subject)/.test(h));
    cols.decision   = lower.findIndex(h => /^(decision|outcome|resolution|result)/.test(h));
    cols.actionItem = lower.findIndex(h => /^(action.?item|action|task|follow.?up|todo)/.test(h));
    cols.owner      = lower.findIndex(h => /^(owner|assigned|person|assignee|responsible)/.test(h));
    cols.due        = lower.findIndex(h => /^(due|deadline|due.?date|by|target.?date)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'meeting',    label: 'Meeting',      colIndex: cols.meeting,    type: 'text', placeholder: 'Meeting name', required: true },
      { role: 'date',       label: 'Date',         colIndex: cols.date,       type: 'date', defaultValue: '__TODAY__' },
      { role: 'attendees',  label: 'Attendees',    colIndex: cols.attendees,  type: 'text', placeholder: 'Alice, Bob, Charlie' },
      { role: 'agenda',     label: 'Agenda item',  colIndex: cols.agenda,     type: 'text', placeholder: 'Topic or agenda item', required: true },
      { role: 'decision',   label: 'Decision',     colIndex: cols.decision,   type: 'text', placeholder: 'What was decided?' },
      { role: 'actionItem', label: 'Action item',  colIndex: cols.actionItem, type: 'text', placeholder: 'Follow-up task' },
      { role: 'owner',      label: 'Owner',        colIndex: cols.owner,      type: 'text', placeholder: 'Responsible person' },
      { role: 'due',        label: 'Due',          colIndex: cols.due,        type: 'date' },
    ];
  },

  render(container, rows, cols) {
    /* ---- Group rows by (meeting + date) key ---- */
    const groupMap = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row     = rows[i];
      const meeting = cell(row, cols.meeting) || 'Untitled Meeting';
      const date    = cell(row, cols.date)    || '';
      const key     = `${meeting}\x00${date}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          meeting,
          date,
          attendees: cell(row, cols.attendees) || '',
          items: [],
        });
      }
      groupMap.get(key).items.push({ row, rowIdx: i + 1 });
    }

    /* ---- Sort groups: most recent date first ---- */
    const groups = [...groupMap.values()].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    if (groups.length === 0) {
      container.append(el('div', { className: 'minutes-empty' }, ['No meeting entries yet.']));
      return;
    }

    const layout = el('div', { className: 'minutes-layout' });
    let isFirst = true;

    for (const group of groups) {
      const section = el('div', { className: 'minutes-meeting' });

      /* ---- Attendee chips ---- */
      const names = parseAttendees(group.attendees);
      const attendeeChips = names.length > 0
        ? el('div', { className: 'minutes-attendees' },
            names.map(n => el('span', { className: 'minutes-attendee-chip' }, [n])))
        : null;

      /* ---- Meeting header ---- */
      const chevron = el('span', { className: 'minutes-chevron' }, ['▼']);
      const header = el('div', { className: 'minutes-meeting-header' }, [
        chevron,
        el('span', { className: 'minutes-meeting-title' }, [group.meeting]),
        group.date
          ? el('span', { className: 'minutes-meeting-date' }, [formatMeetingDate(group.date)])
          : null,
        attendeeChips,
        el('span', { className: 'minutes-item-count' }, [`${group.items.length}`]),
      ]);
      section.append(header);

      /* ---- Agenda items body ---- */
      const body = el('div', { className: 'minutes-body' });

      for (const { row, rowIdx } of group.items) {
        const agenda     = cell(row, cols.agenda);
        const decision   = cell(row, cols.decision);
        const actionItem = cell(row, cols.actionItem);
        const owner      = cell(row, cols.owner);
        const due        = cell(row, cols.due);

        const hasActionRow = actionItem || owner || due || cols.actionItem >= 0;

        const itemEl = el('div', { className: 'minutes-item' }, [
          /* Left: Agenda topic */
          el('div', { className: 'minutes-agenda' }, [
            el('div', { className: 'minutes-agenda-label' }, ['Agenda']),
            cols.agenda >= 0
              ? editableCell('div', { className: 'minutes-agenda-text' }, agenda, rowIdx, cols.agenda)
              : el('div', { className: 'minutes-agenda-text' }, [agenda || '—']),
          ]),
          /* Right: Decision */
          el('div', { className: 'minutes-decision' }, [
            el('div', { className: 'minutes-decision-label' }, ['Decision']),
            cols.decision >= 0
              ? editableCell('div', { className: 'minutes-decision-text' }, decision, rowIdx, cols.decision)
              : el('div', { className: 'minutes-decision-text' }, [decision || '—']),
          ]),
          /* Full-width: Action item row */
          hasActionRow
            ? el('div', { className: 'minutes-action-row' }, [
                el('span', { className: 'minutes-action-label' }, ['Action']),
                cols.actionItem >= 0
                  ? editableCell('span', { className: 'minutes-action-text' }, actionItem, rowIdx, cols.actionItem)
                  : el('span', { className: 'minutes-action-text' }, [actionItem || '—']),
                owner && cols.owner >= 0
                  ? editableCell('span', { className: 'minutes-owner-badge' }, owner, rowIdx, cols.owner)
                  : owner
                    ? el('span', { className: 'minutes-owner-badge' }, [owner])
                    : null,
                due && cols.due >= 0
                  ? editableCell('span', { className: 'minutes-due-badge' }, due, rowIdx, cols.due)
                  : due
                    ? el('span', { className: 'minutes-due-badge' }, [due])
                    : null,
              ])
            : null,
        ]);
        body.append(itemEl);
      }

      section.append(body);

      /* First meeting starts expanded, rest start collapsed */
      if (!isFirst) {
        section.classList.add('minutes-collapsed');
      }
      isFirst = false;

      /* Toggle collapse on header click */
      header.addEventListener('click', () => {
        section.classList.toggle('minutes-collapsed');
      });

      layout.append(section);
    }

    container.append(layout);
  },
};

registerTemplate('minutes', definition);
export default definition;
