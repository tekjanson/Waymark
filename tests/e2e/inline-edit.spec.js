// @ts-check
/**
 * inline-edit.spec.js — Tests for universal inline editing across all templates.
 *
 * Verifies that editableCell()-wrapped fields:
 *   1. Show an <input> on click
 *   2. Commit the new value on Enter (emitting cell-update record)
 *   3. Cancel on Escape (reverting text, no record emitted)
 *   4. Commit on blur (clicking away)
 *
 * Covers formerly read-only templates (schedule, contacts, log, changelog,
 * meal, travel) and newly-editable fields on partially-editable templates
 * (checklist text, kanban title, inventory name, budget description, etc.).
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ──────────────────── Helper ──────────────────── */

/**
 * Click an editable-cell to open its inline input, type a value, and
 * optionally commit via Enter or blur.
 */
async function startInlineEdit(page, selector) {
  const cell = page.locator(selector).first();
  await cell.click();
  const input = cell.locator('input.editable-cell-input');
  await expect(input).toBeVisible({ timeout: 3000 });
  return { cell, input };
}

/* ================================================================
   SCHEDULE  (sheet-011)  — formerly fully read-only
   ================================================================ */

test('schedule: clicking an activity cell shows inline input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.template-schedule-event', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.template-schedule-event-name.editable-cell');
  await expect(input).toHaveValue('Team Standup');
});

test('schedule: Enter commits edit and emits cell-update', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.template-schedule-event', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.template-schedule-event-name.editable-cell');
  await input.fill('Morning Standup');
  await input.press('Enter');

  // Input should be gone, text should reflect new value
  await expect(cell).toHaveText('Morning Standup');
  await expect(cell.locator('input')).not.toBeVisible();

  // Check cell-update record
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
  const last = updates[updates.length - 1];
  expect(last.value).toBe('Morning Standup');
  expect(last.spreadsheetId).toBe('sheet-011');
});

test('schedule: Escape cancels edit without emitting record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.template-schedule-event', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.template-schedule-event-name.editable-cell');
  const original = await input.inputValue();
  await input.fill('SHOULD NOT SAVE');
  await input.press('Escape');

  // Should revert to original text
  await expect(cell).toHaveText(original);

  // Should NOT have emitted any record
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(0);
});

test('schedule: location field is editable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.template-schedule-event', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.template-schedule-location.editable-cell');
  await expect(input).toBeVisible();
});

/* ================================================================
   CONTACTS  (sheet-013)  — formerly fully read-only
   ================================================================ */

test('contacts: name field is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.template-contact-card', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.template-contact-name.editable-cell');
  await input.fill('Dr. Jane Doe');
  await input.press('Enter');

  await expect(cell).toHaveText('Dr. Jane Doe');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('Dr. Jane Doe');
  expect(updates[0].spreadsheetId).toBe('sheet-013');
});

/* ================================================================
   CHECKLIST (sheet-001) — text/date/notes now editable
   ================================================================ */

test('checklist: item text is editable inline (separate from toggle)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-row', { timeout: 5_000 });

  // Click on the text, not the checkbox
  const { cell, input } = await startInlineEdit(page, '.checklist-item-text.editable-cell');
  await input.fill('Whole Milk');
  await input.press('Enter');

  await expect(cell).toHaveText('Whole Milk');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('Whole Milk');
});

/* ================================================================
   KANBAN (sheet-017) — title/assignee/priority now editable
   ================================================================ */

test('kanban: card title is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.kanban-card-title.editable-cell');
  await input.fill('Redesign dashboard');
  await input.press('Enter');

  await expect(cell).toHaveText('Redesign dashboard');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('Redesign dashboard');
  expect(updates[0].spreadsheetId).toBe('sheet-017');
});

test('kanban: stage cycle still works alongside inline editing', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Click the stage button (existing behavior should still work)
  const stageBadge = page.locator('.kanban-stage-btn').first();
  const originalStage = await stageBadge.textContent();
  await stageBadge.click();

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).not.toBe(originalStage);
});

/* ================================================================
   INVENTORY (sheet-012) — name/qty/extra all editable now
   ================================================================ */

test('inventory: item name is editable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-012');
  await page.waitForSelector('.template-inv-card', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.template-inv-name.editable-cell');
  await input.fill('Brown Rice');
  await input.press('Enter');

  await expect(cell).toHaveText('Brown Rice');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('Brown Rice');
});

test('inventory: quantity is editable inline (no prompt)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-012');
  await page.waitForSelector('.template-inv-card', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.template-inv-qty.editable-cell');
  await input.fill('25');
  await input.press('Enter');

  await expect(cell).toHaveText('25');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('25');
});

/* ================================================================
   BUDGET (sheet-016) — description/amount/date all editable
   ================================================================ */

