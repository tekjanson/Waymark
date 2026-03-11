// @ts-check
/**
 * design-audit.spec.js — Screenshot capture for AI-powered design validation.
 *
 * Captures every page, template, and UI state in both light and dark mode.
 * Screenshots are saved to `design-audit-screenshots/` at the project root.
 *
 * Run:  npm run screenshots
 *       npx playwright test tests/e2e/design-audit.spec.js
 *
 * After capture, run:  npm run design-audit
 */
const { test } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');
const fs   = require('fs');
const path = require('path');

/* ────────── Output directory ────────── */
const OUT = path.resolve(__dirname, '..', '..', 'design-audit-screenshots');

test.beforeAll(() => {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'light'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'dark'),  { recursive: true });
});

/* ────────── Template definitions ────────── */
const TEMPLATES = [
  { key: 'checklist',  sheetId: 'sheet-001', wait: '.checklist-row',           label: 'Checklist – Grocery List' },
  { key: 'checklist2', sheetId: 'sheet-002', wait: '.checklist-row',           label: 'Checklist – Home Repairs' },
  { key: 'categorized',sheetId: 'sheet-004', wait: '.checklist-row',           label: 'Checklist – Categorized' },
  { key: 'tracker',    sheetId: 'sheet-010', wait: '.template-tracker-row',    label: 'Progress Tracker' },
  { key: 'schedule',   sheetId: 'sheet-011', wait: '.template-schedule-block', label: 'Weekly Schedule' },
  { key: 'inventory',  sheetId: 'sheet-012', wait: '.template-inv-card',       label: 'Inventory' },
  { key: 'contacts',   sheetId: 'sheet-013', wait: '.template-contact-card',   label: 'Contacts' },
  { key: 'log',        sheetId: 'sheet-014', wait: '.template-log-entry',      label: 'Activity Log' },
  { key: 'testcases',  sheetId: 'sheet-015', wait: '.tc-row',                  label: 'Test Cases' },
  { key: 'budget',     sheetId: 'sheet-016', wait: '.budget-row',              label: 'Budget' },
  { key: 'budget2',    sheetId: 'sheet-033', wait: '.budget-row',              label: 'Budget – April' },
  { key: 'kanban',     sheetId: 'sheet-017', wait: '.kanban-card',             label: 'Kanban Board' },
  { key: 'kanban2',    sheetId: 'sheet-028', wait: '.kanban-card',             label: 'Kanban – Enhanced' },
  { key: 'habit',      sheetId: 'sheet-018', wait: '.habit-grid-row',          label: 'Habit Tracker' },
  { key: 'grading',    sheetId: 'sheet-019', wait: '.grading-row',             label: 'Gradebook' },
  { key: 'grading2',   sheetId: 'sheet-035', wait: '.grading-row',             label: 'Gradebook – Science' },
  { key: 'timesheet',  sheetId: 'sheet-020', wait: '.ts-row',                  label: 'Timesheet' },
  { key: 'poll',       sheetId: 'sheet-021', wait: '.poll-row',                label: 'Poll / Survey' },
  { key: 'changelog',  sheetId: 'sheet-022', wait: '.changelog-entry',         label: 'Changelog' },
  { key: 'crm',        sheetId: 'sheet-023', wait: '.crm-card',               label: 'CRM Pipeline' },
  { key: 'meal',       sheetId: 'sheet-024', wait: '.meal-card',              label: 'Meal Planner' },
  { key: 'meal2',      sheetId: 'sheet-034', wait: '.meal-card',              label: 'Meal – Next Week' },
  { key: 'travel',     sheetId: 'sheet-025', wait: '.travel-card',            label: 'Travel Itinerary' },
  { key: 'roster',     sheetId: 'sheet-026', wait: '.roster-grid-row',        label: 'Roster' },
  { key: 'recipe',     sheetId: 'sheet-027', wait: '.recipe-card',            label: 'Recipe Card' },
  { key: 'recipe2',    sheetId: 'sheet-032', wait: '.recipe-card',            label: 'Recipe – Legacy' },
  { key: 'flow',       sheetId: 'sheet-029', wait: '.flow-group',             label: 'Flow Diagram' },
  { key: 'flow2',      sheetId: 'sheet-031', wait: '.flow-group',             label: 'Flow – Large Pipeline' },
  { key: 'social',     sheetId: 'sheet-030', wait: '.social-feed',            label: 'Social Feed' },
  { key: 'automation', sheetId: 'sheet-036', wait: '.automation-card',        label: 'Automation' },
];

/* ────────── Helper: set theme and take screenshot ────────── */

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('waymark_theme', JSON.stringify(t));
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  // Brief pause for CSS transitions / repaints
  await page.waitForTimeout(300);
}

async function screenshot(page, theme, name) {
  const dir = path.join(OUT, theme);
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  });
}

