/* ============================================================
   templates/template-loader.js — Lazy template loader
   
   Provides on-demand loading of template modules to reduce
   initial page load. Templates are only imported when first
   accessed, significantly improving performance for laptop
   hosting and mobile connections.
   ============================================================ */

/**
 * Lazy-loading template registry.
 * Maps template keys to their import paths and loaded modules.
 */
const TEMPLATE_MODULES = {
  checklist: { path: './checklist.js', module: null },
  testcases: { path: './testcases.js', module: null },
  tracker: { path: './tracker.js', module: null },
  schedule: { path: './schedule.js', module: null },
  inventory: { path: './inventory.js', module: null },
  contacts: { path: './contacts.js', module: null },
  log: { path: './log.js', module: null },
  budget: { path: './budget/index.js', module: null },
  kanban: { path: './kanban/index.js', module: null },
  habit: { path: './habit/index.js', module: null },
  grading: { path: './grading.js', module: null },
  timesheet: { path: './timesheet.js', module: null },
  poll: { path: './poll.js', module: null },
  changelog: { path: './changelog.js', module: null },
  crm: { path: './crm.js', module: null },
  meal: { path: './meal.js', module: null },
  travel: { path: './travel.js', module: null },
  roster: { path: './roster.js', module: null },
  recipe: { path: './recipe/index.js', module: null },
  flow: { path: './flow/index.js', module: null },
  social: { path: './social/index.js', module: null },
  automation: { path: './automation.js', module: null },
  guide: { path: './guide/index.js', module: null },
  knowledge: { path: './knowledge/index.js', module: null },
  notification: { path: './notification.js', module: null },
  iot: { path: './iot/index.js', module: null },
  okr: { path: './okr/index.js', module: null },
  gantt: { path: './gantt/index.js', module: null },
  agents: { path: './agents.js', module: null },
  passwords: { path: './passwords.js', module: null },
  linker: { path: './linker.js', module: null },
  marketing: { path: './marketing.js', module: null },
  arcade: { path: './arcade/index.js', module: null },
  worker: { path: './worker.js', module: null },
  blog: { path: './blog.js', module: null },
  photos: { path: './photos.js', module: null },
  ledger: { path: './ledger/index.js', module: null },
  invoice: { path: './invoice/index.js', module: null },
  rfi: { path: './rfi.js', module: null }
};

/**
 * Load a template module dynamically.
 * Caches the result so subsequent calls return immediately.
 * @param {string} key - Template key
 * @returns {Promise<void>}
 */
export async function loadTemplate(key) {
  const entry = TEMPLATE_MODULES[key];
  if (!entry) {
    console.warn(`Unknown template key: ${key}`);
    return;
  }

  // Already loaded - return cached module
  if (entry.module) return;

  // Dynamic import - only loads when needed
  try {
    entry.module = await import(entry.path);
  } catch (err) {
    console.error(`Failed to load template ${key}:`, err);
    throw err;
  }
}

/**
 * Check if a template is already loaded.
 * @param {string} key - Template key
 * @returns {boolean}
 */
export function isTemplateLoaded(key) {
  const entry = TEMPLATE_MODULES[key];
  return entry && entry.module !== null;
}

/**
 * Preload multiple templates in parallel.
 * Useful for warming the cache when idle.
 * @param {string[]} keys - Template keys to preload
 * @returns {Promise<void>}
 */
export async function preloadTemplates(keys) {
  await Promise.all(keys.map(k => loadTemplate(k)));
}
