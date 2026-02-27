/* ============================================================
   templates/index.js — Template registry & detection engine
   
   Imports all template modules (which self-register via
   registerTemplate), then exports the public API:
   
   - TEMPLATES  — registry of all template definitions
   - detectTemplate(headers) — pick the best template for headers
   - onEdit(fn) — register a cell-edit callback
   ============================================================ */

import { TEMPLATES, onEdit } from './shared.js';

/* Import each template — side-effect: they self-register */
import './testcases.js';
import './checklist.js';
import './tracker.js';
import './schedule.js';
import './inventory.js';
import './contacts.js';
import './log.js';
import './budget.js';
import './kanban.js';
import './habit.js';
import './grading.js';
import './timesheet.js';
import './poll.js';
import './changelog.js';
import './crm.js';
import './meal.js';
import './travel.js';
import './roster.js';

/* ---------- Detection ---------- */

/**
 * Detect the best-matching template for the given headers.
 * Returns { key, template } or defaults to checklist.
 */
export function detectTemplate(headers) {
  if (!headers || headers.length === 0) {
    return { key: 'checklist', template: TEMPLATES.checklist };
  }

  const lower = headers.map(h => (h || '').toLowerCase().trim());

  // Sort by priority (higher = more specific = preferred)
  const candidates = Object.entries(TEMPLATES)
    .filter(([, t]) => t.detect(lower))
    .sort((a, b) => b[1].priority - a[1].priority);

  if (candidates.length > 0) {
    const [key, template] = candidates[0];
    return { key, template };
  }

  // Default to checklist
  return { key: 'checklist', template: TEMPLATES.checklist };
}

export { TEMPLATES, onEdit };
