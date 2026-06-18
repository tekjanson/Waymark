const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils.js');

test('plan toggle button appears in kanban toolbar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await expect(planBtn).toBeVisible();
  expect(await planBtn.textContent()).toContain('📋 Plan');
});

test('clicking plan button enters plan mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  // Should show plan view instead of board
  const planView = page.locator('.kanban-plan-view');
  await expect(planView).toBeVisible();

  // Should show title
  const title = page.locator('.kanban-plan-view-title');
  await expect(title).toContainText('📋 Feature Planning');
});

test('plan mode shows empty state when no plans exist', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  const emptyState = page.locator('.kanban-plan-empty');
  await expect(emptyState).toContainText('No feature plans yet');
});

test('new plan button allows creating a plan', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  page.once('dialog', dialog => {
    dialog.accept('New Feature Plan');
  });

  const newPlanBtn = page.locator('.kanban-new-plan-btn');
  await newPlanBtn.click();

  // Should show the plan card
  const planCard = page.locator('.kanban-plan-card');
  await expect(planCard).toBeVisible();
  await expect(planCard).toContainText('New Feature Plan');
});

test('opening a plan shows detail panel with sections', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  page.once('dialog', dialog => {
    dialog.accept('Test Feature');
  });

  const newPlanBtn = page.locator('.kanban-new-plan-btn');
  await newPlanBtn.click();

  // Open the plan
  const openBtn = page.locator('.kanban-plan-open-btn');
  await openBtn.click();

  // Should show detail panel
  const detailPanel = page.locator('.kanban-plan-detail-panel');
  await expect(detailPanel).toBeVisible();

  // Should show key sections
  await expect(page.locator('text=Key Objectives')).toBeVisible();
  await expect(page.locator('text=Acceptance Criteria')).toBeVisible();
  await expect(page.locator('text=Feature Tasks')).toBeVisible();
});

test('can add objectives to a plan', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  page.once('dialog', dialog => {
    dialog.accept('Test Feature');
  });

  const newPlanBtn = page.locator('.kanban-new-plan-btn');
  await newPlanBtn.click();

  // Open the plan
  const openBtn = page.locator('.kanban-plan-open-btn');
  await openBtn.click();

  // Add an objective
  const objectiveInput = page.locator('.kanban-plan-objective-input');
  await objectiveInput.fill('Improve user experience');
  await objectiveInput.press('Enter');

  // Should show the objective
  await expect(page.locator('.kanban-plan-objective-item')).toContainText('Improve user experience');
});

test('can add acceptance criteria to a plan', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  page.once('dialog', dialog => {
    dialog.accept('Test Feature');
  });

  const newPlanBtn = page.locator('.kanban-new-plan-btn');
  await newPlanBtn.click();

  // Open the plan
  const openBtn = page.locator('.kanban-plan-open-btn');
  await openBtn.click();

  // Add a criterion
  const criteriaInput = page.locator('.kanban-plan-criteria-input');
  await criteriaInput.fill('All users can navigate smoothly');
  await criteriaInput.press('Enter');

  // Should show the criterion
  await expect(page.locator('.kanban-plan-criteria-item')).toContainText('All users can navigate smoothly');
});

test('can toggle criterion completion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  page.once('dialog', dialog => {
    dialog.accept('Test Feature');
  });

  const newPlanBtn = page.locator('.kanban-new-plan-btn');
  await newPlanBtn.click();

  // Open the plan
  const openBtn = page.locator('.kanban-plan-open-btn');
  await openBtn.click();

  // Add a criterion
  const criteriaInput = page.locator('.kanban-plan-criteria-input');
  await criteriaInput.fill('Test criterion');
  await criteriaInput.press('Enter');

  // Toggle the checkbox
  const checkbox = page.locator('.kanban-plan-criteria-checkbox');
  await checkbox.check();

  // Should show as completed
  const criteriaItem = page.locator('.kanban-plan-criteria-item');
  await expect(criteriaItem).toHaveClass(/completed/);
});

test('can mark plan as ready', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  page.once('dialog', dialog => {
    dialog.accept('Test Feature');
  });

  const newPlanBtn = page.locator('.kanban-new-plan-btn');
  await newPlanBtn.click();

  // Open the plan
  const openBtn = page.locator('.kanban-plan-open-btn');
  await openBtn.click();

  // Mark as ready
  const readyBtn = page.locator('.kanban-plan-ready-btn');
  await readyBtn.click();

  // Status should update
  await expect(page.locator('.kanban-plan-status-badge')).toContainText('✓ Ready');

  // Convert button should appear
  const convertBtn = page.locator('.kanban-plan-convert-btn');
  await expect(convertBtn).toBeVisible();
});

test('back button returns to plan list', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');

  const planBtn = page.locator('.kanban-plan-toggle');
  await planBtn.click();

  page.once('dialog', dialog => {
    dialog.accept('Test Feature');
  });

  const newPlanBtn = page.locator('.kanban-new-plan-btn');
  await newPlanBtn.click();

  // Open the plan
  const openBtn = page.locator('.kanban-plan-open-btn');
  await openBtn.click();

  // Click back
  const backBtn = page.locator('.kanban-plan-back-btn');
  await backBtn.click();

  // Should show plan grid again
  const planGrid = page.locator('.kanban-plans-grid');
  await expect(planGrid).toBeVisible();
});
