const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/**
 * Pin the current sheet to Home via the contextual pin menu.
 * Clicking 📌 opens a popover; the first item toggles the Home pin.
 */
async function togglePinViaMenu(page) {
  await page.click('#sheet-pin-btn');
  await page.waitForSelector('.pin-menu', { timeout: 3_000 });
  await page.locator('.pin-menu .pin-menu-item').first().click();
  await page.waitForSelector('.pin-menu', { state: 'detached', timeout: 3_000 });
}

test('pin a sheet → navigate home → verify card → unpin → verify gone', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5_000 });

  const pinBtn = page.locator('#sheet-pin-btn');
  await expect(pinBtn).not.toHaveClass(/pinned/);

  await togglePinViaMenu(page);
  await expect(pinBtn).toHaveClass(/pinned/);

  const toast = page.locator('.toast');
  await expect(toast).toBeVisible({ timeout: 3000 });
  await expect(toast).toContainText('Pinned to Home');

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  // The Pinned Waymarks widget renders the pinned sheet
  const pinnedRows = page.locator('.wayboard-widget-pinned .wayboard-data-name');
  await expect(pinnedRows).toHaveCount(1, { timeout: 5_000 });

  // Click the pinned row to navigate back to the sheet
  await page.locator('.wayboard-widget-pinned .wayboard-data-row').first().click();
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5_000 });

  const pinBtn2 = page.locator('#sheet-pin-btn');
  await expect(pinBtn2).toHaveClass(/pinned/);
  await togglePinViaMenu(page);
  await expect(pinBtn2).not.toHaveClass(/pinned/);

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  // With no pins left, the Pinned Waymarks widget is not rendered
  await expect(page.locator('.wayboard-widget-pinned')).toHaveCount(0, { timeout: 5_000 });
});

test('pinned sheet persists after page reload', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5_000 });
  await togglePinViaMenu(page);
  await expect(page.locator('.toast')).toContainText('Pinned to Home');

  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  const rows = page.locator('.wayboard-widget-pinned .wayboard-data-name');
  await expect(rows).toHaveCount(1, { timeout: 5_000 });
});

test('pin via menu, unpin via menu, pin again results in pinned state', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5_000 });
  const pinBtn = page.locator('#sheet-pin-btn');

  await togglePinViaMenu(page);
  await togglePinViaMenu(page);
  await togglePinViaMenu(page);

  await expect(pinBtn).toHaveClass(/pinned/);

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  await expect(page.locator('.wayboard-widget-pinned .wayboard-data-name')).toHaveCount(1, { timeout: 5_000 });
});

test('pin a folder → navigate home → verify card exists', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-groceries/Groceries'; });
  await page.waitForSelector('#folder-view:not(.hidden)', { timeout: 5_000 });

  const pinBtn = page.locator('#folder-pin-btn');
  await expect(pinBtn).toBeVisible({ timeout: 5_000 });
  await pinBtn.click();
  await expect(pinBtn).toHaveClass(/pinned/);

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  // Verify the folder appears in the Pinned waypoints widget
  const folderRows = page.locator('.wayboard-widget-folders .wayboard-data-name');
  await expect(folderRows.filter({ hasText: 'Groceries' })).toBeVisible({ timeout: 5_000 });
});

test('folder pin button shows pinned state for already-pinned folder', async ({ page }) => {
  await setupApp(page, {
    pinnedFolders: [{ id: 'f-groceries', name: 'Groceries' }],
  });

  await page.evaluate(() => { window.location.hash = '#/folder/f-groceries/Groceries'; });
  await page.waitForSelector('#folder-view:not(.hidden)', { timeout: 5_000 });

  const pinBtn = page.locator('#folder-pin-btn');
  await expect(pinBtn).toHaveClass(/pinned/, { timeout: 5_000 });

  await pinBtn.click();
  await expect(pinBtn).not.toHaveClass(/pinned/);

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  // With no folders pinned, the Pinned waypoints widget is not rendered
  await expect(page.locator('.wayboard-widget-folders')).toHaveCount(0, { timeout: 5_000 });
});

test('pinned sheets widget hidden by default on home', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  // No sheets pinned → the Pinned Waymarks widget is not rendered
  await expect(page.locator('.wayboard-widget-pinned')).toHaveCount(0);
});

test('pre-seeded pinned sheet appears on home page', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-001', name: 'Test Checklist', templateKey: 'checklist', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  const rows = page.locator('.wayboard-widget-pinned .wayboard-data-name');
  await expect(rows).toHaveCount(1, { timeout: 5_000 });
  await expect(rows.filter({ hasText: 'Test Checklist' })).toBeVisible();
});
