// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('meal planner detected as Meal Planner template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Meal');
});

test('meal planner groups by day with macros', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-day', { timeout: 5_000 });

  const days = page.locator('.meal-day-label');
  expect(await days.count()).toBeGreaterThanOrEqual(3);

  // Check calorie info shown
  const macros = await page.locator('.meal-day-macros').allTextContents();
  expect(macros.some(m => m.includes('cal'))).toBe(true);
});

test('meal planner shows meal type badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-type-badge', { timeout: 5_000 });

  const badges = await page.locator('.meal-type-badge').allTextContents();
  expect(badges.some(b => b.includes('Breakfast'))).toBe(true);
  expect(badges.some(b => b.includes('Lunch'))).toBe(true);
});

test('meal planner shows weekly totals summary bar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-summary', { timeout: 5_000 });

  const summaryText = await page.locator('.meal-summary').textContent();
  expect(summaryText).toContain('Total Meals');
  expect(summaryText).toContain('Total Calories');
  expect(summaryText).toContain('Total Protein');
  expect(summaryText).toContain('Daily Average');
});

test('meal planner directoryView shows nutrition overview', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-meals/Meal Plans'; });
  await page.waitForSelector('.meal-dir-card', { timeout: 8_000 });

  const title = await page.locator('.meal-dir-title').textContent();
  expect(title).toContain('Meal Plans');

  const cards = page.locator('.meal-dir-card');
  expect(await cards.count()).toBe(2);
});

test('meal planner directoryView card click navigates to sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-meals/Meal Plans'; });
  await page.waitForSelector('.meal-dir-card', { timeout: 8_000 });

  await page.locator('.meal-dir-card').first().click();
  await page.waitForSelector('.meal-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Meal');
});

test('meal planner directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-meals/Meal Plans'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('meal planner directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-meals/Meal Plans'; });
  await page.waitForSelector('.meal-dir-card', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});

test('meal planner shows view switcher and add-meal button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-chrome', { timeout: 5_000 });
  const views = await page.locator('.meal-seg-btn').allTextContents();
  expect(views).toEqual(expect.arrayContaining(['Days', 'Week', 'Macros']));
  await expect(page.locator('.meal-add-btn')).toBeVisible();
});

test('meal week view renders a day x meal grid', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-chrome', { timeout: 5_000 });
  await page.locator('.meal-seg-btn', { hasText: 'Week' }).click();
  await page.waitForSelector('.meal-week-grid', { timeout: 5_000 });
  const heads = await page.locator('.meal-week-head').allTextContents();
  expect(heads).toEqual(expect.arrayContaining(['Day', 'Breakfast', 'Lunch', 'Dinner', 'Total']));
});

test('meal macros view renders a calorie chart', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-chrome', { timeout: 5_000 });
  await page.locator('.meal-seg-btn', { hasText: 'Macros' }).click();
  await page.waitForSelector('.meal-chart svg', { timeout: 5_000 });
  await expect(page.locator('.meal-chart svg')).toHaveCount(1);
});

test('adding a meal via food search appends a row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-add-btn', { timeout: 5_000 });

  await page.locator('.meal-add-btn').click();
  await page.waitForSelector('.meal-search-input', { timeout: 5_000 });
  await page.fill('.meal-search-input', 'banana');
  await page.waitForSelector('.meal-search-item', { timeout: 5_000 });
  await page.locator('.meal-search-item').first().click();
  await page.waitForSelector('.meal-submit', { timeout: 5_000 });
  await page.locator('.meal-submit').click();

  await expect.poll(async () => {
    const records = await getCreatedRecords(page);
    return records.some(r => r.type === 'row-append');
  }, { timeout: 5_000 }).toBe(true);
});
