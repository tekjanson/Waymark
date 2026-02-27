// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('budget detected as Budget template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Budget');
});

test('budget renders summary with income/expense/balance', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-summary', { timeout: 5_000 });

  const summary = page.locator('.budget-summary');
  await expect(summary).toBeVisible();

  // Should show income and expense values
  const values = await page.locator('.budget-summary-value').allTextContents();
  expect(values.length).toBeGreaterThanOrEqual(3);
});

test('budget groups rows by category', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-category-label', { timeout: 5_000 });

  const categories = page.locator('.budget-category-label');
  expect(await categories.count()).toBeGreaterThanOrEqual(3);
});
