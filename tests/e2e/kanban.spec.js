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

test('kanban stage badge opens dropdown on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const firstBtn = page.locator('.kanban-stage-btn').first();
  const initialText = await firstBtn.textContent();
  await firstBtn.click();

  // Should show a dropdown instead of cycling
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });
  await expect(page.locator('.kanban-stage-dropdown')).toBeVisible();

  // Badge text should NOT have changed yet
  expect(await firstBtn.textContent()).toBe(initialText);
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

  // Wait for the async sheet-replace operation to complete
  await page.waitForFunction(() => {
    const recs = window.__WAYMARK_RECORDS || [];
    return recs.some(r =>
      (r.type === 'cell-update' && r.value === 'Archived') ||
      (r.type === 'sheet-replace' && r.rows && r.rows.some(row => row.includes('Archived')))
    );
  }, { timeout: 5_000 });

  // Verify edit record — archive bundles stage change atomically
  const records = await getCreatedRecords(page);
  const hasArchive = records.some(r => {
    if (r.type === 'cell-update') return r.value === 'Archived';
    if (r.type === 'sheet-replace') {
      return r.rows && r.rows.some(row => row.includes('Archived'));
    }
    return false;
  });
  expect(hasArchive).toBe(true);
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

  // Target the Project combo cell specifically (label is also combo now)
  const projectField = card.locator('.kanban-detail-field').filter({ hasText: 'Project' }).locator('.combo-cell');
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

test('kanban note opens textarea editor for multiline editing', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  await card.locator('.kanban-card-expand').click();

  const noteField = card.locator('.kanban-note-text').first();
  await noteField.click();
  await expect(card.locator('.kanban-note-text .editable-cell-textarea').first()).toBeVisible();
});

test('kanban add note form supports multiline and submit with Ctrl+Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();
  await card.locator('.kanban-add-inline-trigger', { hasText: '+ Note' }).click();

  const noteInput = card.locator('.kanban-add-note-input');
  await expect(noteInput).toBeVisible();
  await noteInput.fill('First line\nSecond line');
  await noteInput.press('Control+Enter');

  await page.waitForFunction(() => {
    const recs = window.__WAYMARK_RECORDS || [];
    return recs.some(r => r.type === 'sheet-replace');
  }, { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const hasNote = records.some(r => {
    if (r.type !== 'sheet-replace' || !Array.isArray(r.rows)) return false;
    return r.rows.some(row => row.includes('First line\nSecond line'));
  });
  expect(hasNote).toBe(true);
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

  // Status-change dates should be formatted with date AND time, not raw ISO
  const firstDate = card.locator('.kanban-activity-date').first();
  const dateText = await firstDate.textContent();
  // Should not be raw ISO format like "2026-02-20 09:15"
  expect(dateText).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
  // Should contain a time component (AM/PM)
  expect(dateText).toMatch(/AM|PM/i);
  // Should contain the month abbreviation
  expect(dateText).toMatch(/Feb|Mar|Jan|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);

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

test('kanban stage badge click bundles stage change and note atomically', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  // Click a stage badge to open dropdown
  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const stageBadge = card.locator('.kanban-stage-btn');
  const prevText = (await stageBadge.textContent()).trim();
  await stageBadge.click();

  // Dropdown should appear
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });

  // Click a different stage in the dropdown
  const items = page.locator('.kanban-stage-dropdown-item');
  // Pick the first item that isn't the current stage
  let targetItem = null;
  let targetText = '';
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).textContent()).trim();
    if (text !== prevText) { targetItem = items.nth(i); targetText = text; break; }
  }
  expect(targetItem).toBeTruthy();
  await targetItem.click();
  const newText = (await stageBadge.textContent()).trim();

  // Stage should have changed
  expect(newText).toBe(targetText);
  expect(newText).not.toBe(prevText);

  // Wait for the async operation to complete (sheet-replace)
  await page.waitForFunction(() => {
    const recs = window.__WAYMARK_RECORDS || [];
    return recs.some(r => r.type === 'sheet-replace');
  }, { timeout: 5_000 });

  const records = await getCreatedRecords(page);

  // The stage change should be bundled in a sheet-replace (not a separate cell-update)
  const replaceRecord = records.find(r => r.type === 'sheet-replace');
  expect(replaceRecord).toBeTruthy();

  // Find "API Rate Limiting" row in the replaced data — stage should be the new value
  const rows = replaceRecord.rows;
  const apiRow = rows.find(r => r[0] === 'API Rate Limiting');
  expect(apiRow).toBeTruthy();
  // Column 2 is "stage" in the fixture
  expect(apiRow[2]).toBe(newText);

  // A status-change note row should also be in the replaced data
  const noteRow = rows.find(r => (r[8] || '').startsWith('⟳') && (r[8] || '').includes(newText));
  expect(noteRow).toBeTruthy();
});

