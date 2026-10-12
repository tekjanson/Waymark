// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('floor plan is detected and rendered', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Floor Plan');
  await expect(page.locator('.floorplan-title')).toContainText('House Plan');
  await expect(page.locator('.floorplan-room')).toHaveCount(4);
  await expect(page.locator('.floorplan-wall')).toHaveCount(2);
});

test('floor plan does not render generic placeholder wall labels', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const genericText = await page.locator('.floorplan-svg text').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
  expect(genericText.some(value => /^(room|wall|electrical|plumbing|fixture)$/i.test(value))).toBe(false);
});

test('wall tool supports single-click placement for immediate feedback', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const beforeCount = await page.locator('.floorplan-wall').count();
  await page.click('.floorplan-svg', { position: { x: 220, y: 180 } });
  const afterCount = await page.locator('.floorplan-wall').count();

  expect(afterCount).toBe(beforeCount + 1);
});

test('created-sheet fallback still opens floor plan canvas in local mode', async ({ page }) => {
  await setupApp(page, { hash: '#/sheet/created-sheet-e2e-fallback' });
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Floor Plan');
  await expect(page.locator('.floorplan-svg')).toBeVisible();
});

test('export button triggers print workflow for PDF output', async ({ page }) => {
  await page.addInitScript(() => {
    window.__PRINT_CALLED__ = false;
    window.print = () => {
      window.__PRINT_CALLED__ = true;
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-export-btn', { timeout: 5_000 });

  await page.click('.floorplan-export-btn');
  const called = await page.evaluate(() => window.__PRINT_CALLED__ === true);
  expect(called).toBe(true);
});
