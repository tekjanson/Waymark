/* ============================================================
   templates/index.js — Template registry & detection engine

   The fallback checklist template is loaded eagerly so the app can
   render immediately, while the rest of the template modules load
   on demand when a sheet/view actually requires them.
   ============================================================ */

import { TEMPLATES, onEdit } from './shared.js';
import { TEMPLATE_REGISTRY } from './registry-data.js';

/* Load the fallback template eagerly so the app can render immediately. */
import './checklist.js';

const _loadingTemplates = new Map();

/**
 * Create a lightweight placeholder definition for metadata-driven
 * detection and metadata-only UI access before the real module loads.
 * @param {string} key
 * @param {Object} meta
 * @returns {Object}
 */
function createPlaceholderTemplate(key, meta) {
  return {
    key,
    name: meta?.name || key,
    icon: meta?.icon || '📊',
    color: meta?.color || '#64748b',
    priority: meta?.priority || 10,
    detect(lower) {
      const signals = Array.isArray(meta?.detectSignals) ? meta.detectSignals : [];
      return signals.some(signal => {
        const needle = (signal || '').toLowerCase();
        return lower.some(h => (h || '').includes(needle));
      });
    },
    columns(lower) {
      const result = {};
      const roles = Array.isArray(meta?.columnRoles) ? meta.columnRoles : [];
      roles.forEach((role) => {
        const idx = lower.findIndex(h => {
          const text = (h || '').toLowerCase();
          if (!text) return false;
          if (role === 'text') return /(^|[^a-z])text($|[^a-z])/.test(text) || /description|name|title|item|task|entry|activity|post|content|recipe|company|employee|student|objective|goal|question|choice|version|invoice|job|game|contact|ticket|subject|note/.test(text);
          if (role === 'status') return /status|done|complete|checked|flag|state/.test(text);
          if (role === 'date') return /date|day|week|time|when/.test(text);
          if (role === 'notes') return /notes|comment|details|remarks/.test(text);
          if (role === 'category') return /category|type|group|section|class|tag|kind/.test(text);
          if (role === 'amount') return /amount|price|cost|value|total|balance|payment|fee/.test(text);
          if (role === 'progress') return /progress|percent|score|rating|level|grade|completion/.test(text);
          if (role === 'quantity') return /quantity|qty|count|stock|units|size/.test(text);
          if (role === 'priority') return /priority|severity|importance/.test(text);
          return text.includes(role.replace(/[^a-z]/g, ''));
        });
        if (idx >= 0) result[role] = idx;
      });
      return result;
    },
    render() {},
    _lazyPlaceholder: true,
  };
}

Object.entries(TEMPLATE_REGISTRY).forEach(([key, meta]) => {
  if (!TEMPLATES[key]) {
    TEMPLATES[key] = createPlaceholderTemplate(key, meta);
  }
});

/**
 * Load a template module on demand and return its definition.
 * @param {string} key
 * @returns {Promise<Object|null>}
 */
export async function loadTemplate(key) {
  if (!key) return null;
  const existing = TEMPLATES[key];
  if (existing && !existing._lazyPlaceholder) return existing;

  const meta = TEMPLATE_REGISTRY[key];
  if (!meta) return existing || null;

  if (_loadingTemplates.has(key)) {
    return _loadingTemplates.get(key);
  }

  const promise = import(meta.modulePath)
    .then(() => TEMPLATES[key] || createPlaceholderTemplate(key, meta))
    .catch((err) => {
      console.warn(`[templates] Failed to load ${key}`, err);
      return TEMPLATES[key] || createPlaceholderTemplate(key, meta);
    });

  _loadingTemplates.set(key, promise);
  try {
    return await promise;
  } finally {
    _loadingTemplates.delete(key);
  }
}

/**
 * Return the currently known template definition for a key.
 * @param {string} key
 * @returns {Object|null}
 */
export function getTemplate(key) {
  return TEMPLATES[key] || null;
}

/**
 * Detect the best-matching template for the given headers.
 * Returns { key, template } or defaults to checklist.
 */
export function detectTemplate(headers) {
  if (!headers || headers.length === 0) {
    return { key: 'checklist', template: TEMPLATES.checklist };
  }

  const lower = headers.map(h => (h || '').toLowerCase().trim());

  const candidates = Object.entries(TEMPLATE_REGISTRY)
    .map(([key, meta]) => ({
      key,
      template: TEMPLATES[key] || createPlaceholderTemplate(key, meta),
    }))
    .filter(({ template }) => template.detect(lower))
    .sort((a, b) => (b.template.priority || 0) - (a.template.priority || 0));

  if (candidates.length > 0) {
    const { key, template } = candidates[0];
    return { key, template };
  }

  return { key: 'checklist', template: TEMPLATES.checklist };
}

export { TEMPLATES, onEdit };
