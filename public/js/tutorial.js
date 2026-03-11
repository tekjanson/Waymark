/* ============================================================
   tutorial.js — Guided onboarding tutorial for WayMark
   
   Walks new users through the app's purpose and key features
   with spotlight highlights and tooltip explanations.
   Also provides per-template contextual tutorials.
   ============================================================ */

import * as userData from './user-data.js';

/* ---------- Tutorial Steps ---------- */

const STEPS = [
  {
    title: 'Welcome to WayMark!',
    body: 'WayMark turns your Google Sheets into beautiful, interactive views — checklists, trackers, kanban boards, budgets, and more. Let\'s take a quick tour!',
    target: null, // no spotlight — centered welcome
    position: 'center',
  },
  {
    title: 'Drive Explorer',
    body: 'Browse your Google Drive folders and sheets. Click "Browse Drive" in the menu to open the full explorer. Click any folder to expand it and find your spreadsheets.',
    target: '#menu-explorer-btn',
    position: 'right',
  },
  {
    title: 'Pin Your Favorites',
    body: 'Found a folder you use often? Pin it for quick access. Pinned folders appear on your home screen so you can jump back in instantly.',
    target: '#pinned-folders',
    position: 'bottom',
  },
  {
    title: 'Search Your Sheets',
    body: 'Looking for a specific sheet? Use the search bar to find sheets by name — results appear instantly as you type.',
    target: '#search-form',
    position: 'bottom',
  },
  {
    title: 'Smart Templates',
    body: 'WayMark automatically detects what kind of data your sheet contains — checklists, schedules, budgets, kanban boards, and 15+ other types — and renders a specialised interactive view.',
    target: null,
    position: 'center',
  },
  {
    title: 'Edit In Place',
    body: 'Click any value in a sheet view to edit it directly. Changes sync back to your Google Sheet in real-time. No need to switch tabs!',
    target: null,
    position: 'center',
  },
  {
    title: 'Open in Google Sheets',
    body: 'Need full spreadsheet editing power? Use the "Edit in Sheets" button in any sheet view to open it directly in Google Sheets.',
    target: null,
    position: 'center',
  },
  {
    title: 'Quick Actions',
    body: 'Use the sidebar menu to create new sheets, import files, or generate example sheets. Everything is just one click away!',
    target: '#menu-create-btn',
    position: 'right',
  },
  {
    title: 'You\'re All Set!',
    body: 'That\'s everything you need to get started. You can revisit this tutorial anytime using the help button in the top bar. Happy organising!',
    target: '#tutorial-btn',
    position: 'bottom',
  },
];

/* ---------- Tutorial Controller ---------- */

let currentStep = 0;
let isActive = false;

const elements = {};

function getElements() {
  if (elements.overlay) return elements;
  elements.overlay   = document.getElementById('tutorial-overlay');
  elements.spotlight = document.getElementById('tutorial-spotlight');
  elements.tooltip   = document.getElementById('tutorial-tooltip');
  elements.title     = document.getElementById('tutorial-title');
  elements.body      = document.getElementById('tutorial-body');
  elements.stepText  = document.getElementById('tutorial-step-text');
  elements.prevBtn   = document.getElementById('tutorial-prev');
  elements.nextBtn   = document.getElementById('tutorial-next');
  elements.skipBtn   = document.getElementById('tutorial-skip');
  return elements;
}

function bindEvents() {
  const els = getElements();
  els.nextBtn.addEventListener('click', next);
  els.prevBtn.addEventListener('click', prev);
  els.skipBtn.addEventListener('click', stop);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isActive) stop();
  });
}

let eventsBound = false;

function start() {
  if (isActive) return;
  const els = getElements();
  if (!eventsBound) { bindEvents(); eventsBound = true; }
  isActive = true;

  _activeSteps = null; // use global STEPS
  _onComplete = null;

  // Resume from last saved step if tutorial wasn't completed
  const savedStep = userData.getTutorialStep();
  const steps = getActiveSteps();
  currentStep = (savedStep > 0 && savedStep < steps.length) ? savedStep : 0;

  els.overlay.classList.remove('hidden');
  renderStep();
}

