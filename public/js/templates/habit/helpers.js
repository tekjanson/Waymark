/* ============================================================
   templates/habit/helpers.js — Constants & pure functions
   for the Habit Tracker template.
   ============================================================ */

import { cell } from '../shared.js';

/* ---------- State Maps ---------- */

/** Display characters for each habit state */
export const STATE_CHAR  = { done: '\u2713', partial: '~', missed: '\u2717', empty: '' };

/** Cycle order when clicking a day cell */
export const STATE_CYCLE = ['empty', 'done', 'partial', 'missed'];

/** Value written back to the sheet for each state */
export const STATE_VALUE = { done: '\u2713', partial: '~', missed: '\u2717', empty: '' };

/** Column header pattern for the "Week Of" / date column */
export const WEEK_COL_PATTERN = /^(week\s*of|week|date|period|week\s*start|starting)/;

/* ---------- Classifiers ---------- */

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

/* ---------- Streak ---------- */

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

/* ---------- Multi-Week Helpers ---------- */

/**
 * Parse a date-like string into a Date object.
 * Handles: "2026-03-10", "3/10/2026", "Mar 10, 2026", "Mar 10".
 * @param {string} raw
 * @returns {Date|null}
 */
export function parseWeekDate(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  // ISO: 2026-03-10
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(v + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  // US: 3/10/2026 or 03/10/2026
  const usMatch = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const d = new Date(Number(usMatch[3]), Number(usMatch[1]) - 1, Number(usMatch[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  // Fallback: try native parsing
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date as a human-readable week label.
 * e.g. "Week of Mar 10, 2026"
 * @param {Date} date
 * @returns {string}
 */
export function formatWeekLabel(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Week of ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Format a date as an ISO string (for sheet storage).
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
 * Extract unique weeks from rows and sort chronologically.
 * @param {string[][]} rows
 * @param {number}     weekOfCol — column index for the "Week Of" column
 * @returns {Array<{date: Date, iso: string, label: string, rows: Array<{row: string[], origIdx: number}>}>}
 */
export function getUniqueWeeks(rows, weekOfCol) {
  const weekMap = new Map();
  for (let i = 0; i < rows.length; i++) {
    const raw = cell(rows[i], weekOfCol);
    const date = parseWeekDate(raw);
    if (!date) continue;
    const iso = formatWeekISO(date);
    if (!weekMap.has(iso)) {
      weekMap.set(iso, { date, iso, label: formatWeekLabel(date), rows: [] });
    }
    weekMap.get(iso).rows.push({ row: rows[i], origIdx: i });
  }
  return Array.from(weekMap.values()).sort((a, b) => a.date - b.date);
}

/**
 * Compute streak across multiple weeks for a given habit.
 * Looks at day cells from the most recent week backward.
 * @param {string}   habitName — the habit text to match
 * @param {Array}    weeks     — sorted week objects from getUniqueWeeks
 * @param {number}   textCol   — text column index
 * @param {number[]} dayCols   — day column indices
 * @param {number}   upToWeekIdx — compute streak up to this week index (inclusive)
 * @returns {number}
 */
export function computeMultiWeekStreak(habitName, weeks, textCol, dayCols, upToWeekIdx) {
  let streak = 0;
  const name = (habitName || '').toLowerCase().trim();
  for (let w = upToWeekIdx; w >= 0; w--) {
    const weekRows = weeks[w].rows;
    const habitRow = weekRows.find(r =>
      (cell(r.row, textCol) || '').toLowerCase().trim() === name
    );
    if (!habitRow) break; // no data for this habit in this week → streak broken
    let weekStreak = 0;
    let brokeStreak = false;
    for (let d = dayCols.length - 1; d >= 0; d--) {
      // On the first (most recent) week, start from the right
      // On older weeks, all days must be done for streak to continue
      if (habitState(cell(habitRow.row, dayCols[d])) === 'done') {
        weekStreak++;
      } else {
        if (w === upToWeekIdx) {
          // Most recent week — stop at first non-done from the right
          brokeStreak = true;
          break;
        } else {
          // Older week with a gap means streak broken
          brokeStreak = true;
          break;
        }
      }
    }
    streak += weekStreak;
    if (brokeStreak) break;
  }
  return streak;
}

/* ---------- Goal Parsing ---------- */

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
