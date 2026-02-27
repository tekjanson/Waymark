// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('timesheet detected as Timesheet template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Timesheet');
});

test('timesheet renders summary with total hours', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-summary', { timeout: 5_000 });

  const values = await page.locator('.ts-summary-value').allTextContents();
  expect(values.length).toBeGreaterThanOrEqual(3);
});

test('timesheet distinguishes billable and non-billable rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-row', { timeout: 5_000 });

  const billable = page.locator('.ts-billable');
  const nonBillable = page.locator('.ts-nonbillable');
  expect(await billable.count()).toBeGreaterThan(0);
  expect(await nonBillable.count()).toBeGreaterThan(0);
});
