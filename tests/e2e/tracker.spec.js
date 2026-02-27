// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('fitness goals detected as Progress Tracker template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.template-tracker-row', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Tracker');

  // Check progress bars rendered
  const rows = page.locator('.template-tracker-row');
  expect(await rows.count()).toBe(8);

  // Check a specific progress percentage
  const pctTexts = await page.locator('.template-tracker-pct').allTextContents();
  expect(pctTexts.some(t => t.includes('84'))).toBe(true);  // 4.2/5 = 84%
});

test('tracker shows progress bar widths', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.template-tracker-bar', { timeout: 5_000 });

  const bars = page.locator('.template-tracker-bar');
  expect(await bars.count()).toBeGreaterThan(0);

  // Check first bar has a non-zero width
  const firstBar = bars.first();
  const width = await firstBar.evaluate(el => el.style.width);
  expect(width).not.toBe('0%');
});