function stop() {
  isActive = false;
  const els = getElements();
  els.overlay.classList.add('hidden');
  els.spotlight.style.display = 'none';
  if (_onComplete) {
    _onComplete();
  } else {
    userData.setTutorialCompleted(true);
    userData.setTutorialStep(currentStep);
  }
}

function next() {
  const steps = getActiveSteps();
  if (currentStep < steps.length - 1) {
    currentStep++;
    if (!_activeSteps) userData.setTutorialStep(currentStep);
    renderStep();
  } else {
    stop();
  }
}

function prev() {
  if (currentStep > 0) {
    currentStep--;
    if (!_activeSteps) userData.setTutorialStep(currentStep);
    renderStep();
  }
}

function renderStep() {
  const els = getElements();
  const steps = getActiveSteps();
  const step = steps[currentStep];

  // Update content
  els.title.textContent = step.title;
  els.body.textContent = step.body;
  els.stepText.textContent = `${currentStep + 1} of ${steps.length}`;

  // Button states
  els.prevBtn.classList.toggle('hidden', currentStep === 0);
  els.nextBtn.textContent = currentStep === steps.length - 1 ? 'Finish' : 'Next';

  // Position spotlight and tooltip
  if (step.target) {
    const targetEl = document.querySelector(step.target);
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const pad = 8;

      els.spotlight.style.display = 'block';
      els.spotlight.style.top    = `${rect.top - pad}px`;
      els.spotlight.style.left   = `${rect.left - pad}px`;
      els.spotlight.style.width  = `${rect.width + pad * 2}px`;
      els.spotlight.style.height = `${rect.height + pad * 2}px`;

      positionTooltip(els.tooltip, rect, step.position);
    } else {
      // Target not visible — center tooltip
      centerTooltip(els);
    }
  } else {
    // No target — center
    centerTooltip(els);
  }
}

function centerTooltip(els) {
  els.spotlight.style.display = 'none';
  els.tooltip.style.position = 'fixed';
  els.tooltip.style.top = '50%';
  els.tooltip.style.left = '50%';
  els.tooltip.style.transform = 'translate(-50%, -50%)';
  els.tooltip.style.right = 'auto';
  els.tooltip.style.bottom = 'auto';
}

function positionTooltip(tooltip, targetRect, position) {
  const gap = 16;
  tooltip.style.position = 'fixed';
  tooltip.style.transform = 'none';

  // Reset
  tooltip.style.top = 'auto';
  tooltip.style.left = 'auto';
  tooltip.style.right = 'auto';
  tooltip.style.bottom = 'auto';

  switch (position) {
    case 'bottom':
      tooltip.style.top  = `${targetRect.bottom + gap}px`;
      tooltip.style.left = `${Math.max(16, targetRect.left)}px`;
      break;
    case 'top':
      tooltip.style.bottom = `${window.innerHeight - targetRect.top + gap}px`;
      tooltip.style.left   = `${Math.max(16, targetRect.left)}px`;
      break;
    case 'right':
      tooltip.style.top  = `${targetRect.top}px`;
      tooltip.style.left = `${targetRect.right + gap}px`;
      break;
    case 'left':
      tooltip.style.top   = `${targetRect.top}px`;
      tooltip.style.right = `${window.innerWidth - targetRect.left + gap}px`;
      break;
    default:
      centerTooltip({ tooltip, spotlight: { style: {} } });
  }

  // Clamp to viewport
  requestAnimationFrame(() => {
    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth - 16) {
      tooltip.style.left = 'auto';
      tooltip.style.right = '16px';
    }
    if (rect.bottom > window.innerHeight - 16) {
      tooltip.style.top = 'auto';
      tooltip.style.bottom = '16px';
    }
  });
}

/* ---------- Public API ---------- */

export const Tutorial = { start, stop, next, prev, startTemplateTutorial };

/* ---------- Per-Template Tutorials ---------- */

