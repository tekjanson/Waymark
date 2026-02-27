/* ============================================================
   ui.js — shared DOM / UI utilities
   ============================================================ */

/* ---------- Element helpers ---------- */

/**
 * Create a DOM element with attributes and children.
 * @param {string} tag
 * @param {Object} attrs  — attribute key/value pairs; special keys: className, dataset, on
 * @param {(string|Node)[]} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') { node.className = val; }
    else if (key === 'dataset') { Object.assign(node.dataset, val); }
    else if (key === 'on') {
      for (const [evt, handler] of Object.entries(val)) {
        node.addEventListener(evt, handler);
      }
    }
    else if (key === 'style' && typeof val === 'object') { Object.assign(node.style, val); }
    else { node.setAttribute(key, val); }
  }

  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/* ---------- Toasts ---------- */

let toastContainer;

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} duration  ms before auto-dismiss
 */
export function showToast(message, type = 'info', duration = 4000) {
  if (!toastContainer) toastContainer = document.getElementById('toast-container');
  const toast = el('div', { className: `toast toast-${type}` }, [message]);
  toastContainer.append(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
}

/* ---------- Loading overlay ---------- */

let overlayEl;

export function showLoading() {
  if (!overlayEl) overlayEl = document.getElementById('loading-overlay');
  overlayEl.classList.remove('hidden');
}

export function hideLoading() {
  if (!overlayEl) overlayEl = document.getElementById('loading-overlay');
  overlayEl.classList.add('hidden');
}

/* ---------- View switching ---------- */

/**
 * Show exactly one view, hiding all others.
 * @param {string} viewName — matches data-view attribute
 */
export function showView(viewName) {
  document.querySelectorAll('#content .view').forEach(v => {
    v.classList.toggle('hidden', v.dataset.view !== viewName);
  });
}

/* ---------- Relative time ---------- */

const UNITS = [
  { max: 60, divisor: 1, unit: 'second' },
  { max: 3600, divisor: 60, unit: 'minute' },
  { max: 86400, divisor: 3600, unit: 'hour' },
  { max: 2592000, divisor: 86400, unit: 'day' },
  { max: 31536000, divisor: 2592000, unit: 'month' },
  { max: Infinity, divisor: 31536000, unit: 'year' },
];

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat
  ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  : null;

/**
 * Return a human-friendly relative time string.
 * @param {Date|string|number} date
 */
export function timeAgo(date) {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  for (const { max, divisor, unit } of UNITS) {
    if (Math.abs(seconds) < max) {
      const val = -Math.round(seconds / divisor);
      return rtf ? rtf.format(val, unit) : `${Math.abs(val)} ${unit}${Math.abs(val) !== 1 ? 's' : ''} ago`;
    }
  }
  return new Date(date).toLocaleDateString();
}

/* ---------- Sidebar toggle ---------- */

export function toggleSidebar(forceOpen) {
  const sidebar = document.getElementById('sidebar');
  if (typeof forceOpen === 'boolean') {
    sidebar.classList.toggle('sidebar-open', forceOpen);
  } else {
    sidebar.classList.toggle('sidebar-open');
  }
  return sidebar.classList.contains('sidebar-open');
}

/* ---------- Escape HTML ---------- */

const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => escapeMap[c]);
}
