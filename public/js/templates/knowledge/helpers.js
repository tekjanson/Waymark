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
 * @param {string} raw — ISO date or partial date string
 * @returns {string}
 */
export function formatDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
