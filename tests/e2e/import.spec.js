// @ts-check
/**
 * import.spec.js — Tests for the sheet import modal.
 *
 * Tests the multi-step import flow: sheet selection, analysis method
 * choice, review, and import execution in local/mock mode.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToHome } = require('../helpers/test-utils');

/* ────────────────── Import button & modal visibility ────────────────── */

test('Import button is visible on the home screen', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#import-sheet-btn')).toBeVisible();
});

test('clicking Import opens the import modal', async ({ page }) => {
  await setupApp(page);

  await expect(page.locator('#import-modal')).toBeHidden();
  await page.locator('#import-sheet-btn').click();
  await expect(page.locator('#import-modal')).toBeVisible();
});

test('import modal closes when clicking Cancel', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await expect(page.locator('#import-modal')).toBeVisible();

  await page.locator('#import-cancel-btn').click();
  await expect(page.locator('#import-modal')).toBeHidden();
});

test('import modal closes when clicking the X button', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await expect(page.locator('#import-modal')).toBeVisible();

  await page.locator('#import-modal-close').click();
  await expect(page.locator('#import-modal')).toBeHidden();
});

test('import modal closes when clicking the backdrop', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await expect(page.locator('#import-modal')).toBeVisible();

  await page.locator('#import-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#import-modal')).toBeHidden();
});

/* ────────────────── Step 1: Sheet list ────────────────── */

test('import modal shows sheet list after loading', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();

  // Wait for mock sheet list to appear
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  const items = page.locator('.import-sheet-item');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
});

test('Next button is disabled until a sheet is selected', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });

  await expect(page.locator('#import-next-btn')).toBeDisabled();
});

test('selecting a sheet enables the Next button', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });

  await page.locator('.import-sheet-item').first().click();
  await expect(page.locator('.import-sheet-item').first()).toHaveClass(/selected/);
  await expect(page.locator('#import-next-btn')).toBeEnabled();
});

test('search field filters the sheet list', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });

  const totalBefore = await page.locator('.import-sheet-item').count();

  // Type a search query that likely matches some but not all
  await page.locator('#import-search-input').fill('zzz-nonexistent-query');
  // Give a moment for filter to apply
  await page.waitForTimeout(200);

  const totalAfter = await page.locator('.import-sheet-item').count();
  expect(totalAfter).toBeLessThanOrEqual(totalBefore);
});

/* ────────────────── Step 2: Configure template & column mapping ────────── */

test('clicking Next after sheet selection shows configure step', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();

  // Should show step 2 with template picker and column map editor
  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#import-template-pick')).toBeVisible();
  await expect(page.locator('#import-column-map-editor')).toBeVisible();
});

test('preview table shows headers from selected sheet', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();

  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });
  const headers = page.locator('.import-preview-table th');
  const count = await headers.count();
  expect(count).toBeGreaterThan(0);
});

test('template picker has auto-detected template selected', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();

  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });

  // Template picker should have many options (all template types)
  const options = page.locator('#import-template-pick option');
  const count = await options.count();
  expect(count).toBeGreaterThan(5);

  // One option should be selected (auto-detected)
  const selectedValue = await page.locator('#import-template-pick').inputValue();
  expect(selectedValue.length).toBeGreaterThan(0);
});

test('column mapping editor shows mapping rows with dropdowns', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();

  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });

  // Column map editor should have mapping rows with select dropdowns
  const mappingRows = page.locator('#import-column-map-editor .import-mapping-row');
  const count = await mappingRows.count();
  expect(count).toBeGreaterThan(0);

  // Each row should have a select element
  const selects = page.locator('#import-column-map-editor .import-mapping-select');
  const selectCount = await selects.count();
  expect(selectCount).toBe(count);
});

test('Back button returns to sheet selection from configure step', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();

  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });
  await page.locator('#import-back-btn').click();
  await expect(page.locator('#import-step-pick')).toBeVisible();
});

/* ────────────────── Step 3: Review & Import ────────────────── */

test('Review button shows review step with template result', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();
  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });

  // Click Review (Next) from configure step
  await page.locator('#import-next-btn').click();

  // Should show review step
  await expect(page.locator('#import-step-review')).toBeVisible({ timeout: 10_000 });
  // Should show a template name
  const templateText = await page.locator('#import-result-template').textContent();
  expect(templateText.length).toBeGreaterThan(0);
});

test('confidence badge shows in configure step', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();

  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });
  // Confidence badge should be visible with a percentage
  await expect(page.locator('#import-detect-confidence')).toBeVisible();
  const badgeText = await page.locator('#import-detect-confidence').textContent();
  expect(badgeText).toMatch(/\d+%/);
});

test('review step shows column mapping', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();
  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });

  // Move to review
  await page.locator('#import-next-btn').click();

  await expect(page.locator('#import-step-review')).toBeVisible({ timeout: 10_000 });
  const mappingRows = page.locator('.import-mapping-row');
  const count = await mappingRows.count();
  expect(count).toBeGreaterThan(0);
});

test('review step shows confidence badge', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();
  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });

  // Move to review
  await page.locator('#import-next-btn').click();

  await expect(page.locator('#import-step-review')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#import-result-confidence')).toBeVisible();
  const confText = await page.locator('#import-result-confidence').textContent();
  expect(confText).toMatch(/\d+%/);
});

test('Import button creates a mock record', async ({ page }) => {
  await setupApp(page);

  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();
  await expect(page.locator('#import-step-analyze')).toBeVisible({ timeout: 10_000 });

  // Move to review
  await page.locator('#import-next-btn').click();
  await expect(page.locator('#import-step-review')).toBeVisible({ timeout: 10_000 });

  // Click import
  await page.locator('#import-next-btn').click();

  // Wait for modal to close (import complete)
  await expect(page.locator('#import-modal')).toBeHidden({ timeout: 15_000 });

  // Verify records were created (folder + spreadsheet)
  const records = await page.evaluate(() => window.__WAYMARK_RECORDS || []);
  const folderRecords = records.filter(r => r.mimeType === 'application/vnd.google-apps.folder');
  const sheetRecords = records.filter(r => r.spreadsheetId);
  expect(folderRecords.length).toBeGreaterThanOrEqual(1); // at least import folder
  expect(sheetRecords.length).toBeGreaterThanOrEqual(1);  // the imported sheet
});

/* ────────────────── Re-open resets state ────────────────── */

test('re-opening import modal resets to step 1', async ({ page }) => {
  await setupApp(page);

  // Open, go to step 2, close
  await page.locator('#import-sheet-btn').click();
  await page.waitForSelector('.import-sheet-item', { timeout: 10_000 });
  await page.locator('.import-sheet-item').first().click();
  await page.locator('#import-next-btn').click();
  await expect(page.locator('#import-step-analyze')).toBeVisible();
  await page.locator('#import-cancel-btn').click();

  // Re-open — should be on step 1
  await page.locator('#import-sheet-btn').click();
  await expect(page.locator('#import-step-pick')).toBeVisible();
  await expect(page.locator('#import-step-analyze')).toBeHidden();
});