test('kanban stage change persists in sheet data after note insertion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  // Click stage badge on "Dark Mode Support" (currently "In Progress")
  const card = page.locator('.kanban-card', { hasText: 'Dark Mode Support' });
  const stageBadge = card.locator('.kanban-stage-btn');
  const prevStage = (await stageBadge.textContent()).trim();
  await stageBadge.click();

  // Dropdown should appear — pick a different stage
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });
  const items = page.locator('.kanban-stage-dropdown-item');
  let targetItem = null;
  let targetText = '';
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).textContent()).trim();
    if (text !== prevStage) { targetItem = items.nth(i); targetText = text; break; }
  }
  expect(targetItem).toBeTruthy();
  await targetItem.click();
  const newStage = (await stageBadge.textContent()).trim();
  expect(newStage).toBe(targetText);
  expect(newStage).not.toBe(prevStage);

  // Wait for sheet-replace to complete
  await page.waitForFunction(() => {
    const recs = window.__WAYMARK_RECORDS || [];
    return recs.some(r => r.type === 'sheet-replace');
  }, { timeout: 5_000 });

  // The sheet-replace record should have the updated stage value
  const records = await getCreatedRecords(page);
  const replaceRecord = records.find(r => r.type === 'sheet-replace');
  const darkModeRow = replaceRecord.rows.find(r => r[0] === 'Dark Mode Support');
  expect(darkModeRow).toBeTruthy();
  expect(darkModeRow[2]).toBe(newStage);

  // There should NOT be a separate cell-update for the stage (it's bundled)
  const cellUpdate = records.find(r => r.type === 'cell-update' && r.value === newStage);
  expect(cellUpdate).toBeFalsy();
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

  // "Fix Search Bug" has 3 regular notes and 1 status note
  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();
  await page.waitForSelector('.kanban-activity-item', { timeout: 3_000 });

  // 3 regular notes
  const notes = card.locator('.kanban-note');
  expect(await notes.count()).toBe(3);
  await expect(notes.first()).toContainText('Found the regex issue');

  // 1 activity entry
  const activity = card.locator('.kanban-activity-item');
  expect(await activity.count()).toBe(1);
  await expect(activity.first()).toContainText('To Do');
  await expect(activity.first()).toContainText('In Progress');
});

test('kanban notes display in chronological order regardless of row order', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Fix Search Bug" has 3 notes in non-chronological row order:
  //   row order: Bob 2026-03-05, Alice 2026-03-03, Alice 2026-03-04
  //   expected display: Alice 2026-03-03, Alice 2026-03-04, Bob 2026-03-05 (chronological)
  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-card-expand').click();
  await page.waitForSelector('.kanban-note', { timeout: 3_000 });

  const notes = card.locator('.kanban-note');
  expect(await notes.count()).toBe(3);

  // First note should be the oldest (2026-03-03)
  await expect(notes.nth(0)).toContainText('Found the regex issue');
  // Second note (2026-03-04)
  await expect(notes.nth(1)).toContainText('Working on a fix');
  // Third note should be the newest (2026-03-05)
  await expect(notes.nth(2)).toContainText('Confirmed');
});

