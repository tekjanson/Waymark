// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

/* ==================================================================
   Single-week mode (backward-compatible — sheet-018)
   ================================================================== */

test('habit tracker detected as Habit Tracker template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Habit');
});

test('habit tracker renders grid with day columns', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  const toggles = page.locator('.habit-toggle');
  expect(await toggles.count()).toBeGreaterThan(0);

  // Check some are done
  const done = page.locator('.habit-done');
  expect(await done.count()).toBeGreaterThan(0);
});

test('habit toggle emits cell-update on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  // Click an empty cell — capture data attrs for stable re-query
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

test('single-week habit has no week navigator', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });
  // No week nav should exist for single-week sheet
  await expect(page.locator('.habit-week-nav')).toHaveCount(0);
});

test('single-week summary panel shows Weekly Summary title', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-summary', { timeout: 5_000 });
  await expect(page.locator('.habit-summary-title')).toContainText('Weekly Summary');
});

/* ==================================================================
   Multi-week mode (sheet-038 with "Week Of" column)
   ================================================================== */

test('multi-week habit tracker detected as Habit Tracker template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Habit');
});

test('multi-week habit shows week navigator', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  const nav = page.locator('.habit-week-nav');
  await expect(nav).toBeVisible();

  // Should show week label
  const label = nav.locator('.habit-week-label');
  await expect(label).toContainText('Week of');

  // Should show week counter
  const counter = nav.locator('.habit-week-counter');
  await expect(counter).toContainText('of 3');

  // Prev/Next buttons should exist
  await expect(nav.locator('.habit-week-prev')).toBeVisible();
  await expect(nav.locator('.habit-week-next')).toBeVisible();
});

test('multi-week defaults to most recent week', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  // Default to most recent (3rd week = Mar 17)
  const label = page.locator('.habit-week-label');
  await expect(label).toContainText('Mar 17');

  const counter = page.locator('.habit-week-counter');
  await expect(counter).toContainText('3 of 3');

  // Next button should be disabled (already at last week)
  await expect(page.locator('.habit-week-next')).toBeDisabled();
  // Prev button should be enabled
  await expect(page.locator('.habit-week-prev')).not.toBeDisabled();
});

test('multi-week shows only current week rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });

  // The most recent week (Mar 17) has 4 habits
  const dataRows = page.locator('.habit-grid-row:not(.habit-grid-header):not(.habit-grid-footer)');
  expect(await dataRows.count()).toBe(4);
});

test('multi-week prev button navigates to earlier week', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  // Click prev to go to week 2 (Mar 10)
  await page.click('.habit-week-prev');
  await expect(page.locator('.habit-week-label')).toContainText('Mar 10');
  await expect(page.locator('.habit-week-counter')).toContainText('2 of 3');

  // Both buttons should now be enabled
  await expect(page.locator('.habit-week-prev')).not.toBeDisabled();
  await expect(page.locator('.habit-week-next')).not.toBeDisabled();

  // Click prev again to go to week 1 (Mar 3)
  await page.click('.habit-week-prev');
  await expect(page.locator('.habit-week-label')).toContainText('Mar 3');
  await expect(page.locator('.habit-week-counter')).toContainText('1 of 3');

  // Prev should now be disabled
  await expect(page.locator('.habit-week-prev')).toBeDisabled();
});

test('multi-week next button navigates forward', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  // Go to earliest week first
  await page.click('.habit-week-prev');
  await page.click('.habit-week-prev');
  await expect(page.locator('.habit-week-counter')).toContainText('1 of 3');

  // Navigate forward
  await page.click('.habit-week-next');
  await expect(page.locator('.habit-week-label')).toContainText('Mar 10');
  await expect(page.locator('.habit-week-counter')).toContainText('2 of 3');
});

test('multi-week grid shows correct data for each week', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });

  // Week 3 (Mar 17) — partially filled, default view
  const week3Done = await page.locator('.habit-done').count();
  expect(week3Done).toBeGreaterThan(0);
  expect(week3Done).toBeLessThan(20); // Not many done in partial week

  // Navigate to week 1 (Mar 3) — more filled in
  await page.click('.habit-week-prev');
  await page.click('.habit-week-prev');
  const week1Done = await page.locator('.habit-done').count();
  expect(week1Done).toBeGreaterThan(week3Done); // Week 1 is more complete
});

test('multi-week toggle emits cell-update with correct row index', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  // Click an empty cell in the current week view
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

test('multi-week summary shows week label in title', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-summary', { timeout: 5_000 });

  const title = page.locator('.habit-summary-title');
  await expect(title).toContainText('Week of');
  await expect(title).toContainText('Mar 17');
});

test('multi-week summary shows trend comparison', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-summary', { timeout: 5_000 });

  // Should show trend indicator comparing to previous week
  const trend = page.locator('.habit-trend');
  await expect(trend).toBeVisible();
  await expect(trend).toContainText('vs last week');
});

