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
