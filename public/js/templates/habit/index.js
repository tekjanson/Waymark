/* ============================================================
   templates/habit/index.js — Habit Tracker barrel module.
   Features: 5 time-scale views (Day / Week / Month / Quarter / Year),
   multi-week tracking via "Week Of" column, streaks, completion bars,
   category grouping (via parseGroups), goal tracking, and summary
   analytics. Backward compatible with single-week sheets.
   ============================================================ */

import {
  el, cell, editableCell, emitEdit,
  registerTemplate, delegateEvent, parseGroups,
} from '../shared.js';

import {
  habitState, STATE_CHAR, STATE_CYCLE, STATE_VALUE,
  computeStreak, computeMultiWeekStreak, parseGoal,
  WEEK_COL_PATTERN, getUniqueWeeks, parseWeekDate,
  formatWeekISO, formatWeekLabel, formatDayLabel,
  formatMonthLabel, formatQuarterLabel,
  DAY_ABBR, DAY_NAMES, MONTH_NAMES,
  getWeekStart, getCurrentMonday, getNextWeekStart,
  dateToDayIndex, findWeekForDate, findClosestWeek,
  getQuarter, getQuarterMonths,
  dayCompletionRate, weekCompletionRate,
} from './helpers.js';

import {
  renderDayView, renderWeekView, renderMonthView,
  renderQuarterView, renderYearView, updateCompletionBars,
} from './views.js';

import { buildSummaryPanel, updateSummary } from './stats.js';

/* ---------- View Constants ---------- */

const VIEWS = [
  { key: 'day',     label: 'Day',     icon: '\uD83D\uDCC5' },
  { key: 'week',    label: 'Week',    icon: '\uD83D\uDCC6' },
  { key: 'month',   label: 'Month',   icon: '\uD83D\uDDD3\uFE0F' },
  { key: 'quarter', label: 'Quarter', icon: '\uD83D\uDCCA' },
  { key: 'year',    label: 'Year',    icon: '\uD83C\uDF10' },
];

