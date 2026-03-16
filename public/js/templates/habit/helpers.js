/* ============================================================
   templates/habit/helpers.js — Constants, state classifiers,
   streak computation, date utilities, and completion helpers
   for the Habit Tracker template.
   ============================================================ */

import { cell } from '../shared.js';

/* ================================================================
   Section 1: State Maps & Classifiers
   ================================================================ */

/** Display characters for each habit state */
export const STATE_CHAR  = { done: '\u2713', partial: '~', missed: '\u2717', empty: '' };

/** Cycle order when clicking a day cell */
export const STATE_CYCLE = ['empty', 'done', 'partial', 'missed'];

/** Value written back to the sheet for each state */
export const STATE_VALUE = { done: '\u2713', partial: '~', missed: '\u2717', empty: '' };

/**
 * Classify a cell value into a habit state.
 * @param {string} val
 * @returns {'done'|'partial'|'missed'|'empty'}
 */
export function habitState(val) {
  const v = (val || '').trim();
  if (!v) return 'empty';
  if (/^(\u2713|\u2714|x|yes|1|true|done)$/i.test(v)) return 'done';
  if (/^(~|half|partial|50%?)$/i.test(v)) return 'partial';
  if (/^(missed|no|0|false|skip|\u2717|\u2718)$/i.test(v)) return 'missed';
  return 'done'; // any non-empty non-special value treated as done
}

/* ================================================================
   Section 2: Streak Computation
   ================================================================ */

/**
 * Compute streak length from day cells (consecutive done from right).
 * @param {string[]} row
 * @param {number[]} dayCols
 * @returns {number}
 */
export function computeStreak(row, dayCols) {
  let streak = 0;
  for (let d = dayCols.length - 1; d >= 0; d--) {
    if (habitState(cell(row, dayCols[d])) === 'done') streak++;
    else break;
  }
  return streak;
}

/**
 * Compute a cross-week streak for a named habit across sorted weeks.
 * Walks backward from the given week, counting consecutive done days.
 * @param {string} habitName
 * @param {Array<{rows: Array}>} weeks — sorted ascending by date
 * @param {number} textCol — column index for habit name
 * @param {number[]} dayCols — column indices for Mon–Sun
 * @param {number} upToWeekIdx — index of the current week (inclusive)
 * @returns {number}
 */
export function computeMultiWeekStreak(habitName, weeks, textCol, dayCols, upToWeekIdx) {
  let streak = 0;
  for (let w = upToWeekIdx; w >= 0; w--) {
    const row = weeks[w].rows.find(r => cell(r, textCol) === habitName);
    if (!row) break;
    for (let d = dayCols.length - 1; d >= 0; d--) {
      if (habitState(cell(row, dayCols[d])) === 'done') streak++;
      else return streak;
    }
  }
  return streak;
}

/* ================================================================
   Section 3: Goal Parsing
   ================================================================ */

/**
 * Parse a goal string ("5x/week", "daily", "3 times/week") into a numeric target.
 * @param {string} raw
 * @returns {number} target completions per week (0 if unparseable)
 */
export function parseGoal(raw) {
  const v = (raw || '').toLowerCase().trim();
  if (!v) return 0;
  if (/^daily$/.test(v)) return 7;
  if (/^weekdays?$/.test(v)) return 5;
  if (/^weekends?$/.test(v)) return 2;
  const m = v.match(/^(\d+)\s*(x|times?)?\s*\/?\s*(week)?/i);
  return m ? Number(m[1]) : 0;
}

/* ================================================================
   Section 4: Week Of Column Detection & Parsing
   ================================================================ */

/** Pattern for detecting Week Of header columns */
export const WEEK_COL_PATTERN = /^(week\s*of|week|date|period|week\s*start|starting)/;

/**
 * Parse a raw date string into a Date object.
 * Handles ISO (YYYY-MM-DD), US (MM/DD/YYYY), and natural language.
 * @param {string} raw
 * @returns {Date|null}
 */
export function parseWeekDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date as a human-readable week label: "Week of Mar 10, 2026"
 * @param {Date} date
 * @returns {string}
 */
