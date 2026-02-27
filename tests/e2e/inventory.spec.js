// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('pantry inventory detected as Inventory template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-012');
  await page.waitForSelector('.template-inv-card', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Inventory');

  // Should group by category
  const categories = page.locator('.template-inv-category');
  expect(await categories.count()).toBeGreaterThanOrEqual(3);

  // Check quantity badges rendered
  const qtys = await page.locator('.template-inv-qty').allTextContents();
  expect(qtys.some(q => q.includes('5 lbs'))).toBe(true);
});

test('inventory renders as card grid', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-012');
  await page.waitForSelector('.template-inv-grid', { timeout: 5_000 });

  const grids = page.locator('.template-inv-grid');
  expect(await grids.count()).toBeGreaterThan(0);

  const cards = page.locator('.template-inv-card');
  expect(await cards.count()).toBe(10);
});
