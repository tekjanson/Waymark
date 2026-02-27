// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('grocery list detected as Checklist template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);
  await expect(page.locator('#template-badge')).toBeVisible();
  await expect(page.locator('#template-badge')).toContainText('Checklist');
});

test('home repairs detected as Checklist template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-002');
  await waitForChecklistRows(page);
  await expect(page.locator('#template-badge')).toContainText('Checklist');
});

test('checklist checkbox toggles completed state on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);

  // Find first uncompleted row (Bread is row 3, not done)
  const rows = page.locator('.checklist-row');
  const breadRow = rows.nth(2); // 0-indexed: Milk(0), Eggs(1), Bread(2)
  await expect(breadRow).not.toHaveClass(/completed/);

  // Click the checkbox
  const checkbox = breadRow.locator('.checklist-checkbox');
  await checkbox.click();

  // Should now be completed
  await expect(breadRow).toHaveClass(/completed/);
  await expect(checkbox).toHaveText('✓');
});

test('checklist toggle emits cell-update record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);

  // Click checkbox on Bread row (uncompleted → done)
  const checkbox = page.locator('.checklist-row').nth(2).locator('.checklist-checkbox');
  await checkbox.click();

  // Verify update record
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);

  const lastUpdate = updates[updates.length - 1];
  expect(lastUpdate.value).toBe('done');
  expect(lastUpdate.spreadsheetId).toBe('sheet-001');
});

test('checklist toggle can uncheck a completed item', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);

  // Milk (index 0) is "done" — should be completed
  const milkRow = page.locator('.checklist-row').first();
  await expect(milkRow).toHaveClass(/completed/);

  // Click to uncheck
  const checkbox = milkRow.locator('.checklist-checkbox');
  await checkbox.click();

  // Should no longer be completed
  await expect(milkRow).not.toHaveClass(/completed/);
  await expect(checkbox).toHaveText('');

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  const lastUpdate = updates[updates.length - 1];
  expect(lastUpdate.value).toBe('');
});