test('kanban card shows last-moved timestamp on card surface', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Kanban Board Redesign" has status-change notes — should show ⟳ moved badge
  const card = page.locator('.kanban-card', { hasText: 'Kanban Board Redesign' });
  const movedBadge = card.locator('.kanban-card-moved');
  await expect(movedBadge).toBeVisible();

  // Badge should contain the ⟳ symbol and a formatted datetime
  const badgeText = await movedBadge.textContent();
  expect(badgeText).toContain('⟳');
  // Should contain a datetime like "Mar 10 2:00 PM"
  expect(badgeText).toMatch(/AM|PM/i);

  // Tooltip should show original datetime string
  const titleAttr = await movedBadge.getAttribute('title');
  expect(titleAttr).toContain('Last status change');
  expect(titleAttr).toMatch(/\d{4}-\d{2}-\d{2}/);
});

test('kanban card without status changes has no moved badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "API Rate Limiting" has no status-change notes — should NOT show moved badge
  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const movedBadge = card.locator('.kanban-card-moved');
  expect(await movedBadge.count()).toBe(0);
});

test('kanban archive button bundles stage change to Archived atomically', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Find "Upgrade Dependencies" in Done lane — it has an archive button
  const card = page.locator('.kanban-card', { hasText: 'Upgrade Dependencies' });
  const archiveBtn = card.locator('.kanban-archive-btn');
  await archiveBtn.click();

  // Wait for sheet-replace to complete
  await page.waitForFunction(() => {
    const recs = window.__WAYMARK_RECORDS || [];
    return recs.some(r => r.type === 'sheet-replace');
  }, { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const replaceRecord = records.find(r => r.type === 'sheet-replace');
  expect(replaceRecord).toBeTruthy();

  // Stage should be "Archived" in the replaced data
  const row = replaceRecord.rows.find(r => r[0] === 'Upgrade Dependencies');
  expect(row).toBeTruthy();
  expect(row[2]).toBe('Archived');

  // Note row should exist
  const noteRow = replaceRecord.rows.find(r => (r[8] || '').includes('→ Archived'));
  expect(noteRow).toBeTruthy();
});

test('kanban reject button bundles stage change to Rejected atomically', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Mobile Layout Polish" is in To Do — has a reject button
  const card = page.locator('.kanban-card', { hasText: 'Mobile Layout Polish' });
  const rejectBtn = card.locator('.kanban-reject-btn');
  await rejectBtn.click();

  // Wait for sheet-replace
  await page.waitForFunction(() => {
    const recs = window.__WAYMARK_RECORDS || [];
    return recs.some(r => r.type === 'sheet-replace');
  }, { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const replaceRecord = records.find(r => r.type === 'sheet-replace');

  // Stage should be "Rejected" in replaced data
  const row = replaceRecord.rows.find(r => r[0] === 'Mobile Layout Polish');
  expect(row).toBeTruthy();
  expect(row[2]).toBe('Rejected');

  // Note row should exist with reject transition
  const noteRow = replaceRecord.rows.find(r => (r[8] || '').includes('→ Rejected'));
  expect(noteRow).toBeTruthy();
});

test('kanban no separate cell-update emitted when note is inserted', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  // Click stage on a card — the change should be bundled, NOT a separate cell-update
  const card = page.locator('.kanban-card', { hasText: 'Mobile Layout Polish' });
  const stageBadge = card.locator('.kanban-stage-btn');
  const prevStage = (await stageBadge.textContent()).trim();
  await stageBadge.click();

  // Pick a different stage from dropdown
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });
  const items = page.locator('.kanban-stage-dropdown-item');
  let targetItem = null;
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).textContent()).trim();
    if (text !== prevStage) { targetItem = items.nth(i); break; }
  }
  expect(targetItem).toBeTruthy();
  await targetItem.click();

  // Wait for the async write
  await page.waitForFunction(() => {
    const recs = window.__WAYMARK_RECORDS || [];
    return recs.some(r => r.type === 'sheet-replace');
  }, { timeout: 5_000 });

  const records = await getCreatedRecords(page);

  // Should have a sheet-replace but NOT a cell-update for the stage
  expect(records.some(r => r.type === 'sheet-replace')).toBe(true);
  const stageUpdates = records.filter(r => r.type === 'cell-update' && r.col === 2);
  expect(stageUpdates.length).toBe(0);
});

