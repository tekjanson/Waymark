/**
 * undo-redo.spec.js — E2E tests for the Undo / Redo system (§4 test layers)
 *
 * Ctrl+Z to undo the last cell edit (reverts via Sheets API).
 * Ctrl+Shift+Z to redo. Toast on undo/redo. Max 50 ops. Stacks cleared on
 * sheet navigation.
 */

const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ─── helpers ─── */

/** Click a checklist item text cell, type a new value, and commit with Enter. */
async function editCell(page, selector, newValue) {
  await page.click(selector);
  const input = await page.waitForSelector(`${selector} .editable-cell-input`, { timeout: 3000 });
  await input.fill(newValue);
  await input.press('Enter');
}

/** Press Ctrl+Z (undo) on the document body. */
async function pressUndo(page) {
  await page.keyboard.press('Control+z');
}

/** Press Ctrl+Shift+Z (redo) on the document body. */
async function pressRedo(page) {
  await page.keyboard.press('Control+Shift+z');
}

/* ─── Layer 1 & 2: basic undo ─── */

test('Ctrl+Z undoes the last cell edit and shows Undone toast', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-item-text.editable-cell', { timeout: 5000 });

  const firstCell = '.checklist-item-text.editable-cell';
  await editCell(page, firstCell, 'NEW VALUE');

  const before = await getCreatedRecords(page);
  const beforeCellUpdates = before.filter(r => r.type === 'cell-update');
  expect(beforeCellUpdates.some(r => r.value === 'NEW VALUE')).toBe(true);

  // Press undo — should revert
  await pressUndo(page);

  // Toast should show "Undone"
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast').last()).toContainText('Undone');

  // A second updateCell call should have been made with the old value
  const after = await getCreatedRecords(page);
  const afterCellUpdates = after.filter(r => r.type === 'cell-update');
  expect(afterCellUpdates.length).toBeGreaterThan(beforeCellUpdates.length);
  const undoRecord = afterCellUpdates[afterCellUpdates.length - 1];
  expect(undoRecord.value).toBe('Milk'); // original value from fixture
});

test('Ctrl+Shift+Z redoes an undone edit and shows Redone toast', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-item-text.editable-cell', { timeout: 5000 });

  const firstCell = '.checklist-item-text.editable-cell';
  await editCell(page, firstCell, 'REDO TARGET');

  // Undo it
  await pressUndo(page);
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Redo it
  await pressRedo(page);
  await page.waitForSelector('.toast', { timeout: 3000 });
  // Use .last() in case both Undone and Redone toasts are briefly visible
  await expect(page.locator('.toast').last()).toContainText('Redone');

  // The last cell-update record should be the redo reapplying the new value
  const records = await getCreatedRecords(page);
  const cellUpdates = records.filter(r => r.type === 'cell-update');
  expect(cellUpdates[cellUpdates.length - 1].value).toBe('REDO TARGET');
});

test('new edit after undo clears the redo stack', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-item-text.editable-cell', { timeout: 5000 });

  const firstCell = '.checklist-item-text.editable-cell';
  await editCell(page, firstCell, 'FIRST EDIT');

  // Undo
  await pressUndo(page);
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Make a NEW edit — should clear redo stack
  // Need a second cell so text is stable
  const cells = page.locator('.checklist-item-text.editable-cell');
  const secondCell = cells.nth(1);
  await secondCell.click();
  const input2 = await secondCell.waitFor({ timeout: 3000 });
  // click again to enter edit mode
  await secondCell.click();
  const inp = await page.waitForSelector('.checklist-item-text.editable-cell .editable-cell-input', { timeout: 3000 });
  await inp.fill('SECOND EDIT');
  await inp.press('Enter');

  // Now Ctrl+Shift+Z should do nothing (redo stack empty)
  const countBefore = (await getCreatedRecords(page)).length;
  await pressRedo(page);
  await page.waitForTimeout(500); // small wait
  const countAfter = (await getCreatedRecords(page)).length;
  expect(countAfter).toBe(countBefore); // no new record = redo stack was empty
});

/* ─── Layer 3: multiple ops ─── */

