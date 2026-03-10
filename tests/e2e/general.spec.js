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
  await expect(page.locator('#menu-examples-btn')).toBeVisible();
});

test('folder view shows open in drive button', async ({ page }) => {
  await setupApp(page);
  // Navigate to a folder view
  await page.evaluate(() => { window.location.hash = '#/folder/f1/Groceries'; });
  await page.waitForSelector('#folder-title', { timeout: 5_000 });
  await expect(page.locator('#folder-title')).toContainText('Groceries');

  const openDriveBtn = page.locator('#open-in-drive-btn');
  await expect(openDriveBtn).toBeVisible();
  await expect(openDriveBtn).toContainText('Open in Drive');
});

test('duplicate sheet button visible and creates copy', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  const dupBtn = page.locator('#duplicate-sheet-btn');
  await expect(dupBtn).toBeVisible();

  await dupBtn.click();
  // Wait for toast confirming creation
  await page.waitForSelector('.toast', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const copyRecord = records.find(r => r.title && r.title.startsWith('Copy of'));
  expect(copyRecord).toBeTruthy();
  expect(copyRecord.rows.length).toBeGreaterThan(0);
});
