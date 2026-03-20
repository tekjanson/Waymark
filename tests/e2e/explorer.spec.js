// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/*
 * Drive Explorer tests — the explorer now shows a Picker button,
 * recent sheets, and pinned sheets instead of browsing Drive folders.
 * Google Picker can't be tested in E2E (external iframe), so we test
 * the UI elements and layout.
 */

test('displays Open from Google Drive button', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const pickerBtn = page.locator('.explorer-picker-btn');
  await expect(pickerBtn).toBeVisible();
  await expect(pickerBtn).toContainText('Open from Drive');
});

test('displays picker hint text', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const hint = page.locator('.explorer-picker-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Browse your Google Drive');
});

test('auto-pins Waymark folder on first load', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const waymarkFolder = page.locator('.folder-item', { hasText: 'Waymark' });
  await expect(waymarkFolder).toBeVisible();
});

test('displays Pin a Folder button', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const pinBtn = page.locator('.explorer-pin-folder-btn');
  await expect(pinBtn).toBeVisible();
  await expect(pinBtn).toContainText('Pin a Folder');
});

test('sidebar toggle works', async ({ page }) => {
  await setupApp(page);

  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toHaveClass(/sidebar-open/);

  await page.click('#sidebar-toggle');
  await expect(sidebar).not.toHaveClass(/sidebar-open/);

  await page.click('#sidebar-toggle');
  await expect(sidebar).toHaveClass(/sidebar-open/);
});
