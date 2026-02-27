// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('template badge hidden for empty sheets', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-999');
  await page.waitForSelector('#checklist-items .empty-state', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toBeHidden();
});

test('generate examples button visible on home screen', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#generate-examples-btn')).toBeVisible();
});
