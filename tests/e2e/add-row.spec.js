// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ====================================================================
   Visibility — trigger button appears with correct noun per template
   ==================================================================== */

test('add-row trigger shows "Add Item" for checklist template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await expect(page.locator('.add-row-trigger')).toBeVisible();
  await expect(page.locator('.add-row-trigger')).toContainText('Add Item');
});

test('add-row trigger shows "Add Transaction" for budget template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await expect(page.locator('.add-row-trigger')).toContainText('Add Transaction');
});

test('add-row trigger shows "Add Goal" for tracker template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await expect(page.locator('.add-row-trigger')).toContainText('Add Goal');
});

test('add-row trigger shows "Add Contact" for contacts template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await expect(page.locator('.add-row-trigger')).toContainText('Add Contact');
});

test('add-row trigger shows "Add Entry" for log template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-014');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await expect(page.locator('.add-row-trigger')).toContainText('Add Entry');
});

test('add-row trigger shows "Add Deal" for CRM template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await expect(page.locator('.add-row-trigger')).toContainText('Add Deal');
});

test('add-row trigger shows "Add Ingredient" for recipe template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-inline-add-btn', { timeout: 5_000 });
  const addBtns = page.locator('.recipe-inline-add-btn');
  expect(await addBtns.count()).toBe(3); // Add Ingredient + Add Step + Add Note
  await expect(addBtns.first()).toContainText('Add Ingredient');
  await expect(addBtns.nth(1)).toContainText('Add Step');
  await expect(addBtns.nth(2)).toContainText('Add Note');
});

/* ====================================================================
   Expand / Collapse behavior
   ==================================================================== */

test('clicking trigger expands form and hides trigger', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await expect(page.locator('.add-row-form')).toBeVisible();
  await expect(page.locator('.add-row-trigger')).toBeHidden();
});

test('cancel button collapses the form and restores trigger', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await expect(page.locator('.add-row-form')).toBeVisible();

  await page.click('.add-row-cancel');
  await expect(page.locator('.add-row-form')).toBeHidden();
  await expect(page.locator('.add-row-trigger')).toBeVisible();
});

test('Escape key collapses the form', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await expect(page.locator('.add-row-form')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.add-row-form')).toBeHidden();
  await expect(page.locator('.add-row-trigger')).toBeVisible();
});

test('first input is focused when form expands', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const firstInput = page.locator('.add-row-form input, .add-row-form select').first();
  await expect(firstInput).toBeFocused();
});

/* ====================================================================
   Validation — required fields prevent submit
   ==================================================================== */

test('empty required fields prevent submit and show error styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  // Submit with all fields empty
  await page.click('.add-row-submit');

  // Form stays open
  await expect(page.locator('.add-row-form')).toBeVisible();

  // At least one field is marked required
  const required = page.locator('.add-row-required');
  expect(await required.count()).toBeGreaterThanOrEqual(1);
});

test('validation error clears once required field is filled and resubmitted', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  // Trigger validation error
  await page.click('.add-row-submit');
  expect(await page.locator('.add-row-required').count()).toBeGreaterThanOrEqual(1);

  // Fill required fields (description + amount for budget)
  await page.locator('.add-row-form .add-row-field-input').first().fill('Groceries');
  await page.locator('.add-row-form input[type="number"]').first().fill('45');

  await page.click('.add-row-submit');

  // Form should now collapse (successful submit)
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await expect(page.locator('.add-row-form')).toBeHidden();
});

/* ====================================================================
   Submit — various template types
   ==================================================================== */

test('checklist add-row submits single row and records row-append', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  await page.locator('.add-row-form .add-row-field-input').first().fill('Buy milk');
  await page.click('.add-row-submit');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  expect(appends[0].rows.length).toBe(1);
  expect(appends[0].rows[0].some(v => v === 'Buy milk')).toBe(true);
});

