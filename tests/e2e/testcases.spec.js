// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('login tests detected as Test Cases template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Test Cases');
});

test('test cases renders summary bar with counts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-summary', { timeout: 5_000 });

  const summary = page.locator('.tc-summary');
  await expect(summary).toBeVisible();

  // Check pass count (5 Pass rows)
  const passItem = page.locator('.tc-summary-item.tc-pass');
  await expect(passItem).toContainText('5');

  // Check fail count (2 Fail rows)
  const failItem = page.locator('.tc-summary-item.tc-fail');
  await expect(failItem).toContainText('2');

  // Total
  const total = page.locator('.tc-summary-total');
  await expect(total).toContainText('10');
});

test('test cases renders correct number of rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row', { timeout: 5_000 });

  const rows = page.locator('.tc-row');
  expect(await rows.count()).toBe(10);
});

test('test cases rows have status badges with correct classes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-status-btn', { timeout: 5_000 });

  // First row = Pass
  const firstBtn = page.locator('.tc-status-btn').first();
  await expect(firstBtn).toHaveClass(/tc-pass/);
  await expect(firstBtn).toHaveText('Pass');

  // Second row = Fail
  const secondBtn = page.locator('.tc-status-btn').nth(1);
  await expect(secondBtn).toHaveClass(/tc-fail/);
  await expect(secondBtn).toHaveText('Fail');
});

test('test cases shows expected/actual details', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row-details', { timeout: 5_000 });

  // Check expected text exists
  const expectedLabels = page.locator('.tc-label');
  expect(await expectedLabels.count()).toBeGreaterThan(0);
  const texts = await expectedLabels.allTextContents();
  expect(texts.some(t => t.includes('Expected'))).toBe(true);
});

test('test cases shows priority badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-priority', { timeout: 5_000 });

  const priorities = page.locator('.tc-priority');
  expect(await priorities.count()).toBeGreaterThan(0);
  const texts = await priorities.allTextContents();
  expect(texts.some(t => t.toLowerCase().includes('high'))).toBe(true);
});

test('test cases status badge cycles on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-status-btn', { timeout: 5_000 });

  // Click first status badge (Pass → Fail)
  const firstBtn = page.locator('.tc-status-btn').first();
  await expect(firstBtn).toHaveText('Pass');
  await firstBtn.click();

  // Should cycle: Pass → Fail
  await expect(firstBtn).toHaveText('Fail');
  await expect(firstBtn).toHaveClass(/tc-fail/);
});

test('test cases status cycle emits cell-update record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-status-btn', { timeout: 5_000 });

  // Click first status badge
  const firstBtn = page.locator('.tc-status-btn').first();
  await firstBtn.click();

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);

  const lastUpdate = updates[updates.length - 1];
  expect(lastUpdate.spreadsheetId).toBe('sheet-015');
  expect(lastUpdate.value).toBe('Fail'); // Pass cycles to Fail
});

test('test cases status full cycle returns to start', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-status-btn', { timeout: 5_000 });

  // Untested row (index 7: "OAuth Google login")
  const untestedBtn = page.locator('.tc-status-btn').nth(7);
  await expect(untestedBtn).toHaveText('Untested');

  // Full cycle: Untested → Pass → Fail → Blocked → Skip → Untested
  await untestedBtn.click();
  await expect(untestedBtn).toHaveText('Pass');
  await untestedBtn.click();
  await expect(untestedBtn).toHaveText('Fail');
  await untestedBtn.click();
  await expect(untestedBtn).toHaveText('Blocked');
  await untestedBtn.click();
  await expect(untestedBtn).toHaveText('Skip');
  await untestedBtn.click();
  await expect(untestedBtn).toHaveText('Untested');
});

test('test cases row border color matches status', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row', { timeout: 5_000 });

  // Pass row should have pass class
  const firstRow = page.locator('.tc-row').first();
  await expect(firstRow).toHaveClass(/tc-row-pass/);

  // Fail row
  const secondRow = page.locator('.tc-row').nth(1);
  await expect(secondRow).toHaveClass(/tc-row-fail/);
});