test('multi-week summary shows weekly history chart', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-summary', { timeout: 5_000 });

  const history = page.locator('.habit-week-history');
  await expect(history).toBeVisible();
  await expect(page.locator('.habit-week-history-title')).toContainText('Weekly History');

  // Should have 3 bars (one per week)
  const bars = page.locator('.habit-week-history-bar');
  expect(await bars.count()).toBe(3);

  // Current week should be highlighted
  await expect(page.locator('.habit-week-history-selected')).toHaveCount(1);
});

test('multi-week week navigator buttons have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  await expect(page.locator('.habit-week-prev')).toHaveCSS('cursor', 'pointer');
});

test('multi-week grid rebuilds when navigating weeks', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  // Get done count for week 3
  const week3Done = await page.locator('.habit-done').count();

  // Navigate to week 1
  await page.click('.habit-week-prev');
  await page.click('.habit-week-prev');

  // Grid should have rebuilt — check done count changed
  const week1Done = await page.locator('.habit-done').count();
  expect(week1Done).not.toBe(week3Done);

  // The summary title should now reflect week 1
  await expect(page.locator('.habit-summary-title')).toContainText('Mar 3');
});

test('multi-week renders at mobile width without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  // Verify nav is still visible
  await expect(page.locator('.habit-week-nav')).toBeVisible();

  // Check no elements overflow viewport
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.habit-week-nav *, .habit-grid *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

test('multi-week summary has design token styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-summary', { timeout: 5_000 });

  const summary = page.locator('.habit-summary');
  const bgColor = await summary.evaluate(el =>
    getComputedStyle(el).getPropertyValue('background-color')
  );
  expect(bgColor).not.toBe('');
  expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  await expect(summary).toHaveCSS('border-radius', /\d+px/);
});

/* ==================================================================
   v2: Add Week + Start Tracking Weeks buttons
   ================================================================== */

test('multi-week mode shows "+ New Week" button in navigator', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  const addBtn = page.locator('.habit-add-week-btn');
  await expect(addBtn).toBeVisible();
  await expect(addBtn).toContainText('New Week');
  await expect(addBtn).toHaveCSS('cursor', 'pointer');
});

test('clicking "+ New Week" creates sheet-replace record with new rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-add-week-btn', { timeout: 5_000 });

  await page.click('.habit-add-week-btn');
  // After clicking, the app should create a sheet-replace record
  // (via _onInsertAfterRow which calls replaceSheetData)
  await page.waitForTimeout(500); // small delay for async operation
  const records = await getCreatedRecords(page);
  const replaceRecord = records.find(r => r.type === 'sheet-replace');
  expect(replaceRecord).toBeTruthy();

  // The new data should include rows for the next week
  if (replaceRecord && replaceRecord.values) {
    const allRows = replaceRecord.values;
    // Original: 1 header + 12 data rows (3 weeks × 4 habits) = 13
    // After adding week: 13 + 4 new habit rows = 17
    expect(allRows.length).toBeGreaterThanOrEqual(17);

    // The new rows should have the next week's date (2026-03-24 = week after 2026-03-17)
    const newWeekRows = allRows.filter(r => r.includes('2026-03-24'));
    expect(newWeekRows.length).toBe(4); // One per habit
  }
});

test('single-week mode shows "Start Tracking Weeks" button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid', { timeout: 5_000 });

  const upgradeBtn = page.locator('.habit-start-multiweek-btn');
  await expect(upgradeBtn).toBeVisible();
  await expect(upgradeBtn).toContainText('Start Tracking Weeks');
  await expect(upgradeBtn).toHaveCSS('cursor', 'pointer');
});

test('single-week mode does not show week navigator', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid', { timeout: 5_000 });

  await expect(page.locator('.habit-week-nav')).not.toBeVisible();
  await expect(page.locator('.habit-add-week-btn')).not.toBeVisible();
});

test('clicking "Start Tracking Weeks" emits sheet-replace with Week Of column', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-start-multiweek-btn', { timeout: 5_000 });

  await page.click('.habit-start-multiweek-btn');
  await page.waitForTimeout(500);
  const records = await getCreatedRecords(page);
  const replaceRecord = records.find(r => r.type === 'sheet-replace');
  expect(replaceRecord).toBeTruthy();

  if (replaceRecord && replaceRecord.values) {
    const header = replaceRecord.values[0];
    // The header should now include "Week Of"
    expect(header).toContain('Week Of');

    // All data rows should have a date in the Week Of column
    const weekOfIdx = header.indexOf('Week Of');
    for (let i = 1; i < replaceRecord.values.length; i++) {
      const weekVal = replaceRecord.values[i][weekOfIdx];
      // Should match ISO date pattern YYYY-MM-DD
      expect(weekVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test('multi-week "+ New Week" button has dashed border style in single-week mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-start-multiweek-btn', { timeout: 5_000 });

  const btn = page.locator('.habit-start-multiweek-btn');
  await expect(btn).toHaveCSS('border-style', 'dashed');
});

test('multi-week + New Week button positioned after nav buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-038');
  await page.waitForSelector('.habit-week-nav', { timeout: 5_000 });

  // Verify the add-week button is inside the week nav container
  const btnInNav = page.locator('.habit-week-nav .habit-add-week-btn');
  await expect(btnInNav).toBeVisible();
});
