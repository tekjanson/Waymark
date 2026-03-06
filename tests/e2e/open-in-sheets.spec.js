// @ts-check
/**
 * open-in-sheets.spec.js — Tests for the "Edit in Sheets" button.
 *
 * Each test bootstraps the app in full isolation via setupApp()
 * and verifies the button's visibility and interaction without
 * any shared state between tests. In local mode the button
 * shows a toast instead of opening a Google Sheets URL.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows } = require('../helpers/test-utils');

test('Edit in Sheets button is visible when viewing a sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);

  await expect(page.locator('#open-in-sheets-btn')).toBeVisible();
  await expect(page.locator('#open-in-sheets-btn')).toContainText('Edit in Sheets');
});

test('Edit in Sheets button is not visible on home view', async ({ page }) => {
  await setupApp(page);

  // Home view should be shown, checklist view hidden
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('#checklist-view')).toBeHidden();

  // The button exists in the DOM but is inside the hidden checklist-view
  await expect(page.locator('#open-in-sheets-btn')).not.toBeVisible();
});

test('Edit in Sheets button shows toast in local mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);

  // In local mode, clicking should show a toast instead of opening a tab
  await page.locator('#open-in-sheets-btn').click();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('not available in local mode');
});

test('Edit in Sheets button shows toast for any sheet in local mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-002');
  await waitForChecklistRows(page);

  await page.locator('#open-in-sheets-btn').click();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('not available in local mode');
});