test('budget: amount field is editable inline (no prompt)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-row', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.budget-amount.editable-cell');
  await input.fill('5500');
  await input.press('Enter');

  await expect(cell).toHaveText('5500');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('5500');
});

test('budget: description field is editable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-row', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.budget-row-text.editable-cell');
  await expect(input).toBeVisible();
});

/* ================================================================
   TESTCASES (sheet-015) — text/expected/actual/notes now editable
   ================================================================ */

test('testcases: test description is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.tc-row-text.editable-cell');
  await input.fill('Verify login with SSO');
  await input.press('Enter');

  await expect(cell).toHaveText('Verify login with SSO');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('Verify login with SSO');
});

test('testcases: status cycle still works alongside inline editing', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row', { timeout: 5_000 });

  const statusBtn = page.locator('.tc-status-btn').first();
  await statusBtn.click();

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
});

/* ================================================================
   CRM (sheet-023) — company/contact/value/notes now editable
   ================================================================ */

test('crm: company name is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.crm-card-company.editable-cell');
  await input.fill('Acme Industries');
  await input.press('Enter');

  await expect(cell).toHaveText('Acme Industries');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('Acme Industries');
});

/* ================================================================
   LOG (sheet-014) — all fields now editable
   ================================================================ */

test('log: activity text is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-014');
  await page.waitForSelector('.template-log-entry', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.template-log-text.editable-cell');
  await expect(input).toBeVisible();
});

/* ================================================================
   HABIT (sheet-018) — habit name & streak now editable
   ================================================================ */

test('habit: habit name is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.habit-grid-row', { timeout: 5_000 });

  // Skip the header row — get the first data row's name cell
  const nameCell = page.locator('.habit-grid-row:not(.habit-grid-header) .habit-name-cell.editable-cell').first();
  await nameCell.click();
  const input = nameCell.locator('input.editable-cell-input');
  await expect(input).toBeVisible();
});

/* ================================================================
   GRADING (sheet-019) — student name & scores editable
   ================================================================ */

test('grading: student name is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.grading-row', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.grading-student-cell.editable-cell');
  await expect(input).toBeVisible();
});

test('grading: score cell is editable inline (no prompt)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.grading-row', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.grading-score-cell.editable-cell');
  await input.fill('95');
  await input.press('Enter');

  await expect(cell).toHaveText('95');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('95');
});

/* ================================================================
   POLL (sheet-021) — option text & votes editable
   ================================================================ */

test('poll: vote count is editable inline (no prompt)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-021');
  await page.waitForSelector('.poll-row', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.poll-votes-count.editable-cell');
  await input.fill('42');
  await input.press('Enter');

  await expect(cell).toHaveText('42');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('42');
});

/* ================================================================
   TIMESHEET (sheet-020) — all fields editable
   ================================================================ */

test('timesheet: hours field is editable inline (no prompt)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-row', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.ts-hours.editable-cell');
  await input.fill('8.5');
  await input.press('Enter');

  await expect(cell).toHaveText('8.5');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('8.5');
});

/* ================================================================
   ROSTER (sheet-026) — employee name & role now editable
   ================================================================ */

test('roster: employee name is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-026');
  await page.waitForSelector('.roster-grid-row:not(.roster-header)', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.roster-employee-cell.editable-cell');
  await expect(input).toBeVisible();
});

/* ================================================================
   TRAVEL (sheet-025) — all fields editable
   ================================================================ */

test('travel: activity title is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-025');
  await page.waitForSelector('.travel-card', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.travel-card-title.editable-cell');
  await expect(input).toBeVisible();
});

/* ================================================================
   CHANGELOG (sheet-022) — type badge & description editable
   ================================================================ */

test('changelog: description is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-022');
  await page.waitForSelector('.changelog-entry', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.changelog-desc.editable-cell');
  await expect(input).toBeVisible();
});

/* ================================================================
   MEAL (sheet-024) — all fields editable
   ================================================================ */

test('meal: recipe name is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-024');
  await page.waitForSelector('.meal-card', { timeout: 5_000 });

  const { input } = await startInlineEdit(page, '.meal-recipe.editable-cell');
  await expect(input).toBeVisible();
});

/* ================================================================
   BLUR COMMIT TEST (cross-template)
   ================================================================ */

test('inline edit commits on blur (clicking away)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.template-schedule-event', { timeout: 5_000 });

  const { cell, input } = await startInlineEdit(page, '.template-schedule-event-name.editable-cell');
  await input.fill('Blur Test Value');

  // Click somewhere else to blur
  await page.locator('body').click({ position: { x: 10, y: 10 } });

  // Should have committed
  await expect(cell).toHaveText('Blur Test Value');
  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBe(1);
  expect(updates[0].value).toBe('Blur Test Value');
});