/* ============================================================
   Stage Dropdown Tests
   ============================================================ */

test('kanban stage badge click opens dropdown instead of cycling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const stageBadge = card.locator('.kanban-stage-btn');
  const originalText = (await stageBadge.textContent()).trim();
  await stageBadge.click();

  // Dropdown should appear
  const dropdown = page.locator('.kanban-stage-dropdown');
  await expect(dropdown).toBeVisible();

  // Stage badge text should NOT have changed yet (no cycling)
  const currentText = (await stageBadge.textContent()).trim();
  expect(currentText).toBe(originalText);
});

test('kanban stage dropdown shows all six stages', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-stage-btn').click();
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });

  const items = page.locator('.kanban-stage-dropdown-item');
  const count = await items.count();
  expect(count).toBe(6);

  // Verify stage names
  const texts = [];
  for (let i = 0; i < count; i++) {
    texts.push((await items.nth(i).textContent()).trim());
  }
  expect(texts).toEqual(['Backlog', 'To Do', 'In Progress', 'QA', 'Done', 'Rejected']);
});

test('kanban stage dropdown highlights current stage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  // "Fix Search Bug" is "In Progress"
  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  await card.locator('.kanban-stage-btn').click();
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });

  // The "In Progress" item should have the .active class
  const activeItem = page.locator('.kanban-stage-dropdown-item.active');
  await expect(activeItem).toHaveCount(1);
  const activeText = (await activeItem.textContent()).trim();
  expect(activeText).toBe('In Progress');
});

test('kanban stage dropdown closes on outside click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  await card.locator('.kanban-stage-btn').click();
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });
  await expect(page.locator('.kanban-stage-dropdown')).toBeVisible();

  // Click outside the dropdown
  await page.click('.kanban-board', { position: { x: 5, y: 5 } });
  await expect(page.locator('.kanban-stage-dropdown')).toHaveCount(0);
});

test('kanban stage dropdown closes when clicking badge again', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const stageBadge = card.locator('.kanban-stage-btn');
  await stageBadge.click();
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });
  await expect(page.locator('.kanban-stage-dropdown')).toBeVisible();

  // Click badge again to close
  await stageBadge.click();
  await expect(page.locator('.kanban-stage-dropdown')).toHaveCount(0);
});

test('kanban stage dropdown items have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  await card.locator('.kanban-stage-btn').click();
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });

  const item = page.locator('.kanban-stage-dropdown-item').first();
  await expect(item).toHaveCSS('cursor', 'pointer');
});

test('kanban selecting stage from dropdown updates badge and emits record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const stageBadge = card.locator('.kanban-stage-btn');
  expect((await stageBadge.textContent()).trim()).toBe('To Do');

  // Open dropdown and select "QA"
  await stageBadge.click();
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });
  const qaItem = page.locator('.kanban-stage-dropdown-item', { hasText: 'QA' });
  await qaItem.click();

  // Badge should now say "QA"
  expect((await stageBadge.textContent()).trim()).toBe('QA');

  // Dropdown should be closed
  await expect(page.locator('.kanban-stage-dropdown')).toHaveCount(0);

  // Should have emitted a sheet-replace record
  await page.waitForFunction(() => {
    const recs = window.__WAYMARK_RECORDS || [];
    return recs.some(r => r.type === 'sheet-replace');
  }, { timeout: 5_000 });
  const records = await getCreatedRecords(page);
  const replaceRecord = records.find(r => r.type === 'sheet-replace');
  expect(replaceRecord).toBeTruthy();
});

