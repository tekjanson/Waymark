// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ---------- Backward compat: 4-column sheet (sheet-017) ---------- */

test('kanban detected as Kanban Board template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Kanban');
});

test('kanban renders swim lanes with cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  const lanes = page.locator('.kanban-lane');
  expect(await lanes.count()).toBe(6); // Backlog, To Do, In Progress, QA, Done, Rejected

  const cards = page.locator('.kanban-card');
  expect(await cards.count()).toBe(9);
});

test('kanban stage badge cycles on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const firstBtn = page.locator('.kanban-stage-btn').first();
  const initialText = await firstBtn.textContent();
  await firstBtn.click();

  // Should have changed text
  const newText = await firstBtn.textContent();
  expect(newText).not.toBe(initialText);
});

/* ---------- Enhanced: 9-column sheet (sheet-028) ---------- */

test('kanban enhanced fixture detects as Kanban Board', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Kanban');
});

test('kanban renders project filter pills', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-filter-bar', { timeout: 5_000 });

  const pills = page.locator('.kanban-filter-pill');
  // "All" + 4 projects: Frontend, Backend, Testing, DevOps
  expect(await pills.count()).toBe(5);
  await expect(pills.first()).toContainText('All');
});

test('kanban project filter shows only matching cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-filter-bar', { timeout: 5_000 });

  // Count all cards before filter (excludes archived by default)
  const totalBefore = await page.locator('.kanban-card').count();
  expect(totalBefore).toBe(8);

  // Click "Backend" filter pill
  const backendPill = page.locator('.kanban-filter-pill', { hasText: 'Backend' });
  await backendPill.click();

  // Only Backend tasks visible: "API Rate Limiting", "Add Export Feature"
  const filtered = await page.locator('.kanban-card').count();
  expect(filtered).toBe(2);

  // Click "All" to reset
  await page.locator('.kanban-filter-pill', { hasText: 'All' }).click();
  expect(await page.locator('.kanban-card').count()).toBe(8);
});

test('kanban card expand shows description', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Find a card with an expand button and click it
  const expandBtn = page.locator('.kanban-card-expand').first();
  await expandBtn.click();

  // Detail section should be visible
  await expect(page.locator('.kanban-card-detail').first()).toBeVisible();
  await expect(page.locator('.kanban-detail-desc').first()).toBeVisible();
});

test('kanban card expand shows sub-tasks', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Kanban Board Redesign" (Done lane) has 2 sub-tasks
  // Find it via .kanban-card-title containing the text
  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();

  const subtaskRows = card.locator('.kanban-subtask-row');
  expect(await subtaskRows.count()).toBe(2);

  // Both sub-tasks should be checked (Done)
  const checkedBoxes = card.locator('.kanban-subtask-check.checked');
  expect(await checkedBoxes.count()).toBe(2);
});

test('kanban sub-task checkbox toggles status', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Expand "Dark Mode Support" which has sub-tasks with mixed status
  const card = page.locator('.kanban-card', { hasText: 'Dark Mode Support' });
  await card.locator('.kanban-card-expand').click();

  const firstCheck = card.locator('.kanban-subtask-check').first();
  const wasChecked = await firstCheck.evaluate(el => el.classList.contains('checked'));

  await firstCheck.click();

  // Should have toggled
  const isNowChecked = await firstCheck.evaluate(el => el.classList.contains('checked'));
  expect(isNowChecked).not.toBe(wasChecked);

  // Verify edit record was created
  const records = await getCreatedRecords(page);
  const stageEdit = records.find(r => r.type === 'cell-update' && (r.value === 'To Do' || r.value === 'Done'));
  expect(stageEdit).toBeTruthy();
});

test('kanban card expand shows notes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Kanban Board Redesign" has 1 note
  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();

  const notes = card.locator('.kanban-note');
  expect(await notes.count()).toBe(1);
  await expect(notes.first()).toContainText('Looks great in testing!');
  await expect(card.locator('.kanban-note-author').first()).toContainText('Alice');
});

test('kanban sort by priority orders cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-sort-select', { timeout: 5_000 });

  await page.locator('.kanban-sort-select').selectOption('priority');

  // After sorting by priority, P0 tasks should come first in their lanes
  // In the In Progress lane: "Fix Search Bug" (P0) should be before "Dark Mode Support" (P1)
  const inProgressLane = page.locator('.kanban-lane-inprogress');
  const firstCard = inProgressLane.locator('.kanban-card').first();
  await expect(firstCard).toContainText('Fix Search Bug');
});

