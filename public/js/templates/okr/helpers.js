/* ============================================================
   okr/helpers.js — Pure helper functions for the OKR template
   ============================================================ */

/**
 * Parse a progress value string to a number 0–100.
 * Accepts "75%", "0.75", "75", "75.5%", etc.
 * @param {string|null|undefined} str
 * @returns {number}  always 0–100
 */
export function parseProgress(str) {
  if (!str && str !== 0) return 0;
  const s = String(str).trim();
  if (!s) return 0;

  /* Handle decimal fraction like "0.75" → 75 */
  const num = parseFloat(s.replace('%', '').trim());
  if (isNaN(num)) return 0;

  /* If input looks like a fraction (no % and value ≤ 1) treat as decimal */
  if (!s.includes('%') && num >= 0 && num <= 1) return Math.round(num * 100);

  return Math.max(0, Math.min(100, Math.round(num)));
}

/**
 * Compute the average progress for a set of KRs (0–100).
 * Returns 0 for empty arrays.
 * @param {number[]} progresses  array of 0–100 values
 * @returns {number}
 */
export function rollupProgress(progresses) {
  if (!progresses || progresses.length === 0) return 0;
  const sum = progresses.reduce((acc, p) => acc + p, 0);
  return Math.round(sum / progresses.length);
}

/**
 * Return a CSS class name for a progress level.
 * @param {number} pct  0–100
 * @returns {string}
 */
export function progressClass(pct) {
  if (pct >= 70) return 'okr-progress-high';
  if (pct >= 40) return 'okr-progress-mid';
  return 'okr-progress-low';
}

/**
 * Normalise a quarter string to "QN YYYY" format.
 * Accepts "Q1 2026", "q1-2026", "2026 Q1", "Q1", etc.
 * Returns the original string if it can't be parsed.
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function normaliseQuarter(str) {
  if (!str || typeof str !== 'string') return '';
  const s = str.trim();
  if (!s) return '';
  /* Match "QN YYYY" or "QN-YYYY" or "QN/YYYY" */
  const m = s.match(/Q([1-4])[\s\-\/]?(20\d{2})?/i);
  if (!m) return s;
  const q = m[1];
  const y = m[2] || '';
  return y ? `Q${q} ${y}` : `Q${q}`;
}

/**
 * Collect unique, non-empty quarter values from the rows data.
 * Returns sorted array (ascending).
 * @param {string[][]} rows
 * @param {number} quarterColIdx
 * @returns {string[]}
 */
export function collectQuarters(rows, quarterColIdx) {
  if (quarterColIdx < 0) return [];
  const seen = new Set();
  for (const row of rows) {
    const q = normaliseQuarter(row[quarterColIdx]);
    if (q) seen.add(q);
  }
  return [...seen].sort();
}

/**
 * Group data rows by the Objective column into an ordered array of groups.
 * Within each group, rows sharing the same objective text are KR children.
 * Empty-objective rows are placed under the previous objective.
 * @param {string[][]} rows  data rows (no header)
 * @param {number} objColIdx
 * @returns {{ objective: string, rows: string[][] }[]}
 */
export function groupByObjective(rows, objColIdx) {
  const groups = [];
  const groupMap = new Map();

  for (const row of rows) {
    const objRaw = (row[objColIdx] || '').trim();
    const obj = objRaw || ((groups.length > 0) ? groups[groups.length - 1].objective : '(Unlabelled)');

    if (!groupMap.has(obj)) {
      const g = { objective: obj, rows: [] };
      groups.push(g);
      groupMap.set(obj, g);
    }
    groupMap.get(obj).rows.push(row);
  }
  return groups;
}