const TEMPLATE_TUTORIALS = {
  kanban: [
    { title: '📋 Kanban Board', body: 'This is your Kanban board — tasks are organised into lanes by stage. Drag cards between lanes to update their status, or click the stage badge to cycle through stages.', target: null, position: 'center' },
    { title: 'Filter by Project', body: 'Use the filter pills to show only tasks from a specific project. Click "All" to see everything.', target: '.kanban-filter-bar', position: 'bottom' },
    { title: 'Sort & Archive', body: 'Sort cards by priority, due date, or reporter. Toggle "Show Archived" to see completed and archived tasks.', target: '.kanban-controls', position: 'bottom' },
    { title: 'Card Details', body: 'Click the ▾ arrow on a card to expand its details — description, sub-tasks, notes, and editable metadata. Click ⛶ to open the full focus view.', target: '.kanban-card', position: 'bottom' },
    { title: 'Priority & Stage', body: 'Click the colored priority dot to cycle P0→P1→P2→P3. Click the stage badge to move tasks through your workflow. Drag cards between lanes for bulk moves.', target: '.kanban-card-header', position: 'bottom' },
    { title: 'Collapse Lanes', body: 'Click the ▾/▸ toggle on a lane header to collapse or expand it — great for focusing on what matters.', target: '.kanban-lane-header', position: 'bottom' },
    { title: 'Add Tasks', body: 'Use the "+ Add Task" button at the bottom of any lane to create new tasks directly in that stage.', target: '.add-row-trigger', position: 'top' },
  ],
  budget: [
    { title: '💰 Budget Tracker', body: 'Your budget sheet shows income and expenses grouped by category, with subtotals and visual summaries.', target: null, position: 'center' },
    { title: 'Category Groups', body: 'Items are grouped by category. Each group header shows a subtotal — red when over budget.', target: '.checklist-group-header', position: 'bottom' },
    { title: 'Inline Editing', body: 'Click any value to edit it directly. Changes sync back to your Google Sheet in real-time.', target: '.editable-cell', position: 'bottom' },
    { title: 'Budget Chart', body: 'The stacked bar chart shows expense allocation by category. Over-budget categories are highlighted in red.', target: '.budget-chart', position: 'top' },
  ],
  recipe: [
    { title: '🍳 Recipe Viewer', body: 'Your recipe is displayed with ingredients, instructions, and metadata. Let\'s explore the cooking tools!', target: null, position: 'center' },
    { title: 'Scale Recipes', body: 'Use the scale controls to multiply or divide ingredient quantities. Perfect for cooking for different group sizes.', target: '.recipe-scale-bar', position: 'bottom' },
    { title: 'Cooking Mode', body: 'Tap any ingredient to check it off as you cook. Green checkmarks track what you\'ve used.', target: '.recipe-ingredients', position: 'bottom' },
    { title: 'Shopping List', body: 'Toggle Shopping List mode to see just ingredients in a compact checklist format — perfect for grocery shopping on your phone.', target: '.recipe-mode-bar', position: 'bottom' },
    { title: 'Print Recipe', body: 'Use the Print/PDF button to export a clean, formatted recipe for printing or saving as PDF.', target: '.recipe-print-btn', position: 'bottom' },
  ],
  checklist: [
    { title: '✅ Checklist', body: 'Your checklist shows items with checkboxes. Check items off as you complete them!', target: null, position: 'center' },
    { title: 'Check Items', body: 'Click the checkbox next to any item to toggle it complete. The row updates with a strikethrough and syncs to your sheet.', target: '.checklist-checkbox', position: 'bottom' },
    { title: 'Category Progress', body: 'Items grouped by category show progress bars in each header — see how much is done at a glance.', target: '.checklist-group-header', position: 'bottom' },
    { title: 'Bulk Actions', body: 'Use the ✓ All and ✗ All buttons on each category to quickly check or uncheck all items in that group.', target: '.checklist-bulk-btn', position: 'bottom' },
  ],
  habit: [
    { title: '📊 Habit Tracker', body: 'Track your daily habits with a visual grid. Each cell represents one day for one habit.', target: null, position: 'center' },
    { title: 'Toggle States', body: 'Click any day cell to cycle through states: empty → ✓ done (green) → ◐ partial (yellow) → ✗ missed (red). Each state syncs to your sheet.', target: '.habit-toggle', position: 'bottom' },
    { title: 'Streaks & Goals', body: 'The streak column shows consecutive days completed with a 🔥 flame. If goals are set, progress bars show how close you are to your target.', target: '.habit-streak', position: 'bottom' },
    { title: 'Weekly Summary', body: 'The summary panel shows your overall progress, best habit, and per-habit mini progress bars — all update live as you toggle.', target: '.habit-summary', position: 'bottom' },
  ],
  testcases: [
    { title: '🧪 Test Cases', body: 'Manage your test cases with status tracking, filtering, and bulk operations.', target: null, position: 'center' },
    { title: 'Status Cycling', body: 'Click the status badge on any test case to cycle through: Untested → Pass → Fail → Blocked → Skip.', target: '.testcase-status', position: 'bottom' },
    { title: 'Filter by Status', body: 'Use the filter pills to show only tests with a specific status — great for focusing on failures.', target: '.testcase-toolbar', position: 'bottom' },
    { title: 'Bulk Operations', body: 'Mark all as Pass, reset to Untested, or skip filtered items with one click. Copy all failures to clipboard for bug reports.', target: '.testcase-bulk-btn', position: 'bottom' },
  ],
  crm: [
    { title: '🤝 CRM Pipeline', body: 'Your CRM shows deals with contact info, stage tracking, and pipeline analytics.', target: null, position: 'center' },
    { title: 'Stage Cycling', body: 'Click the stage badge to move deals through your pipeline: Lead → Contacted → Qualified → Proposal → Won/Lost.', target: '.crm-stage-btn', position: 'bottom' },
    { title: 'Funnel View', body: 'Toggle the pipeline funnel view to see deals grouped by stage with conversion percentages between stages.', target: '.crm-toggle-view', position: 'bottom' },
  ],
  contacts: [
    { title: '👥 Contacts', body: 'Your contacts are sorted alphabetically with quick navigation and search.', target: null, position: 'center' },
    { title: 'A–Z Navigation', body: 'Use the letter index on the side to jump directly to contacts starting with that letter.', target: '.contacts-sidebar', position: 'left' },
    { title: 'Search & Filter', body: 'Type in the search box to filter contacts by name, email, or any visible field.', target: '.contacts-search', position: 'bottom' },
  ],
  flow: [
    { title: '🔀 Flow Diagram', body: 'Your flow diagram shows process steps connected by edges. Nodes are auto-arranged in a hierarchical layout.', target: null, position: 'center' },
    { title: 'Node Interaction', body: 'Hover over a node for details. Double-click to open the full detail modal with connections and properties.', target: '.flow-node', position: 'bottom' },
    { title: 'Drag & Arrange', body: 'Drag nodes to reposition them. Positions are saved automatically. Click "Auto-Align" to reset the layout.', target: '.flow-realign-btn', position: 'bottom' },
  ],
  tracker: [
    { title: '📈 Goal Tracker', body: 'Track progress toward your goals with visual progress bars, milestones, and completion estimates.', target: null, position: 'center' },
    { title: 'Progress Bars', body: 'Each goal shows a progress bar with milestone markers at 25%, 50%, and 75%. Completed goals show a ✓ badge.', target: '.tracker-bar-wrap', position: 'bottom' },
    { title: 'Edit Values', body: 'Click any value to edit it inline. Update current progress to see the bar and ETA update in real-time.', target: '.editable-cell', position: 'bottom' },
  ],
  roster: [
    { title: '📅 Roster', body: 'Manage employee schedules with shift assignments across days of the week.', target: null, position: 'center' },
    { title: 'Toggle Shifts', body: 'Click day cells to toggle employee shifts. Click shift badges to cycle through shift types.', target: '.roster-grid', position: 'bottom' },
    { title: 'Weekly Navigation', body: 'Use the prev/next buttons to navigate between weeks. The summary footer shows daily coverage counts.', target: '.roster-toolbar', position: 'bottom' },
  ],
  timesheet: [
    { title: '⏱️ Timesheet', body: 'Track billable hours by client, project, and date with grouping and invoice export.', target: null, position: 'center' },
    { title: 'Grouping', body: 'Group entries by client, date, or project to see subtotals for hours and revenue.', target: '.timesheet-group-toolbar', position: 'bottom' },
    { title: 'Invoice Export', body: 'Click the invoice button to generate a printable invoice summary with billable line items.', target: '.timesheet-invoice-btn', position: 'bottom' },
  ],
  grading: [
    { title: '📝 Gradebook', body: 'View student grades with class averages, grade distribution, and per-assignment scores.', target: null, position: 'center' },
    { title: 'Class Average', body: 'The footer row shows class-wide averages for each assignment, color-coded by grade.', target: '.grading-footer', position: 'top' },
    { title: 'Distribution Chart', body: 'The grade distribution chart shows how many A\'s, B\'s, C\'s, D\'s, and F\'s are in the class.', target: '.grading-dist-chart', position: 'bottom' },
  ],
  meal: [
    { title: '🍽️ Meal Planner', body: 'Plan your weekly meals with nutrition tracking and meal-by-day organization.', target: null, position: 'center' },
    { title: 'Nutrition Summary', body: 'The summary bar shows total meals, calories, and protein for the week.', target: '.meal-summary', position: 'bottom' },
  ],
  inventory: [
    { title: '📦 Inventory', body: 'Track your inventory with low-stock alerts, quantities, and reorder notifications.', target: null, position: 'center' },
    { title: 'Low Stock Alerts', body: 'Items below the threshold are highlighted at the top with a ⚠ Low badge and red border.', target: '.inventory-reorder', position: 'bottom' },
  ],
  travel: [
    { title: '✈️ Travel Planner', body: 'Organize your travel itinerary with cost tracking, countdown timer, and map links.', target: null, position: 'center' },
    { title: 'Trip Summary', body: 'The summary bar shows total trip cost, number of activities, and countdown to departure.', target: '.travel-summary', position: 'bottom' },
  ],
  schedule: [
    { title: '📆 Schedule', body: 'View your events sorted by time with conflict detection for overlapping events.', target: null, position: 'center' },
    { title: 'Conflicts', body: 'Overlapping events are highlighted with a red border and ⚠ Conflict badge. Use "Today" to jump to the current day.', target: '.schedule-today-btn', position: 'bottom' },
  ],
  changelog: [
    { title: '📝 Changelog', body: 'Browse version history with collapsible sections and quick navigation.', target: null, position: 'center' },
    { title: 'Version Navigation', body: 'Use the sidebar to jump to any version. Click version headers to collapse/expand. The latest version is auto-expanded.', target: '.changelog-sidebar', position: 'left' },
  ],
  log: [
    { title: '📋 Activity Log', body: 'View activity entries in reverse chronological order. Large logs are paginated for performance.', target: null, position: 'center' },
  ],
  poll: [
    { title: '📊 Poll Results', body: 'Animated bar chart showing poll results with percentage labels.', target: null, position: 'center' },
    { title: 'Live Mode', body: 'Enable live mode for automatic 10-second refresh — perfect for watching results come in.', target: '.poll-live-btn', position: 'bottom' },
  ],
  social: [
    { title: '💬 Social Feed', body: 'View posts with author profiles, mood indicators, and threaded comments.', target: null, position: 'center' },
  ],
};

