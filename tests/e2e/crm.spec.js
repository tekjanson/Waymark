// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('crm detected as CRM template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('CRM');
});

test('crm renders pipeline summary and deal cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-summary', { timeout: 5_000 });

  await expect(page.locator('.crm-summary-total')).toBeVisible();

  const cards = page.locator('.crm-card');
  expect(await cards.count()).toBe(8);
});

test('crm stage badge cycles on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-stage-btn', { timeout: 5_000 });

  const firstBtn = page.locator('.crm-stage-btn').first();
  const initialText = await firstBtn.textContent();
  await firstBtn.click();

  const newText = await firstBtn.textContent();
  expect(newText).not.toBe(initialText);

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
});
