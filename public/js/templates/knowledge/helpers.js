/* ============================================================
   knowledge/helpers.js — Pure functions for Knowledge Base
   ============================================================ */

/* ---------- Status classification ---------- */

/** @type {Record<string, string>} */
export const STATUS_COLORS = {
  published: '#16a34a',
  draft: '#f59e0b',
  review: '#3b82f6',
  archived: '#94a3b8',
};

/** @type {Record<string, string>} */
export const STATUS_LABELS = {
  published: 'Published',
  draft: 'Draft',
  review: 'In Review',
  archived: 'Archived',
};

/**
 * Classify a status string into a normalised key.
 * @param {string} val
 * @returns {string}
 */
export function classifyStatus(val) {
  const v = (val || '').toLowerCase().trim();
  if (/^(publish|live|active|final|approved)/.test(v)) return 'published';
  if (/^(review|pending|in.?review)/.test(v)) return 'review';
  if (/^(archive|deprecat|obsolete|retire)/.test(v)) return 'archived';
  return 'draft';
}

/* ---------- Tag parsing ---------- */

/**
 * Parse a comma/semicolon-separated tag string into an array of trimmed tags.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseTags(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[,;]+/)
    .map(t => t.trim())
    .filter(Boolean);
}

/**
 * Collect unique, sorted tags from all article groups.
 * @param {Array<{row: string[]}>} groups — parsed article groups
 * @param {number} tagIdx — column index for tags
 * @returns {string[]}
 */
export function collectTags(groups, tagIdx) {
  if (tagIdx < 0) return [];
  const set = new Set();
  for (const g of groups) {
    for (const t of parseTags(g.row[tagIdx] || '')) {
      set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Collect unique, sorted categories from all article groups.
 * @param {Array<{row: string[]}>} groups
 * @param {number} catIdx
 * @returns {string[]}
 */
export function collectCategories(groups, catIdx) {
  if (catIdx < 0) return [];
  const set = new Set();
  for (const g of groups) {
    const v = (g.row[catIdx] || '').trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* ---------- Content helpers ---------- */

/**
 * Build a plain-text snippet from the content children of a group.
 * @param {Array<{row: string[]}>} children — content sub-rows
 * @param {number} contentIdx — column index for content
 * @param {number} [maxLen=120] — max snippet length
 * @returns {string}
 */
export function buildSnippet(children, contentIdx, maxLen = 120) {
  if (contentIdx < 0 || children.length === 0) return '';
  const text = children
    .map(c => (c.row[contentIdx] || '').trim())
    .filter(Boolean)
    .join(' ');
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s\S*$/, '') + '…';
}

/**
 * Format a date string into a human-readable short form.
 * Handles:
 *   - YYYY-MM-DD           → forced local midnight (avoids UTC-offset day-off bug)
 *   - YYYY-MM-DD HH:mm     → local datetime
 *   - Google Sheets serial  → integer days since 1899-12-30
 *   - Any other string       → passed to Date constructor
 * @param {string} raw
 * @returns {string}
 */
export function formatDate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const clean = raw.trim();
  if (!clean) return '';

  // Google Sheets serial date: integer 40000–60000
  if (/^\d{5}$/.test(clean)) {
    const serial = parseInt(clean, 10);
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + serial);
    return epoch.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Date-only "YYYY-MM-DD" — append T00:00:00 to force local midnight
  const d = /^\d{4}-\d{2}-\d{2}$/.test(clean)
    ? new Date(clean + 'T00:00:00')
    : new Date(clean);

  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Returns current time as "YYYY-MM-DD HH:mm" */
export function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const REACTION_EMOJIS = ['👍', '❤️', '💡', '✅'];
