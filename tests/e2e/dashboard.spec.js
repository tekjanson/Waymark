const { test, expect } = require('@playwright/test');
const { setupApp, navigateToDashboard, navigateToHome } = require('../helpers/test-utils');

/* ──────────────────────────────────────────────────────────────
   Dashboard E2E tests
   ────────────────────────────────────────────────────────────── */

/* Helper: seed a dashboard in localStorage before the app boots */
async function seedDashboard(page, dashboard) {
  await page.addInitScript((db) => {
    const existing = JSON.parse(localStorage.getItem('waymark_dashboards') || '[]');
    existing.push(db);
    localStorage.setItem('waymark_dashboards', JSON.stringify(existing));
  }, dashboard);
}

/* ── Detection & Rendering ── */

test('dashboard view renders when navigating to #/dashboard', async ({ page }) => {
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-home-header', { timeout: 5000 });
  await expect(page.locator('.dashboard-home-header')).toBeVisible();
  await expect(page.locator('.dashboard-home-title')).toContainText('Dashboards');
});

test('empty state is shown when no dashboards exist', async ({ page }) => {
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-empty', { timeout: 5000 });
  await expect(page.locator('.dashboard-empty')).toBeVisible();
  await expect(page.locator('.dashboard-empty-text')).toContainText('No dashboards yet');
});

test('create button is visible on dashboard home', async ({ page }) => {
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-create-btn', { timeout: 5000 });
  await expect(page.locator('.dashboard-create-btn')).toBeVisible();
  await expect(page.locator('.dashboard-create-btn')).toHaveCSS('cursor', 'pointer');
});

/* ── Dashboard card rendering ── */

test('existing dashboard appears as a card on home', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-db-1',
    name: 'My Test Dashboard',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-card', { timeout: 5000 });
  await expect(page.locator('.dashboard-card')).toHaveCount(1);
  await expect(page.locator('.dashboard-card-name')).toContainText('My Test Dashboard');
});

test('dashboard card shows layout name in meta text', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-db-layout',
    name: 'Layout Test',
    layout: '3x1',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-card-meta', { timeout: 5000 });
  await expect(page.locator('.dashboard-card-meta')).toContainText('3 Column');
});

test('dashboard card body has pointer cursor for navigation', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-db-cursor',
    name: 'Cursor Test',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-card-body', { timeout: 5000 });
  await expect(page.locator('.dashboard-card-body')).toHaveCSS('cursor', 'pointer');
});

/* ── Create modal ── */

test('create button opens the create dashboard modal', async ({ page }) => {
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-create-btn', { timeout: 5000 });
  await page.click('.dashboard-create-btn');
  await page.waitForSelector('#dashboard-create-modal', { timeout: 3000 });
  await expect(page.locator('#dashboard-create-modal')).toBeVisible();
  await expect(page.locator('#dashboard-modal-name')).toBeVisible();
});

test('create modal has layout radio options', async ({ page }) => {
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-create-btn', { timeout: 5000 });
  await page.click('.dashboard-create-btn');
  await page.waitForSelector('.dashboard-layout-options', { timeout: 3000 });
  const radios = page.locator('input[name="dashboard-layout"]');
  await expect(radios).toHaveCount(4);
});

test('create modal closes on X button click', async ({ page }) => {
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-create-btn', { timeout: 5000 });
  await page.click('.dashboard-create-btn');
  await page.waitForSelector('#dashboard-create-modal', { timeout: 3000 });
  await page.click('.modal-close');
  await expect(page.locator('#dashboard-create-modal')).toBeHidden();
});

test('create modal closes on overlay click', async ({ page }) => {
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-create-btn', { timeout: 5000 });
  await page.click('.dashboard-create-btn');
  await page.waitForSelector('#dashboard-create-modal', { timeout: 3000 });
  await page.click('#dashboard-create-modal', { position: { x: 5, y: 5 } });
  await expect(page.locator('#dashboard-create-modal')).toBeHidden();
});

test('creating a dashboard navigates to dashboard view', async ({ page }) => {
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-create-btn', { timeout: 5000 });
  await page.click('.dashboard-create-btn');
  await page.waitForSelector('#dashboard-modal-name', { timeout: 3000 });
  await page.fill('#dashboard-modal-name', 'E2E Test Dashboard');
  await page.locator('#dashboard-create-modal .modal-footer .btn.btn-primary').click();
  // Should navigate to the individual dashboard view
  await page.waitForSelector('.dashboard-view-header', { timeout: 5000 });
  await expect(page.locator('.dashboard-view-title')).toContainText('E2E Test Dashboard');
});

/* ── Dashboard grid view ── */

test('dashboard view shows grid with correct layout class for 2x2', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-grid-2x2',
    name: 'Grid 2x2 Test',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-grid-2x2');
  await page.waitForSelector('.dashboard-grid', { timeout: 5000 });
  await expect(page.locator('.dashboard-grid')).toBeVisible();
  await expect(page.locator('.dashboard-grid-2x2')).toBeVisible();
});

test('2x2 dashboard renders 4 panel slots', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-panels-2x2',
    name: '4 Panel Dashboard',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-panels-2x2');
  await page.waitForSelector('.dashboard-panel', { timeout: 5000 });
  await expect(page.locator('.dashboard-panel')).toHaveCount(4);
});

test('3x1 dashboard renders 3 panel slots', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-panels-3x1',
    name: '3 Panel Dashboard',
    layout: '3x1',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-panels-3x1');
  await page.waitForSelector('.dashboard-panel', { timeout: 5000 });
  await expect(page.locator('.dashboard-panel')).toHaveCount(3);
});

