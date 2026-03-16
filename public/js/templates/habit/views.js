/* ============================================================
   templates/habit/views.js — Five time-scale view renderers
   for the Habit Tracker template.

   Views: Day, Week, Month, Quarter, Year
   Each view renders the same underlying data at a different
   time granularity. Day and Week are interactive (toggle cells).
   Month, Quarter, and Year are read-only visualizations.
   ============================================================ */

import { el, cell, editableCell, emitEdit } from '../shared.js';

import {
  habitState, STATE_CHAR, STATE_CYCLE, STATE_VALUE,
  computeStreak, computeMultiWeekStreak, parseGoal,
  DAY_ABBR, DAY_NAMES, MONTH_ABBR,
  dateToDayIndex, getWeekStart, formatWeekISO, formatDayLabel,
  formatMonthLabel, formatQuarterLabel,
  getMonthCalendar, getQuarter, getQuarterMonths,
  getWeekStartsInRange, dayCompletionRate, weekCompletionRate,
  findWeekForDate, computeMonthHabitStreaks,
} from './helpers.js';

/* ================================================================
   Day View — Simple checklist of today's habits
   ================================================================ */

/**
 * Render the Day View: a tall, tappable checklist for one day.
 * @param {HTMLElement} container
 * @param {string[][]} weekRows — rows for the current week
 * @param {Object} cols
 * @param {Date} targetDate — the specific day to display
 * @param {Object} opts — { weeks, weekIdx, isMultiWeek }
 */
export function renderDayView(container, weekRows, cols, targetDate, opts = {}) {
  const dayIdx = dateToDayIndex(targetDate);
  const dayColIdx = cols.days[dayIdx];
  if (dayColIdx === undefined) {
    container.append(el('div', { className: 'habit-day-empty' }, [
      'No data for ' + formatDayLabel(targetDate),
    ]));
    return;
  }

  const dayName = DAY_NAMES[dayIdx];
  const dateStr = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  /* Header */
  container.append(el('div', { className: 'habit-day-header' }, [
    el('h3', { className: 'habit-day-title' }, [`${dayName}, ${dateStr}`]),
  ]));

  /* Habit list */
  const list = el('div', { className: 'habit-day-list' });
  let doneCount = 0;

  for (let i = 0; i < weekRows.length; i++) {
    const row = weekRows[i];
    const rowIdx = (row._sourceIndex !== undefined ? row._sourceIndex : i) + 1;
    const name = cell(row, cols.text) || '';
    const val = cell(row, dayColIdx);
    const state = habitState(val);
    if (state === 'done') doneCount++;

    /* Streak */
    let streak = 0;
    if (opts.isMultiWeek && opts.weeks && opts.weekIdx !== undefined) {
      streak = computeMultiWeekStreak(name, opts.weeks, cols.text, cols.days, opts.weekIdx);
    } else {
      streak = computeStreak(row, cols.days);
    }

    const item = el('div', {
      className: `habit-day-item habit-day-item-${state}`,
      dataset: { rowIdx: String(rowIdx), colIdx: String(dayColIdx), state },
    }, [
      el('div', { className: 'habit-day-check' }, [STATE_CHAR[state] || '\u00A0']),
      el('div', { className: 'habit-day-info' }, [
        el('span', { className: 'habit-day-name' }, [name]),
        streak > 0
          ? el('span', { className: 'habit-day-streak' }, [`\uD83D\uDD25 ${streak} day streak`])
          : null,
      ].filter(Boolean)),
    ]);
    list.append(item);
  }

  container.append(list);

  /* Progress summary */
  const total = weekRows.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  container.append(el('div', { className: 'habit-day-progress' }, [
    el('span', { className: 'habit-day-progress-text' }, [
      `${doneCount} of ${total} complete (${pct}%)`,
    ]),
    el('div', { className: 'habit-day-progress-bar' }, [
      el('div', { className: 'habit-day-progress-fill', style: `width: ${pct}%` }),
    ]),
  ]));
}

