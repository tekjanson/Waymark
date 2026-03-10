/* ============================================================
   templates/habit/index.js — Habit Tracker barrel module.
   Features: 4-state toggle, streaks, completion bars,
   category grouping (via parseGroups), goal tracking,
   and summary analytics panel.
   ============================================================ */

import {
  el, cell, editableCell, emitEdit,
  registerTemplate, delegateEvent, parseGroups,
} from '../shared.js';

import {
  habitState, STATE_CHAR, STATE_CYCLE, STATE_VALUE,
  computeStreak, parseGoal,
} from './helpers.js';

import { buildSummaryPanel, updateSummary } from './stats.js';

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Habit Tracker',
  icon: '\uD83D\uDD04',
  color: '#d97706',
  priority: 22,
  itemNoun: 'Habit',

  detect(lower) {
    return lower.some(h => /^(habit|routine|daily)/.test(h))
      && lower.some(h => /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|streak)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, days: [], streak: -1, category: -1, goal: -1 };
    cols.text     = lower.findIndex(h => /^(habit|routine|daily|activity|task|name)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.streak   = lower.findIndex(h => /^(streak|total|count|score)/.test(h));
    cols.category = lower.findIndex((h, i) =>
      i !== cols.text && i !== cols.streak
      && /^(category|group|type|area|pillar)/.test(h));
    cols.goal = lower.findIndex((h, i) =>
      i !== cols.text && i !== cols.streak && i !== cols.category
      && /^(goal|target|frequency|aim)/.test(h));
    const dayPattern = /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/;
    for (let i = 0; i < lower.length; i++) {
      if ([cols.text, cols.streak, cols.category, cols.goal].includes(i)) continue;
      if (dayPattern.test(lower[i])) cols.days.push(i);
    }
    return cols;
  },

  addRowFields(cols) {
    const fields = [
      { role: 'text', label: 'Habit', colIndex: cols.text, type: 'text', placeholder: 'New habit', required: true },
    ];
    if (cols.category >= 0) {
      fields.push({ role: 'category', label: 'Category', colIndex: cols.category, type: 'text', placeholder: 'e.g. Health' });
    }
    if (cols.goal >= 0) {
      fields.push({ role: 'goal', label: 'Goal', colIndex: cols.goal, type: 'text', placeholder: 'e.g. 5x/week' });
    }
    return fields;
  },

  render(container, rows, cols) {
    const hasCategories = cols.category >= 0;
    const hasGoals      = cols.goal >= 0;

    /* ---- Delegated day toggle ---- */
    delegateEvent(container, 'click', '.habit-toggle', (e, dayCell) => {
      const curState = dayCell.dataset.state || 'empty';
      const curIdx   = STATE_CYCLE.indexOf(curState);
      const nextState = STATE_CYCLE[(curIdx + 1) % STATE_CYCLE.length];

      dayCell.dataset.state = nextState;
      dayCell.className = `habit-grid-cell habit-day-cell habit-toggle habit-${nextState}`;
      dayCell.textContent = STATE_CHAR[nextState];

      const rowIdx = Number(dayCell.dataset.rowIdx);
      const colIdx = Number(dayCell.dataset.colIdx);
      emitEdit(rowIdx, colIdx, STATE_VALUE[nextState]);

      /* Update streak display for this row */
      const gridRow  = dayCell.closest('.habit-grid-row');
      const streakEl = gridRow?.querySelector('.habit-streak-cell');
      if (streakEl) {
        const toggles = gridRow.querySelectorAll('.habit-toggle');
        let streak = 0;
        for (let d = toggles.length - 1; d >= 0; d--) {
          if (toggles[d].dataset.state === 'done') streak++;
          else break;
        }
        streakEl.textContent = streak > 0 ? `\uD83D\uDD25 ${streak}` : '\u2014';
        streakEl.classList.toggle('habit-streak-active', streak > 0);
        if (cols.streak >= 0) emitEdit(rowIdx, cols.streak, String(streak));
      }

      /* Update goal progress for this row */
      if (hasGoals) {
        const goalEl = gridRow?.querySelector('.habit-goal-progress');
        if (goalEl) {
          const toggles = gridRow.querySelectorAll('.habit-toggle');
          let done = 0;
          for (const t of toggles) { if (t.dataset.state === 'done') done++; }
          const target = Number(goalEl.dataset.target) || 0;
          goalEl.textContent = target > 0 ? `${done}/${target}` : `${done}`;
          goalEl.classList.toggle('habit-goal-met', target > 0 && done >= target);
        }
      }

      updateCompletionBars(container, cols);
      updateSummary(container, cols);
    });

    /* ---- Build grids ---- */
    if (hasCategories) {
      const groups = parseGroups(rows, cols.category);
      for (const group of groups) {
        const section = el('div', { className: 'habit-category-section' });
        const catName = cell(group.row, cols.category) || 'Uncategorized';
        section.append(el('div', { className: 'habit-category-header' }, [
          el('span', { className: 'habit-category-icon' }, ['\uD83D\uDCC2']),
          el('h4', { className: 'habit-category-title' }, [catName]),
          el('span', { className: 'habit-category-count' }, [
            `${1 + group.children.length} habit${group.children.length ? 's' : ''}`,
          ]),
        ]));
        const allGroupRows = [group.row, ...group.children.map(c => c.row)];
        const allGroupIdxs = [group.idx, ...group.children.map(c => c.idx)];
        const grid = el('div', { className: 'habit-grid' });
        renderGrid(grid, allGroupRows, cols, hasGoals, allGroupIdxs);
        section.append(grid);
        container.append(section);
      }
    } else {
      const grid = el('div', { className: 'habit-grid' });
      renderGrid(grid, rows, cols, hasGoals, null);
      container.append(grid);
    }

    /* ---- Summary panel ---- */
    container.append(buildSummaryPanel());
    updateSummary(container, cols);
  },
};

