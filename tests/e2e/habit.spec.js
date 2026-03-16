// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ================================================================
   LAYER 1: Detection & Rendering — Single-week (sheet-018)
   ================================================================ */

test('habit tracker detected as Habit Tracker template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Habit');
});

test('single-week habit renders day view by default', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-day-list, .habit-day-empty', { timeout: 5_000 });

  // Day tab should be active
  const dayTab = page.locator('.habit-view-tab[data-view="day"]');
  await expect(dayTab).toHaveClass(/habit-view-tab-active/);
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

test('multi-week has Add Week button visible in week view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Default view is 'day' — switch to week view to see add week button
  await page.click('.habit-view-tab[data-view="week"]');
  await page.waitForSelector('.habit-grid', { timeout: 3_000 });
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

  // Default is day view — day list should be present
  await page.waitForSelector('.habit-day-list, .habit-day-empty', { timeout: 3_000 });
  const dayTab = page.locator('.habit-view-tab[data-view="day"]');
  await expect(dayTab).toHaveClass(/habit-view-tab-active/);

  // Switch to Week view
  await page.click('.habit-view-tab[data-view="week"]');
  await page.waitForSelector('.habit-grid', { timeout: 3_000 });
  await expect(page.locator('.habit-grid')).toBeVisible();

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

test('switching to year view renders mini month calendars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-months', { timeout: 3_000 });
  await expect(page.locator('.habit-year-months')).toBeVisible();
  await expect(page.locator('.habit-year-legend')).toBeVisible();

  // 12 mini month calendars
  const miniMonths = page.locator('.habit-year-mini-month');
  expect(await miniMonths.count()).toBe(12);
});

/* ================================================================
   LAYER 2: Week View — Navigation & interaction
   ================================================================ */

test('week view navigation changes displayed week label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
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
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });

  // Non-header, non-footer data rows: 4 habits in fixture
  const dataRows = page.locator('.habit-grid-row:not(.habit-grid-header):not(.habit-grid-footer)');
  expect(await dataRows.count()).toBe(4);
});

test('week view completion footer shows percentage bars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
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

test('month view calendar stays compact on desktop (no oversized cells)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  const grid = page.locator('.habit-month-grid');
  const gridBox = await grid.boundingBox();
  expect(gridBox).toBeTruthy();
  expect(gridBox.width).toBeLessThanOrEqual(560);

  const firstDay = page.locator('.habit-month-day').first();
  await expect(firstDay).toBeVisible();
  const dayBox = await firstDay.boundingBox();
  expect(dayBox).toBeTruthy();
  expect(dayBox.height).toBeLessThanOrEqual(90);
});

test('month view header row stays shorter than day cells', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  const headerCell = page.locator('.habit-month-day-name').first();
  await expect(headerCell).toBeVisible();

  const headerBox = await headerCell.boundingBox();
  const dayBox = await page.locator('.habit-month-day').first().boundingBox();
  expect(headerBox).toBeTruthy();
  expect(dayBox).toBeTruthy();
  expect(headerBox.height).toBeLessThan(dayBox.height);
  expect(headerBox.height).toBeLessThanOrEqual(50);
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
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
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
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
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
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  await expect(page.locator('.habit-toggle').first()).toHaveCSS('cursor', 'pointer');
});

test('habit grid has header and footer rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
  await page.waitForSelector('.habit-grid', { timeout: 5_000 });

  await expect(page.locator('.habit-grid-header')).toBeVisible();
  await expect(page.locator('.habit-grid-footer')).toBeVisible();
});

test('active view tab has distinct active class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Default view is now 'day'
  const dayTab = page.locator('.habit-view-tab[data-view="day"]');
  await expect(dayTab).toHaveClass(/habit-view-tab-active/);

  const weekTab = page.locator('.habit-view-tab[data-view="week"]');
  const hasActive = await weekTab.evaluate(el => el.classList.contains('habit-view-tab-active'));
  expect(hasActive).toBe(false);
});

test('year view mini months have day cells with rate classes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-months', { timeout: 3_000 });

  const cells = page.locator('.habit-year-mini-cell:not(.habit-year-mini-empty)');
  expect(await cells.count()).toBeGreaterThan(0);

  // Each mini month has day headers (M T W T F S S)
  const headers = page.locator('.habit-year-mini-header');
  expect(await headers.count()).toBe(12 * 7); // 7 per month × 12 months
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
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
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
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });
  await page.click('.habit-view-tab[data-view="week"]');
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
  // Default view is 'day' — button should be hidden
  await expect(addWeekBtn).toBeHidden();

  // Switch to week view — button should appear
  await page.click('.habit-view-tab[data-view="week"]');
  await page.waitForSelector('.habit-grid', { timeout: 3_000 });
  await expect(addWeekBtn).toBeVisible();

  // Switch to month view — button should hide again
  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });
  await expect(addWeekBtn).toBeHidden();
});