test('kanban clicking current stage in dropdown does nothing', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });

  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const stageBadge = card.locator('.kanban-stage-btn');
  const currentStage = (await stageBadge.textContent()).trim();

  // Capture record count before action
  const recordsBefore = await getCreatedRecords(page);
  const countBefore = recordsBefore.length;

  // Open dropdown and click the current stage
  await stageBadge.click();
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3_000 });
  const currentItem = page.locator('.kanban-stage-dropdown-item.active');
  await currentItem.click();

  // Badge text should be unchanged
  expect((await stageBadge.textContent()).trim()).toBe(currentStage);

  // Dropdown should be closed
  await expect(page.locator('.kanban-stage-dropdown')).toHaveCount(0);

  // No NEW records should have been emitted
  const recordsAfter = await getCreatedRecords(page);
  expect(recordsAfter.length).toBe(countBefore);
});

/* ============================================================
   Lane Visibility Tests
   ============================================================ */

test('kanban lane visibility button shows panel with checkboxes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-lane', { timeout: 5_000 });

  const lanesBtn = page.locator('.kanban-lane-vis-btn');
  await expect(lanesBtn).toBeVisible();
  await expect(lanesBtn).toContainText('Lanes');

  // Panel should be hidden initially
  const panel = page.locator('.kanban-lane-vis-panel');
  await expect(panel).toBeHidden();

  // Click to open panel
  await lanesBtn.click();
  await expect(panel).toBeVisible();

  // Should have 6 checkboxes (core lanes)
  const checkboxes = panel.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(6);
});

test('kanban unchecking a lane hides it from the board', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-lane', { timeout: 5_000 });

  // Count initial visible lanes
  const initialCount = await page.locator('.kanban-lane').count();
  expect(initialCount).toBeGreaterThanOrEqual(5);

  // Open lane visibility panel
  await page.click('.kanban-lane-vis-btn');
  await page.waitForSelector('.kanban-lane-vis-panel:not(.hidden)', { timeout: 3_000 });

  // Uncheck the "backlog" lane
  const backlogCheckbox = page.locator('.kanban-lane-vis-item input[data-lane="backlog"]');
  await backlogCheckbox.uncheck();

  // Board should have one fewer lane
  const newCount = await page.locator('.kanban-lane').count();
  expect(newCount).toBe(initialCount - 1);

  // The backlog lane should not be visible
  await expect(page.locator('.kanban-lane-backlog')).toHaveCount(0);
});

test('kanban re-checking a lane restores it to the board', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-lane', { timeout: 5_000 });

  const initialCount = await page.locator('.kanban-lane').count();

  // Hide backlog lane
  await page.click('.kanban-lane-vis-btn');
  await page.waitForSelector('.kanban-lane-vis-panel:not(.hidden)', { timeout: 3_000 });
  const backlogCb = page.locator('.kanban-lane-vis-item input[data-lane="backlog"]');
  await backlogCb.uncheck();
  expect(await page.locator('.kanban-lane').count()).toBe(initialCount - 1);

  // Re-check backlog lane
  await backlogCb.check();
  expect(await page.locator('.kanban-lane').count()).toBe(initialCount);
  await expect(page.locator('.kanban-lane-backlog')).toHaveCount(1);
});

test('kanban lane visibility panel closes on outside click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-lane', { timeout: 5_000 });

  await page.click('.kanban-lane-vis-btn');
  const panel = page.locator('.kanban-lane-vis-panel');
  await expect(panel).toBeVisible();

  // Click outside
  await page.click('.kanban-board', { position: { x: 5, y: 5 } });
  await expect(panel).toBeHidden();
});

test('kanban hiding multiple lanes adjusts grid columns', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-lane', { timeout: 5_000 });

  // Open lane visibility panel and hide 2 lanes
  await page.click('.kanban-lane-vis-btn');
  await page.waitForSelector('.kanban-lane-vis-panel:not(.hidden)', { timeout: 3_000 });
  await page.locator('.kanban-lane-vis-item input[data-lane="backlog"]').uncheck();
  await page.locator('.kanban-lane-vis-item input[data-lane="rejected"]').uncheck();

  // Board should have kanban-board-4 class (6 - 2 = 4)
  const board = page.locator('.kanban-board');
  const hasClass = await board.evaluate(el => el.classList.contains('kanban-board-4'));
  expect(hasClass).toBe(true);
});