test('kanban sort by due date orders cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-sort-select', { timeout: 5_000 });

  await page.locator('.kanban-sort-select').selectOption('due');

  // In To Do lane: "API Rate Limiting" (2026-03-20) and "Mobile Layout Polish" (2026-03-25)
  // Earlier due should come first
  const todoLane = page.locator('.kanban-lane-todo');
  const firstCard = todoLane.locator('.kanban-card').first();
  await expect(firstCard).toContainText('API Rate Limiting');
});

test('kanban archive button hides card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Count cards in Done lane before archive
  const doneLane = page.locator('.kanban-lane-done');
  const cardsBefore = await doneLane.locator('.kanban-card').count();
  expect(cardsBefore).toBe(2);

  // Click archive on first Done card
  await doneLane.locator('.kanban-archive-btn').first().click();

  // Wait for animation
  await page.waitForTimeout(400);

  // One fewer card in Done lane
  const cardsAfter = await doneLane.locator('.kanban-card').count();
  expect(cardsAfter).toBe(cardsBefore - 1);

  // Verify edit record
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'Archived')).toBe(true);
});

test('kanban show archived toggle reveals archived lane', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  // Initially 6 lanes (no archived lane visible)
  expect(await page.locator('.kanban-lane').count()).toBe(6);

  // Toggle "Show Archived"
  await page.locator('.kanban-archive-checkbox').check();

  // Now 7 lanes
  expect(await page.locator('.kanban-lane').count()).toBe(7);

  // Archived lane should have 1 card ("Setup CI Pipeline")
  const archivedLane = page.locator('.kanban-lane-archived');
  await expect(archivedLane).toBeVisible();
  expect(await archivedLane.locator('.kanban-card').count()).toBe(1);
  await expect(archivedLane.locator('.kanban-card').first()).toContainText('Setup CI Pipeline');
});

test('kanban card shows due date chip', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Cards with due dates should show a due chip
  const dueChips = page.locator('.kanban-card-due');
  expect(await dueChips.count()).toBeGreaterThan(0);
});

test('kanban card shows project badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const projectBadges = page.locator('.kanban-card-project-badge');
  expect(await projectBadges.count()).toBeGreaterThan(0);
});

test('kanban card shows label tag', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const labels = page.locator('.kanban-card-label');
  expect(await labels.count()).toBeGreaterThan(0);
});

test('kanban card shows sub-task progress indicator', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Cards with sub-tasks should show count
  const stCounts = page.locator('.kanban-card-subtask-count');
  expect(await stCounts.count()).toBeGreaterThan(0);
});

test('kanban lane header shows item count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-lane-count', { timeout: 5_000 });

  // Each lane should show a count
  const counts = page.locator('.kanban-lane-count');
  expect(await counts.count()).toBe(6); // 6 lanes visible by default (incl. Rejected)
});

/* ---------- Drag-and-drop ---------- */

test('kanban cards are draggable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Every card should have draggable attribute
  const cards = page.locator('.kanban-card[draggable="true"]');
  expect(await cards.count()).toBe(8);
});

test('kanban card drag adds dragging class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card').first();

  // Dispatch synthetic dragstart via evaluate (DataTransfer can only be created in page context)
  await card.evaluate(el => {
    const evt = new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() });
    el.dispatchEvent(evt);
  });
  await expect(card).toHaveClass(/kanban-card-dragging/);
});

/* ---------- Combo cell (Project / Assignee) ---------- */

test('kanban project field opens combo dropdown on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Expand a card to see detail
  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  // Click the Project field value (should be a combo cell)
  const projectField = card.locator('.kanban-detail-field-value.combo-cell').first();
  await projectField.click();

  // Should show an input
  const input = card.locator('.combo-cell-input');
  await expect(input).toBeVisible();

  // Visible dropdown should appear with options
  const dropdown = projectField.locator('.combo-cell-dropdown:not(.hidden)');
  await expect(dropdown).toBeVisible();
  const options = dropdown.locator('.combo-cell-option');
  expect(await options.count()).toBeGreaterThan(0);
});

test('kanban assignee field opens combo dropdown on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Expand a card to see detail
  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  // Find the assignee combo cell (second combo-cell in detail)
  const assigneeField = card.locator('.kanban-detail-field-value.combo-cell').nth(1);
  await assigneeField.click();

  // The input and dropdown should appear inside the assignee field itself
  const input = assigneeField.locator('.combo-cell-input');
  await expect(input).toBeVisible();
  const dropdown = assigneeField.locator('.combo-cell-dropdown:not(.hidden)');
  await expect(dropdown).toBeVisible();
});