/**
 * Start a template-specific tutorial.
 * Only shows once per template unless force=true.
 * @param {string} key — template key (e.g. 'kanban', 'budget')
 * @param {boolean} [force=false] — bypass completion check
 */
function startTemplateTutorial(key, force = false) {
  const storageKey = `waymark_template-tutorial-${key}`;
  if (!force) {
    try { if (localStorage.getItem(storageKey)) return; } catch { /* ignore */ }
    try { if (localStorage.getItem('waymark_template_tutorials_auto') === 'false') return; } catch { /* ignore */ }
  }

  const steps = TEMPLATE_TUTORIALS[key];
  if (!steps || steps.length === 0) return;

  // Use the same overlay system as the global tutorial
  const els = getElements();
  if (!eventsBound) { bindEvents(); eventsBound = true; }

  // Save current state to restore after
  const savedSteps = _activeSteps;
  const savedCallback = _onComplete;

  _activeSteps = steps;
  _onComplete = () => {
    try { localStorage.setItem(storageKey, 'true'); } catch { /* ignore */ }
    _activeSteps = savedSteps;
    _onComplete = savedCallback;
  };

  isActive = true;
  currentStep = 0;
  els.overlay.classList.remove('hidden');
  renderStep();
}

/** Currently active step array (global or template) */
let _activeSteps = null;
let _onComplete = null;

/**
 * Get the active steps list (template tutorial overrides global).
 * @returns {Array}
 */
function getActiveSteps() {
  return _activeSteps || STEPS;
}
