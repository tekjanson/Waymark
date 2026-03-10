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

test('share button visible on sheet view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  const shareBtn = page.locator('#share-btn');
  await expect(shareBtn).toBeVisible();
  await expect(shareBtn).toContainText('Share');
});

test('lock button visible and toggles lock state', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  const lockBtn = page.locator('#lock-btn');
  await expect(lockBtn).toBeVisible();
  // Initially unlocked
  await expect(lockBtn).not.toHaveClass(/locked/);

  // Click to lock
  await lockBtn.click();
  await expect(lockBtn).toHaveClass(/locked/);
  await expect(page.locator('#checklist-items')).toHaveClass(/sheet-locked/);

  // Click to unlock
  await lockBtn.click();
  await expect(lockBtn).not.toHaveClass(/locked/);
  await expect(page.locator('#checklist-items')).not.toHaveClass(/sheet-locked/);
});

test('locked sheet prevents inline editing', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.editable-cell', { timeout: 5_000 });

  // Lock the sheet
  await page.locator('#lock-btn').click();
  await expect(page.locator('#checklist-items')).toHaveClass(/sheet-locked/);

  // Try clicking an editable cell — no input should appear
  const cell = page.locator('.editable-cell').first();
  // pointer-events: none means click won't reach JS, but verify no input appears
  await cell.dispatchEvent('click');
  await page.waitForTimeout(500);
  await expect(cell.locator('input')).not.toBeVisible();
});

/* --- Settings / Profile tests --- */

test('settings modal shows build hash with link', async ({ page }) => {
  await setupApp(page);
  // Open settings via user-name click
  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
  const versionEl = page.locator('#settings-version');
  await expect(versionEl).toBeVisible();
  const text = await versionEl.textContent();
  expect(text).toContain('Build:');
});

test('settings version contains a GitHub link', async ({ page }) => {
  await setupApp(page);
  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
  const link = page.locator('.settings-hash-link');
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toContain('github.com');
});

/* --- Template Migration tests --- */

test('migration banner shows for legacy recipe without Status/Rating columns', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-032');
  await page.waitForSelector('.migration-banner', { timeout: 5_000 });
  const text = await page.locator('.migration-text').textContent();
  expect(text).toContain('Status');
  expect(text).toContain('Rating');
});

test('migration banner dismiss button removes it', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-032');
  await page.waitForSelector('.migration-banner', { timeout: 5_000 });
  await page.locator('.migration-dismiss').click();
  await expect(page.locator('.migration-banner')).toHaveCount(0);
});

test('full recipe sheet does not show migration banner', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });
  await expect(page.locator('.migration-banner')).toHaveCount(0);
});

test('pinning a sheet shows a toast notification', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5_000 });
  await page.locator('#sheet-pin-btn').click();

  const toast = page.locator('.toast');
  await expect(toast).toBeVisible({ timeout: 3000 });
  await expect(toast).toContainText('pinned');
});