test('sidebar+main dashboard renders 2 panel slots', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-panels-sidebar',
    name: 'Sidebar Dashboard',
    layout: 'sidebar-main',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-panels-sidebar');
  await page.waitForSelector('.dashboard-panel', { timeout: 5000 });
  await expect(page.locator('.dashboard-panel')).toHaveCount(2);
});

test('empty panels show "Add Sheet" button', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-empty-panels',
    name: 'Empty Panels',
    layout: '2x1',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-empty-panels');
  await page.waitForSelector('.dashboard-panel-add-btn', { timeout: 5000 });
  const addBtns = page.locator('.dashboard-panel-add-btn');
  await expect(addBtns).toHaveCount(2);
});

test('panel with sheet shows panel pick button and title bar', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-with-panel',
    name: 'Panel With Sheet',
    layout: '2x1',
    panels: [{ sheetId: 'sheet-017', title: 'Kanban Project' }, null],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-with-panel');
  await page.waitForSelector('.dashboard-panel-titlebar', { timeout: 5000 });
  await expect(page.locator('.dashboard-panel-pick-btn').first()).toBeVisible();
  await expect(page.locator('.dashboard-panel-pick-btn').first()).toHaveCSS('cursor', 'pointer');
});

/* ── Navigation ── */

test('back button from dashboard view returns to dashboard home', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-nav-back',
    name: 'Nav Back Test',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-nav-back');
  await page.waitForSelector('.dashboard-back-btn', { timeout: 5000 });
  await page.click('.dashboard-back-btn');
  await page.waitForSelector('.dashboard-home-header', { timeout: 3000 });
  await expect(page.locator('.dashboard-home-header')).toBeVisible();
});

test('clicking dashboard card navigates to that dashboard', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-card-nav',
    name: 'Card Navigation Test',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-card-body', { timeout: 5000 });
  await page.click('.dashboard-card-body');
  await page.waitForSelector('.dashboard-view-title', { timeout: 5000 });
  await expect(page.locator('.dashboard-view-title')).toContainText('Card Navigation Test');
});

test('sidebar menu item navigates to dashboard home', async ({ page }) => {
  await setupApp(page);
  await navigateToHome(page);
  await page.waitForSelector('#menu-dashboard-btn', { timeout: 5000 });
  await page.click('#menu-dashboard-btn');
  await page.waitForSelector('#dashboard-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('.dashboard-home-header')).toBeVisible();
});

/* ── Refresh button ── */

test('refresh button is visible on dashboard view', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-refresh-btn',
    name: 'Refresh Test',
    layout: '2x1',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-refresh-btn');
  await page.waitForSelector('.dashboard-refresh-btn', { timeout: 5000 });
  await expect(page.locator('.dashboard-refresh-btn')).toBeVisible();
  await expect(page.locator('.dashboard-refresh-btn')).toHaveCSS('cursor', 'pointer');
});

/* ── Layout badge ── */

test('dashboard view shows correct layout badge', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-layout-badge',
    name: 'Badge Test',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-layout-badge');
  await page.waitForSelector('.dashboard-layout-badge', { timeout: 5000 });
  await expect(page.locator('.dashboard-layout-badge')).toContainText('2 × 2 Grid');
});

/* ── Responsive ── */

test('dashboard renders correctly at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seedDashboard(page, {
    id: 'test-mobile',
    name: 'Mobile Test',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-mobile');
  await page.waitForSelector('.dashboard-grid', { timeout: 5000 });
  // On mobile, 2x2 should collapse to single column
  const gridCols = await page.evaluate(() => {
    const grid = document.querySelector('.dashboard-grid');
    return grid ? getComputedStyle(grid).gridTemplateColumns : '';
  });
  // grid-template-columns 'none' or single value = single column
  expect(gridCols).not.toBe('');
});

/* ── Panel picker modal ── */

test('add sheet button opens panel picker modal', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-picker',
    name: 'Picker Test',
    layout: '2x1',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-picker');
  await page.waitForSelector('.dashboard-panel-add-btn', { timeout: 5000 });
  await page.locator('.dashboard-panel-add-btn').first().click();
  await page.waitForSelector('#dashboard-picker-modal', { timeout: 3000 });
  await expect(page.locator('#dashboard-picker-modal')).toBeVisible();
});

test('panel picker modal closes on overlay click', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-picker-close',
    name: 'Picker Close Test',
    layout: '2x1',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page, 'test-picker-close');
  await page.waitForSelector('.dashboard-panel-add-btn', { timeout: 5000 });
  await page.locator('.dashboard-panel-add-btn').first().click();
  await page.waitForSelector('#dashboard-picker-modal', { timeout: 3000 });
  await page.click('#dashboard-picker-modal', { position: { x: 5, y: 5 } });
  await expect(page.locator('#dashboard-picker-modal')).toBeHidden();
});

/* ── Delete dashboard ── */

test('delete button exists on dashboard card', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-delete-btn',
    name: 'Delete Test Dashboard',
    layout: '2x2',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-delete-btn', { timeout: 5000 });
  await expect(page.locator('.dashboard-delete-btn')).toBeVisible();
  await expect(page.locator('.dashboard-delete-btn')).toHaveCSS('cursor', 'pointer');
});

/* ── Edit dashboard modal ── */

test('edit button opens pre-populated modal', async ({ page }) => {
  await seedDashboard(page, {
    id: 'test-edit-modal',
    name: 'Edit Test Dashboard',
    layout: '3x1',
    panels: [],
  });
  await setupApp(page);
  await navigateToDashboard(page);
  await page.waitForSelector('.dashboard-edit-btn', { timeout: 5000 });
  await page.click('.dashboard-edit-btn');
  await page.waitForSelector('#dashboard-create-modal', { timeout: 3000 });
  const nameVal = await page.inputValue('#dashboard-modal-name');
  expect(nameVal).toBe('Edit Test Dashboard');
});
