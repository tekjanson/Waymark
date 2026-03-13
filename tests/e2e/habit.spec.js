// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ================================================================
   LAYER 1: Detection & Rendering — Single-week (sheet-018)
   ================================================================ */

test('habit tracker detected as Habit Tracker template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Habit');
});

test('single-week habit renders grid with day columns', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  const toggles = page.locator('.habit-toggle');
  expect(await toggles.count()).toBeGreaterThan(0);

  // Check some are done (sheet-018 has ✓ entries)
  const done = page.locator('.habit-done');
  expect(await done.count()).toBeGreaterThan(0);
});

test('single-week shows Day and Week view tabs only', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  const tabs = page.locator('.habit-view-tab');
  expect(await tabs.count()).toBe(2);
  await expect(tabs.nth(0)).toContainText('Day');
  await expect(tabs.nth(1)).toContainText('Week');
});

test('single-week has upgrade button for multi-week tracking', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  const upgradeBtn = page.locator('.habit-upgrade-btn');
  await expect(upgradeBtn).toBeVisible();
  await expect(upgradeBtn).toContainText('Start Tracking Weeks');
});

/* ================================================================
   LAYER 1: Detection & Rendering — Multi-week (sheet-038)
   ================================================================ */

test('multi-week habit tracker detected correctly', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Habit');
});

test('multi-week shows all five view tabs', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  const tabs = page.locator('.habit-view-tab');
  expect(await tabs.count()).toBe(5);
  await expect(tabs.nth(0)).toContainText('Day');
  await expect(tabs.nth(1)).toContainText('Week');
  await expect(tabs.nth(2)).toContainText('Month');
  await expect(tabs.nth(3)).toContainText('Quarter');
  await expect(tabs.nth(4)).toContainText('Year');
});

test('multi-week has time navigator with prev/next/today', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-time-nav', { timeout: 5_000 });

  await expect(page.locator('.habit-time-prev')).toBeVisible();
  await expect(page.locator('.habit-time-next')).toBeVisible();
  await expect(page.locator('.habit-time-today')).toBeVisible();
  await expect(page.locator('.habit-time-label')).toBeVisible();
});

test('multi-week has Add Week button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Default view is 'week' — add week button should be visible
  const addWeekBtn = page.locator('.habit-add-week-btn');
  await expect(addWeekBtn).toBeVisible();
  await expect(addWeekBtn).toContainText('New Week');
});

/* ================================================================
   LAYER 2: View Switching — User click-through workflow
   ================================================================ */

test('clicking view tabs switches between views', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Default is week view — grid should be present
  await page.waitForSelector('.habit-grid', { timeout: 3_000 });
  await expect(page.locator('.habit-grid')).toBeVisible();

  // Switch to Day view
  await page.click('.habit-view-tab[data-view="day"]');
  await page.waitForSelector('.habit-day-list, .habit-day-empty', { timeout: 3_000 });

  // Verify Day tab is active
  const dayTab = page.locator('.habit-view-tab[data-view="day"]');
  await expect(dayTab).toHaveClass(/habit-view-tab-active/);

  // Switch to Month view
  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });
  await expect(page.locator('.habit-month-grid')).toBeVisible();
});

test('switching to quarter view renders heatmap table', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="quarter"]');
  // Quarter view may show empty or populated depending on date alignment
  const tableOrEmpty = await page.waitForSelector('.habit-quarter-table, .habit-quarter-empty', { timeout: 3_000 });
  expect(tableOrEmpty).toBeTruthy();
});

test('switching to year view renders contribution heatmap', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-heatmap', { timeout: 3_000 });
  await expect(page.locator('.habit-year-heatmap')).toBeVisible();
  await expect(page.locator('.habit-year-grid')).toBeVisible();
  await expect(page.locator('.habit-year-legend')).toBeVisible();
});

/* ================================================================
   LAYER 2: Week View — Navigation & interaction
   ================================================================ */

