const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('agents template detects and renders cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-grid')).toBeVisible();
  await expect(page.locator('.agents-card')).toHaveCount(4);
});

test('agents template renders agent names', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-name').first()).toContainText('Alex');
});

test('agents template renders status badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const badges = page.locator('.agents-status-badge');
  await expect(badges.first()).toContainText('Online');
});

test('agents template renders tuning section', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-tuning-section').first()).toBeVisible();
  await expect(page.locator('.agents-tuning-label').first()).toContainText('Tuning');
});

test('agents template renders workboard field', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-workboard').first()).toBeVisible();
  await expect(page.locator('.agents-field-label').first()).toContainText('Workboard');
});

test('agents template renders header stats', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-header-stats')).toBeVisible();
  await expect(page.locator('.agents-stat').first()).toContainText('4');
});

test('agents template renders avatar initials', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // "Alex" → 1 word → 1 initial: "A"
  await expect(page.locator('.agents-avatar').first()).toContainText('A');
});

test('Dev Fleet sidebar button is visible', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#menu-fleet-btn')).toBeVisible();
  await expect(page.locator('#menu-fleet-btn')).toContainText('Dev Fleet');
});

test('Set as Fleet Registry button appears on agents sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // Open the more-actions overflow menu
  await page.click('#more-actions-btn');
  await expect(page.locator('#set-fleet-btn')).toBeVisible();
  await expect(page.locator('#set-fleet-btn')).toContainText('Set as Fleet Registry');
});

test('Dev Fleet button navigates to fleet sheet after pin', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // Open overflow and click Set as Fleet Registry
  await page.click('#more-actions-btn');
  await page.click('#set-fleet-btn');
  // Navigate away then use Fleet button
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  await page.click('#menu-fleet-btn');
  await page.waitForSelector('.agents-grid', { timeout: 10000 });
  await expect(page.locator('.agents-grid')).toBeVisible();
});
