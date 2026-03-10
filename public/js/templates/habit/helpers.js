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