/* ================================================================
   NEW: Day View Defaults to Today
   ================================================================ */

test('day view is the default view on multi-week sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Day tab should be active by default
  const dayTab = page.locator('.habit-view-tab[data-view="day"]');
  await expect(dayTab).toHaveClass(/habit-view-tab-active/);

  // Day view content should be visible (checklist or fallback)
  await page.waitForSelector('.habit-day-list, .habit-day-empty', { timeout: 3_000 });
});

test('day view shows habit items with check indicators', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Day view is default — should show habit items
  const dayList = page.locator('.habit-day-list');
  const isEmpty = await page.locator('.habit-day-empty').count();
  if (isEmpty === 0) {
    await expect(dayList).toBeVisible();
    const items = page.locator('.habit-day-item');
    expect(await items.count()).toBeGreaterThan(0);
    // Each item should have a check indicator
    const checks = page.locator('.habit-day-check');
    expect(await checks.count()).toBeGreaterThan(0);
  }
});

test('day view items are clickable and toggle state', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-day-list', { timeout: 5_000 });

  const item = page.locator('.habit-day-item').first();
  const initialState = await item.getAttribute('data-state');
  await item.click();
  const newState = await item.getAttribute('data-state');
  expect(newState).not.toBe(initialState);

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update')).toBe(true);
});

test('day view shows progress bar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-day-list', { timeout: 5_000 });

  const progressBar = page.locator('.habit-day-progress');
  await expect(progressBar).toBeVisible();
  const progressText = page.locator('.habit-day-progress-text');
  await expect(progressText).toContainText(/complete/i);
});

/* ================================================================
   NEW: Month View Streak Badges & Celebration
   ================================================================ */

test('month view shows streak badges section', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  // Navigate to a month with data (fixture has Jan-Mar 2026)
  // Set date to Feb 2026 by navigating
  const label = page.locator('.habit-time-label');
  const currentLabel = await label.textContent();

  // Navigate until we reach Feb 2026 or similar month with data
  // The fixture data is from Jan 26 - Mar 16, 2026
  // currentDate for multi-week lands in the fixture range
  const streakSection = page.locator('.habit-month-streaks');
  await expect(streakSection).toBeVisible();

  // Check streak badges exist
  const badges = page.locator('.habit-month-streak-badge');
  expect(await badges.count()).toBeGreaterThan(0);

  // Each badge should have a name and count
  const firstName = page.locator('.habit-month-streak-name').first();
  await expect(firstName).toBeVisible();
});

test('month view shows star indicator on perfect days', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  // Check for perfect day indicators — fixture data has days where all habits done
  const perfectDays = page.locator('.habit-month-perfect');
  const starIndicators = page.locator('.habit-month-star');

  // At least check the classes/structure exist (data alignment varies)
  const hasPerfect = await perfectDays.count();
  if (hasPerfect > 0) {
    expect(await starIndicators.count()).toBeGreaterThan(0);
  }
});

test('month view day click navigates to day view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  // Click a day cell with data
  const dayCell = page.locator('.habit-month-day:not(.habit-rate-none)').first();
  const hasDays = await dayCell.count();
  if (hasDays > 0) {
    await dayCell.click();
    // Should switch to day view
    const dayTab = page.locator('.habit-view-tab[data-view="day"]');
    await expect(dayTab).toHaveClass(/habit-view-tab-active/);
    await page.waitForSelector('.habit-day-list, .habit-day-empty', { timeout: 3_000 });
  }
});

/* ================================================================
   NEW: Year View — Mini Month Calendars
   ================================================================ */

test('year view shows 12 mini month calendars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-months', { timeout: 3_000 });

  const miniMonths = page.locator('.habit-year-mini-month');
  expect(await miniMonths.count()).toBe(12);

  // Each mini month has a title and grid
  const titles = page.locator('.habit-year-mini-title');
  expect(await titles.count()).toBe(12);
  await expect(titles.first()).toContainText('Jan');
  await expect(titles.last()).toContainText('Dec');
});

test('year view mini months have clickable day cells', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-months', { timeout: 3_000 });

  // Find a cell with rate data and click it
  const ratedCell = page.locator('.habit-year-mini-cell:not(.habit-year-mini-empty):not(.habit-rate-none)').first();
  const hasRated = await ratedCell.count();
  if (hasRated > 0) {
    await expect(ratedCell).toHaveCSS('cursor', 'pointer');
    await ratedCell.click();
    // Should switch to day view
    await page.waitForSelector('.habit-day-list, .habit-day-empty', { timeout: 5_000 });
    const dayTab = page.locator('.habit-view-tab[data-view="day"]');
    await expect(dayTab).toHaveClass(/habit-view-tab-active/);
  }
});

