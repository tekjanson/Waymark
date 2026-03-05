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
  expect(await lanes.count()).toBe(4); // Backlog, To Do, In Progress, Done

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

  // Initially 4 lanes (no archived lane visible)
  expect(await page.locator('.kanban-lane').count()).toBe(4);

  // Toggle "Show Archived"
  await page.locator('.kanban-archive-checkbox').check();

  // Now 5 lanes
  expect(await page.locator('.kanban-lane').count()).toBe(5);

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
  expect(await counts.count()).toBe(4); // 4 lanes visible by default
});
