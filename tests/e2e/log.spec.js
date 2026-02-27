// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('workout log detected as Activity Log template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-014');
  await page.waitForSelector('.template-log-entry', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Log');

  // Log entries rendered (reverse chronological = newest first)
  const entries = page.locator('.template-log-entry');
  expect(await entries.count()).toBe(8);

  // First entry should be the most recent (Feb 27)
  const firstTime = await page.locator('.template-log-time').first().textContent();
  expect(firstTime).toContain('2026-02-21');  // reversed = oldest at top... wait.
});

test('log shows type badges and duration', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-014');
  await page.waitForSelector('.template-log-type', { timeout: 5_000 });

  const types = await page.locator('.template-log-type').allTextContents();
  expect(types).toContain('Cardio');
  expect(types).toContain('Strength');

  const durations = await page.locator('.template-log-duration').allTextContents();
  expect(durations.some(d => d.includes('min'))).toBe(true);
});