test('week view navigation changes displayed week label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-grid', { timeout: 5_000 });

  // Get initial time label
  const initialLabel = await page.locator('.habit-time-label').textContent();
  expect(initialLabel).toBeTruthy();

  // Navigate backward
  await page.click('.habit-time-prev');
  const afterPrev = await page.locator('.habit-time-label').textContent();
  expect(afterPrev).not.toBe(initialLabel);
});

test('week view shows 4 habit rows (matching fixture data)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });

  // Non-header, non-footer data rows: 4 habits in fixture
  const dataRows = page.locator('.habit-grid-row:not(.habit-grid-header):not(.habit-grid-footer)');
  expect(await dataRows.count()).toBe(4);
});

test('week view completion footer shows percentage bars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-grid-footer', { timeout: 5_000 });

  const footer = page.locator('.habit-grid-footer');
  await expect(footer).toBeVisible();

  const bars = page.locator('.habit-completion-bar');
  expect(await bars.count()).toBeGreaterThan(0);
});

/* ================================================================
   LAYER 2: Day View — Checklist
   ================================================================ */

test('day view shows habit checklist or no-data message', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="day"]');
  const listOrEmpty = await page.waitForSelector('.habit-day-list, .habit-day-empty', { timeout: 3_000 });
  expect(listOrEmpty).toBeTruthy();
});

/* ================================================================
   LAYER 2: Month View — Calendar grid
   ================================================================ */

test('month view shows calendar grid with day headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  const headerRow = page.locator('.habit-month-header');
  await expect(headerRow).toBeVisible();
  const dayNames = page.locator('.habit-month-day-name');
  expect(await dayNames.count()).toBe(7);
});

test('month view shows legend for completion rates', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-legend', { timeout: 3_000 });

  const legend = page.locator('.habit-month-legend');
  await expect(legend).toBeVisible();

  const swatches = page.locator('.habit-legend-swatch');
  expect(await swatches.count()).toBeGreaterThanOrEqual(4);
});

test('month view navigation changes displayed month', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  const initialLabel = await page.locator('.habit-time-label').textContent();
  await page.click('.habit-time-prev');
  const afterPrev = await page.locator('.habit-time-label').textContent();
  expect(afterPrev).not.toBe(initialLabel);
});

/* ================================================================
   LAYER 3: Interaction — Toggle emits cell-update
   ================================================================ */

test('habit toggle emits cell-update on click in week view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  const unchecked = page.locator('.habit-toggle.habit-empty').first();
  const rowAttr = await unchecked.getAttribute('data-row-idx');
  const colAttr = await unchecked.getAttribute('data-col-idx');
  await unchecked.click();
  const clicked = page.locator(`.habit-toggle[data-row-idx="${rowAttr}"][data-col-idx="${colAttr}"]`);
  await expect(clicked).toHaveClass(/habit-done/);

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
  const dayUpdate = updates.find(u => String(u.col) === colAttr && String(u.row) === rowAttr);
  expect(dayUpdate).toBeTruthy();
  expect(dayUpdate.value).toBe('✓');
});

test('habit toggle cycles through done-partial-missed-empty states', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  const cell = page.locator('.habit-toggle.habit-empty').first();
  const rowAttr = await cell.getAttribute('data-row-idx');
  const colAttr = await cell.getAttribute('data-col-idx');
  const locator = page.locator(`.habit-toggle[data-row-idx="${rowAttr}"][data-col-idx="${colAttr}"]`);

  // Click 1: empty → done
  await cell.click();
  await expect(locator).toHaveClass(/habit-done/);

  // Click 2: done → partial
  await locator.click();
  await expect(locator).toHaveClass(/habit-partial/);

  // Click 3: partial → missed
  await locator.click();
  await expect(locator).toHaveClass(/habit-missed/);

  // Click 4: missed → empty
  await locator.click();
  await expect(locator).toHaveClass(/habit-empty/);
});

/* ================================================================
   LAYER 4: Visual Consistency — Design tokens & layout
   ================================================================ */

