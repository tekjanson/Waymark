// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('roster detected as Roster template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-026');
  await page.waitForSelector('.roster-grid-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Roster');
});

test('roster renders employee grid with shift badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-026');
  await page.waitForSelector('.roster-shift-btn', { timeout: 5_000 });

  const shifts = page.locator('.roster-shift-btn');
  expect(await shifts.count()).toBe(8);

  // Check employee names
  const employees = await page.locator('.roster-employee-cell').allTextContents();
  expect(employees.some(e => e.includes('Alice Chen'))).toBe(true);
});

test('roster day toggle emits cell-update', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-026');
  await page.waitForSelector('.roster-toggle', { timeout: 5_000 });

  const unchecked = page.locator('.roster-toggle:not(.roster-checked)').first();
  const rRowAttr = await unchecked.getAttribute('data-row-idx');
  const rColAttr = await unchecked.getAttribute('data-col-idx');
  await unchecked.click();
  const clickedRoster = page.locator(`.roster-toggle[data-row-idx="${rRowAttr}"][data-col-idx="${rColAttr}"]`);
  await expect(clickedRoster).toHaveClass(/roster-checked/);

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
});
