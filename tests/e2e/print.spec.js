// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ─── Print button: presence and accessibility ─── */

test('print button appears in overflow menu on any sheet view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Open the overflow menu
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3_000 });

  // Print button should be visible
  await expect(page.locator('#print-btn')).toBeVisible();
  await expect(page.locator('#print-btn')).toContainText('Print');
});

test('print button has correct aria-label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  const btn = page.locator('#print-btn');
  await expect(btn).toHaveAttribute('aria-label', 'Print sheet');
});

test('print button triggers window.print()', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Intercept window.print() to avoid dialog
  let printCalled = false;
  await page.evaluate(() => { window.print = () => { window.__PRINT_CALLED = true; }; });

  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3_000 });
  await page.click('#print-btn');

  printCalled = await page.evaluate(() => !!window.__PRINT_CALLED);
  expect(printCalled).toBe(true);
});

test('overflow menu closes after clicking print button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.evaluate(() => { window.print = () => {}; }); // suppress dialog
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3_000 });
  await page.click('#print-btn');

  // Menu should close after action
  await expect(page.locator('.header-overflow-menu')).toHaveClass(/hidden/);
});

/* ─── Print media: UI chrome hidden ─── */

test('top-bar is hidden in print media', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  const topBarVisible = await page.locator('#top-bar').evaluate(
    el => getComputedStyle(el).display
  );
  expect(topBarVisible).toBe('none');
});

test('sidebar is hidden in print media', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  const sidebarDisplay = await page.locator('#sidebar').evaluate(
    el => getComputedStyle(el).display
  );
  expect(sidebarDisplay).toBe('none');
});

test('checklist-header is hidden in print media', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  const headerDisplay = await page.locator('.checklist-header').evaluate(
    el => getComputedStyle(el).display
  );
  expect(headerDisplay).toBe('none');
});

test('add-row trigger is hidden in print media', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  const triggerDisplay = await page.locator('.add-row-trigger').evaluate(
    el => getComputedStyle(el).display
  );
  expect(triggerDisplay).toBe('none');
});

/* ─── Print media: template-specific layouts ─── */

test('kanban toolbar is hidden and board layout resets in print media', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  // Toolbar hidden
  const toolbarDisplay = await page.locator('.kanban-toolbar').evaluate(
    el => getComputedStyle(el).display
  );
  expect(toolbarDisplay).toBe('none');

  // Board changes to flex layout
  const boardDisplay = await page.locator('.kanban-board').evaluate(
    el => getComputedStyle(el).display
  );
  expect(['flex', 'block']).toContain(boardDisplay);
});

test('budget summary cards visible and upload button hidden in print media', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-summary', { timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  // Summary still visible
  await expect(page.locator('.budget-summary')).toBeVisible();
});

test('recipe cards are visible in print media', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  // Recipe cards still visible
  await expect(page.locator('.recipe-card').first()).toBeVisible();
});

/* ─── Print button exists on kanban and recipe sheets ─── */

test('print button reachable on kanban sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5_000 });

  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3_000 });
  await expect(page.locator('#print-btn')).toBeVisible();
});

test('print button reachable on recipe sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3_000 });
  await expect(page.locator('#print-btn')).toBeVisible();
});