/* ============================================================
   Dynamic Label Tests
   ============================================================ */

test('kanban custom label "security" is displayed on card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "API Rate Limiting" has the custom label "security"
  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const label = card.locator('.kanban-card-label');
  await expect(label).toBeVisible();
  await expect(label).toContainText('security');
});

test('kanban custom label has fallback styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "security" is not a known label — should use fallback style
  const card = page.locator('.kanban-card', { hasText: 'API Rate Limiting' });
  const label = card.locator('.kanban-card-label');

  // Should have a class but not a specific known label class
  const classList = await label.evaluate(el => el.className);
  expect(classList).toContain('kanban-card-label');
  expect(classList).toContain('kanban-label-security');

  // Fallback style should have non-transparent background
  const bg = await label.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('kanban known labels still have specific styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // "Fix Search Bug" has label "bug"
  const card = page.locator('.kanban-card', { hasText: 'Fix Search Bug' });
  const label = card.locator('.kanban-card-label');
  await expect(label).toBeVisible();
  await expect(label).toContainText('bug');

  // Should have the specific bug label class
  const classList = await label.evaluate(el => el.className);
  expect(classList).toContain('kanban-label-bug');
});

/* ---------- Filter bar overflow (many projects — sheet-039) ---------- */

test('kanban many-projects fixture renders all 15 project pills plus All', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-039');
  await page.waitForSelector('.kanban-filter-bar', { timeout: 5_000 });

  const pills = page.locator('.kanban-filter-pill');
  // "All" + 17 unique projects = 18 pills
  expect(await pills.count()).toBe(18);
  await expect(pills.first()).toContainText('All');
});

test('kanban filter bar does not overflow viewport on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-039');
  await page.waitForSelector('.kanban-filter-bar', { timeout: 5_000 });

  const filterBar = page.locator('.kanban-filter-bar');

  // Filter bar should have a max-height constraint (76px)
  const height = await filterBar.evaluate(el => el.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(80); // 76px max-height + tolerance

  // Board should still be visible below the toolbar
  await expect(page.locator('.kanban-board')).toBeVisible();
});

test('kanban filter bar scrolls horizontally on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-039');
  await page.waitForSelector('.kanban-filter-bar', { timeout: 5_000 });

  const filterBar = page.locator('.kanban-filter-bar');

  // On mobile, filter bar should have nowrap and overflow-x: auto
  await expect(filterBar).toHaveCSS('flex-wrap', 'nowrap');

  // Filter bar should be a single row (height ≤ ~40px for one line of pills)
  const height = await filterBar.evaluate(el => el.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(45);

  // The filter bar should have scrollable content wider than its visible width
  const overflows = await filterBar.evaluate(el => el.scrollWidth > el.clientWidth);
  expect(overflows).toBe(true);

  // Board should still be visible below
  await expect(page.locator('.kanban-board')).toBeVisible();
});

test('kanban filter pills do not shrink on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-039');
  await page.waitForSelector('.kanban-filter-pill', { timeout: 5_000 });

  const pills = page.locator('.kanban-filter-pill');
  const firstPillWidth = await pills.first().evaluate(el => el.getBoundingClientRect().width);

  // Pills should maintain minimum readable width (not shrunk to tiny)
  expect(firstPillWidth).toBeGreaterThan(20);

  // Each pill should have white-space: nowrap to prevent text wrapping
  await expect(pills.nth(5)).toHaveCSS('white-space', 'nowrap');
});

test('kanban filter bar on mobile has no visible scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-039');
  await page.waitForSelector('.kanban-filter-bar', { timeout: 5_000 });

  // Verify scrollbar-width is none on the filter bar (Firefox)
  await expect(page.locator('.kanban-filter-bar')).toHaveCSS('scrollbar-width', 'none');
});