test('kanban combo cell commits edit on Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  const projectField = card.locator('.kanban-detail-field-value.combo-cell').first();
  await projectField.click();

  const input = card.locator('.combo-cell-input').first();
  await input.fill('New Project');
  await input.press('Enter');

  // Verify edit record
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'New Project')).toBe(true);
});

test('kanban combo cell cancels on Escape', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  const projectField = card.locator('.kanban-detail-field-value.combo-cell').first();
  const originalText = await projectField.textContent();

  await projectField.click();
  const input = card.locator('.combo-cell-input').first();
  await input.fill('Should Not Save');
  await input.press('Escape');

  // Text should revert and dropdown should be gone
  await expect(projectField).toContainText(originalText || '');
  await expect(projectField.locator('.combo-cell-dropdown')).toBeHidden();
});

test('kanban combo cell selects option from dropdown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  const projectField = card.locator('.kanban-detail-field-value.combo-cell').first();
  await projectField.click();

  // Clear input to see all options, then pick one different from current
  const input = projectField.locator('.combo-cell-input');
  await input.fill('');

  const dropdown = projectField.locator('.combo-cell-dropdown:not(.hidden)');
  await expect(dropdown).toBeVisible();

  // Pick an option that differs from original ("Frontend")
  const options = dropdown.locator('.combo-cell-option');
  const count = await options.count();
  let picked = null;
  for (let i = 0; i < count; i++) {
    const text = await options.nth(i).textContent();
    if (text !== 'Frontend') { picked = { el: options.nth(i), text }; break; }
  }
  expect(picked).not.toBeNull();
  await picked.el.click();

  // Verify edit record was created with the selected value
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === picked.text)).toBe(true);
});

test('kanban combo cell arrow toggles dropdown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  const projectField = card.locator('.kanban-detail-field-value.combo-cell').first();
  await projectField.click();

  // Dropdown opens on click
  const dropdown = projectField.locator('.combo-cell-dropdown');
  await expect(dropdown).toBeVisible();

  // Click arrow to close
  const arrow = projectField.locator('.combo-cell-arrow');
  await arrow.click();
  await expect(dropdown).toHaveClass(/hidden/);

  // Click arrow again to re-open
  await arrow.click();
  await expect(dropdown).not.toHaveClass(/hidden/);
});

test('kanban combo cell filters options when typing', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  const projectField = card.locator('.kanban-detail-field-value.combo-cell').first();
  await projectField.click();

  // Clear input to see all available options
  const input = projectField.locator('.combo-cell-input');
  await input.fill('');

  const dropdown = projectField.locator('.combo-cell-dropdown');
  const allCount = await dropdown.locator('.combo-cell-option').count();
  expect(allCount).toBeGreaterThan(1);

  // Type a non-matching value to see the (new) hint
  await input.fill('zzz_nonexistent_project');
  const emptyHint = dropdown.locator('.combo-cell-empty');
  await expect(emptyHint).toBeVisible();
  await expect(emptyHint).toContainText('(new)');
  expect(await dropdown.locator('.combo-cell-option').count()).toBe(0);

  // Clear the filter to restore all
  await input.fill('');
  expect(await dropdown.locator('.combo-cell-option').count()).toBe(allCount);
});

/* ---------- Textarea cell (Description) ---------- */

test('kanban description opens textarea on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  const descField = card.locator('.kanban-detail-desc.textarea-cell');
  await descField.click();

  const textarea = card.locator('.editable-cell-textarea');
  await expect(textarea).toBeVisible();
});

test('kanban description textarea commits on Ctrl+Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  const descField = card.locator('.kanban-detail-desc.textarea-cell');
  await descField.click();

  const textarea = card.locator('.editable-cell-textarea');
  await textarea.fill('Updated description text');
  await textarea.press('Control+Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'Updated description text')).toBe(true);
});

test('kanban description textarea cancels on Escape', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();

  const descField = card.locator('.kanban-detail-desc.textarea-cell');
  const originalText = await descField.textContent();

  await descField.click();
  const textarea = card.locator('.editable-cell-textarea');
  await textarea.fill('Should not save this');
  await textarea.press('Escape');

  await expect(descField).toContainText(originalText || '');
});

/* ---------- Add-row combo dropdown ---------- */

