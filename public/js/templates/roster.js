/* templates/roster.js — Roster: shift grid, all fields editable */

import { el, cell, editableCell, emitEdit, registerTemplate } from './shared.js';

const definition = {
  name: 'Roster',
  icon: '👥',
  color: '#6366f1',
  priority: 18,

  detect(lower) {
    return lower.some(h => /^(employee|staff|team.?member|worker|person|name)/.test(h))
      && lower.some(h => /^(shift|roster|rotation|schedule|availability|on.?call)/.test(h));
  },

  columns(lower) {
    const cols = { employee: -1, role: -1, shift: -1, days: [] };
    cols.employee = lower.findIndex(h => /^(employee|staff|team.?member|worker|person|name)/.test(h));
    if (cols.employee === -1) cols.employee = 0;
    cols.role     = lower.findIndex((h, i) => i !== cols.employee && /^(role|position|title|job|department|team)/.test(h));
    cols.shift    = lower.findIndex(h => /^(shift|rotation|type|roster|schedule|availability|on.?call)/.test(h));
    const dayPattern = /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/;
    for (let i = 0; i < lower.length; i++) {
      if (i !== cols.employee && i !== cols.role && i !== cols.shift && dayPattern.test(lower[i])) {
        cols.days.push(i);
      }
    }
    return cols;
  },

  shiftStates: ['Morning', 'Afternoon', 'Night', 'Off'],

  render(container, rows, cols, template) {
    // Header
    const headerRow = el('div', { className: 'roster-grid-row roster-header' });
    headerRow.append(el('div', { className: 'roster-cell roster-employee-cell' }, ['Employee']));
    if (cols.role >= 0) headerRow.append(el('div', { className: 'roster-cell roster-role-cell' }, ['Role']));
    if (cols.shift >= 0) headerRow.append(el('div', { className: 'roster-cell roster-shift-cell' }, ['Shift']));
    for (const dayIdx of cols.days) {
      const dayAbbrs = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      headerRow.append(el('div', { className: 'roster-cell roster-day-cell' }, [dayAbbrs[cols.days.indexOf(dayIdx)] || 'Day']));
    }
    container.append(headerRow);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const employee = cell(row, cols.employee) || row[0] || '—';
      const role = cols.role >= 0 ? cell(row, cols.role) : '';
      const shift = cols.shift >= 0 ? cell(row, cols.shift) : '';

      const rowEl = el('div', { className: 'roster-grid-row' });
      rowEl.append(editableCell('div', { className: 'roster-cell roster-employee-cell' }, employee, rowIdx, cols.employee));
      if (cols.role >= 0) rowEl.append(editableCell('div', { className: 'roster-cell roster-role-cell' }, role, rowIdx, cols.role));
      if (cols.shift >= 0) {
        const shiftBadge = el('button', {
          className: `roster-shift-btn roster-shift-${shift.toLowerCase().trim() || 'morning'}`,
          title: 'Click to cycle shift',
        }, [shift || 'Morning']);

        shiftBadge.addEventListener('click', () => {
          const states = template.shiftStates;
          const current = shiftBadge.textContent.trim();
          const idx = states.findIndex(s => s.toLowerCase() === current.toLowerCase());
          const next = states[(idx + 1) % states.length];
          shiftBadge.textContent = next;
          shiftBadge.className = `roster-shift-btn roster-shift-${next.toLowerCase().trim()}`;
          emitEdit(rowIdx, cols.shift, next);
        });

        rowEl.append(el('div', { className: 'roster-cell roster-shift-cell' }, [shiftBadge]));
      }

      for (const dayIdx of cols.days) {
        const val = cell(row, dayIdx);
        const checked = /^(✓|✔|x|yes|1|true)$/i.test(val.trim());
        const dayCell = el('div', {
          className: `roster-cell roster-day-cell roster-toggle ${checked ? 'roster-checked' : ''}`,
          title: 'Click to toggle',
          dataset: { rowIdx: String(rowIdx), colIdx: String(dayIdx) },
        }, [checked ? '✓' : '']);

        dayCell.addEventListener('click', () => {
          const nowChecked = !dayCell.classList.contains('roster-checked');
          dayCell.classList.toggle('roster-checked', nowChecked);
          dayCell.textContent = nowChecked ? '✓' : '';
          emitEdit(rowIdx, dayIdx, nowChecked ? '✓' : '');
        });

        rowEl.append(dayCell);
      }

      container.append(rowEl);
    }
  },
};

registerTemplate('roster', definition);
export default definition;
