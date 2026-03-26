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

test('test cases renders filter toolbar with pills', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-toolbar', { timeout: 5_000 });

  const pills = page.locator('.tc-filter-pill');
  expect(await pills.count()).toBe(6); // All, Pass, Fail, Blocked, Skip, Untested

  // "All" pill is active by default
  const allPill = page.locator('.tc-filter-pill').first();
  await expect(allPill).toHaveClass(/tc-filter-active/);
  await expect(allPill).toHaveText('All');
});

test('test cases filter pill hides non-matching rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-filter-pill', { timeout: 5_000 });

  // Click "Fail" filter pill
  const failPill = page.locator('.tc-filter-pill[data-filter="fail"]');
  await failPill.click();

  // Only fail rows should be visible (2 in fixture)
  const visibleRows = page.locator('.tc-row:not(.hidden)');
  expect(await visibleRows.count()).toBe(2);

  // Each visible row should have fail status
  const first = visibleRows.first();
  await expect(first).toHaveClass(/tc-row-fail/);

  // Click "All" to reset
  await page.locator('.tc-filter-pill[data-filter="all"]').click();
  expect(await page.locator('.tc-row:not(.hidden)').count()).toBe(10);
});

test('test cases bulk All Pass sets every row to Pass', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-bulk-btn', { timeout: 5_000 });

  await page.locator('.tc-bulk-btn.tc-bulk-pass').click();

  // All status badges should read "Pass"
  const btns = page.locator('.tc-status-btn');
  const count = await btns.count();
  for (let i = 0; i < count; i++) {
    await expect(btns.nth(i)).toHaveText('Pass');
    await expect(btns.nth(i)).toHaveClass(/tc-pass/);
  }

  // Summary bar should show all as pass
  const passItem = page.locator('.tc-summary-item.tc-pass');
  await expect(passItem).toContainText('10');
});

test('test cases bulk Reset All sets every row to Untested', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-bulk-btn', { timeout: 5_000 });

  await page.locator('.tc-bulk-btn.tc-bulk-reset').click();

  const btns = page.locator('.tc-status-btn');
  const count = await btns.count();
  for (let i = 0; i < count; i++) {
    await expect(btns.nth(i)).toHaveText('Untested');
  }

  const untestedItem = page.locator('.tc-summary-item.tc-untested');
  await expect(untestedItem).toContainText('10');
});

test('test cases bulk Skip Filtered affects only visible rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-bulk-btn', { timeout: 5_000 });

  // Filter to "fail" (2 rows), then skip filtered
  await page.locator('.tc-filter-pill[data-filter="fail"]').click();
  expect(await page.locator('.tc-row:not(.hidden)').count()).toBe(2);

  await page.locator('.tc-bulk-btn.tc-bulk-skip').click();

  // Reset filter to see all rows
  await page.locator('.tc-filter-pill[data-filter="all"]').click();

  // The 2 formerly-fail rows should now be Skip; others unchanged
  const skipItem = page.locator('.tc-summary-item.tc-skip');
  // Original: 1 skip + 2 newly set = 3
  await expect(skipItem).toContainText('3');
});

test('test cases bulk All Pass emits cell-update records', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-bulk-btn', { timeout: 5_000 });

  await page.locator('.tc-bulk-btn.tc-bulk-pass').click();

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update' && r.value === 'Pass');
  // Should have emitted one update per row (10 rows)
  expect(updates.length).toBeGreaterThanOrEqual(10);
});

test('test cases summary bar updates after individual status cycle', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-status-btn', { timeout: 5_000 });

  // Initial pass count = 5
  const passItem = page.locator('.tc-summary-item.tc-pass');
  await expect(passItem).toContainText('5');

  // Click first badge: Pass → Fail (pass count drops to 4)
  await page.locator('.tc-status-btn').first().click();
  await expect(passItem).toContainText('4');
});

test('test cases rows have data-status attribute', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row', { timeout: 5_000 });

  const firstRow = page.locator('.tc-row').first();
  await expect(firstRow).toHaveAttribute('data-status', 'pass');

  const secondRow = page.locator('.tc-row').nth(1);
  await expect(secondRow).toHaveAttribute('data-status', 'fail');
});

test('test cases copy failures button is rendered', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-bulk-btn', { timeout: 5_000 });

  const copyBtn = page.locator('.tc-bulk-btn.tc-bulk-copy');
  await expect(copyBtn).toBeVisible();
  await expect(copyBtn).toContainText('Copy Failures');
});

/* ---------- Directory View ---------- */

test('testcases directoryView shows test suite overview title', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-title', { timeout: 8_000 });

  await expect(page.locator('.tc-dir-title')).toContainText('Test Suite Overview');
});

test('testcases directoryView shows per-suite cards', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-card', { timeout: 8_000 });

  const cards = page.locator('.tc-dir-card');
  expect(await cards.count()).toBe(2);
});

test('testcases directoryView shows grand totals bar with accurate counts', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-totals', { timeout: 8_000 });

  const text = await page.locator('.tc-dir-totals').textContent();
  // 10 + 12 = 22 total tests
  expect(text).toContain('22 tests');
  // 5 + 7 = 12 pass → 55% pass rate
  expect(text).toContain('55%');
  expect(text).toContain('2 suites');
});

test('testcases directoryView totals show pass and fail counts', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-totals', { timeout: 8_000 });

  // Grand pass = 12
  await expect(page.locator('.tc-dir-totals-pass')).toContainText('12');
  // Grand fail = 4
  await expect(page.locator('.tc-dir-totals-fail')).toContainText('4');
  // Grand blocked = 2
  await expect(page.locator('.tc-dir-totals-blocked')).toContainText('2');
});

test('testcases directoryView card click navigates to sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-card', { timeout: 8_000 });

  await page.locator('.tc-dir-card').first().click();
  await page.waitForSelector('.tc-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Test Cases');
});

test('testcases directoryView cards show per-suite pass rate', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-card', { timeout: 8_000 });

  const rates = page.locator('.tc-dir-card-rate');
  expect(await rates.count()).toBe(2);
  // Each card should show a percentage
  const texts = await rates.allTextContents();
  expect(texts.every(t => /%/.test(t))).toBe(true);
});

test('testcases directoryView cards show status breakdown counts', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-card-counts', { timeout: 8_000 });

  // Each card has individual pass/fail/blocked/skip/untested counts
  const counts = page.locator('.tc-dir-card-counts');
  expect(await counts.count()).toBe(2);

  // First card (Login) should show pass count of 5
  const firstText = await counts.first().textContent();
  expect(firstText).toContain('5');
});

test('testcases directoryView cards show proportional status bar', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-bar', { timeout: 8_000 });

  const bars = page.locator('.tc-dir-bar');
  expect(await bars.count()).toBe(2);

  // Each bar should have pass segment
  const passSeg = page.locator('.tc-dir-bar-pass');
  expect(await passSeg.count()).toBeGreaterThanOrEqual(2);
});

test('testcases directoryView cards have pointer cursor for click interaction', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-card', { timeout: 8_000 });

  await expect(page.locator('.tc-dir-card').first()).toHaveCSS('cursor', 'pointer');
});

test('testcases directoryView uses grid layout for cards', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-grid', { timeout: 8_000 });

  await expect(page.locator('.tc-dir-grid')).toHaveCSS('display', 'grid');
});

test('testcases directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('testcases directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-testcases/Test Suites'; });
  await page.waitForSelector('.tc-dir-title', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});