test('kanban add-row project field shows combo dropdown with existing projects', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Open the add-row form in the first lane
  const trigger = page.locator('.add-row-trigger').first();
  await trigger.click();
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  // The project field should have a combo wrap with arrow
  const comboWrap = page.locator('.add-row-combo-wrap').first();
  await expect(comboWrap).toBeVisible();

  // Click the combo input to open dropdown
  const comboInput = comboWrap.locator('.add-row-field-combo');
  await comboInput.focus();
  await page.waitForSelector('.add-row-combo-dropdown:not(.hidden)', { timeout: 3_000 });

  // Dropdown should have options from existing project names
  const options = comboWrap.locator('.add-row-combo-option');
  expect(await options.count()).toBeGreaterThan(0);
});

test('kanban add-row combo dropdown arrow toggles the list', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const trigger = page.locator('.add-row-trigger').first();
  await trigger.click();
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const comboWrap = page.locator('.add-row-combo-wrap').first();
  const arrow = comboWrap.locator('.add-row-combo-arrow');

  // Click arrow to open
  await arrow.click();
  await page.waitForSelector('.add-row-combo-dropdown:not(.hidden)', { timeout: 3_000 });

  const options = comboWrap.locator('.add-row-combo-option');
  expect(await options.count()).toBeGreaterThan(0);
});

test('kanban add-row combo allows typing a new value', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const trigger = page.locator('.add-row-trigger').first();
  await trigger.click();
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const comboInput = page.locator('.add-row-field-combo').first();
  await comboInput.fill('Brand New Project');

  // Input should accept the custom value
  await expect(comboInput).toHaveValue('Brand New Project');

  // Dropdown should show "(new)" hint since no match
  const emptyHint = page.locator('.add-row-combo-empty').first();
  await expect(emptyHint).toBeVisible();
});

test('kanban add-row combo selects option from dropdown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const trigger = page.locator('.add-row-trigger').first();
  await trigger.click();
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  const comboWrap = page.locator('.add-row-combo-wrap').first();
  const comboInput = comboWrap.locator('.add-row-field-combo');
  await comboInput.focus();
  await page.waitForSelector('.add-row-combo-dropdown:not(.hidden)', { timeout: 3_000 });

  // Click first option in the dropdown
  const firstOption = comboWrap.locator('.add-row-combo-option').first();
  const optionText = await firstOption.textContent();
  await firstOption.click();

  // Input should now have the selected value
  await expect(comboInput).toHaveValue(optionText || '');
});

test('kanban priority dot cycles on click and records edit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Expand first card to access detail panel
  const expandBtn = page.locator('.kanban-card-expand').first();
  await expandBtn.click();
  await page.waitForSelector('.kanban-card-detail', { timeout: 3_000 });

  // Click priority dot on the card header
  const priDot = page.locator('.kanban-card .kanban-pri-dot').first();
  await expect(priDot).toBeVisible();
  await priDot.click();

  // Verify a priority edit was recorded
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && /P[0-3]/.test(r.value))).toBe(true);
});

test('kanban detail panel shows editable priority field', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Expand first card
  const expandBtn = page.locator('.kanban-card-expand').first();
  await expandBtn.click();
  await page.waitForSelector('.kanban-card-detail', { timeout: 3_000 });

  // Priority field should exist in the detail metadata
  const priLabel = page.locator('.kanban-detail-field-label').filter({ hasText: 'Priority' });
  await expect(priLabel).toBeVisible();
});

test('kanban add-row description is a textarea', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const trigger = page.locator('.add-row-trigger').first();
  await trigger.click();
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3_000 });

  // Description field should be a textarea (scope to the visible form)
  const form = page.locator('.add-row-form:not(.hidden)');
  const textarea = form.locator('.add-row-field-textarea');
  await expect(textarea).toBeVisible();
});

test('kanban lane collapse button hides cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Click collapse button on first lane
  const collapseBtn = page.locator('.kanban-lane-collapse').first();
  await collapseBtn.click();

  // Lane should have collapsed class
  const firstLane = page.locator('.kanban-lane').first();
  await expect(firstLane).toHaveClass(/kanban-lane-collapsed/);

  // Lane body should be hidden
  const laneBody = firstLane.locator('.kanban-lane-body');
  await expect(laneBody).toBeHidden();
});

test('kanban lane collapse toggles back on second click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const collapseBtn = page.locator('.kanban-lane-collapse').first();
  // Collapse
  await collapseBtn.click();
  const firstLane = page.locator('.kanban-lane').first();
  await expect(firstLane).toHaveClass(/kanban-lane-collapsed/);

  // Expand
  const expandBtn = firstLane.locator('.kanban-lane-collapse');
  await expandBtn.click();
  await expect(firstLane).not.toHaveClass(/kanban-lane-collapsed/);
  const laneBody = firstLane.locator('.kanban-lane-body');
  await expect(laneBody).toBeVisible();
});