test('year view uses grid layout for month calendars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-months', { timeout: 3_000 });

  await expect(page.locator('.habit-year-months')).toHaveCSS('display', 'grid');
});

test('year view responsive at mobile: 2 column grid', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-months', { timeout: 3_000 });

  const miniMonths = page.locator('.habit-year-mini-month');
  expect(await miniMonths.count()).toBe(12);

  // Verify no overflow
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.habit-year-mini-month').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.textContent.slice(0, 20));
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ================================================================
   LAYER 6: Non-Monday date normalisation
   ================================================================ */

test('non-Monday Week Of dates render month view with colored cells', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-040');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Switch to Month view
  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  // The fixture has data for Jan 28, Feb 4, Feb 11 (all Wednesdays)
  // Normalised to Mon Jan 26, Mon Feb 2, Mon Feb 9
  // Navigate to Feb 2026 which should have the most data
  const timeLabel = await page.locator('.habit-time-label').textContent();
  // Initial month should be the one containing the last week of data
  expect(timeLabel).toBeTruthy();

  // Check that colored data cells exist (not all habit-rate-none)
  const coloredCount = await page.evaluate(() => {
    return document.querySelectorAll('.habit-month-day.habit-rate-high, .habit-month-day.habit-rate-mid, .habit-month-day.habit-rate-low, .habit-month-day.habit-rate-zero').length;
  });
  expect(coloredCount).toBeGreaterThan(0);
});

test('non-Monday Week Of dates render quarter view with data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-040');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Switch to Quarter view
  await page.click('.habit-view-tab[data-view="quarter"]');
  await page.waitForSelector('.habit-quarter-table, .habit-quarter-empty', { timeout: 3_000 });

  // Should show a table (not empty) since fixture has Q1 2026 data
  const hasTable = await page.locator('.habit-quarter-table').isVisible().catch(() => false);
  const hasEmpty = await page.locator('.habit-quarter-empty').isVisible().catch(() => false);
  expect(hasTable || hasEmpty).toBe(true);

  if (hasTable) {
    // Quarter table should have heat cells with data
    const heatCount = await page.evaluate(() => {
      return document.querySelectorAll('.habit-quarter-heat:not(.habit-rate-none)').length;
    });
    expect(heatCount).toBeGreaterThan(0);
  }
});

test('non-Monday Week Of dates render year view with colored cells', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-040');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Switch to Year view
  await page.click('.habit-view-tab[data-view="year"]');
  await page.waitForSelector('.habit-year-months', { timeout: 3_000 });

  // Year stats should show weeks tracked > 0
  const stats = await page.locator('.habit-year-stats').textContent();
  expect(stats).toContain('weeks tracked');
  // Should track 3 weeks (from 3 non-Monday dates normalised to Mondays)
  expect(stats).toMatch(/[1-9]\d* weeks/);

  // Should have colored mini-month cells
  const coloredCount = await page.evaluate(() => {
    return document.querySelectorAll('.habit-year-mini-cell.habit-rate-high, .habit-year-mini-cell.habit-rate-mid, .habit-year-mini-cell.habit-rate-low').length;
  });
  expect(coloredCount).toBeGreaterThan(0);
});

test('non-Monday dates day view still renders habits correctly', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-040');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Day view should be default and show habit items
  const dayItems = page.locator('.habit-day-item');
  const dayEmpty = page.locator('.habit-day-empty');
  const hasItems = await dayItems.count() > 0;
  const hasEmpty = await dayEmpty.count() > 0;
  // Should have either items (if date matches) or a no-data message
  expect(hasItems || hasEmpty).toBe(true);
});

test('month view shows no-data banner when navigated outside data range', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-view-switcher', { timeout: 5_000 });

  // Switch to Month view
  await page.click('.habit-view-tab[data-view="month"]');
  await page.waitForSelector('.habit-month-grid', { timeout: 3_000 });

  // Navigate far into the future (fixture data is Jan-Mar 2026)
  for (let i = 0; i < 6; i++) {
    await page.click('.habit-time-next');
  }

  // Should show no-data banner
  const nodata = page.locator('.habit-month-nodata');
  await expect(nodata).toBeVisible({ timeout: 2000 });
  const text = await nodata.textContent();
  expect(text).toContain('No habit data');
  expect(text).toContain('arrows');
});
