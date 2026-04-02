// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('arcade detected as Arcade template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-lobby', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Arcade');
});

test('arcade renders game grid with selectable cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-grid', { timeout: 5_000 });

  const cards = page.locator('.arcade-game-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
});

test('arcade game card becomes selected on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-card', { timeout: 5_000 });

  const firstCard = page.locator('.arcade-game-card').first();
  await firstCard.click();
  await expect(firstCard).toHaveClass(/arcade-game-card-selected/);
});

test('arcade renders match history table', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-history', { timeout: 5_000 });

  // Header row + 6 data rows = 7 total, but count only data rows (exclude header)
  const rows = page.locator('.arcade-history-row:not(.arcade-history-header)');
  expect(await rows.count()).toBe(6);
});

test('arcade shows no-peers message when offline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-lobby', { timeout: 5_000 });

  await expect(page.locator('.arcade-no-peers')).toBeVisible();
});