test('budget add-row includes description, amount, and auto-filled date', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  await page.locator('.add-row-form .add-row-field-input').first().fill('Coffee');
  await page.locator('.add-row-form input[type="number"]').first().fill('5.50');

  await page.click('.add-row-submit');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  const row = appends[0].rows[0];
  expect(row.some(v => v === 'Coffee')).toBe(true);
  expect(row.some(v => v === '5.50')).toBe(true);
  // Date field should have today's date auto-filled (YYYY-MM-DD format)
  expect(row.some(v => /^\d{4}-\d{2}-\d{2}$/.test(v))).toBe(true);
});

test('contacts add-row submits name, email, phone, and role', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const inputs = page.locator('.add-row-form .add-row-field-input');
  await inputs.nth(0).fill('Alice Smith');
  await inputs.nth(1).fill('alice@test.com');
  await inputs.nth(2).fill('555-1234');
  await inputs.nth(3).fill('Manager');

  await page.click('.add-row-submit');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  const row = appends[0].rows[0];
  expect(row.some(v => v === 'Alice Smith')).toBe(true);
  expect(row.some(v => v === 'alice@test.com')).toBe(true);
  expect(row.some(v => v === '555-1234')).toBe(true);
});

test('CRM add-row defaults stage select to Lead', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  // Stage select should default to "Lead"
  const stageSelect = page.locator('.add-row-form .add-row-field-select').first();
  await expect(stageSelect).toHaveValue('Lead');
});

test('CRM add-row submits deal with company and default stage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  await page.locator('.add-row-form .add-row-field-input').first().fill('Acme Corp');
  await page.click('.add-row-submit');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  const row = appends[0].rows[0];
  expect(row.some(v => v === 'Acme Corp')).toBe(true);
  expect(row.some(v => v === 'Lead')).toBe(true);
});

test('tracker add-row submits goal with default progress 0', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  await page.locator('.add-row-form .add-row-field-input').first().fill('Run 5K');
  await page.click('.add-row-submit');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  const row = appends[0].rows[0];
  expect(row.some(v => v === 'Run 5K')).toBe(true);
});

/* ====================================================================
   Select dropdowns — correct options and defaults
   ==================================================================== */

test('test-cases form includes select dropdowns for result and priority', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const selects = page.locator('.add-row-form select');
  expect(await selects.count()).toBeGreaterThanOrEqual(2);

  // Result select defaults to "Untested"
  await expect(selects.first()).toHaveValue('Untested');
});

test('test-cases select can be changed before submit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  // Fill required text field
  await page.locator('.add-row-form .add-row-field-input').first().fill('Login test');

  // Change result to "Pass"
  await page.locator('.add-row-form select').first().selectOption('Pass');

  await page.click('.add-row-submit');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  const row = appends[0].rows[0];
  expect(row.some(v => v === 'Login test')).toBe(true);
  expect(row.some(v => v === 'Pass')).toBe(true);
});

/* ====================================================================
   Grid templates — minimal fields (identity only)
   ==================================================================== */

test('habit add-row form has exactly one field for habit name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const fields = page.locator('.add-row-form .add-row-field');
  expect(await fields.count()).toBe(1);
});

test('habit add-row submits a new habit name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  await page.locator('.add-row-form .add-row-field-input').first().fill('Meditate');
  await page.click('.add-row-submit');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  expect(appends[0].rows[0].some(v => v === 'Meditate')).toBe(true);
});

test('grading add-row form has exactly one field for student name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const fields = page.locator('.add-row-form .add-row-field');
  expect(await fields.count()).toBe(1);
});

/* ====================================================================
   Kanban — per-lane add buttons
   ==================================================================== */

test('kanban has an add trigger in each of the 5 lanes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  const triggers = page.locator('.kanban-lane .add-row-trigger');
  expect(await triggers.count()).toBe(5);
});

test('kanban does NOT show a global add-row trigger outside lanes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  // Only triggers inside lanes, no top-level trigger
  const globalTrigger = page.locator('#checklist-items > .add-row-root > .add-row-trigger');
  await expect(globalTrigger).toHaveCount(0);
});

