/* ============================================================
   templates/mesh/helpers.js — Pure functions for mesh task queue
   ============================================================ */

/* ---------- Status ---------- */

/** Canonical status values. */
export const STATUS_STATES = ['pending', 'running', 'done', 'failed', 'cancelled'];

/** Cycle order for click-to-advance (skips 'running' — only workers set that). */
export const STATUS_CYCLE = ['pending', 'done', 'failed', 'cancelled', 'pending'];

/**
 * Normalise a raw status string to a canonical value.
 * @param {string} raw
 * @returns {'pending'|'running'|'done'|'failed'|'cancelled'}
 */
export function classifyStatus(raw) {
  const v = (raw || '').toLowerCase().trim();
  if (/^(done|complete|success|pass)$/.test(v)) return 'done';
  if (/^(run|running|active|in.?progress)$/.test(v)) return 'running';
  if (/^(fail|failed|error|broken)$/.test(v)) return 'failed';
  if (/^(cancel|cancelled|aborted|skipped)$/.test(v)) return 'cancelled';
  return 'pending';
}

/**
 * Human-readable label for a status.
 * @param {string} cls — canonical status
 * @returns {string}
 */
export function statusLabel(cls) {
  return {
    pending:   'Pending',
    running:   'Running',
    done:      'Done',
    failed:    'Failed',
    cancelled: 'Cancelled',
  }[cls] || 'Pending';
}

/**
 * Advance a status to the next in the manual cycle (skips 'running').
 * @param {string} current — canonical status
 * @returns {string} next canonical status
 */
export function nextStatus(current) {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[idx >= 0 ? (idx + 1) % (STATUS_CYCLE.length - 1) : 0];
}

/* ---------- Priority ---------- */

/** Numeric rank for sorting (lower = higher priority). */
export function priorityRank(raw) {
  const v = (raw || '').toLowerCase().trim();
  if (v === 'high' || v === 'critical' || v === 'urgent') return 0;
  if (v === 'low' || v === 'background' || v === 'defer') return 2;
  return 1; // normal / medium / default
}

/* ---------- Counting & aggregation ---------- */

/**
 * Count tasks by canonical status.
 * @param {Object[]} tasks — array of parsed task objects
 * @returns {{ pending: number, running: number, done: number, failed: number, cancelled: number }}
 */
export function countByStatus(tasks) {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
  for (const t of tasks) {
    const cls = classifyStatus(t.status);
    if (cls in counts) counts[cls]++;
  }
  return counts;
}

/**
 * Sort tasks with high-priority first, then by creation time (oldest first).
 * @param {Object[]} tasks
 * @returns {Object[]} sorted copy
 */
export function sortByPriority(tasks) {
  return [...tasks].sort((a, b) => {
    const pd = priorityRank(a.priority) - priorityRank(b.priority);
    if (pd !== 0) return pd;
    return (a.created || '').localeCompare(b.created || '');
  });
}

/* ---------- Duration formatting ---------- */

/**
 * Format elapsed time between two ISO/datetime strings.
 * Returns a compact human-readable string: "320ms", "5.3s", "2m 14s".
 * @param {string} startStr
 * @param {string} [endStr] — defaults to now
 * @returns {string}
 */
export function formatDuration(startStr, endStr) {
  if (!startStr) return '—';
  const start = new Date(startStr);
  const end   = endStr ? new Date(endStr) : new Date();
  if (isNaN(start) || isNaN(end)) return '—';
  const ms = end - start;
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

/* ---------- JSON helpers ---------- */

/**
 * Parse a JSON string safely, returning fallback on error.
 * @param {string} str
 * @param {*} [fallback=null]
 * @returns {*}
 */
export function parseJSON(str, fallback = null) {
  if (!str || typeof str !== 'string') return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Format a value as a compact JSON string for display.
 * Objects/arrays get pretty-printed. Primitives return their string form.
 * @param {*} val
 * @returns {string}
 */
export function formatJSON(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}
