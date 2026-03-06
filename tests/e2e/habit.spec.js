// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

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

  // Check some are checked
  const checked = page.locator('.habit-checked');
  expect(await checked.count()).toBeGreaterThan(0);
});

test('habit toggle emits cell-update on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  // Click an unchecked cell — capture data attrs for stable re-query
  const unchecked = page.locator('.habit-toggle:not(.habit-checked)').first();
  const rowAttr = await unchecked.getAttribute('data-row-idx');
  const colAttr = await unchecked.getAttribute('data-col-idx');
  await unchecked.click();
  const clicked = page.locator(`.habit-toggle[data-row-idx="${rowAttr}"][data-col-idx="${colAttr}"]`);
  await expect(clicked).toHaveClass(/habit-checked/);

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
  expect(updates[updates.length - 1].value).toBe('✓');
});

test('habit tracker shows summary bar with completion stats', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-summary-bar', { timeout: 5_000 });

  const summaryBar = page.locator('.habit-summary-bar');
  await expect(summaryBar).toBeVisible();

  // Should show habit count, completion %, and check-in counts
  const stats = page.locator('.habit-summary-stat');
  expect(await stats.count()).toBe(3);
});

test('habit tracker shows view toggle toolbar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toolbar', { timeout: 5_000 });

  const toolbar = page.locator('.habit-toolbar');
  await expect(toolbar).toBeVisible();

  // Should have Weekly and Stats buttons
  const buttons = page.locator('.habit-view-btn');
  expect(await buttons.count()).toBe(2);

  // Weekly should be active by default
  await expect(page.locator('.habit-view-btn-active')).toContainText('Weekly');
});

test('habit tracker switches to stats view and back', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toolbar', { timeout: 5_000 });

  // Click Stats button
  await page.click('.habit-view-btn[data-view="stats"]');
  await page.waitForSelector('.habit-stats', { timeout: 5_000 });

  // Stats view should show analytics cards
  const cards = page.locator('.habit-stats-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);

  // Ring chart should be visible
  await expect(page.locator('.habit-ring-wrap')).toBeVisible();

  // Switch back to weekly
  await page.click('.habit-view-btn[data-view="weekly"]');
  await page.waitForSelector('.habit-table', { timeout: 5_000 });
  await expect(page.locator('.habit-table')).toBeVisible();
});

test('habit tracker stats show streak leaderboard', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toolbar', { timeout: 5_000 });

  await page.click('.habit-view-btn[data-view="stats"]');
  await page.waitForSelector('.habit-streak-list', { timeout: 5_000 });

  const streakItems = page.locator('.habit-streak-item');
  expect(await streakItems.count()).toBeGreaterThan(0);

  // First item should have the medal emoji
  await expect(streakItems.first().locator('.habit-streak-rank')).toContainText('🥇');
});

test('habit tracker stats show per-habit completion bars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toolbar', { timeout: 5_000 });

  await page.click('.habit-view-btn[data-view="stats"]');
  await page.waitForSelector('.habit-completion-list', { timeout: 5_000 });

  const completionItems = page.locator('.habit-completion-item');
  expect(await completionItems.count()).toBeGreaterThan(0);
});

test('habit tracker stats show day strength heatmap', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toolbar', { timeout: 5_000 });

  await page.click('.habit-view-btn[data-view="stats"]');
  await page.waitForSelector('.habit-day-heatmap', { timeout: 5_000 });

  const days = page.locator('.habit-heatmap-day');
  expect(await days.count()).toBe(7);
});

test('habit tracker renders day-column completion percentages in header', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-day-pct', { timeout: 5_000 });

  const dayPcts = page.locator('.habit-day-pct');
  expect(await dayPcts.count()).toBe(7);
});

test('habit comprehensive fixture shows category headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.habit-category-header', { timeout: 5_000 });

  const catHeaders = page.locator('.habit-category-header');
  expect(await catHeaders.count()).toBeGreaterThanOrEqual(2);
});

test('habit comprehensive fixture shows goal progress bars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.habit-goal-bar-bg', { timeout: 5_000 });

  const goalBars = page.locator('.habit-goal-bar-bg');
  expect(await goalBars.count()).toBeGreaterThan(0);
});

test('habit comprehensive fixture stats show category breakdown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.habit-toolbar', { timeout: 5_000 });

  await page.click('.habit-view-btn[data-view="stats"]');
  await page.waitForSelector('.habit-stats', { timeout: 5_000 });

  // Should have at least 4 cards: completion ring, day strength, streak leaderboard, per-habit, category
  const cards = page.locator('.habit-stats-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
});

test('habit comprehensive fixture stats show goal achievement', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.habit-toolbar', { timeout: 5_000 });

  await page.click('.habit-view-btn[data-view="stats"]');
  await page.waitForSelector('.habit-stats', { timeout: 5_000 });

  // Should contain goal achievement text
  const statsText = await page.locator('.habit-stats').textContent();
  expect(statsText).toContain('Goal Achievement');
});

test('habit met-goal rows are highlighted', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.habit-row-goal-met', { timeout: 5_000 });

  const metRows = page.locator('.habit-row-goal-met');
  expect(await metRows.count()).toBeGreaterThan(0);
});