export function formatWeekLabel(date) {
  return 'Week of ' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a date as ISO string (YYYY-MM-DD).
 * @param {Date} date
 * @returns {string}
 */
export function formatWeekISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Group rows by their Week Of value. Attaches _sourceIndex to each row.
 * @param {string[][]} rows — data rows (values.slice(1))
 * @param {number} weekOfCol — column index of Week Of
 * @returns {Array<{date: Date, iso: string, label: string, rows: string[][]}>}
 */
export function getUniqueWeeks(rows, weekOfCol) {
  const map = new Map();
  rows.forEach((row, idx) => {
    const raw = cell(row, weekOfCol);
    const d = parseWeekDate(raw);
    if (!d) return;
    const iso = formatWeekISO(d);
    if (!map.has(iso)) map.set(iso, { date: d, iso, label: formatWeekLabel(d), rows: [] });
    row._sourceIndex = idx;
    map.get(iso).rows.push(row);
  });
  return Array.from(map.values()).sort((a, b) => a.date - b.date);
}

/* ================================================================
   Section 5: Date Utilities
   ================================================================ */

/** Short day names matching Mon–Sun column order */
export const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Full day names */
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Month names */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Short month names */
export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Get the Monday of the week containing the given date.
 * @param {Date} [date] — defaults to today
 * @returns {Date}
 */
export function getWeekStart(date) {
  const d = new Date(date || new Date());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Alias for getWeekStart(new Date()) */
export const getCurrentMonday = () => getWeekStart(new Date());

/**
 * Get the Monday 7 days after the given date.
 * @param {Date} date
 * @returns {Date}
 */
export function getNextWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 7);
  return d;
}

/**
 * Convert a JS Date's day-of-week to a 0-based Mon–Sun index.
 * @param {Date} date
 * @returns {number} 0=Mon, 6=Sun
 */