/* ---------- Grid Renderer ---------- */

/**
 * Render the habit grid (header + data rows + completion footer).
 * @param {HTMLElement}   grid
 * @param {string[][]}    rows
 * @param {Object}        cols
 * @param {boolean}       hasGoals
 * @param {number[]|null} idxOverrides — original row indices (for grouped mode)
 */
function renderGrid(grid, rows, cols, hasGoals, idxOverrides) {
  /* Header */
  const headerRow = el('div', { className: 'habit-grid-row habit-grid-header' });
  headerRow.append(el('div', { className: 'habit-grid-cell habit-name-cell' }, ['Habit']));
  const dayAbbr = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let d = 0; d < cols.days.length; d++) {
    headerRow.append(el('div', { className: 'habit-grid-cell habit-day-cell' }, [dayAbbr[d] || 'Day']));
  }
  headerRow.append(el('div', { className: 'habit-grid-cell habit-streak-cell' }, ['\uD83D\uDD25']));
  if (hasGoals) headerRow.append(el('div', { className: 'habit-grid-cell habit-goal-cell' }, ['\uD83C\uDFAF']));
  grid.append(headerRow);

  /* Data rows */
  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const rowIdx = (idxOverrides ? idxOverrides[i] : i) + 1; // 1-based
    const text   = cell(row, cols.text) || row[0] || '\u2014';

    const gridRow = el('div', { className: 'habit-grid-row' });
    gridRow.append(editableCell('div', { className: 'habit-grid-cell habit-name-cell' }, text, rowIdx, cols.text));

    let doneCount = 0;
    for (const dayIdx of cols.days) {
      const val   = cell(row, dayIdx);
      const state = habitState(val);
      if (state === 'done') doneCount++;
      gridRow.append(el('div', {
        className: `habit-grid-cell habit-day-cell habit-toggle habit-${state}`,
        title: 'Click to cycle: \u2713 ~ \u2717',
        dataset: { rowIdx: String(rowIdx), colIdx: String(dayIdx), state },
      }, [STATE_CHAR[state]]));
    }

    /* Streak */
    const sheetStreak = cols.streak >= 0 ? cell(row, cols.streak) : '';
    const streak = sheetStreak ? Number(sheetStreak) || 0 : computeStreak(row, cols.days);
    gridRow.append(el('div', {
      className: `habit-grid-cell habit-streak-cell ${streak > 0 ? 'habit-streak-active' : ''}`,
    }, [streak > 0 ? `\uD83D\uDD25 ${streak}` : '\u2014']));

    /* Goal progress */
    if (hasGoals) {
      const goalRaw = cell(row, cols.goal);
      const target  = parseGoal(goalRaw);
      const label   = target > 0 ? `${doneCount}/${target}` : (goalRaw || '\u2014');
      const met     = target > 0 && doneCount >= target;
      gridRow.append(el('div', { className: 'habit-grid-cell habit-goal-cell' }, [
        el('span', {
          className: `habit-goal-progress ${met ? 'habit-goal-met' : ''}`,
          dataset: { target: String(target) },
        }, [label]),
      ]));
    }

    grid.append(gridRow);
  }

  /* Completion footer */
  const footerRow = el('div', { className: 'habit-grid-row habit-grid-footer' });
  footerRow.append(el('div', { className: 'habit-grid-cell habit-name-cell' }, ['Completion']));
  for (let d = 0; d < cols.days.length; d++) {
    footerRow.append(el('div', { className: 'habit-grid-cell habit-day-cell habit-completion-cell' }));
  }
  footerRow.append(el('div', { className: 'habit-grid-cell habit-streak-cell' }));
  if (hasGoals) footerRow.append(el('div', { className: 'habit-grid-cell habit-goal-cell' }));
  grid.append(footerRow);
  updateCompletionBars(grid, cols);
}

/* ---------- Completion Bars ---------- */

/**
 * Update completion percentage bars in the footer row(s).
 * @param {HTMLElement} container
 * @param {Object}      cols
 */
function updateCompletionBars(container, cols) {
  const footers = container.querySelectorAll('.habit-grid-footer');
  for (const footer of footers) {
    const completionCells = footer.querySelectorAll('.habit-completion-cell');
    const grid = footer.closest('.habit-grid') || container;
    for (let d = 0; d < cols.days.length; d++) {
      const dayIdx  = cols.days[d];
      const toggles = grid.querySelectorAll(`.habit-toggle[data-col-idx="${dayIdx}"]`);
      let done = 0;
      for (const t of toggles) { if (t.dataset.state === 'done') done++; }
      const total = toggles.length || 1;
      const pct   = Math.round((done / total) * 100);
      const c     = completionCells[d];
      if (!c) continue;
      while (c.firstChild) c.removeChild(c.firstChild);
      const bar = el('div', { className: 'habit-completion-bar' });
      bar.append(el('div', { className: 'habit-completion-fill', style: `width: ${pct}%` }));
      c.append(bar);
      c.append(el('span', { className: 'habit-completion-pct' }, [`${pct}%`]));
    }
  }
}

registerTemplate('habit', definition);
export default definition;
