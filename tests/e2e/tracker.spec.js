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

test('tracker shows milestone markers on progress bars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-milestone', { timeout: 5_000 });

  // Each row should have 3 milestone markers (25%, 50%, 75%)
  const milestones = page.locator('.tracker-milestone');
  // 8 rows x 3 markers = 24 total
  expect(await milestones.count()).toBe(24);
  // Some milestones should be passed (progress > marker%)
  const passed = page.locator('.tracker-milestone-passed');
  expect(await passed.count()).toBeGreaterThan(0);
});

test('tracker shows ETA for in-progress goals', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-eta', { timeout: 5_000 });

  const etas = page.locator('.tracker-eta');
  expect(await etas.count()).toBeGreaterThan(0);
  const text = await etas.first().textContent();
  expect(text).toMatch(/^ETA:/);
});