export function dateToDayIndex(date) {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

/**
 * Format a date as "Friday, Mar 14".
 * @param {Date} date
 * @returns {string}
 */
export function formatDayLabel(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * Format as "March 2026".
 * @param {number} year
 * @param {number} month — 0-based
 * @returns {string}
 */
export function formatMonthLabel(year, month) {
  return MONTH_NAMES[month] + ' ' + year;
}

/**
 * Format as "Q1 2026".
 * @param {number} year
 * @param {number} quarter — 0-based (0=Q1)
 * @returns {string}
 */
export function formatQuarterLabel(year, quarter) {
  return `Q${quarter + 1} ${year}`;
}

/**
 * Get all calendar days for a month, grouped by week rows (Mon–Sun).
 * Null entries represent days outside the month.
 * @param {number} year
 * @param {number} month — 0-based
 * @returns {Array<Array<Date|null>>}
 */
export function getMonthCalendar(year, month) {
  const weeks = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const start = getWeekStart(firstDay);
  const cursor = new Date(start);

  while (cursor <= lastDay || cursor.getDay() !== 1) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      if (cursor.getMonth() === month) {
        week.push(new Date(cursor));
      } else {
        week.push(null);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor > lastDay && cursor.getDay() === 1) break;
  }
  return weeks;
}

/**
 * Get the quarter (0–3) for a given month.
 * @param {number} month — 0-based
 * @returns {number}
 */
export function getQuarter(month) {
  return Math.floor(month / 3);
}

/**
 * Get the three months in a quarter.
 * @param {number} quarter — 0-based
 * @returns {number[]}
 */
export function getQuarterMonths(quarter) {
  const start = quarter * 3;
  return [start, start + 1, start + 2];
}

/**
 * Get all week-start Mondays in a date range as ISO strings.
 * @param {Date} start
 * @param {Date} end
 * @returns {string[]}
 */
export function getWeekStartsInRange(start, end) {
  const mondays = [];
  const cursor = getWeekStart(start);
  while (cursor <= end) {
    mondays.push(formatWeekISO(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return mondays;
}

/* ================================================================
   Section 6: Completion Rate Helpers
   ================================================================ */

/**
 * Compute the overall completion rate for a set of rows across all days.
 * @param {string[][]} rows
 * @param {number[]} dayCols
 * @returns {number} 0–1
 */
export function weekCompletionRate(rows, dayCols) {
  let done = 0, total = 0;
  for (const row of rows) {
    for (const col of dayCols) {
      total++;
      const s = habitState(cell(row, col));
      if (s === 'done') done++;
      else if (s === 'partial') done += 0.5;
    }
  }
  return total ? done / total : 0;
}

/**
 * Compute completion rate for a specific day column across rows.
 * Returns -1 if no rows (no data available).
 * @param {string[][]} rows
 * @param {number} dayColIdx
 * @returns {number} 0–1 or -1 if no data
 */
export function dayCompletionRate(rows, dayColIdx) {
  if (!rows || rows.length === 0) return -1;
  let done = 0;
  for (const row of rows) {
    const s = habitState(cell(row, dayColIdx));
    if (s === 'done') done++;
    else if (s === 'partial') done += 0.5;
  }
  return done / rows.length;
}

/**
 * Compute per-habit states for a specific day across rows.
 * @param {string[][]} rows
 * @param {number} textCol
 * @param {number} dayColIdx
 * @returns {Array<{name: string, state: string}>}
 */
export function dayHabitStates(rows, textCol, dayColIdx) {
  return rows.map(row => ({
    name: cell(row, textCol) || '',
    state: habitState(cell(row, dayColIdx)),
  }));
}

/**
 * Find the week index in the weeks array for a given date.
 * Returns -1 if not found.
 * @param {Array<{iso: string}>} weeks
 * @param {Date} date
 * @returns {number}
 */
export function findWeekForDate(weeks, date) {
  const targetISO = formatWeekISO(getWeekStart(date));
  return weeks.findIndex(w => w.iso === targetISO);
}

/**
 * Find the closest week index to a given date.
 * Unlike findWeekForDate (exact match only), this returns the week
 * whose start date is nearest, making it a robust fallback.
 * @param {Array<{date: Date}>} weeks
 * @param {Date} date
 * @returns {number} index, or -1 if weeks is empty
 */
export function findClosestWeek(weeks, date) {
  if (!weeks || weeks.length === 0) return -1;
  const target = date.getTime();
  let bestIdx = 0;
  let bestDist = Math.abs(weeks[0].date.getTime() - target);
  for (let i = 1; i < weeks.length; i++) {
    const dist = Math.abs(weeks[i].date.getTime() - target);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Compute per-habit streaks for a specific month.
 * @param {Array} weeks — all week objects {iso, rows, date}
 * @param {Object} cols — column indices {text, days}
 * @param {number} year
 * @param {number} month — 0-based
 * @returns {Array<{name: string, streak: number, allDone: boolean}>}
 */
export function computeMonthHabitStreaks(weeks, cols, year, month) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const monthWeekISOs = getWeekStartsInRange(monthStart, monthEnd);

  /* Find the latest week index that overlaps this month */
  let lastWeekIdx = -1;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (monthWeekISOs.includes(weeks[i].iso)) { lastWeekIdx = i; break; }
  }
  if (lastWeekIdx < 0) return [];

  /* Collect unique habit names */
  const weekMap = new Map();
  for (const w of weeks) weekMap.set(w.iso, w);
  const habitNames = [];
  const seen = new Set();
  for (const iso of monthWeekISOs) {
    const w = weekMap.get(iso);
    if (!w) continue;
    for (const row of w.rows) {
      const name = cell(row, cols.text) || '';
      if (name && !seen.has(name)) { seen.add(name); habitNames.push(name); }
    }
  }

  return habitNames.map(name => {
    const streak = computeMultiWeekStreak(name, weeks, cols.text, cols.days, lastWeekIdx);
    let totalDays = 0, doneDays = 0;
    for (const iso of monthWeekISOs) {
      const w = weekMap.get(iso);
      if (!w) continue;
      const row = w.rows.find(r => cell(r, cols.text) === name);
      if (!row) continue;
      for (const dayCol of cols.days) {
        totalDays++;
        if (habitState(cell(row, dayCol)) === 'done') doneDays++;
      }
    }
    return { name, streak, allDone: totalDays > 0 && doneDays === totalDays };
  });
}
