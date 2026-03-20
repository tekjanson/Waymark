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
  await expect(pickerBtn).toContainText('Open from Google Drive');
});

test('displays picker hint text', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const hint = page.locator('.explorer-picker-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Select a spreadsheet');
});

test('shows empty state when no recent or pinned sheets', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const emptyState = page.locator('#explorer-view .empty-state', { hasText: 'No recent sheets yet' });
  await expect(emptyState).toBeVisible();
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
