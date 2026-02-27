// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('habit tracker detected as Habit Tracker template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Habit');
});

test('habit tracker renders grid with day columns', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  const toggles = page.locator('.habit-toggle');
  expect(await toggles.count()).toBeGreaterThan(0);

  // Check some are checked
  const checked = page.locator('.habit-checked');
  expect(await checked.count()).toBeGreaterThan(0);
});

test('habit toggle emits cell-update on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-toggle', { timeout: 5_000 });

  // Click an unchecked cell — capture data attrs for stable re-query
  const unchecked = page.locator('.habit-toggle:not(.habit-checked)').first();
  const rowAttr = await unchecked.getAttribute('data-row-idx');
  const colAttr = await unchecked.getAttribute('data-col-idx');
  await unchecked.click();
  const clicked = page.locator(`.habit-toggle[data-row-idx="${rowAttr}"][data-col-idx="${colAttr}"]`);
  await expect(clicked).toHaveClass(/habit-checked/);

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
  expect(updates[updates.length - 1].value).toBe('✓');
});
