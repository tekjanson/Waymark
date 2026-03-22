/* ============================================================
   gantt/helpers.js — Pure helper functions for the Gantt template
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element in the SVG namespace with the given attributes.
 * @param {string} tag
 * @param {Object} attrs
 * @returns {SVGElement}
 */
export function svg(tag, attrs = {}) {
  const elem = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    elem.setAttribute(k, String(v));
  }
  return elem;
}

/**
 * Parse a date string (YYYY-MM-DD or ISO) to a Date object.
 * Returns null if the string is empty or not a valid date.
 * @param {string|null|undefined} str
 * @returns {Date|null}
 */
export function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a Date as 'Mon YY' for axis labels (e.g. 'Apr 26').
 * @param {Date} date
 * @returns {string}
 */
export function formatMonthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

/**
 * Format a Date as 'Mon D' for tooltips (e.g. 'Apr 1').
 * @param {Date} date
 * @returns {string}
 */
export function formatShortDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Format a Date as ISO YYYY-MM-DD for emitting edits.
 * @param {Date} date
 * @returns {string}
 */
export function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Return the number of whole days from d1 to d2 (may be negative).
 * @param {Date} d1
 * @param {Date} d2
 * @returns {number}
 */
export function daysBetween(d1, d2) {
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

/**
 * Return a new Date that is n days after date.
 * @param {Date} date
 * @param {number} n
 * @returns {Date}
 */
export function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Compute the visible date range from the tasks array.
 * Adds 3 days of padding before the earliest start and 5 days after the
 * latest end so bars are never clipped at the edge.
 * Returns null if no tasks have valid dates.
 * @param {{ start: Date|null, end: Date|null }[]} tasks
 * @returns {{ minDate: Date, maxDate: Date, totalDays: number }|null}
 */
export function computeGanttRange(tasks) {
  let minDate = null;
  let maxDate = null;
  for (const t of tasks) {
    if (t.start && (!minDate || t.start < minDate)) minDate = t.start;
    if (t.end   && (!maxDate || t.end   > maxDate)) maxDate = t.end;
  }
  if (!minDate || !maxDate) return null;
  if (maxDate <= minDate) maxDate = addDays(minDate, 7);
  const paddedMin = addDays(minDate, -3);
  const paddedMax = addDays(maxDate, 5);
  return { minDate: paddedMin, maxDate: paddedMax, totalDays: daysBetween(paddedMin, paddedMax) };
}

/**
 * Parse a comma-separated dependencies string into an array of trimmed task names.
 * @param {string} depStr
 * @returns {string[]}
 */
export function parseDependencies(depStr) {
  if (!depStr || !depStr.trim()) return [];
  return depStr.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Return a CSS class name for a bar based on progress percentage.
 * @param {number} pct  0–100
 * @returns {string}
 */
export function progressClass(pct) {
  if (pct >= 100) return 'gantt-bar-complete';
  if (pct > 0)    return 'gantt-bar-active';
  return 'gantt-bar-pending';
}

/* Palette of distinct assignee colors */
const ASSIGNEE_COLORS = [
  '#0284c7', '#16a34a', '#7c3aed', '#d97706', '#dc2626',
  '#0891b2', '#65a30d', '#9333ea', '#b45309', '#b91c1c',
];

/* Module-level color lookup — reset each render via resetAssigneeColors() */
const _colorMap = {};
let _colorIdx = 0;

/**
 * Get or assign a consistent color for an assignee name.
 * @param {string|null} name
 * @returns {string}  hex color
 */
export function assigneeColor(name) {
  if (!name) return '#6b7280';
  if (!_colorMap[name]) {
    _colorMap[name] = ASSIGNEE_COLORS[_colorIdx % ASSIGNEE_COLORS.length];
    _colorIdx++;
  }
  return _colorMap[name];
}

/** Reset the assignee color mapping (call at the start of each render). */
export function resetAssigneeColors() {
  for (const k of Object.keys(_colorMap)) delete _colorMap[k];
  _colorIdx = 0;
}

/**
 * Compute which tasks lie on the critical path using a forward + backward
 * pass (CPM algorithm).  Returns a Set of 0-based task indices.
 * Tasks with no valid dates or zero duration are excluded from the path.
 * @param {{ name: string, duration: number, depStr: string }[]} tasks
 * @returns {Set<number>}
 */
export function findCriticalPath(tasks) {
  const n = tasks.length;
  if (n === 0) return new Set();

  /* Build name → index lookup */
  const nameToIdx = {};
  tasks.forEach((t, i) => { nameToIdx[t.name.trim().toLowerCase()] = i; });

  /* Resolve dependency indices for each task */
  const predOf = tasks.map(t =>
    parseDependencies(t.depStr)
      .map(d => nameToIdx[d.trim().toLowerCase()])
      .filter(i => i !== undefined && !isNaN(i))
  );

  /* Forward pass: ES (earliest start) and EF (earliest finish) in days */
  const ef = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const es_i = predOf[i].length > 0 ? Math.max(...predOf[i].map(j => ef[j])) : 0;
    ef[i] = es_i + Math.max(tasks[i].duration, 1);
  }
  const projDur = Math.max(...ef);

  /* Backward pass: LF (latest finish) and LS (latest start) in days */
  const lf = new Array(n).fill(projDur);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j < n; j++) {
      if (predOf[j].includes(i)) {
        const ls_j = lf[j] - Math.max(tasks[j].duration, 1);
        if (ls_j < lf[i]) lf[i] = ls_j;
      }
    }
  }

  /* Critical: total float (LS − ES) is zero */
  const critical = new Set();
  for (let i = 0; i < n; i++) {
    const es_i = predOf[i].length > 0 ? Math.max(...predOf[i].map(j => ef[j])) : 0;
    const ls_i = lf[i] - Math.max(tasks[i].duration, 1);
    if (Math.abs(ls_i - es_i) < 0.001) critical.add(i);
  }
  return critical;
}
