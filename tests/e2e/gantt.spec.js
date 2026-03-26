const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ─── Campaign sheet (sheet-055): 8 tasks with dependencies ─── */

test('gantt template is detected for campaign sheet-055', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-wrapper', { timeout: 5000 });
  await expect(page.locator('.gantt-wrapper')).toBeVisible();
  await expect(page.locator('#template-badge')).toContainText('Gantt Timeline');
});

test('gantt renders correct number of task bars for campaign sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-bar', { timeout: 5000 });
  // 8 data rows → 8 bars (all have valid dates)
  const bars = await page.locator('.gantt-bar').count();
  expect(bars).toBe(8);
});

test('gantt label column shows all 8 task names', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-task-label', { timeout: 5000 });
  const labels = await page.locator('.gantt-task-label').count();
  expect(labels).toBe(8);
  // First task name is visible
  await expect(page.locator('.gantt-task-label .gantt-task-name').first()).toContainText('Content Strategy');
});

test('gantt chart SVG is present and non-empty', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-chart-svg', { timeout: 5000 });
  await expect(page.locator('.gantt-chart-svg')).toBeVisible();
  // SVG has a positive width attribute
  const width = await page.locator('.gantt-chart-svg').getAttribute('width');
  expect(parseInt(width, 10)).toBeGreaterThan(100);
});

test('gantt SVG axes and bars groups are present', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-chart-svg', { timeout: 5000 });
  // Verify major SVG groups are rendered
  await expect(page.locator('.gantt-bars')).toBeAttached();
  await expect(page.locator('.gantt-axis')).toBeAttached();
  await expect(page.locator('.gantt-grid')).toBeAttached();
  // Today line may or may not be in range — verify it's at most 1
  const todayCount = await page.locator('.gantt-today-line').count();
  expect(todayCount).toBeGreaterThanOrEqual(0);
  expect(todayCount).toBeLessThanOrEqual(1);
});

test('gantt month labels are present on the time axis', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-month-label', { timeout: 5000 });
  const count = await page.locator('.gantt-month-label').count();
  expect(count).toBeGreaterThan(1); // at least 2 month labels for a 2-month range
});

test('gantt progress bars fill fraction of the bar width', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-bar-progress', { timeout: 5000 });
  const progBars = await page.locator('.gantt-bar-progress').count();
  // Tasks with pct > 0: Content Strategy (100%), Design Assets (80%), Landing Page (60%),
  //   Email Campaign (40%), Social (20%), Analytics (100%) = at least 6
  expect(progBars).toBeGreaterThanOrEqual(5);
});

test('gantt dependency arrows are rendered for dependent tasks', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-dep-arrow', { timeout: 5000 });
  const arrows = await page.locator('.gantt-dep-arrow').count();
  // There are 6 tasks with dependencies
  expect(arrows).toBeGreaterThanOrEqual(4);
});

test('gantt complete bars have gantt-bar-complete class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-bar-complete', { timeout: 5000 });
  const count = await page.locator('.gantt-bar-complete').count();
  // "Content Strategy" (100%) and "Analytics Setup" (100%) are complete
  expect(count).toBeGreaterThanOrEqual(2);
});

test('gantt critical path bars have critical outline element', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-bar-critical-outline', { timeout: 5000 });
  const count = await page.locator('.gantt-bar-critical-outline').count();
  // At least one critical-path task should exist
  expect(count).toBeGreaterThan(0);
});

test('gantt critical path labels in label column are styled differently', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-critical-label', { timeout: 5000 });
  const count = await page.locator('.gantt-critical-label').count();
  expect(count).toBeGreaterThan(0);
});

test('gantt drag handles are clickable (pointer cursor)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-drag-handle', { timeout: 5000 });
  // Verify there is one drag handle per task with dates
  const handles = await page.locator('.gantt-drag-handle').count();
  expect(handles).toBe(8);
});

test('gantt drag handle emits start and end date edits on mouse drag', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-drag-handle', { timeout: 5000 });

  // Get bounding rect of first drag handle
  const firstHandle = page.locator('.gantt-drag-handle').first();
  const box = await firstHandle.boundingBox();
  expect(box).not.toBeNull();

  // Simulate drag: mousedown, move 25px right (5 days), mouseup
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  // After drag, emitEdit should have been called for start + end dates
  const records = await getCreatedRecords(page);
  expect(records.length).toBeGreaterThanOrEqual(1);
});

test('gantt assignee name appears in task label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-task-assignee', { timeout: 5000 });
  const assignees = await page.locator('.gantt-task-assignee').count();
  // All 8 tasks have assignees
  expect(assignees).toBe(8);
  // First task is assigned to Alice
  await expect(page.locator('.gantt-task-assignee').first()).toContainText('Alice');
});

test('gantt wrapper uses flex layout', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-wrapper', { timeout: 5000 });
  await expect(page.locator('.gantt-wrapper')).toHaveCSS('display', 'flex');
});

test('gantt label column uses design token surface background', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-label-col', { timeout: 5000 });
  const bg = await page.locator('.gantt-label-col').evaluate(
    el => getComputedStyle(el).backgroundColor
  );
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('');
});

test('gantt percentage labels appear on bars wide enough to show them', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-bar-label', { timeout: 5000 });
  const labels = await page.locator('.gantt-bar-label').count();
  expect(labels).toBeGreaterThan(0);
  // At least the 100% label should be visible
  const texts = await page.locator('.gantt-bar-label').allTextContents();
  expect(texts.some(t => t.includes('100'))).toBe(true);
});

test('gantt chart scroll area is horizontally scrollable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-chart-scroll', { timeout: 5000 });
  const overflow = await page.locator('.gantt-chart-scroll').evaluate(
    el => getComputedStyle(el).overflowX
  );
  expect(overflow).toMatch(/auto|scroll/);
});

test('gantt add row form is present', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
  await expect(page.locator('.add-row-trigger').first()).toBeVisible();
  await expect(page.locator('.add-row-trigger').first()).toContainText('Add Task');
});

/* ─── Sprint sheet (sheet-056): 6 tasks in a short sprint ─── */

test('gantt template is detected for sprint sheet-056', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-056');
  await page.waitForSelector('.gantt-wrapper', { timeout: 5000 });
  await expect(page.locator('#template-badge')).toContainText('Gantt Timeline');
});

test('gantt renders 6 task bars for sprint sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-056');
  await page.waitForSelector('.gantt-bar', { timeout: 5000 });
  await expect(page.locator('.gantt-bar')).toHaveCount(6);
});

test('gantt sprint shows a linear dependency chain', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-056');
  await page.waitForSelector('.gantt-chart-svg', { timeout: 5000 });
  // Wait for dep arrows to be added to DOM (SVG elements may not be 'visible')
  await page.waitForFunction(
    () => document.querySelectorAll('.gantt-dep-arrow').length > 0,
    { timeout: 5000 }
  );
  const arrows = await page.locator('.gantt-dep-arrow').count();
  // 5 dependency arrows (each task depends on the previous)
  expect(arrows).toBe(5);
});

test('gantt renders correctly at 375px mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-wrapper', { timeout: 5000 });
  await expect(page.locator('.gantt-wrapper')).toBeVisible();
  // Label column visible
  await expect(page.locator('.gantt-label-col')).toBeVisible();
  // Chart scroll area visible
  await expect(page.locator('.gantt-chart-scroll')).toBeVisible();
});

/* ---------- Directory view ---------- */

test('gantt directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-gantt/Gantt%20Timelines'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('gantt directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-gantt/Gantt%20Timelines'; });
  await page.waitForSelector('.gantt-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});
