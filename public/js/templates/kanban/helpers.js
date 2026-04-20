/* ============================================================
   kanban/helpers.js — Constants & pure helper functions

   Deterministic color mapping, priority ranking, due-date
   formatting, lane configuration, and status-change timestamp
   utilities for the Kanban template.
   ============================================================ */

/* ---------- Constants ---------- */

export const PROJECT_PALETTE = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
  '#d97706', '#0d9488', '#0891b2', '#4f46e5', '#16a34a',
];

export const LANE_LABELS = {
  backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress',
  qa: 'QA', done: 'Done', rejected: 'Rejected', archived: 'Archived',
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

/* ---------- Status-Change Timestamps ---------- */

/** Prefix used to identify auto-generated status-change notes. */
export const STATUS_PREFIX = '⟳ ';

/**
 * Check whether a note's text is an auto-generated status-change note.
 * @param {string} text
 * @returns {boolean}
 */
export function isStatusNote(text) {
  return (text || '').startsWith(STATUS_PREFIX);
}

/**
 * Extract a branch name from a note that follows the AI completion note format.
 * Matches patterns like "Branch: feature/my-task" or "fix/my-fix".
 * Returns null if no branch is found.
 * @param {string} text
 * @returns {string|null}
 */
export function parseBranchName(text) {
  const m = (text || '').match(/\bBranch:\s*([\w./-]+(?:[\w.-])*)/);
  return m ? m[1] : null;
}

/**
 * Current timestamp as a compact ISO string (YYYY-MM-DD HH:MM).
 * Uses a space separator instead of T for human readability in the sheet.
 * @returns {string}
 */
export function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Format a date/datetime string for display in note headers.
 * Always shows the actual datetime stamp so users know exactly when
 * things happened. Handles both "YYYY-MM-DD" and "YYYY-MM-DD HH:MM" formats.
 * @param {string} dateStr
 * @returns {string}
 */
export function formatNoteDate(dateStr) {
  if (!dateStr) return '';
  // Parse: support "YYYY-MM-DD" and "YYYY-MM-DD HH:MM"
  const hasTime = /\d{2}:\d{2}/.test(dateStr);
  const d = hasTime ? new Date(dateStr.replace(' ', 'T')) : new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;

  const now = new Date();
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  let str = d.toLocaleDateString('en-US', opts);
  // Always include time when available
  if (hasTime) {
    str += ` ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return str;
}

/**
 * Format a date/datetime as a short relative label for card badges.
 * @param {string} dateStr
 * @returns {string}
 */
export function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const hasTime = /\d{2}:\d{2}/.test(dateStr);
  const d = hasTime ? new Date(dateStr.replace(' ', 'T')) : new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;

  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.round(diffMs / 60000);
  const diffHr = Math.round(diffMs / 3600000);
  const diffDay = Math.round(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/* ---------- Cycle Time ---------- */

/**
 * Compute the time (in fractional hours) that a card spent in a given stage,
 * derived from STATUS_PREFIX note timestamps.
 *
 * Scans `notes` for pairs of auto-generated status-change notes
 * (e.g. "⟳ To Do → In Progress") and sums the durations the card
 * spent with `targetStage` as its current stage.
 *
 * @param {Object[]} notes    — array of note group-objects (each has `.row`)
 * @param {number}   noteCol  — column index for the note text
 * @param {number}   dateCol  — column index for the note timestamp
 * @param {string}   targetStage — human-readable stage label (e.g. "In Progress")
 * @returns {number} total hours spent in targetStage (0 if no data)
 */
export function calcCycleTime(notes, noteCol, dateCol, targetStage) {
  if (!notes || notes.length === 0 || noteCol < 0 || dateCol < 0 || !targetStage) return 0;

  // Build ordered list of status-change events with timestamps
  const events = [];
  for (const n of notes) {
    const text = (n.row[noteCol] || '').trim();
    if (!text.startsWith(STATUS_PREFIX)) continue;
    const dateStr = (n.row[dateCol] || '').trim();
    if (!dateStr) continue;
    const hasTime = /\d{2}:\d{2}/.test(dateStr);
    const d = hasTime ? new Date(dateStr.replace(' ', 'T')) : new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) continue;
    // Parse "⟳ From → To"
    const match = text.slice(STATUS_PREFIX.length).match(/^(.+?)\s*→\s*(.+)$/);
    if (!match) continue;
    events.push({ from: match[1].trim(), to: match[2].trim(), time: d.getTime() });
  }

  // Sort events chronologically
  events.sort((a, b) => a.time - b.time);

  // Accumulate time windows where the current stage equals targetStage
  let totalMs = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.from === targetStage) {
      // Stage was left at ev.time; find when it was entered (prior event that set it)
      let enteredAt = null;
      for (let j = i - 1; j >= 0; j--) {
        if (events[j].to === targetStage) { enteredAt = events[j].time; break; }
      }
      // If we never saw an entry event, skip (can't compute the window)
      if (enteredAt !== null) totalMs += ev.time - enteredAt;
    }
  }

  return totalMs / (1000 * 60 * 60);
}

/* ---------- Text Search ---------- */

/**
 * Check whether a card group matches a case-insensitive text query.
 * Searches the task title, description, assignee, label, project, and reporter fields.
 *
 * @param {Object} group   — parsed group object (has `.row`)
 * @param {Object} cols    — column-index map from `columns()`
 * @param {string} query   — raw search string (may be empty)
 * @returns {boolean} true if the card matches (or query is blank)
 */
export function matchesSearch(group, cols, query) {
  if (!query || !query.trim()) return true;
  const q = query.trim().toLowerCase();
  const { row } = group;

  const searchFields = [
    cols.text,
    cols.description,
    cols.assignee,
    cols.label,
    cols.project,
    cols.reporter,
  ];

  for (const colIdx of searchFields) {
    if (colIdx >= 0) {
      const val = (row[colIdx] || '').toLowerCase();
      if (val.includes(q)) return true;
    }
  }

  // Also check sub-task descriptions
  for (const child of [...(group.subtasks || []), ...(group.notes || [])]) {
    if (cols.description >= 0) {
      const val = (child.row[cols.description] || '').toLowerCase();
      if (val.includes(q)) return true;
    }
    if (cols.note >= 0) {
      const val = (child.row[cols.note] || '').toLowerCase();
      if (val.includes(q)) return true;
    }
  }

  return false;
}