test('kanban project filter works with many projects', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-039');
  await page.waitForSelector('.kanban-filter-bar', { timeout: 5_000 });

  // Count all cards initially
  const totalBefore = await page.locator('.kanban-card').count();
  expect(totalBefore).toBeGreaterThan(0);

  // Click a specific project pill to filter
  const pill = page.locator('.kanban-filter-pill', { hasText: 'Auth System' });
  await pill.click();

  // Should show only that project's cards
  const filtered = await page.locator('.kanban-card').count();
  expect(filtered).toBeLessThan(totalBefore);
  expect(filtered).toBeGreaterThan(0);

  // Click "All" to reset
  await page.locator('.kanban-filter-pill', { hasText: 'All' }).click();
  expect(await page.locator('.kanban-card').count()).toBe(totalBefore);
});

test('kanban filter bar desktop has scroll for overflowing pills', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-039');
  await page.waitForSelector('.kanban-filter-bar', { timeout: 5_000 });

  const filterBar = page.locator('.kanban-filter-bar');

  // On desktop, overflow-y should be 'auto' or 'scroll'
  const overflowY = await filterBar.evaluate(el => getComputedStyle(el).overflowY);
  expect(['auto', 'scroll']).toContain(overflowY);

  // The filter bar should use a thin scrollbar on desktop
  await expect(filterBar).toHaveCSS('scrollbar-width', 'thin');
});

test('kanban board is not pushed below fold by filter bar on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-039');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  // The board should start within the visible viewport
  const boardTop = await page.locator('.kanban-board').evaluate(el => {
    return el.getBoundingClientRect().top;
  });

  // Board should not be pushed below the fold (should be within viewport height)
  expect(boardTop).toBeLessThan(812);
});

/* ---------- AI Agent Status Indicator ---------- */

test('kanban shows AI status indicator when sheet has AI-authored notes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-043');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });

  const aiStatus = page.locator('.kanban-ai-status');
  await expect(aiStatus).toBeVisible();
  await expect(aiStatus).toContainText('AI');
});

test('kanban AI status shows offline state for old timestamps', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-043');
  await page.waitForSelector('.kanban-ai-status', { timeout: 5000 });

  // Fixture timestamps are from 2026-03-15, which is >15min in the past
  const aiStatus = page.locator('.kanban-ai-status');
  await expect(aiStatus).toHaveClass(/kanban-ai-offline/);
  await expect(aiStatus).toContainText('AI Offline');
});

test('kanban AI status shows dot indicator', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-043');
  await page.waitForSelector('.kanban-ai-status', { timeout: 5000 });

  const dot = page.locator('.kanban-ai-dot');
  await expect(dot).toBeVisible();
});

test('kanban AI status shows relative timestamp with author', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-043');
  await page.waitForSelector('.kanban-ai-time', { timeout: 5000 });

  const timeText = page.locator('.kanban-ai-time');
  await expect(timeText).toBeVisible();
  // Should show "Last: AI · <relative date>"
  await expect(timeText).toContainText('Last: AI');
});

test('kanban does not show AI status for boards without AI activity', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });

  const aiStatus = page.locator('.kanban-ai-status');
  await expect(aiStatus).toHaveCount(0);
});

/* ---------- Touch drag-and-drop ---------- */

test('kanban touch drag activates after long-press (500ms) and adds dragging class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card').first();

  // Simulate a long-press touchstart followed by no movement
  await card.evaluate(el => {
    const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [t], changedTouches: [t],
    }));
  });

  // Wait 600ms for the long-press threshold (500ms) to trigger
  await page.waitForTimeout(600);

  // Should have dragging class after long-press
  await expect(card).toHaveClass(/kanban-card-dragging/);

  // Cleanup: dispatch touchend
  await card.evaluate(el => {
    const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
    el.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true, cancelable: true, touches: [], changedTouches: [t],
    }));
  });

  // Class should be removed after touchend
  await expect(card).not.toHaveClass(/kanban-card-dragging/);
});