/* ---------- Status-Change Timestamps ---------- */

test('kanban activity section shows status-change history', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Kanban Board Redesign" has 3 status-change notes
  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();
  await page.waitForSelector('.kanban-activity-list', { timeout: 3_000 });

  const activityItems = card.locator('.kanban-activity-item');
  expect(await activityItems.count()).toBe(3);

  // Verify transition text format (from → to)
  await expect(activityItems.first()).toContainText('Backlog');
  await expect(activityItems.first()).toContainText('To Do');
});

test('kanban activity items show formatted timestamps', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Expand "Kanban Board Redesign" which has status-change notes with timestamps
  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();
  await page.waitForSelector('.kanban-activity-date', { timeout: 3_000 });

  // Status-change dates should be formatted (not raw ISO), e.g. "Feb 20" or "14d ago"
  const firstDate = card.locator('.kanban-activity-date').first();
  const dateText = await firstDate.textContent();
  // Should not be raw ISO format like "2026-02-20 09:15"
  expect(dateText).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
  // Should contain some formatted text (month name, relative time, etc.)
  expect(dateText.length).toBeGreaterThan(0);

  // Tooltip should show original date string
  const titleAttr = await firstDate.getAttribute('title');
  expect(titleAttr).toContain('2026-02-20');
});

test('kanban activity icon displays transition symbol', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();
  await page.waitForSelector('.kanban-activity-icon', { timeout: 3_000 });

  const icon = card.locator('.kanban-activity-icon').first();
  await expect(icon).toContainText('⟳');
  await expect(icon).toHaveCSS('color', /./);
});

test('kanban status notes separated from regular notes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Kanban Board Redesign" has 1 regular note and 3 status notes
  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();

  // Regular notes still show in notes section
  const regularNotes = card.locator('.kanban-note');
  expect(await regularNotes.count()).toBe(1);
  await expect(regularNotes.first()).toContainText('Looks great in testing!');

  // Status notes show in activity section
  const activityItems = card.locator('.kanban-activity-item');
  expect(await activityItems.count()).toBe(3);
});

test('kanban regular note dates are formatted', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Expand "Kanban Board Redesign" to see the regular note
  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();
  await page.waitForSelector('.kanban-note-date', { timeout: 3_000 });

  const noteDate = card.locator('.kanban-note-date').first();
  const dateText = await noteDate.textContent();
  // Regular note date should be formatted, not raw "2026-03-01"
  expect(dateText).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(dateText.length).toBeGreaterThan(0);

  // Tooltip shows original date
  const titleAttr = await noteDate.getAttribute('title');
  expect(titleAttr).toBe('2026-03-01');
});

test('kanban stage badge click inserts status-change record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  // Click a stage badge to cycle status
  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const stageBadge = card.locator('.kanban-stage-btn');
  const prevText = await stageBadge.textContent();
  await stageBadge.click();
  const newText = await stageBadge.textContent();

  // Stage should have changed
  expect(newText).not.toBe(prevText);

  // Verify cell-update record was created for the stage change
  const records = await getCreatedRecords(page);
  const stageEdit = records.find(r => r.type === 'cell-update' && r.value === newText.trim());
  expect(stageEdit).toBeTruthy();
});

test('kanban activity timeline has design token styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();
  await page.waitForSelector('.kanban-activity-list', { timeout: 3_000 });

  // Activity list should have the timeline border-left
  const activityList = card.locator('.kanban-activity-list');
  const borderLeft = await activityList.evaluate(el =>
    getComputedStyle(el).getPropertyValue('border-left-style')
  );
  expect(borderLeft).toBe('solid');

  // Activity text should have non-empty styling
  const activityText = card.locator('.kanban-activity-text').first();
  const fontSize = await activityText.evaluate(el =>
    getComputedStyle(el).getPropertyValue('font-size')
  );
  expect(fontSize).not.toBe('');
});

test('kanban Fix Search Bug card shows activity from status change', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Fix Search Bug" has 1 regular note and 1 status note
  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();
  await page.waitForSelector('.kanban-activity-item', { timeout: 3_000 });

  // 1 regular note
  const notes = card.locator('.kanban-note');
  expect(await notes.count()).toBe(1);
  await expect(notes.first()).toContainText('Found the regex issue');

  // 1 activity entry
  const activity = card.locator('.kanban-activity-item');
  expect(await activity.count()).toBe(1);
  await expect(activity.first()).toContainText('To Do');
  await expect(activity.first()).toContainText('In Progress');
});
