// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('poll detected as Poll / Survey template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-021');
  await page.waitForSelector('.poll-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Poll');
});

test('poll renders bar chart with vote counts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-021');
  await page.waitForSelector('.poll-bar', { timeout: 5_000 });

  const bars = page.locator('.poll-bar');
  expect(await bars.count()).toBe(5);

  // Total votes shown
  const total = page.locator('.poll-total');
  await expect(total).toContainText('25');
});