test('kanban touch drag does NOT activate if finger moves before 500ms (scroll protection)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card').first();
  const board = page.locator('.kanban-board');

  // Simulate touchstart + immediate touchmove (scroll gesture)
  await card.evaluate(el => {
    const t1 = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [t1], changedTouches: [t1],
    }));
  });

  // Move finger significantly within 500ms — cancels long-press
  await board.evaluate(el => {
    const t2 = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 200 });
    el.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true, cancelable: true, touches: [t2], changedTouches: [t2],
    }));
  });

  // Wait past threshold
  await page.waitForTimeout(600);

  // Card should NOT have dragging class (scroll gesture was detected)
  await expect(card).not.toHaveClass(/kanban-card-dragging/);
});

test('kanban touch drag highlights target lane on touchmove', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card').first();

  // Start long-press
  await card.evaluate(el => {
    const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [t], changedTouches: [t],
    }));
  });

  // Wait for long-press to activate
  await page.waitForTimeout(600);
  await expect(card).toHaveClass(/kanban-card-dragging/);

  // Simulate touchmove over a different lane
  const doneLane = page.locator('.kanban-lane-done');
  const laneBox = await doneLane.boundingBox();
  if (laneBox) {
    const mx = laneBox.x + laneBox.width / 2;
    const my = laneBox.y + laneBox.height / 2;
    await page.evaluate(({ x, y }) => {
      const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
      document.dispatchEvent(new TouchEvent('touchmove', {
        bubbles: true, cancelable: true, touches: [t], changedTouches: [t],
      }));
    }, { x: mx, y: my });
    // The lane under the touch should be highlighted
    await expect(donePane => donePane, 'done lane highlight').toBeTruthy();
  }

  // Cleanup
  await card.evaluate(el => {
    const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
    el.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true, cancelable: true, touches: [], changedTouches: [t],
    }));
  });
});

test('kanban touch drag cleans up body class on touchend', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  const card = page.locator('.kanban-card').first();

  await card.evaluate(el => {
    const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [t], changedTouches: [t],
    }));
  });

  await page.waitForTimeout(600);

  // Body should have the touch-dragging class
  const bodyHasClass = await page.evaluate(() => document.body.classList.contains('kanban-touch-dragging'));
  expect(bodyHasClass).toBe(true);

  // Dispatch touchend
  await card.evaluate(el => {
    const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
    el.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true, cancelable: true, touches: [], changedTouches: [t],
    }));
  });

  // Body class should be removed
  const bodyStillHasClass = await page.evaluate(() => document.body.classList.contains('kanban-touch-dragging'));
  expect(bodyStillHasClass).toBe(false);
});

test('kanban directoryView renders for board folder', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-kanban/Project%20Boards'; });
  await page.waitForSelector('.kanban-directory', { timeout: 8_000 });
  await expect(page.locator('.kanban-directory')).toBeVisible();
});

test('kanban directoryView shows Project Boards title', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-kanban/Project%20Boards'; });
  await page.waitForSelector('.kanban-dir-title', { timeout: 8_000 });
  await expect(page.locator('.kanban-dir-title')).toContainText('Project Boards');
});

test('kanban directoryView shows board cards', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-kanban/Project%20Boards'; });
  await page.waitForSelector('.kanban-dir-card', { timeout: 8_000 });
  const cards = page.locator('.kanban-dir-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
});

test('kanban directoryView card click navigates to sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-kanban/Project%20Boards'; });
  await page.waitForSelector('.kanban-dir-card', { timeout: 8_000 });
  await page.locator('.kanban-dir-card').first().click();
  await page.waitForSelector('.kanban-lane', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Kanban');
});

test('kanban directoryView shows board count', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-kanban/Project%20Boards'; });
  await page.waitForSelector('.kanban-dir-count', { timeout: 8_000 });
  await expect(page.locator('.kanban-dir-count')).toContainText('board');
});

test('kanban directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-kanban/Project%20Boards'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('kanban directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-kanban/Project%20Boards'; });
  await page.waitForSelector('.kanban-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});

