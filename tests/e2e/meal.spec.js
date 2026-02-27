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