/* ================================================================
   Week View — 7-day grid with toggleable cells
   ================================================================ */

/**
 * Render the Week View: the full Mon–Sun grid with toggleable day cells.
 * @param {HTMLElement} container
 * @param {string[][]} weekRows — rows to display
 * @param {Object} cols
 * @param {Object} opts — { hasGoals, idxOverrides, weeks, weekIdx, isMultiWeek }
 */
export function renderWeekView(container, weekRows, cols, opts = {}) {
  const hasGoals = opts.hasGoals || false;
  const grid = el('div', { className: 'habit-grid' });

  /* Header row */
  const headerRow = el('div', { className: 'habit-grid-row habit-grid-header' });
  headerRow.append(el('div', { className: 'habit-grid-cell habit-name-cell' }, ['Habit']));
  for (let d = 0; d < cols.days.length; d++) {
    headerRow.append(el('div', { className: 'habit-grid-cell habit-day-cell' }, [DAY_ABBR[d] || 'Day']));
  }
  headerRow.append(el('div', { className: 'habit-grid-cell habit-streak-cell' }, ['\uD83D\uDD25']));
  if (hasGoals) headerRow.append(el('div', { className: 'habit-grid-cell habit-goal-cell' }, ['\uD83C\uDFAF']));
  grid.append(headerRow);

  /* Data rows */
  for (let i = 0; i < weekRows.length; i++) {
    const row = weekRows[i];
    const rowIdx = (opts.idxOverrides ? opts.idxOverrides[i]
      : row._sourceIndex !== undefined ? row._sourceIndex : i) + 1;
    const text = cell(row, cols.text) || row[0] || '\u2014';

    const gridRow = el('div', { className: 'habit-grid-row' });
    gridRow.append(editableCell('div', { className: 'habit-grid-cell habit-name-cell' }, text, rowIdx, cols.text));

    let doneCount = 0;
    for (const dayIdx of cols.days) {
      const val = cell(row, dayIdx);
      const state = habitState(val);
      if (state === 'done') doneCount++;
      gridRow.append(el('div', {
        className: `habit-grid-cell habit-day-cell habit-toggle habit-${state}`,
        title: 'Click to cycle: \u2713 ~ \u2717',
        dataset: { rowIdx: String(rowIdx), colIdx: String(dayIdx), state },
      }, [STATE_CHAR[state]]));
    }

    /* Streak */
    let streak;
    if (opts.isMultiWeek && opts.weeks && opts.weekIdx !== undefined) {
      streak = computeMultiWeekStreak(text, opts.weeks, cols.text, cols.days, opts.weekIdx);
    } else {
      const sheetStreak = cols.streak >= 0 ? cell(row, cols.streak) : '';
      streak = sheetStreak ? Number(sheetStreak) || 0 : computeStreak(row, cols.days);
    }
    gridRow.append(el('div', {
      className: `habit-grid-cell habit-streak-cell ${streak > 0 ? 'habit-streak-active' : ''}`,
    }, [streak > 0 ? `\uD83D\uDD25 ${streak}` : '\u2014']));

    /* Goal progress */
    if (hasGoals) {
      const goalRaw = cell(row, cols.goal);
      const target = parseGoal(goalRaw);
      const label = target > 0 ? `${doneCount}/${target}` : (goalRaw || '\u2014');
      const met = target > 0 && doneCount >= target;
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
  container.append(grid);

  /* Update footer bars (immediate) */
  updateCompletionBars(grid, cols);
}

/* ================================================================
   Month View — Calendar grid with daily completion indicators
   ================================================================ */

/**
 * Render the Month View: a calendar showing daily completion rates.
 * @param {HTMLElement} container
 * @param {Array} weeks — all week objects {iso, rows, date, ...}
 * @param {Object} cols
 * @param {number} year
 * @param {number} month — 0-based
 * @param {function} onDayClick — callback(date) when a day cell is clicked
 */
export function renderMonthView(container, weeks, cols, year, month, onDayClick) {
  const calendar = getMonthCalendar(year, month);

  /* Build a lookup: weekISO → week data */
  const weekMap = new Map();
  for (const w of weeks) weekMap.set(w.iso, w);

  /* Calendar header (day names) */
  const calGrid = el('div', { className: 'habit-month-grid' });
  const headerRow = el('div', { className: 'habit-month-row habit-month-header' });
  for (const abbr of DAY_ABBR) {
    headerRow.append(el('div', { className: 'habit-month-cell habit-month-day-name' }, [abbr]));
  }
  calGrid.append(headerRow);

  /* Calendar weeks */
  for (const week of calendar) {
    const row = el('div', { className: 'habit-month-row' });
    for (let d = 0; d < 7; d++) {
      const date = week[d];
      if (!date) {
        row.append(el('div', { className: 'habit-month-cell habit-month-empty' }));
        continue;
      }

      const dayNum = date.getDate();
      const weekISO = formatWeekISO(getWeekStart(date));
      const weekData = weekMap.get(weekISO);
      const dayIdx = dateToDayIndex(date);
      const dayColIdx = cols.days[dayIdx];

      let rate = -1;
      if (weekData && dayColIdx !== undefined) {
        rate = dayCompletionRate(weekData.rows, dayColIdx);
      }

      const rateClass = rate < 0 ? 'habit-rate-none'
        : rate >= 0.75 ? 'habit-rate-high'
        : rate >= 0.25 ? 'habit-rate-mid'
        : rate > 0 ? 'habit-rate-low'
        : 'habit-rate-zero';

      const dayCell = el('div', {
        className: `habit-month-cell habit-month-day ${rateClass}${rate >= 1.0 ? ' habit-month-perfect' : ''}`,
        title: rate >= 0 ? `${Math.round(rate * 100)}% complete` : 'No data',
      }, [
        el('span', { className: 'habit-month-day-num' }, [String(dayNum)]),
        rate >= 1.0
          ? el('span', { className: 'habit-month-star' }, ['\u2B50'])
          : rate >= 0
            ? el('div', { className: 'habit-month-day-dot' })
            : null,
      ].filter(Boolean));

      if (onDayClick) {
        dayCell.style.cursor = 'pointer';
        dayCell.addEventListener('click', () => onDayClick(date));
      }

      row.append(dayCell);
    }
    calGrid.append(row);
  }
  container.append(calGrid);

  /* Check if this month has any data */
  const monthWeekISOs = getWeekStartsInRange(new Date(year, month, 1), new Date(year, month + 1, 0));
  const hasMonthData = monthWeekISOs.some(iso => weekMap.has(iso));
  if (!hasMonthData && weeks.length > 0) {
    const firstWeek = weeks[0];
    const lastWeek = weeks[weeks.length - 1];
    container.append(el('div', { className: 'habit-month-nodata' }, [
      el('span', { className: 'habit-month-nodata-icon' }, ['\uD83D\uDCC5']),
      el('span', {}, [
        `No habit data for ${MONTH_ABBR[month]} ${year}. Your data spans ${firstWeek.label.replace('Week of ', '')} \u2013 ${lastWeek.label.replace('Week of ', '')}. Use the arrows to navigate.`,
      ]),
    ]));
  }

  /* Legend */
  container.append(el('div', { className: 'habit-month-legend' }, [
    el('span', { className: 'habit-legend-item' }, [
      el('span', { className: 'habit-legend-swatch habit-rate-high' }),
      el('span', {}, ['75%+']),
    ]),
    el('span', { className: 'habit-legend-item' }, [
      el('span', { className: 'habit-legend-swatch habit-rate-mid' }),
      el('span', {}, ['25–74%']),
    ]),
    el('span', { className: 'habit-legend-item' }, [
      el('span', { className: 'habit-legend-swatch habit-rate-low' }),
      el('span', {}, ['1–24%']),
    ]),
    el('span', { className: 'habit-legend-item' }, [
      el('span', { className: 'habit-legend-swatch habit-rate-zero' }),
      el('span', {}, ['0%']),
    ]),
    el('span', { className: 'habit-legend-item' }, [
      el('span', { className: 'habit-legend-swatch habit-rate-none' }),
      el('span', {}, ['No data']),
    ]),
  ]));

  /* Streak badges section */
  const streaks = computeMonthHabitStreaks(weeks, cols, year, month);
  if (streaks.length > 0) {
    const allPerfect = streaks.every(h => h.allDone);
    if (allPerfect) {
      container.append(el('div', { className: 'habit-month-perfect-banner' }, [
        el('span', { className: 'habit-month-perfect-icon' }, ['\uD83C\uDF89']),
        el('span', {}, ['Perfect Month! All habits completed every day!']),
      ]));
    }
    const streakSection = el('div', { className: 'habit-month-streaks' });
    streakSection.append(el('h4', { className: 'habit-month-streaks-title' }, [
      '\uD83D\uDD25 Habit Streaks',
    ]));
    const streakList = el('div', { className: 'habit-month-streaks-list' });
    for (const h of streaks) {
      streakList.append(el('div', { className: 'habit-month-streak-badge' }, [
        el('span', { className: 'habit-month-streak-name' }, [h.name]),
        el('span', {
          className: `habit-month-streak-count${h.allDone ? ' habit-month-streak-perfect' : ''}`,
        }, [
          h.streak > 0 ? `\uD83D\uDD25 ${h.streak}` : '\u2014',
        ]),
      ]));
    }
    streakSection.append(streakList);
    container.append(streakSection);
  }
}

/* ================================================================
   Quarter View — 13-week heatmap by habit
   ================================================================ */

/**
 * Render the Quarter View: a heatmap table of weeks × habits.
 * @param {HTMLElement} container
 * @param {Array} weeks — all week objects
 * @param {Object} cols
 * @param {number} year
 * @param {number} quarter — 0-based
 */
export function renderQuarterView(container, weeks, cols, year, quarter) {
  const qMonths = getQuarterMonths(quarter);
  const qStart = new Date(year, qMonths[0], 1);
  const qEnd = new Date(year, qMonths[2] + 1, 0);
  const weekISOs = getWeekStartsInRange(qStart, qEnd);

  /* Build week lookup */
  const weekMap = new Map();
  for (const w of weeks) weekMap.set(w.iso, w);

  /* Collect unique habit names (from all available weeks in quarter) */
  const habitNames = [];
  const seen = new Set();
  for (const iso of weekISOs) {
    const w = weekMap.get(iso);
    if (!w) continue;
    for (const row of w.rows) {
      const name = cell(row, cols.text) || '';
      if (name && !seen.has(name)) { seen.add(name); habitNames.push(name); }
    }
  }

  if (habitNames.length === 0) {
    container.append(el('div', { className: 'habit-quarter-empty' }, [
      'No habit data for ' + formatQuarterLabel(year, quarter),
    ]));
    return;
  }

  /* Table */
  const table = el('div', { className: 'habit-quarter-table' });

  /* Header: empty corner + habit names */
  const headerRow = el('div', { className: 'habit-quarter-row habit-quarter-header' });
  headerRow.append(el('div', { className: 'habit-quarter-cell habit-quarter-week-label' }, ['Week']));
  for (const name of habitNames) {
    headerRow.append(el('div', { className: 'habit-quarter-cell habit-quarter-habit-name' }, [name]));
  }
  headerRow.append(el('div', { className: 'habit-quarter-cell habit-quarter-avg' }, ['Avg']));
  table.append(headerRow);

  /* Data rows: one per week */
  for (const iso of weekISOs) {
    const w = weekMap.get(iso);
    const row = el('div', { className: 'habit-quarter-row' });

    /* Week label */
    const weekLabel = MONTH_ABBR[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10));
    row.append(el('div', { className: 'habit-quarter-cell habit-quarter-week-label' }, [weekLabel]));

    let totalRate = 0, ratedCount = 0;
    for (const name of habitNames) {
      if (!w) {
        row.append(el('div', { className: 'habit-quarter-cell habit-quarter-heat habit-rate-none' }));
        continue;
      }
      const habitRow = w.rows.find(r => cell(r, cols.text) === name);
      if (!habitRow) {
        row.append(el('div', { className: 'habit-quarter-cell habit-quarter-heat habit-rate-none' }));
        continue;
      }
      let done = 0;
      for (const dayCol of cols.days) {
        const s = habitState(cell(habitRow, dayCol));
        if (s === 'done') done++;
        else if (s === 'partial') done += 0.5;
      }
      const rate = cols.days.length ? done / cols.days.length : 0;
      totalRate += rate;
      ratedCount++;
      const rateClass = rate >= 0.75 ? 'habit-rate-high'
        : rate >= 0.25 ? 'habit-rate-mid'
        : rate > 0 ? 'habit-rate-low'
        : 'habit-rate-zero';
      row.append(el('div', {
        className: `habit-quarter-cell habit-quarter-heat ${rateClass}`,
        title: `${name}: ${Math.round(rate * 100)}%`,
      }));
    }

    /* Average */
    const avg = ratedCount ? totalRate / ratedCount : -1;
    const avgClass = avg < 0 ? '' : avg >= 0.75 ? 'habit-rate-high' : avg >= 0.25 ? 'habit-rate-mid' : 'habit-rate-low';
    row.append(el('div', {
      className: `habit-quarter-cell habit-quarter-avg ${avgClass}`,
    }, [avg >= 0 ? `${Math.round(avg * 100)}%` : '\u2014']));

    table.append(row);
  }

  container.append(table);
}

/* ================================================================
   Year View — 12 mini month calendars (month plan scaled up)
   ================================================================ */

/**
 * Render the Year View: a 4×3 grid of mini month calendars with
 * daily completion indicators. Click any day to jump to Day view.
 * @param {HTMLElement} container
 * @param {Array} weeks — all week objects
 * @param {Object} cols
 * @param {number} year
 * @param {function} [onDayClick] — callback(date) when a day cell is clicked
 */
export function renderYearView(container, weeks, cols, year, onDayClick) {
  const weekMap = new Map();
  for (const w of weeks) weekMap.set(w.iso, w);

  const yearGrid = el('div', { className: 'habit-year-months' });

  for (let month = 0; month < 12; month++) {
    const miniMonth = el('div', { className: 'habit-year-mini-month' });
    miniMonth.append(el('div', { className: 'habit-year-mini-title' }, [MONTH_ABBR[month]]));

    const calendar = getMonthCalendar(year, month);
    const miniGrid = el('div', { className: 'habit-year-mini-grid' });

    /* Day headers */
    const headerRow = el('div', { className: 'habit-year-mini-row' });
    for (const letter of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) {
      headerRow.append(el('div', { className: 'habit-year-mini-header' }, [letter]));
    }
    miniGrid.append(headerRow);

    /* Calendar weeks */
    for (const week of calendar) {
      const row = el('div', { className: 'habit-year-mini-row' });
      for (let d = 0; d < 7; d++) {
        const date = week[d];
        if (!date) {
          row.append(el('div', { className: 'habit-year-mini-cell habit-year-mini-empty' }));
          continue;
        }

        const weekISO = formatWeekISO(getWeekStart(date));
        const weekData = weekMap.get(weekISO);
        const dayIdx = dateToDayIndex(date);
        const dayColIdx = cols.days[dayIdx];

        let rate = -1;
        if (weekData && dayColIdx !== undefined) {
          rate = dayCompletionRate(weekData.rows, dayColIdx);
        }

        const rateClass = rate < 0 ? 'habit-rate-none'
          : rate >= 0.75 ? 'habit-rate-high'
          : rate >= 0.25 ? 'habit-rate-mid'
          : rate > 0 ? 'habit-rate-low'
          : 'habit-rate-zero';

        const dayCell = el('div', {
          className: `habit-year-mini-cell ${rateClass}${rate >= 1.0 ? ' habit-year-mini-perfect' : ''}`,
          title: rate >= 0
            ? `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${Math.round(rate * 100)}%`
            : '',
        });

        if (onDayClick) {
          dayCell.style.cursor = 'pointer';
          dayCell.addEventListener('click', () => onDayClick(date));
        }

        row.append(dayCell);
      }
      miniGrid.append(row);
    }

    miniMonth.append(miniGrid);
    yearGrid.append(miniMonth);
  }

  container.append(yearGrid);

  /* Yearly stats summary */
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const weekISOs = getWeekStartsInRange(yearStart, yearEnd);
  let totalWeeks = 0, totalRate = 0;
  for (const iso of weekISOs) {
    const w = weekMap.get(iso);
    if (!w) continue;
    totalWeeks++;
    totalRate += weekCompletionRate(w.rows, cols.days);
  }
  const avgRate = totalWeeks ? Math.round((totalRate / totalWeeks) * 100) : 0;
  if (totalWeeks === 0 && weeks.length > 0) {
    const firstYear = weeks[0].date.getFullYear();
    const lastYear = weeks[weeks.length - 1].date.getFullYear();
    const yearsWithData = [...new Set([firstYear, lastYear])];
    container.append(el('div', { className: 'habit-year-nodata' }, [
      el('span', { className: 'habit-year-nodata-icon' }, ['\uD83D\uDCC5']),
      el('span', {}, [
        `No habit data for ${year}. Your data spans ${yearsWithData.join('\u2013')}. Use the arrows to navigate.`,
      ]),
    ]));
  }

  container.append(el('div', { className: 'habit-year-stats' }, [
    el('span', { className: 'habit-year-stat' }, [
      `${totalWeeks} weeks tracked`,
    ]),
    el('span', { className: 'habit-year-stat' }, [
      `${avgRate}% average completion`,
    ]),
  ]));

  /* Legend */
  container.append(el('div', { className: 'habit-year-legend' }, [
    el('span', {}, ['Less']),
    el('span', { className: 'habit-legend-swatch habit-rate-zero' }),
    el('span', { className: 'habit-legend-swatch habit-rate-low' }),
    el('span', { className: 'habit-legend-swatch habit-rate-mid' }),
    el('span', { className: 'habit-legend-swatch habit-rate-high' }),
    el('span', {}, ['More']),
  ]));
}

/* ================================================================
   Shared Helper: Completion Bars (used by Week View)
   ================================================================ */

/**
 * Update completion percentage bars in the footer row(s).
 * @param {HTMLElement} container
 * @param {Object} cols
 */
export function updateCompletionBars(container, cols) {
  const footers = container.querySelectorAll('.habit-grid-footer');
  for (const footer of footers) {
    const completionCells = footer.querySelectorAll('.habit-completion-cell');
    const grid = footer.closest('.habit-grid') || container;
    for (let d = 0; d < cols.days.length; d++) {
      const dayIdx = cols.days[d];
      const toggles = grid.querySelectorAll(`.habit-toggle[data-col-idx="${dayIdx}"]`);
      let done = 0;
      for (const t of toggles) { if (t.dataset.state === 'done') done++; }
      const total = toggles.length || 1;
      const pct = Math.round((done / total) * 100);
      const c = completionCells[d];
      if (!c) continue;
      while (c.firstChild) c.removeChild(c.firstChild);
      const bar = el('div', { className: 'habit-completion-bar' });
      bar.append(el('div', { className: 'habit-completion-fill', style: `width: ${pct}%` }));
      c.append(bar);
      c.append(el('span', { className: 'habit-completion-pct' }, [`${pct}%`]));
    }
  }
}
