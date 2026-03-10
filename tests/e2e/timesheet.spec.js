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

/* --- grouping tests --- */

test('timesheet group toolbar shows four group buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-toolbar', { timeout: 5_000 });
  const btns = page.locator('.ts-group-btn');
  expect(await btns.count()).toBe(4);
});

test('timesheet grouping by client creates group headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-toolbar', { timeout: 5_000 });
  await page.locator('.ts-group-btn[data-group="client"]').click();
  const headers = page.locator('.ts-group-header');
  expect(await headers.count()).toBeGreaterThanOrEqual(2);
});

test('timesheet group headers show hour subtotals', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-toolbar', { timeout: 5_000 });
  await page.locator('.ts-group-btn[data-group="client"]').click();
  const stats = await page.locator('.ts-group-stats').allTextContents();
  expect(stats.length).toBeGreaterThan(0);
  expect(stats[0]).toContain('h');
});

test('timesheet group by date creates date headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-toolbar', { timeout: 5_000 });
  await page.locator('.ts-group-btn[data-group="date"]').click();
  const headers = page.locator('.ts-group-header');
  expect(await headers.count()).toBeGreaterThanOrEqual(4);
});

test('timesheet none button removes grouping', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-toolbar', { timeout: 5_000 });
  await page.locator('.ts-group-btn[data-group="client"]').click();
  expect(await page.locator('.ts-group-header').count()).toBeGreaterThan(0);
  await page.locator('.ts-group-btn[data-group="none"]').click();
  expect(await page.locator('.ts-group-header').count()).toBe(0);
});

/* --- invoice export tests --- */

test('timesheet export invoice button opens overlay', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-invoice-btn', { timeout: 5_000 });
  await page.locator('.ts-invoice-btn').click();
  await page.waitForSelector('.ts-invoice-overlay', { timeout: 3_000 });
  await expect(page.locator('.ts-inv-title')).toHaveText('Invoice');
});

test('timesheet invoice shows billable line items with amounts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-invoice-btn', { timeout: 5_000 });
  await page.locator('.ts-invoice-btn').click();
  await page.waitForSelector('.ts-inv-table', { timeout: 3_000 });
  const rows = page.locator('.ts-inv-row');
  expect(await rows.count()).toBeGreaterThanOrEqual(5);
});

test('timesheet invoice close button removes overlay', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-invoice-btn', { timeout: 5_000 });
  await page.locator('.ts-invoice-btn').click();
  await page.waitForSelector('.ts-invoice-overlay', { timeout: 3_000 });
  await page.locator('#ts-inv-close').click();
  await expect(page.locator('.ts-invoice-overlay')).toHaveCount(0);
});
