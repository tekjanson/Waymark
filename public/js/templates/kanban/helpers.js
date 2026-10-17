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
 * Normalize spoken stage words to canonical lane labels.
 * @param {string} value
 * @returns {string}
 */
export function normalizeVoiceStage(value) {
  const v = (value || '').toLowerCase().trim().replace(/[-_]+/g, ' ');
  if (!v) return '';
  if (/^(backlog|back log|idea|ideas)$/.test(v)) return 'Backlog';
  if (/^(to do|todo|ready|planned|queued|next)$/.test(v)) return 'To Do';
  if (/^(in progress|progress|doing|active|wip|started)$/.test(v)) return 'In Progress';
  if (/^(qa|q a|review|testing|verify|verification)$/.test(v)) return 'QA';
  if (/^(done|complete|completed|finished|closed|shipped)$/.test(v)) return 'Done';
  if (/^(rejected|reject|declined|invalid|wontfix|won't fix)$/.test(v)) return 'Rejected';
  if (/^(archived|archive)$/.test(v)) return 'Archived';
  return '';
}

/**
 * Parse a spoken task transcript into kanban row fields.
 * @param {string} transcript
 * @returns {{title: string, description: string, priority: string, stage: string}}
 */
export function parseVoiceTask(transcript) {
  const original = (transcript || '').trim();
  const result = { title: '', description: '', priority: 'P2', stage: '' };
  if (!original) return result;

  const priorityMatch = original.match(/\b(?:priority\s*)?(p[0-3]|critical|urgent|high|medium|normal|low)\b/i);
  if (priorityMatch) {
    const pri = priorityMatch[1].toLowerCase();
    if (pri === 'critical' || pri === 'urgent' || pri === 'p0') result.priority = 'P0';
    else if (pri === 'high' || pri === 'p1') result.priority = 'P1';
    else if (pri === 'low' || pri === 'p3') result.priority = 'P3';
    else result.priority = 'P2';
  }

  const stageWords = '(backlog|back log|to do|todo|in progress|doing|active|wip|qa|q a|review|testing|done|complete|completed|rejected|reject|archived|archive)';
  const stageMatch = original.match(new RegExp(`\\b(?:stage|column|lane|status)\\s+(?:is\\s+)?${stageWords}\\b`, 'i'))
    || original.match(new RegExp(`\\b(?:in|into|to|on|under)\\s+(?:the\\s+)?${stageWords}(?:\\s+(?:column|lane|stage))?\\b`, 'i'));
  if (stageMatch) result.stage = normalizeVoiceStage(stageMatch[1]);

  const descriptionMatch = original.match(/\b(?:description|details|detail|notes?|with details?)\s+(.*?)(?=\s+\b(?:priority|stage|column|lane|status)\b|\s+\bp[0-3]\b|$)/i);
  if (descriptionMatch) result.description = descriptionMatch[1].trim().replace(/[.。]+$/, '');

  const quotedTitle = original.match(/\b(?:called|named|titled|title)\s+["“”']([^"“”']+)["“”']/i);
  if (quotedTitle) {
    result.title = quotedTitle[1].trim();
  } else {
    const titleMatch = original.match(new RegExp(`\\b(?:called|named|titled|title|task|card)\\s+(.*?)(?=\\s+\\b(?:description|details|detail|notes?|with details?|priority|stage|column|lane|status)\\b|\\s+\\bp[0-3]\\b|\\s+\\b(?:in|into|to|on|under)\\s+(?:the\\s+)?${stageWords}(?:\\s+(?:column|lane|stage))?\\b|$)`, 'i'));
    if (titleMatch) result.title = titleMatch[1].trim();
  }

  if (!result.title) {
    let cleaned = original
      .replace(/\b(?:please\s+)?(?:create|add|make|new)\s+(?:a\s+)?(?:task|card|ticket)?\b/ig, ' ')
      .replace(/\b(?:description|details|detail|notes?|with details?)\s+.*$/i, ' ')
      .replace(/\b(?:priority\s*)?(?:p[0-3]|critical|urgent|high|medium|normal|low)\b/ig, ' ')
      .replace(new RegExp(`\\b(?:stage|column|lane|status)\\s+(?:is\\s+)?${stageWords}\\b`, 'ig'), ' ')
      .replace(new RegExp(`\\b(?:in|into|to|on|under)\\s+(?:the\\s+)?${stageWords}(?:\\s+(?:column|lane|stage))?\\b`, 'ig'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
    cleaned = cleaned.replace(/^(?:called|named|titled|title|task|card)\s+/i, '').trim();
    result.title = cleaned;
  }

  result.title = (result.title || 'Voice Task')
    .replace(/^(?:called|named|titled|title)\s+/i, '')
    .replace(/[.。]+$/, '')
    .trim();
  return result;
}

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
