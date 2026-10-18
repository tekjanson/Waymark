// @ts-check
/**
 * open-in-sheets.spec.js — Tests for the "Edit in Sheets" button.
 *
 * Each test bootstraps the app in full isolation via setupApp()
 * and verifies the button's visibility, href behaviour, and
 * interaction without any shared state between tests.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, openOverflowMenu } = require('../helpers/test-utils');

test('Edit in Sheets button is visible when viewing a sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);

  await openOverflowMenu(page);
  await expect(page.locator('#open-in-sheets-btn')).toBeVisible();
});

test('Edit in Sheets button is not visible on home view', async ({ page }) => {
  await setupApp(page);

  // Home view should be shown, checklist view hidden
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('#checklist-view')).toBeHidden();

  // The button exists in the DOM but is inside the hidden checklist-view
  await expect(page.locator('#open-in-sheets-btn')).not.toBeVisible();
});

test('Edit in Sheets button opens correct Google Sheets URL', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);

  await page.evaluate(() => {
    window.__openedUrl = '';
    window.open = (url) => { window.__openedUrl = url; return null; };
  });
  await openOverflowMenu(page);
  await page.locator('#open-in-sheets-btn').click();

  const url = await page.evaluate(() => window.__openedUrl);
  expect(url).toContain('docs.google.com/spreadsheets/d/sheet-001');
});

test('Edit in Sheets button opens correct URL for a different sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-002');
  await waitForChecklistRows(page);

  await page.evaluate(() => {
    window.__openedUrl = '';
    window.open = (url) => { window.__openedUrl = url; return null; };
  });
  await openOverflowMenu(page);
  await page.locator('#open-in-sheets-btn').click();

  const url = await page.evaluate(() => window.__openedUrl);
  expect(url).toContain('docs.google.com/spreadsheets/d/sheet-002');
});

test('Edit in Sheets button updates URL when navigating between sheets', async ({ page }) => {
  await setupApp(page);

  // Navigate to first sheet
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);

  // Navigate to second sheet
  await navigateToSheet(page, 'sheet-002');
  await waitForChecklistRows(page);

  await page.evaluate(() => {
    window.__openedUrl = '';
    window.open = (url) => { window.__openedUrl = url; return null; };
  });
  await openOverflowMenu(page);
  await page.locator('#open-in-sheets-btn').click();

  const url = await page.evaluate(() => window.__openedUrl);
  expect(url).toContain('docs.google.com/spreadsheets/d/sheet-002');
  expect(url).not.toContain('sheet-001');
});
