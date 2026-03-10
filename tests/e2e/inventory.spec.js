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

test('inventory shows summary bar with item count and low-stock count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-012');
  await page.waitForSelector('.inv-summary', { timeout: 5_000 });

  await expect(page.locator('.inv-summary')).toContainText('10 items');
  await expect(page.locator('.inv-summary-low')).toContainText('low stock');
});

test('inventory highlights low-stock items with reorder section', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-012');
  await page.waitForSelector('.inv-reorder-header', { timeout: 5_000 });

  await expect(page.locator('.inv-reorder-header')).toContainText('Reorder');
  const lowCards = page.locator('.inv-low-stock');
  expect(await lowCards.count()).toBeGreaterThan(0);
  // low-stock cards should have the low badge
  const badges = page.locator('.inv-low-badge');
  expect(await badges.count()).toBeGreaterThan(0);
});

test('inventory low-stock items appear before categories', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-012');
  await page.waitForSelector('.inv-reorder-header', { timeout: 5_000 });

  // Reorder header should come before any category header
  const elements = await page.locator('.inv-reorder-header, .template-inv-category').allTextContents();
  expect(elements[0]).toContain('Reorder');
});