/* ────────── Helper: capture a page in both themes ────────── */

async function captureBothThemes(page, name) {
  await setTheme(page, 'light');
  await screenshot(page, 'light', name);
  await setTheme(page, 'dark');
  await screenshot(page, 'dark', name);
}

/* ═══════════════════════════════════════════════════════════════
   Test: Login Screen
   ═══════════════════════════════════════════════════════════════ */
test('capture login screen', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#login-btn', { state: 'visible', timeout: 10_000 });
  await captureBothThemes(page, '00-login');
});

/* ═══════════════════════════════════════════════════════════════
   Test: Home View (dashboard)
   ═══════════════════════════════════════════════════════════════ */
test('capture home view', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await captureBothThemes(page, '01-home');
});

/* ═══════════════════════════════════════════════════════════════
   Test: Explorer View
   ═══════════════════════════════════════════════════════════════ */
test('capture explorer view', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });
  await page.waitForTimeout(500);
  await captureBothThemes(page, '02-explorer');
});

/* ═══════════════════════════════════════════════════════════════
   Test: Settings Modal
   ═══════════════════════════════════════════════════════════════ */
test('capture settings modal', async ({ page }) => {
  await setupApp(page);
  // Open settings modal
  await page.evaluate(() => {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
  });
  await page.waitForTimeout(300);
  await captureBothThemes(page, '03-settings-modal');
});

/* ═══════════════════════════════════════════════════════════════
   Test: Create Sheet Modal
   ═══════════════════════════════════════════════════════════════ */
test('capture create-sheet modal', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const modal = document.getElementById('create-sheet-modal');
    if (modal) modal.classList.remove('hidden');
  });
  await page.waitForTimeout(300);
  await captureBothThemes(page, '04-create-sheet-modal');
});

/* ═══════════════════════════════════════════════════════════════
   Test: Examples Modal
   ═══════════════════════════════════════════════════════════════ */
test('capture examples modal', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const modal = document.getElementById('examples-modal');
    if (modal) modal.classList.remove('hidden');
  });
  await page.waitForTimeout(300);
  await captureBothThemes(page, '05-examples-modal');
});

/* ═══════════════════════════════════════════════════════════════
   Test: Import Modal
   ═══════════════════════════════════════════════════════════════ */
test('capture import modal', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const modal = document.getElementById('import-modal');
    if (modal) modal.classList.remove('hidden');
  });
  await page.waitForTimeout(300);
  await captureBothThemes(page, '06-import-modal');
});

/* ═══════════════════════════════════════════════════════════════
   Tests: Every template (both light + dark)
   ═══════════════════════════════════════════════════════════════ */
for (const tmpl of TEMPLATES) {
  test(`capture ${tmpl.label}`, async ({ page }) => {
    await setupApp(page);
    await navigateToSheet(page, tmpl.sheetId);
    await page.waitForSelector(tmpl.wait, { timeout: 10_000 });
    // Let animations / lazy renders finish
    await page.waitForTimeout(800);
    await captureBothThemes(page, `template-${tmpl.key}`);
  });
}

/* ═══════════════════════════════════════════════════════════════
   Tests: Directory views for templates that have them
   ═══════════════════════════════════════════════════════════════ */

const DIRECTORY_VIEWS = [
  {
    key: 'budget-dir',
    label: 'Budget Directory',
    route: '#/folder/f-budgets/Budgets',
    wait: '.budget-dir-card',
  },
  {
    key: 'grading-dir',
    label: 'Gradebook Directory',
    route: '#/folder/f-grades/Gradebooks',
    wait: '.grading-dir-card',
  },
  {
    key: 'meal-dir',
    label: 'Meal Planner Directory',
    route: '#/folder/f-meals/Meal%20Plans',
    wait: '.meal-dir-card',
  },
  {
    key: 'kanban-dir',
    label: 'Kanban Directory',
    route: '#/folder/f-projects/Projects',
    wait: '.kanban-dir-card',
  },
  {
    key: 'social-dir',
    label: 'Social Feed Directory',
    route: '#/folder/f-social/Social%20Feeds',
    wait: '.social-dir-card',
  },
];

for (const dir of DIRECTORY_VIEWS) {
  test(`capture ${dir.label}`, async ({ page }) => {
    await setupApp(page);
    await page.evaluate((hash) => { window.location.hash = hash; }, dir.route);
    try {
      await page.waitForSelector(dir.wait, { timeout: 8_000 });
    } catch {
      // Directory view may not exist for this fixture set — skip gracefully
      console.log(`  ⚠ ${dir.label}: directory selector ${dir.wait} not found, capturing anyway`);
    }
    await page.waitForTimeout(800);
    await captureBothThemes(page, `dir-${dir.key}`);
  });
}
