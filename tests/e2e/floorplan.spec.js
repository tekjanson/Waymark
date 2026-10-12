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
