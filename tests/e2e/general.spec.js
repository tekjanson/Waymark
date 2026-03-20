// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords, openOverflowMenu } = require('../helpers/test-utils');

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

  await openOverflowMenu(page);
  const dupBtn = page.locator('#duplicate-sheet-btn');
  await expect(dupBtn).toBeVisible();

  await dupBtn.click();
  // Wait for duplicate modal to appear
  await page.waitForSelector('#duplicate-modal', { timeout: 5_000 });

  // Modal should show a pre-filled name
  const nameInput = page.locator('.duplicate-name-input');
  await expect(nameInput).toBeVisible();
  const nameValue = await nameInput.inputValue();
  expect(nameValue).toContain('Copy of');

  // Click the Create Copy button
  await page.click('.duplicate-create-btn');

  // Wait for toast confirming creation
  await page.waitForSelector('.toast', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const copyRecord = records.find(r => r.title && r.title.startsWith('Copy of'));
  expect(copyRecord).toBeTruthy();
  expect(copyRecord.rows.length).toBeGreaterThan(0);
});

test('share button visible in overflow menu', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  const shareBtn = page.locator('#share-btn');
  await expect(shareBtn).toBeVisible();
  await expect(shareBtn).toContainText('Share');
});

test('share button opens share modal with links', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#share-btn').click();
  await page.waitForSelector('#share-modal', { timeout: 5_000 });
  await expect(page.locator('#share-modal')).toBeVisible();

  // Should show two share link inputs (Waymark + Google)
  const inputs = page.locator('.share-link-input');
  expect(await inputs.count()).toBe(2);

  // Waymark link should contain sheet ID
  const waymarkLink = await inputs.nth(0).inputValue();
  expect(waymarkLink).toContain('sheet-001');

  // Google link should point to docs.google.com
  const googleLink = await inputs.nth(1).inputValue();
  expect(googleLink).toContain('docs.google.com');
  expect(googleLink).toContain('sheet-001');
});

test('share modal has copy buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#share-btn').click();
  await page.waitForSelector('#share-modal', { timeout: 5_000 });

  const copyBtns = page.locator('.share-copy-btn');
  expect(await copyBtns.count()).toBe(2);
  await expect(copyBtns.first()).toContainText('Copy');
});

test('share modal closes on close button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#share-btn').click();
  await page.waitForSelector('#share-modal', { timeout: 5_000 });
  await expect(page.locator('#share-modal')).toBeVisible();

  await page.locator('#share-modal .modal-close').click();
  await expect(page.locator('#share-modal')).toHaveCount(0);
});

test('share modal closes on overlay click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#share-btn').click();
  await page.waitForSelector('#share-modal', { timeout: 5_000 });

  // Click the overlay (outside the modal content)
  await page.locator('#share-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#share-modal')).toHaveCount(0);
});

test('share modal has manage sharing link', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#share-btn').click();
  await page.waitForSelector('#share-modal', { timeout: 5_000 });

  const manageLink = page.locator('.btn-share-google');
  await expect(manageLink).toBeVisible();
  await expect(manageLink).toContainText('Manage Sharing');
  const href = await manageLink.getAttribute('href');
  expect(href).toContain('docs.google.com');
});

test('duplicate modal closes on close button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#duplicate-sheet-btn').click();
  await page.waitForSelector('#duplicate-modal', { timeout: 5_000 });

  await page.locator('#duplicate-modal .modal-close').click();
  await expect(page.locator('#duplicate-modal')).toHaveCount(0);
});

test('duplicate modal closes on cancel button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#duplicate-sheet-btn').click();
  await page.waitForSelector('#duplicate-modal', { timeout: 5_000 });

  await page.locator('#duplicate-modal .modal-footer .btn-secondary').click();
  await expect(page.locator('#duplicate-modal')).toHaveCount(0);
});

test('duplicate modal has choose folder button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#duplicate-sheet-btn').click();
  await page.waitForSelector('#duplicate-modal', { timeout: 5_000 });

  await expect(page.locator('.duplicate-choose-folder')).toBeVisible();
  await expect(page.locator('.duplicate-folder-name')).toContainText('Default');
});

test.skip('duplicate folder browser shows breadcrumbs and folders — replaced by Google Picker', async ({ page }) => {
});

test('duplicate choose-folder button picks folder via Picker', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  await page.locator('#duplicate-sheet-btn').click();
  await page.waitForSelector('#duplicate-modal', { timeout: 5_000 });

  // Click choose folder — Picker auto-returns in mock mode
  await page.locator('.duplicate-choose-folder').click();

  // Folder name should update from default
  await expect(page.locator('.duplicate-folder-name')).not.toContainText('Default');
});

test('lock button shows toast feedback on toggle', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Click lock button via overflow menu
  await openOverflowMenu(page);
  await page.locator('#lock-btn').click();

  // Should show lock toast
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible({ timeout: 3000 });
  await expect(toast).toContainText('locked');

  // Wait for first toast to disappear before unlocking
  await page.waitForSelector('.toast', { state: 'hidden', timeout: 6_000 });

  // Unlock and verify toast
  await openOverflowMenu(page);
  await page.locator('#lock-btn').click();
  await expect(page.locator('.toast').last()).toContainText('unlocked');
});

test('lock button visible in overflow and toggles lock state', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await openOverflowMenu(page);
  const lockBtn = page.locator('#lock-btn');
  await expect(lockBtn).toBeVisible();
  // Initially unlocked
  await expect(lockBtn).not.toHaveClass(/locked/);

  // Click to lock (menu closes, re-open to verify state)
  await lockBtn.click();
  await expect(page.locator('#checklist-items')).toHaveClass(/sheet-locked/);

  // Re-open menu and unlock
  await openOverflowMenu(page);
  await expect(lockBtn).toHaveClass(/locked/);
  await lockBtn.click();
  await expect(page.locator('#checklist-items')).not.toHaveClass(/sheet-locked/);
});

test('locked sheet prevents inline editing', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.editable-cell', { timeout: 5_000 });

  // Lock the sheet via overflow menu
  await openOverflowMenu(page);
  await page.locator('#lock-btn').click();
  await expect(page.locator('#checklist-items')).toHaveClass(/sheet-locked/);

  // Try clicking an editable cell — no input should appear
  const cell = page.locator('.editable-cell').first();
  // pointer-events: none means click won't reach JS, but verify no input appears
  await cell.dispatchEvent('click');
  // Give time for any input to appear (if broken)
  await page.waitForSelector('#checklist-items', { timeout: 1_000 });
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
