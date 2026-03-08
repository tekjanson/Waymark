/* ============================================================
   kanban/helpers.js — Constants & pure helper functions

   Deterministic color mapping, priority ranking, due-date
   formatting, and lane configuration for the Kanban template.
   ============================================================ */

/* ---------- Constants ---------- */

export const PROJECT_PALETTE = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
  '#d97706', '#0d9488', '#0891b2', '#4f46e5', '#16a34a',
];

export const LANE_LABELS = {
  backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress',
  done: 'Done', archived: 'Archived',
};

/** Number of cards rendered per lane before showing "Show more" */
export const LANE_PAGE_SIZE = 50;

/* ---------- Pure Functions ---------- */

/**
 * Deterministic color for a project name.
 * @param {string} name
 * @returns {string} hex color
 */
export function projectColor(name) {
  if (!name) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return PROJECT_PALETTE[Math.abs(hash) % PROJECT_PALETTE.length];
}

/**
 * Numeric rank for sorting by priority (lower = more urgent).
 * @param {string} val
 * @returns {number}
 */
export function priRank(val) {
  const v = (val || '').toLowerCase().trim();
  if (v === 'p0' || v === 'critical') return 0;
  if (v === 'p1' || v === 'high') return 1;
  if (v === 'p2' || v === 'medium') return 2;
  if (v === 'p3' || v === 'low') return 3;
  return 4;
}

/**
 * CSS class for due-date urgency.
 * @param {string} dateStr
 * @returns {string}
 */
export function dueBadgeClass(dateStr) {
  if (!dateStr) return '';
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = (due - now) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'kanban-due-overdue';
  if (diff < 2) return 'kanban-due-soon';
  if (diff < 7) return 'kanban-due-upcoming';
  return 'kanban-due-later';
}

/**
 * Human-friendly due-date label.
 * @param {string} dateStr
 * @returns {string}
 */
export function formatDue(dateStr) {
  if (!dateStr) return '';
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return dateStr;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((due - now) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `${diff}d`;
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