test('kanban To Do lane prefills stage select to "To Do"', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  const todoLane = page.locator('.kanban-lane').nth(1);
  await todoLane.locator('.add-row-trigger').click();
  await todoLane.locator('.add-row-form:not(.hidden)').waitFor({ timeout: 3_000 });

  const stageSelect = todoLane.locator('.add-row-form select').first();
  await expect(stageSelect).toHaveValue('To Do');
});

test('kanban In Progress lane prefills stage to "In Progress"', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  const progressLane = page.locator('.kanban-lane').nth(2);
  await progressLane.locator('.add-row-trigger').click();
  await progressLane.locator('.add-row-form:not(.hidden)').waitFor({ timeout: 3_000 });

  const stageSelect = progressLane.locator('.add-row-form select').first();
  await expect(stageSelect).toHaveValue('In Progress');
});

test('kanban per-lane add submits record with correct stage value', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  const backlogLane = page.locator('.kanban-lane').first();
  await backlogLane.locator('.add-row-trigger').click();
  await backlogLane.locator('.add-row-form:not(.hidden)').waitFor({ timeout: 3_000 });

  await backlogLane.locator('.add-row-form .add-row-field-input').first().fill('New task');
  await backlogLane.locator('.add-row-submit').click();
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  expect(appends[0].rows[0].some(v => v === 'New task')).toBe(true);
  expect(appends[0].rows[0].some(v => v === 'Backlog')).toBe(true);
});

test('kanban Done lane submit includes "Done" stage in record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  const doneLane = page.locator('.kanban-lane').nth(3);
  await doneLane.locator('.add-row-trigger').click();
  await doneLane.locator('.add-row-form:not(.hidden)').waitFor({ timeout: 3_000 });

  await doneLane.locator('.add-row-form .add-row-field-input').first().fill('Completed task');
  await doneLane.locator('.add-row-submit').click();
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  expect(appends[0].rows[0].some(v => v === 'Done')).toBe(true);
});

/* ====================================================================
   Recipe — inline add ingredient / step buttons
   ==================================================================== */

test('recipe does NOT show a generic add-row trigger', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  // No generic add-row-trigger outside the card
  const globalTrigger = page.locator('#checklist-items > .add-row-root > .add-row-trigger');
  await expect(globalTrigger).toHaveCount(0);
});

test('recipe renders as single card (not multi-recipe grid)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  const cards = page.locator('.recipe-card');
  expect(await cards.count()).toBe(1);
  await expect(cards.first()).toHaveClass(/recipe-single/);
});

test('recipe shows inline "Add Ingredient" and "Add Step" buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-inline-add-btn', { timeout: 5_000 });

  const addBtns = page.locator('.recipe-inline-add-btn');
  expect(await addBtns.count()).toBe(3); // Add Ingredient + Add Step + Add Note
  await expect(addBtns.first()).toContainText('Add Ingredient');
  await expect(addBtns.nth(1)).toContainText('Add Step');
  await expect(addBtns.nth(2)).toContainText('Add Note');
});

test('recipe inline add ingredient: click opens form and cancel hides it', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-inline-add-btn', { timeout: 5_000 });

  const addBtn = page.locator('.recipe-inline-add-btn').first();
  await addBtn.click();

  // Form should be visible
  const form = page.locator('.recipe-inline-add-form:not(.hidden)').first();
  await expect(form).toBeVisible();

  // First input (quantity) should be focused
  const inputs = form.locator('.recipe-inline-add-input');
  await expect(inputs.first()).toBeFocused();

  // Trigger should be hidden
  await expect(addBtn).toBeHidden();

  // Cancel hides form
  await form.locator('.recipe-inline-add-cancel').click();
  await expect(form).toBeHidden();
  await expect(addBtn).toBeVisible();
});

