/* ============================================================
   templates/roster.js — Roster: shift grid, weekly nav, summary
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, delegateEvent, cycleStatus, buildDirSyncBtn } from './shared.js';

/* ---------- Constants ---------- */
const DAY_ABBRS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_PER_PAGE = 7;

const definition = {
  name: 'Roster',
  icon: '👥',
  color: '#6366f1',
  priority: 18,
  itemNoun: 'Employee',
  defaultHeaders: ['Employee', 'Role', 'Shift', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],

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

  addRowFields(cols) {
    return [
      { role: 'employee', label: 'Employee', colIndex: cols.employee, type: 'text',   placeholder: 'Name', required: true },
      { role: 'role',     label: 'Role',     colIndex: cols.role,     type: 'text',   placeholder: 'Position or title' },
      { role: 'shift',    label: 'Shift',    colIndex: cols.shift,    type: 'select', options: ['Morning', 'Afternoon', 'Night', 'Off'], defaultValue: 'Morning' },
    ];
  },

  shiftStates: ['Morning', 'Afternoon', 'Night', 'Off'],

  render(container, rows, cols, template) {
    /* ---------- Week navigation ---------- */
    const totalDays = cols.days.length;
    const totalPages = Math.max(1, Math.ceil(totalDays / DAYS_PER_PAGE));
    let currentPage = 0;

    /** Get the slice of day column indices for the current page */
    function visibleDays() {
      const start = currentPage * DAYS_PER_PAGE;
      return cols.days.slice(start, start + DAYS_PER_PAGE);
    }

    const prevBtn = el('button', { className: 'roster-nav-btn', disabled: true }, ['\u2190 Prev']);
    const nextBtn = el('button', { className: 'roster-nav-btn', disabled: totalPages <= 1 }, ['Next \u2192']);
    const weekLabel = el('span', { className: 'roster-week-label' }, [`Week 1 of ${totalPages}`]);

    const toolbar = el('div', { className: 'roster-toolbar' }, [prevBtn, weekLabel, nextBtn]);
    container.append(toolbar);

    /* ---------- Grid wrapper (rebuilt on page change) ---------- */
    const gridWrap = el('div', { className: 'roster-grid' });
    container.append(gridWrap);

    /** Build or rebuild the grid for the current page of days */
    function buildGrid() {
      while (gridWrap.firstChild) gridWrap.removeChild(gridWrap.firstChild);
      const vDays = visibleDays();

      /* Header row */
      const headerRow = el('div', { className: 'roster-grid-row roster-header' });
      headerRow.append(el('div', { className: 'roster-cell roster-employee-cell' }, ['Employee']));
      if (cols.role >= 0) headerRow.append(el('div', { className: 'roster-cell roster-role-cell' }, ['Role']));
      if (cols.shift >= 0) headerRow.append(el('div', { className: 'roster-cell roster-shift-cell' }, ['Shift']));
      for (const dayIdx of vDays) {
        headerRow.append(el('div', { className: 'roster-cell roster-day-cell' },
          [DAY_ABBRS[cols.days.indexOf(dayIdx)] || 'Day']));
      }
      gridWrap.append(headerRow);

      /* Data rows */
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowIdx = i + 1;
        const employee = cell(row, cols.employee) || row[0] || '\u2014';
        const role = cols.role >= 0 ? cell(row, cols.role) : '';
        const shift = cols.shift >= 0 ? cell(row, cols.shift) : '';

        const rowEl = el('div', { className: 'roster-grid-row' });
        rowEl.append(editableCell('div', { className: 'roster-cell roster-employee-cell' }, employee, rowIdx, cols.employee));
        if (cols.role >= 0) rowEl.append(editableCell('div', { className: 'roster-cell roster-role-cell' }, role, rowIdx, cols.role));
        if (cols.shift >= 0) {
          const shiftBadge = el('button', {
            className: `roster-shift-btn roster-shift-${shift.toLowerCase().trim() || 'morning'}`,
            title: 'Click to cycle shift',
            dataset: { rowIdx: String(rowIdx) },
          }, [shift || 'Morning']);
          rowEl.append(el('div', { className: 'roster-cell roster-shift-cell' }, [shiftBadge]));
        }

        for (const dayIdx of vDays) {
          const val = cell(row, dayIdx);
          const checked = /^(✓|✔|x|yes|1|true)$/i.test(val.trim());
          rowEl.append(el('div', {
            className: `roster-cell roster-day-cell roster-toggle ${checked ? 'roster-checked' : ''}`,
            title: 'Click to toggle',
            dataset: { rowIdx: String(rowIdx), colIdx: String(dayIdx) },
          }, [checked ? '\u2713' : '']));
        }

        gridWrap.append(rowEl);
      }

      /* ---------- Summary row ---------- */
      const summaryRow = el('div', { className: 'roster-grid-row roster-summary' });
      summaryRow.append(el('div', { className: 'roster-cell roster-employee-cell roster-summary-label' }, ['Coverage']));
      if (cols.role >= 0) summaryRow.append(el('div', { className: 'roster-cell roster-role-cell' }));
      if (cols.shift >= 0) summaryRow.append(el('div', { className: 'roster-cell roster-shift-cell' }));

      for (const dayIdx of vDays) {
        /* Count checked employees per shift for this day */
        const shiftCounts = {};
        let totalChecked = 0;
        for (let i = 0; i < rows.length; i++) {
          const val = cell(rows[i], dayIdx);
          const checked = /^(✓|✔|x|yes|1|true)$/i.test(val.trim());
          if (checked) {
            totalChecked++;
            const shift = (cols.shift >= 0 ? cell(rows[i], cols.shift) : '').trim() || 'Morning';
            shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
          }
        }

        const parts = Object.entries(shiftCounts).map(([s, c]) => `${s[0]}:${c}`);
        const noCoverage = totalChecked === 0;

        summaryRow.append(el('div', {
          className: `roster-cell roster-day-cell roster-summary-day ${noCoverage ? 'roster-no-coverage' : ''}`,
          title: noCoverage ? 'No coverage!' : Object.entries(shiftCounts).map(([s, c]) => `${s}: ${c}`).join(', '),
        }, [noCoverage ? '\u26A0' : parts.join(' ')]));
      }
      gridWrap.append(summaryRow);

      /* Update nav state */
      prevBtn.disabled = currentPage === 0;
      nextBtn.disabled = currentPage >= totalPages - 1;
      weekLabel.textContent = `Week ${currentPage + 1} of ${totalPages}`;
    }

    /* ---------- Delegated events ---------- */
    if (cols.shift >= 0) {
      delegateEvent(container, 'click', '.roster-shift-btn', (e, btn) => {
        const next = cycleStatus(btn, template.shiftStates, s => s.toLowerCase().trim(), 'roster-shift-btn roster-shift-');
        emitEdit(Number(btn.dataset.rowIdx), cols.shift, next);
      });
    }

    delegateEvent(container, 'click', '.roster-toggle', (e, dayCell) => {
      const nowChecked = !dayCell.classList.contains('roster-checked');
      dayCell.classList.toggle('roster-checked', nowChecked);
      dayCell.textContent = nowChecked ? '\u2713' : '';
      emitEdit(Number(dayCell.dataset.rowIdx), Number(dayCell.dataset.colIdx), nowChecked ? '\u2713' : '');
    });

    /* Nav button handlers */
    prevBtn.addEventListener('click', () => {
      if (currentPage > 0) { currentPage--; buildGrid(); }
    });
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages - 1) { currentPage++; buildGrid(); }
    });

    /* Initial render */
    buildGrid();
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'roster-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'roster-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'roster-dir-icon tmpl-dir-icon' }, ['\uD83D\uDC65']),
      el('span', { className: 'roster-dir-title tmpl-dir-title' }, ['Rosters']),
      el('span', { className: 'roster-dir-count tmpl-dir-count' }, [
        `${sheets.length} roster${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'roster-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'roster-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'roster-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'roster-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} employee${rows.length !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.roster-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('roster', definition);
export default definition;
