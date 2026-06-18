/* ============================================================
   templates/agents/helpers.js — Constants and utilities
   ============================================================ */

import { el } from '../shared.js';

/* ---------- Fleet webhook config (localStorage key) ---------- */
export const LS_WEBHOOK_KEY = 'waymark_fleet_webhook_url';

/* ---------- Status config ---------- */
export const STATUS_CYCLE  = ['Online', 'Idle', 'Offline', 'Error'];
export const STATUS_COLORS = {
  Online:  { bg: '#dcfce7', text: '#15803d', dot: '#16a34a' },
  Idle:    { bg: '#fef9c3', text: '#854d0e', dot: '#ca8a04' },
  Offline: { bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8' },
  Error:   { bg: '#fee2e2', text: '#991b1b', dot: '#dc2626' },
};

/* ---------- Human names pool (for new-agent suggestions) ---------- */
export const AGENT_NAME_POOL = [
  'Alex', 'Sam', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Quinn',
  'Avery', 'Blake', 'Drew', 'Finley', 'Harper', 'Indigo', 'Jules',
  'Kendall', 'Lane', 'Marlow', 'Noel', 'Oakley', 'Payton',
];

/** Time-ago formatter
 * @param {string} isoStr - ISO timestamp
 * @returns {string}
 */
export function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (isNaN(secs) || secs < 0) return '—';
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Build a stat badge for header
 * @param {string} label - Display label
 * @param {number} count - Count value
 * @param {string} color - Optional color override
 * @returns {Element}
 */
export function buildStatBadge(label, count, color = null) {
  return el('div', { className: 'agents-stat' }, [
    el('span', {
      className: 'agents-stat-count',
      ...(color ? { style: `color:${color}` } : {}),
    }, [String(count)]),
    el('span', { className: 'agents-stat-label' }, [label]),
  ]);
}