test('multiple sequential undos revert edits in order', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-item-text.editable-cell', { timeout: 5000 });

  const cells = page.locator('.checklist-item-text.editable-cell');

  // Edit two different cells
  await (await cells.nth(0).elementHandle()).click();
  let inp = await page.waitForSelector('.checklist-item-text.editable-cell .editable-cell-input', { timeout: 3000 });
  await inp.fill('EDIT-A');
  await inp.press('Enter');

  await page.waitForTimeout(100);

  await (await cells.nth(1).elementHandle()).click();
  inp = await page.waitForSelector('.checklist-item-text.editable-cell .editable-cell-input', { timeout: 3000 });
  await inp.fill('EDIT-B');
  await inp.press('Enter');

  // Two edits made; undo both
  const beforeCellUpdates = (await getCreatedRecords(page)).filter(r => r.type === 'cell-update');
  await pressUndo(page);
  await page.waitForSelector('.toast', { timeout: 3000 });
  await pressUndo(page);
  await page.waitForSelector('.toast', { timeout: 3000 });

  const records = await getCreatedRecords(page);
  const cellUpdates = records.filter(r => r.type === 'cell-update');
  // Should have 2 more cell-update records (the two undo reverts)
  expect(cellUpdates.length).toBe(beforeCellUpdates.length + 2);
  // Last undo reverts EDIT-A back to "Milk"
  expect(cellUpdates[cellUpdates.length - 1].value).toBe('Milk');
});

/* ─── Layer 4: input element does NOT trigger undo ─── */

test('Ctrl+Z inside an input element is handled natively, not by undo stack', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-item-text.editable-cell', { timeout: 5000 });

  const firstCell = '.checklist-item-text.editable-cell';
  await editCell(page, firstCell, 'SAVED VALUE');

  const countAfterEdit = (await getCreatedRecords(page)).length;

  // Now click into the SAME cell to open a new input (but don't commit)
  await page.click(firstCell);
  await page.waitForSelector(`${firstCell} .editable-cell-input`, { timeout: 3000 });

  // Press Ctrl+Z while inside the input — should NOT trigger our undo handler
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  // No additional records should have been created by undo
  const recordsAfter = await getCreatedRecords(page);
  expect(recordsAfter.length).toBe(countAfterEdit);

  // No toast should have appeared
  const toastVisible = await page.locator('.toast').isVisible().catch(() => false);
  expect(toastVisible).toBe(false);
});

/* ─── Layer 5: no-op when stack is empty ─── */

test('Ctrl+Z does nothing when undo stack is empty', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-item-text.editable-cell', { timeout: 5000 });

  // Capture baseline (may include user-data init records)
  const countBefore = (await getCreatedRecords(page)).length;

  // No edits made — press undo
  await pressUndo(page);
  await page.waitForTimeout(400);

  // No new records, no toast
  const records = await getCreatedRecords(page);
  expect(records.length).toBe(countBefore);
  const toastVisible = await page.locator('.toast').isVisible().catch(() => false);
  expect(toastVisible).toBe(false);
});

test('Ctrl+Shift+Z does nothing when redo stack is empty', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-item-text.editable-cell', { timeout: 5000 });

  const countBefore = (await getCreatedRecords(page)).length;

  await pressRedo(page);
  await page.waitForTimeout(400);

  // No new records, no toast
  const records = await getCreatedRecords(page);
  expect(records.length).toBe(countBefore);
  const toastVisible = await page.locator('.toast').isVisible().catch(() => false);
  expect(toastVisible).toBe(false);
});

/* ─── Layer 6: stack clears on sheet navigation ─── */

test('undo stack clears when navigating to a different sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-item-text.editable-cell', { timeout: 5000 });

  // Make an edit on sheet-001
  await editCell(page, '.checklist-item-text.editable-cell', 'EDIT ON SHEET 1');
  const countOnSheet1 = (await getCreatedRecords(page)).length;
  expect(countOnSheet1).toBeGreaterThan(0);

  // Navigate to a different sheet
  await navigateToSheet(page, 'sheet-002');
  await page.waitForSelector('.checklist-item-text.editable-cell, .kanban-card, .budget-row', { timeout: 10000 });
  // Let any async saves (addRecentSheet) settle before capturing baseline
  await page.waitForTimeout(300);

  // Capture count AFTER navigation (includes async addRecentSheet records)
  const countBeforeUndo = (await getCreatedRecords(page)).length;

  // Press Ctrl+Z — stack was cleared so nothing is undone
  await pressUndo(page);
  await page.waitForTimeout(400);

  const records = await getCreatedRecords(page);
  // Count should be the same (no new record from undo on the previous sheet)
  expect(records.length).toBe(countBeforeUndo);
  const toastVisible = await page.locator('.toast').isVisible().catch(() => false);
  expect(toastVisible).toBe(false);
});
