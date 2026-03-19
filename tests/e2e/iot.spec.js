const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('iot template is detected for sheet-047', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-view', { timeout: 5000 });
  await expect(page.locator('.iot-view')).toBeVisible();
  await expect(page.locator('#template-badge')).toContainText('IoT Sensor Dashboard');
});

test('renders six sensor cards from fixture data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-card', { timeout: 5000 });
  await expect(page.locator('.iot-card')).toHaveCount(6);
});

test('summary cards show sensor and attention totals', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-summary-cards', { timeout: 5000 });
  await expect(page.locator('.iot-summary-card').nth(0)).toContainText('6');
  await expect(page.locator('.iot-summary-card').nth(1)).toContainText('3');
});

test('alerts filter shows only attention sensors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-filter-btn', { timeout: 5000 });
  await page.locator('.iot-filter-btn').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.iot-card').length === 3, { timeout: 3000 });
  await expect(page.locator('.iot-card')).toHaveCount(3);
});

test('state button click cycles and emits a sheet edit record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-state-btn', { timeout: 5000 });
  const firstState = page.locator('.iot-state-btn').first();
  await expect(firstState).toContainText('Normal');
  await firstState.click();
  await expect(firstState).toContainText('Watch');
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Watch')).toBe(true);
});

test('editing a reading emits a record and updates the card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-reading-value', { timeout: 5000 });

  await page.locator('.iot-reading-value').first().click();
  const input = page.locator('.editable-cell-input').first();
  await input.fill('25.5');
  await input.press('Enter');

  await expect(page.locator('.iot-reading-value').first()).toContainText('25.5 C');
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === '25.5')).toBe(true);
});

test('interactive controls use pointer cursor styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-state-btn', { timeout: 5000 });
  await expect(page.locator('.iot-state-btn').first()).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('.iot-filter-btn').first()).toHaveCSS('cursor', 'pointer');
});

test('iot dashboard has no horizontal overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-view', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('.iot-view *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 3) {
        issues.push(el.className || el.tagName);
      }
    });
    return issues;
  });

  expect(overflows).toHaveLength(0);
});
