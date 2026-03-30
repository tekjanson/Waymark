const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('pin a sheet → navigate home → verify card → unpin → verify gone', async ({ page }) => {
  await setupApp(page);
  
  // Navigate to a sheet
  await navigateToSheet(page, 'sheet-001');
  
  // Wait for pin button
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5_000 });
  
  // Verify not pinned initially
  const pinBtn = page.locator('#sheet-pin-btn');
  await expect(pinBtn).not.toHaveClass(/pinned/);
  
  // Pin the sheet
  await pinBtn.click();
  
  // Verify pin button has pinned class
  await expect(pinBtn).toHaveClass(/pinned/);
  
  // Verify toast
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible({ timeout: 3000 });
  await expect(toast).toContainText('pinned');
  
  // Navigate to home
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  
  // Verify pinned sheets section is visible
  const pinnedSection = page.locator('#home-pinned-sheets');
  await expect(pinnedSection).not.toHaveClass(/hidden/, { timeout: 5_000 });
  
  // Verify the pinned card exists
  const pinnedCards = page.locator('#pinned-sheets .pinned-card');
  await expect(pinnedCards).toHaveCount(1, { timeout: 5_000 });
  
  // Click the pinned card to navigate back to the sheet
  await pinnedCards.first().click();
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5_000 });
  
  // Unpin the sheet
  const pinBtn2 = page.locator('#sheet-pin-btn');
  await expect(pinBtn2).toHaveClass(/pinned/);
  await pinBtn2.click();
  
  // Verify pinned class removed
  await expect(pinBtn2).not.toHaveClass(/pinned/);
  
  // Navigate to home again
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  
  // Verify pinned sheets section is hidden
  await expect(page.locator('#home-pinned-sheets')).toHaveClass(/hidden/, { timeout: 5_000 });
});

test('pinned sheet persists after page reload', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5_000 });
  await page.locator('#sheet-pin-btn').click();
  await expect(page.locator('.toast')).toContainText('pinned');
  
  // Reload the page
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
  
  // Navigate home
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  
  // Verify pinned sheet still appears
  const pinnedSection = page.locator('#home-pinned-sheets');
  await expect(pinnedSection).not.toHaveClass(/hidden/, { timeout: 5_000 });
  const cards = page.locator('#pinned-sheets .pinned-card');
  await expect(cards).toHaveCount(1, { timeout: 5_000 });
});

test('rapid pin/unpin/pin results in pinned state', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5_000 });
  const pinBtn = page.locator('#sheet-pin-btn');
  
  // Rapid: pin → unpin → pin
  await pinBtn.click();
  await pinBtn.click();
  await pinBtn.click();
  
  // Should end up pinned (odd number of clicks)
  await expect(pinBtn).toHaveClass(/pinned/);
  
  // Navigate home and verify
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  
  const pinnedSection = page.locator('#home-pinned-sheets');
  await expect(pinnedSection).not.toHaveClass(/hidden/, { timeout: 5_000 });
});

test('pin a folder → navigate home → verify card exists', async ({ page }) => {
  await setupApp(page);
  
  // Navigate to a folder
  await page.evaluate(() => { window.location.hash = '#/folder/f-groceries/Groceries'; });
  await page.waitForSelector('#folder-view:not(.hidden)', { timeout: 5_000 });
  
  // Wait for pin button
  const pinBtn = page.locator('#folder-pin-btn');
  await expect(pinBtn).toBeVisible({ timeout: 5_000 });
  
  // Pin the folder
  await pinBtn.click();
  
  // Verify pinned class
  await expect(pinBtn).toHaveClass(/pinned/);
  
  // Navigate to home
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  
  // Verify the folder appears in pinned section
  const folderCards = page.locator('#pinned-folders .pinned-card');
  const count = await folderCards.count();
  expect(count).toBeGreaterThanOrEqual(1);
  
  // Verify "Groceries" card exists
  await expect(page.locator('.pinned-card-name', { hasText: 'Groceries' })).toBeVisible({ timeout: 5_000 });
});

test('folder pin button shows pinned state for already-pinned folder', async ({ page }) => {
  await setupApp(page, {
    pinnedFolders: [{ id: 'f-groceries', name: 'Groceries' }],
  });
  
  // Navigate to the already-pinned folder
  await page.evaluate(() => { window.location.hash = '#/folder/f-groceries/Groceries'; });
  await page.waitForSelector('#folder-view:not(.hidden)', { timeout: 5_000 });
  
  // Pin button should show pinned state
  const pinBtn = page.locator('#folder-pin-btn');
  await expect(pinBtn).toHaveClass(/pinned/, { timeout: 5_000 });
  
  // Unpin it
  await pinBtn.click();
  await expect(pinBtn).not.toHaveClass(/pinned/);
  
  // Navigate home
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  
  // Verify the "Groceries" card is gone (only auto-pinned Waymark should remain)
  await expect(page.locator('.pinned-card-name', { hasText: 'Groceries' })).toHaveCount(0, { timeout: 5_000 });
});

test('pinned sheets section hidden by default on home', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  
  // No sheets pinned → section should be hidden
  const section = page.locator('#home-pinned-sheets');
  await expect(section).toHaveClass(/hidden/);
});

test('pre-seeded pinned sheet appears on home page', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-001', name: 'Test Checklist', templateKey: 'checklist', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  
  // The pinned sheets section should be visible
  const section = page.locator('#home-pinned-sheets');
  await expect(section).not.toHaveClass(/hidden/, { timeout: 5_000 });
  
  // Card should exist
  const cards = page.locator('#pinned-sheets .pinned-card');
  await expect(cards).toHaveCount(1);
  await expect(page.locator('.pinned-card-name', { hasText: 'Test Checklist' })).toBeVisible();
});