test('view switcher tabs have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-tab', { timeout: 5_000 });

  const tab = page.locator('.habit-view-tab').first();
  await expect(tab).toHaveCSS('cursor', 'pointer');
});

test('habit toggle cells have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  await expect(page.locator('.habit-toggle').first()).toHaveCSS('cursor', 'pointer');
});

test('habit grid has header and footer rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid', { timeout: 5_000 });

  await expect(page.locator('.habit-grid-header')).toBeVisible();
  await expect(page.locator('.habit-grid-footer')).toBeVisible();
});

test('active view tab has distinct active class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  const weekTab = page.locator('.habit-view-tab[data-view="week"]');
  await expect(weekTab).toHaveClass(/habit-view-tab-active/);

  const dayTab = page.locator('.habit-view-tab[data-view="day"]');
  const hasActive = await dayTab.evaluate(el => el.classList.contains('habit-view-tab-active'));
  expect(hasActive).toBe(false);
});

test('year view contribution grid has heatmap cells', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-heatmap', { timeout: 3_000 });

  const cells = page.locator('.habit-year-cell');
  expect(await cells.count()).toBeGreaterThan(0);

  const dayLabels = page.locator('.habit-year-day-label');
  expect(await dayLabels.count()).toBe(7);
});

test('year view shows stats summary', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-stats', { timeout: 3_000 });

  const stats = page.locator('.habit-year-stat');
  expect(await stats.count()).toBe(2);
  await expect(stats.nth(0)).toContainText('weeks tracked');
  await expect(stats.nth(1)).toContainText('average completion');
});

/* ================================================================
   LAYER 4: Responsive — Mobile viewport
   ================================================================ */

test('habit tracker at mobile width has no major overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid', { timeout: 5_000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.habit-view-content *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows.length).toBeLessThan(3);
});

test('view switcher renders at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  const tabs = page.locator('.habit-view-tab');
  expect(await tabs.count()).toBe(5);
});

/* ================================================================
   LAYER 5: Data Persistence
   ================================================================ */

test('toggle in multi-week view emits correct row/col indices', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  const emptyCell = page.locator('.habit-toggle.habit-empty').first();
  const count = await emptyCell.count();
  if (count === 0) return;

  const rowAttr = await emptyCell.getAttribute('data-row-idx');
  const colAttr = await emptyCell.getAttribute('data-col-idx');
  await emptyCell.click();

  const records = await getCreatedRecords(page);
  const update = records.find(
    r => r.type === 'cell-update' && String(r.row) === rowAttr && String(r.col) === colAttr
  );
  expect(update).toBeTruthy();
});

/* ================================================================
   LAYER 6: Edge Cases & Resilience
   ================================================================ */

test('single-week mode hides add-week button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  const addWeekBtn = page.locator('.habit-add-week-btn');
  expect(await addWeekBtn.count()).toBe(0);
});

test('time navigator today button is clickable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-time-nav', { timeout: 5_000 });

  const todayBtn = page.locator('.habit-time-today');
  await expect(todayBtn).toBeVisible();
  await todayBtn.click();
  const label = await page.locator('.habit-time-label').textContent();
  expect(label).toBeTruthy();
});

test('quarter view handles date range outside fixture data gracefully', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="quarter"]');
  // Navigate forward to quarters with no data
  for (let i = 0; i < 4; i++) await page.click('.habit-time-next');

  // Should show table or empty message — no crash
  const viewContent = page.locator('.habit-view-content');
  const hasContent = await viewContent.evaluate(el => el.children.length > 0);
  expect(hasContent).toBe(true);
});

test('add-week button hides when switching away from week view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  const addWeekBtn = page.locator('.habit-add-week-btn');
  await expect(addWeekBtn).toBeVisible();

  // Switch to month view
  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });
  await expect(addWeekBtn).toBeHidden();

  // Switch back to week view — button should reappear
  await page.click('.habit-view-tab[data-view="week"]');
  await page.waitForSelector('.habit-grid', { timeout: 3_000 });
  await expect(addWeekBtn).toBeVisible();
});
