// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, getExplorerFolderNames } = require('../helpers/test-utils');

/*
 * Drive Explorer tests — each test preconditions its own state via
 * setupApp() and runs in complete isolation.
 */

test('displays My Drive and Shared with Me sections', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await expect(page.locator('.explorer-section-title').first()).toHaveText('My Drive');
  await expect(page.locator('.explorer-section-title').last()).toHaveText('Shared with Me');
});

test('lists root folders from fixture data', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const names = await getExplorerFolderNames(page);
  expect(names).toContain('Groceries');
  expect(names).toContain('Home Projects');
  expect(names).toContain('Empty Folder');
});

test('lists shared folders', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const names = await getExplorerFolderNames(page);
  expect(names).toContain('Family Chores');
  expect(names).toContain('Team Tasks');
});

test('expands a folder to show children', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const groceries = page.locator('.folder-item', { hasText: 'Groceries' });
  await groceries.click();

  await page.waitForSelector('.sheet-item', { timeout: 5_000 });
  const sheetText = await page.locator('.sheet-item').first().textContent();
  expect(sheetText).toContain('Grocery List');
});

test('collapses an expanded folder', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const groceries = page.locator('.folder-item', { hasText: 'Groceries' });

  // Expand
  await groceries.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });
  expect(await page.locator('.sheet-item').count()).toBeGreaterThan(0);

  // Collapse
  await groceries.click();
  const wrapper = groceries.locator('..').locator('.folder-children');
  await expect(wrapper).toBeEmpty();
});

test('shows shared badge on shared folders', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const sharedBadges = page.locator('.badge-shared');
  expect(await sharedBadges.count()).toBeGreaterThan(0);
});

test('handles empty folders', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const empty = page.locator('.folder-item', { hasText: 'Empty Folder' });
  await empty.click();
  await page.waitForSelector('.folder-spinner', { timeout: 5_000 });
  const msg = await empty.locator('..').locator('.folder-children .folder-spinner').textContent();
  expect(msg).toContain('No items');
});

test('pin and unpin a folder', async ({ page }) => {
  // Start with NO pinned folders (clean state)
  await setupApp(page, { waitForExplorer: true });

  const groceriesRow = page.locator('.folder-item', { hasText: 'Groceries' });
  const pinBtn = groceriesRow.locator('.btn-pin');

  // Pin it
  await pinBtn.click();
  await expect(pinBtn).toHaveClass(/pinned/);

  // Verify it appears on home
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)');
  await expect(page.locator('.pinned-card-name', { hasText: 'Groceries' })).toBeVisible();

  // Unpin it
  const pinBtnAgain = page.locator('.folder-item', { hasText: 'Groceries' }).locator('.btn-pin');
  await pinBtnAgain.click();
  await expect(pinBtnAgain).not.toHaveClass(/pinned/);
});

test('sidebar toggle works', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toHaveClass(/sidebar-open/);

  await page.click('#sidebar-toggle');
  await expect(sidebar).not.toHaveClass(/sidebar-open/);

  await page.click('#sidebar-toggle');
  await expect(sidebar).toHaveClass(/sidebar-open/);
});