/* Multi-week views (require Week Of column) */
const MULTI_WEEK_VIEWS = ['month', 'quarter', 'year'];

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Habit Tracker',
  icon: '\uD83D\uDD04',
  color: '#d97706',
  priority: 22,
  itemNoun: 'Habit',

  migrations: [
    { role: 'weekOf', header: 'Week Of' },
  ],

  detect(lower) {
    return lower.some(h => /^(habit|routine|daily)/.test(h))
      && lower.some(h => /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|streak)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, days: [], streak: -1, category: -1, goal: -1, weekOf: -1 };
    cols.text     = lower.findIndex(h => /^(habit|routine|daily|activity|task|name)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.streak   = lower.findIndex(h => /^(streak|total|count|score)/.test(h));
    cols.category = lower.findIndex((h, i) =>
      i !== cols.text && i !== cols.streak
      && /^(category|group|type|area|pillar)/.test(h));
    cols.goal = lower.findIndex((h, i) =>
      i !== cols.text && i !== cols.streak && i !== cols.category
      && /^(goal|target|frequency|aim)/.test(h));
    cols.weekOf = lower.findIndex((h, i) =>
      i !== cols.text && i !== cols.streak && i !== cols.category && i !== cols.goal
      && WEEK_COL_PATTERN.test(h));
    const dayPattern = /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/;
    for (let i = 0; i < lower.length; i++) {
      if ([cols.text, cols.streak, cols.category, cols.goal, cols.weekOf].includes(i)) continue;
      if (dayPattern.test(lower[i])) cols.days.push(i);
    }
    return cols;
  },

  addRowFields(cols) {
    const fields = [
      { role: 'text', label: 'Habit', colIndex: cols.text, type: 'text', placeholder: 'New habit', required: true },
    ];
    if (cols.weekOf >= 0) {
      fields.push({ role: 'weekOf', label: 'Week Of', colIndex: cols.weekOf, type: 'text', placeholder: 'e.g. 2026-03-10' });
    }
    if (cols.category >= 0) {
      fields.push({ role: 'category', label: 'Category', colIndex: cols.category, type: 'text', placeholder: 'e.g. Health' });
    }
    if (cols.goal >= 0) {
      fields.push({ role: 'goal', label: 'Goal', colIndex: cols.goal, type: 'text', placeholder: 'e.g. 5x/week' });
    }
    return fields;
  },

  render(container, rows, cols, template) {
    const isMultiWeek = cols.weekOf >= 0;
    const hasCategories = cols.category >= 0;
    const hasGoals = cols.goal >= 0;

    /* Parse multi-week data */
    let weeks = [];
    if (isMultiWeek) {
      weeks = getUniqueWeeks(rows, cols.weekOf);
    }

    /* View state */
    const state = {
      activeView: 'day',
      currentDate: new Date(),
      weekIdx: isMultiWeek ? weeks.length - 1 : 0,
    };

    /* Determine available views */
    const availableViews = isMultiWeek
      ? VIEWS
      : VIEWS.filter(v => !MULTI_WEEK_VIEWS.includes(v.key));

    /* ---- Build UI structure ---- */

    /* View switcher tabs */
    const viewSwitcher = el('div', { className: 'habit-view-switcher' });
    for (const v of availableViews) {
      const tab = el('button', {
        className: `habit-view-tab ${v.key === state.activeView ? 'habit-view-tab-active' : ''}`,
        dataset: { view: v.key },
      }, [`${v.icon} ${v.label}`]);
      viewSwitcher.append(tab);
    }
    container.append(viewSwitcher);

    /* Time navigator */
    const timeNav = el('div', { className: 'habit-time-nav' });
    const prevBtn = el('button', { className: 'habit-time-btn habit-time-prev' }, ['\u25C0']);
    const timeLabel = el('span', { className: 'habit-time-label' });
    const nextBtn = el('button', { className: 'habit-time-btn habit-time-next' }, ['\u25B6']);
    const todayBtn = el('button', { className: 'habit-time-today' }, ['Today']);
    timeNav.append(prevBtn, timeLabel, nextBtn, todayBtn);

    /* Add Week button (multi-week only) */
    let addWeekBtn = null;
    if (isMultiWeek && template && template._onInsertAfterRow) {
      addWeekBtn = el('button', { className: 'habit-add-week-btn' }, ['+ New Week']);
      timeNav.append(addWeekBtn);
    }
    container.append(timeNav);

    /* Upgrade button (single-week only) */
    if (!isMultiWeek && template && template._onInsertAfterRow) {
      const upgradeBtn = el('button', { className: 'habit-upgrade-btn' }, [
        '\uD83D\uDCC5 Start Tracking Weeks',
      ]);
      upgradeBtn.addEventListener('click', async () => {
        upgradeBtn.disabled = true;
        upgradeBtn.textContent = 'Setting up...';
        const newColIdx = template._totalColumns || (rows[0] ? rows[0].length : 9);
        const monday = formatWeekISO(getCurrentMonday());
        const nextMonday = formatWeekISO(getNextWeekStart(getCurrentMonday()));

        /* Build pending edits: add "Week Of" header + fill all existing rows */
        const pendingEdits = [{ rowIdx: 0, colIdx: newColIdx, value: 'Week Of' }];
        for (let i = 0; i < rows.length; i++) {
          pendingEdits.push({ rowIdx: i + 1, colIdx: newColIdx, value: monday });
        }

        /* Create second week rows (empty) for each habit */
        const newRows = [];
        for (const row of rows) {
          const newRow = new Array(newColIdx + 1).fill('');
          newRow[cols.text] = cell(row, cols.text);
          newRow[newColIdx] = nextMonday;
          if (cols.category >= 0) newRow[cols.category] = cell(row, cols.category);
          if (cols.goal >= 0) newRow[cols.goal] = cell(row, cols.goal);
          if (cols.streak >= 0) newRow[cols.streak] = '0';
          newRows.push(newRow);
        }

        await template._onInsertAfterRow(rows.length, newRows, pendingEdits);
      });
      container.append(upgradeBtn);
    }

    /* View content area */
    const viewContent = el('div', { className: 'habit-view-content' });
    container.append(viewContent);

    /* Summary panel */
    container.append(buildSummaryPanel());

    /* ---- Delegated day toggle (shared across Day and Week views) ---- */
    delegateEvent(container, 'click', '.habit-toggle', (e, dayCell) => {
      const curState = dayCell.dataset.state || 'empty';
      const curIdx = STATE_CYCLE.indexOf(curState);
      const nextState = STATE_CYCLE[(curIdx + 1) % STATE_CYCLE.length];

      dayCell.dataset.state = nextState;
      dayCell.className = `habit-grid-cell habit-day-cell habit-toggle habit-${nextState}`;
      dayCell.textContent = STATE_CHAR[nextState];

      const rowIdx = Number(dayCell.dataset.rowIdx);
      const colIdx = Number(dayCell.dataset.colIdx);
      emitEdit(rowIdx, colIdx, STATE_VALUE[nextState]);

      /* Update streak display */
      const gridRow = dayCell.closest('.habit-grid-row');
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

      /* Update goal progress */
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
      updateSummary(container, cols, weeks, state.weekIdx);
    });

    /* Delegated day-item toggle (Day View) */
    delegateEvent(container, 'click', '.habit-day-item', (e, item) => {
      const curState = item.dataset.state || 'empty';
      const curIdx = STATE_CYCLE.indexOf(curState);
      const nextState = STATE_CYCLE[(curIdx + 1) % STATE_CYCLE.length];

      item.dataset.state = nextState;
      item.className = `habit-day-item habit-day-item-${nextState}`;
      const check = item.querySelector('.habit-day-check');
      if (check) check.textContent = STATE_CHAR[nextState] || '\u00A0';

      const rowIdx = Number(item.dataset.rowIdx);
      const colIdx = Number(item.dataset.colIdx);
      emitEdit(rowIdx, colIdx, STATE_VALUE[nextState]);

      /* Update progress bar */
      const items = container.querySelectorAll('.habit-day-item');
      let done = 0;
      for (const it of items) { if (it.dataset.state === 'done') done++; }
      const total = items.length || 1;
      const pct = Math.round((done / total) * 100);
      const fill = container.querySelector('.habit-day-progress-fill');
      const text = container.querySelector('.habit-day-progress-text');
      if (fill) fill.style.width = `${pct}%`;
      if (text) text.textContent = `${done} of ${total} complete (${pct}%)`;
    });

    /* ---- Navigation helpers ---- */

    function getTimeLabel() {
      switch (state.activeView) {
        case 'day':
          return formatDayLabel(state.currentDate);
        case 'week': {
          if (isMultiWeek && weeks[state.weekIdx]) {
            return weeks[state.weekIdx].label + ` (${state.weekIdx + 1} of ${weeks.length})`;
          }
          return 'This Week';
        }
        case 'month':
          return formatMonthLabel(state.currentDate.getFullYear(), state.currentDate.getMonth());
        case 'quarter': {
          const q = getQuarter(state.currentDate.getMonth());
          return formatQuarterLabel(state.currentDate.getFullYear(), q);
        }
        case 'year':
          return String(state.currentDate.getFullYear());
        default:
          return '';
      }
    }

    function navigate(delta) {
      switch (state.activeView) {
        case 'day':
          state.currentDate.setDate(state.currentDate.getDate() + delta);
          break;
        case 'week':
          if (isMultiWeek) {
            state.weekIdx = Math.max(0, Math.min(weeks.length - 1, state.weekIdx + delta));
            state.currentDate = new Date(weeks[state.weekIdx].date);
          }
          break;
        case 'month':
          state.currentDate.setMonth(state.currentDate.getMonth() + delta);
          break;
        case 'quarter':
          state.currentDate.setMonth(state.currentDate.getMonth() + (delta * 3));
          break;
        case 'year':
          state.currentDate.setFullYear(state.currentDate.getFullYear() + delta);
          break;
      }
      rebuildView();
    }

    function goToday() {
      state.currentDate = new Date();
      if (isMultiWeek) {
        const idx = findWeekForDate(weeks, state.currentDate);
        state.weekIdx = idx >= 0 ? idx : weeks.length - 1;
      }
      rebuildView();
    }

    function switchView(viewKey) {
      state.activeView = viewKey;
      /* Update tab active state */
      for (const tab of viewSwitcher.querySelectorAll('.habit-view-tab')) {
        tab.classList.toggle('habit-view-tab-active', tab.dataset.view === viewKey);
      }
      /* Show/hide add week button based on view */
      if (addWeekBtn) {
        addWeekBtn.style.display = viewKey === 'week' ? '' : 'none';
      }
      rebuildView();
    }

    function rebuildView() {
      timeLabel.textContent = getTimeLabel();
      while (viewContent.firstChild) viewContent.removeChild(viewContent.firstChild);

      switch (state.activeView) {
        case 'day':
          renderDayContent();
          break;
        case 'week':
          renderWeekContent();
          break;
        case 'month':
          renderMonthContent();
          break;
        case 'quarter':
          renderQuarterContent();
          break;
        case 'year':
          renderYearContent();
          break;
      }

      updateSummary(container, cols, weeks, state.weekIdx);
    }

    /* ---- View content builders ---- */

    function renderDayContent() {
      let weekRows;
      if (isMultiWeek) {
        /* Find the week for the target date — fall back to closest week */
        let idx = findWeekForDate(weeks, state.currentDate);
        if (idx < 0) idx = findClosestWeek(weeks, state.currentDate);
        if (idx >= 0) {
          weekRows = weeks[idx].rows;
          state.weekIdx = idx;
        } else {
          viewContent.append(el('div', { className: 'habit-day-empty' }, [
            'No data for ' + formatDayLabel(state.currentDate),
          ]));
          return;
        }
      } else {
        weekRows = rows;
      }
      renderDayView(viewContent, weekRows, cols, state.currentDate, {
        weeks, weekIdx: state.weekIdx, isMultiWeek,
      });
    }

    function renderWeekContent() {
      let weekRows;
      if (isMultiWeek) {
        weekRows = weeks[state.weekIdx]?.rows || [];
      } else {
        weekRows = rows;
      }

      if (hasCategories && !isMultiWeek) {
        /* Category grouping for single-week mode */
        const groups = parseGroups(weekRows, cols.category);
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
          renderWeekView(section, allGroupRows, cols, {
            hasGoals, idxOverrides: allGroupIdxs,
          });
          viewContent.append(section);
        }
      } else {
        renderWeekView(viewContent, weekRows, cols, {
          hasGoals, weeks, weekIdx: state.weekIdx, isMultiWeek,
        });
      }
    }

    function renderMonthContent() {
      const year = state.currentDate.getFullYear();
      const month = state.currentDate.getMonth();
      renderMonthView(viewContent, weeks, cols, year, month, (date) => {
        state.currentDate = date;
        switchView('day');
      });
    }

    function renderQuarterContent() {
      const year = state.currentDate.getFullYear();
      const quarter = getQuarter(state.currentDate.getMonth());
      renderQuarterView(viewContent, weeks, cols, year, quarter);
    }

    function renderYearContent() {
      const year = state.currentDate.getFullYear();
      renderYearView(viewContent, weeks, cols, year, (date) => {
        state.currentDate = date;
        switchView('day');
      });
    }

    /* ---- Event listeners ---- */

    prevBtn.addEventListener('click', () => navigate(-1));
    nextBtn.addEventListener('click', () => navigate(1));
    todayBtn.addEventListener('click', goToday);

    delegateEvent(viewSwitcher, 'click', '.habit-view-tab', (e, tab) => {
      switchView(tab.dataset.view);
    });

    /* Add Week button handler */
    if (addWeekBtn && template._onInsertAfterRow) {
      addWeekBtn.addEventListener('click', async () => {
        addWeekBtn.disabled = true;
        addWeekBtn.textContent = 'Adding...';

        const latestWeek = weeks[weeks.length - 1];
        const nextMonday = formatWeekISO(getNextWeekStart(latestWeek.date));

        /* Get habit names from latest week */
        const habitNames = latestWeek.rows.map(r => cell(r, cols.text));

        /* Build new row arrays */
        const totalCols = template._totalColumns || (rows[0] ? rows[0].length : 10);
        const newRows = [];
        for (const name of habitNames) {
          const newRow = new Array(totalCols).fill('');
          newRow[cols.text] = name;
          newRow[cols.weekOf] = nextMonday;
          if (cols.streak >= 0) newRow[cols.streak] = '0';
          /* Copy category & goal from the source row */
          const sourceRow = latestWeek.rows.find(r => cell(r, cols.text) === name);
          if (sourceRow) {
            if (cols.category >= 0) newRow[cols.category] = cell(sourceRow, cols.category);
            if (cols.goal >= 0) newRow[cols.goal] = cell(sourceRow, cols.goal);
          }
          newRows.push(newRow);
        }

        /* Insert after the last data row */
        await template._onInsertAfterRow(rows.length, newRows, []);
      });
    }

    /* ---- Initial render ---- */

    /* Default to most recent week in multi-week mode */
    if (isMultiWeek && weeks.length > 0) {
      const todayIdx = findWeekForDate(weeks, new Date());
      state.weekIdx = todayIdx >= 0 ? todayIdx : weeks.length - 1;
      /* Keep state.currentDate = today when today is in data range,
         so Day view defaults to today. Fall back to data range otherwise. */
      if (todayIdx < 0) {
        state.currentDate = new Date(weeks[state.weekIdx].date);
      }
    }

    /* Hide add-week button initially (day view is default) */
    if (addWeekBtn) addWeekBtn.style.display = 'none';

    rebuildView();
  },
};

registerTemplate('habit', definition);
export default definition;