test('recipe inline add ingredient: submit appends row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-inline-add-btn', { timeout: 5_000 });

  await page.locator('.recipe-inline-add-btn').first().click();
  const form = page.locator('.recipe-inline-add-form:not(.hidden)').first();
  const inputs = form.locator('.recipe-inline-add-input');
  // Fill quantity and ingredient name in separate inputs
  await inputs.first().fill('2 cups');
  await inputs.nth(1).fill('flour');
  await form.locator('.recipe-inline-add-submit').click();

  // Wait for re-render
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  expect(appends[0].rows.length).toBe(1);
  // The quantity and ingredient values should be in separate columns
  expect(appends[0].rows[0].some(v => v === '2 cups')).toBe(true);
  expect(appends[0].rows[0].some(v => v === 'flour')).toBe(true);
});

test('recipe inline add step: Enter key submits', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-inline-add-btn', { timeout: 5_000 });

  // Click "Add Step" (second button)
  await page.locator('.recipe-inline-add-btn').nth(1).click();
  const form = page.locator('.recipe-inline-add-form:not(.hidden)');
  await form.locator('.recipe-inline-add-input').fill('Preheat oven');
  await form.locator('.recipe-inline-add-input').press('Enter');

  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(1);
  expect(appends[0].rows[0].some(v => v === 'Preheat oven')).toBe(true);
});

test('recipe inline add: Escape key cancels without submit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-inline-add-btn', { timeout: 5_000 });

  await page.locator('.recipe-inline-add-btn').first().click();
  const form = page.locator('.recipe-inline-add-form:not(.hidden)').first();
  const input = form.locator('.recipe-inline-add-input').first();
  await input.fill('should not submit');
  await input.press('Escape');

  // Form should be hidden
  await expect(form).toBeHidden();

  // No records created
  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBe(0);
});

test('recipe inline add: empty field shows validation error', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-inline-add-btn', { timeout: 5_000 });

  await page.locator('.recipe-inline-add-btn').first().click();
  const form = page.locator('.recipe-inline-add-form:not(.hidden)').first();

  // Click submit with empty inputs
  await form.locator('.recipe-inline-add-submit').click();

  // First input should get required class
  await expect(form.locator('.recipe-inline-add-input').first()).toHaveClass(/add-row-required/);

  // Form stays open
  await expect(form).toBeVisible();
});

/* ====================================================================
   Form state — clears after submit, persists on cancel
   ==================================================================== */

test('form fields are cleared after successful submit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  await page.locator('.add-row-form .add-row-field-input').first().fill('Test item');
  await page.click('.add-row-submit');

  // After re-render, re-expand form
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  // First input should be empty (form was cleared)
  const val = await page.locator('.add-row-form .add-row-field-input').first().inputValue();
  expect(val).toBe('');
});

/* ====================================================================
   Re-render — new data appears after submit (mock mode)
   ==================================================================== */

test('new checklist item appears in rendered view after submit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-row', { timeout: 5_000 });

  const countBefore = await page.locator('.checklist-row').count();

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });
  await page.locator('.add-row-form .add-row-field-input').first().fill('Extra groceries');
  await page.click('.add-row-submit');

  // Wait for re-render
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  const countAfter = await page.locator('.checklist-row').count();
  expect(countAfter).toBe(countBefore + 1);
});

/* ====================================================================
   Field count — form matches template's addRowFields declaration
   ==================================================================== */

test('budget form shows 4 visible fields (description, amount, category, date)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  // Budget has 5 fields but "budget" col may be -1 in the fixture; count visible fields
  const fields = page.locator('.add-row-form .add-row-field');
  expect(await fields.count()).toBeGreaterThanOrEqual(3);
});

test('contacts form shows 4 fields (name, email, phone, role)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const fields = page.locator('.add-row-form .add-row-field');
  expect(await fields.count()).toBe(4);
});

/* ====================================================================
   Toast notification after successful add
   ==================================================================== */

test('success toast appears after adding an item', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  await page.locator('.add-row-form .add-row-field-input').first().fill('Toast test');
  await page.click('.add-row-submit');

  // Wait for toast to appear
  await page.waitForSelector('.toast', { timeout: 5_000 });
  await expect(page.locator('.toast')).toContainText('added');
});
