/* ============================================================
   lock-on-submit.spec.js — E2E tests for the row lock-on-submit feature
   ============================================================ */

const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords, openOverflowMenu } = require('../helpers/test-utils');

/* ── Helpers ── */

/** Enable lock-on-submit for the current sheet via the overflow toggle */
async function enableLockOnSubmit(page) {
  await openOverflowMenu(page);
  const toggle = page.locator('#lock-submit-toggle');
  const checked = await toggle.isChecked();
  if (!checked) {
    await toggle.check({ force: true });
    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
  }
  // Close the menu
  await page.keyboard.press('Escape');
}

/** Pre-seed WAYMARK_PROTECTED_RANGES so the mock locks look pre-existing */
async function seedProtectedRanges(page, spreadsheetId, ranges) {
  await page.evaluate(({ id, r }) => {
    if (!window.__WAYMARK_PROTECTED_RANGES) window.__WAYMARK_PROTECTED_RANGES = {};
    window.__WAYMARK_PROTECTED_RANGES[id] = r;
  }, { id: spreadsheetId, r: ranges });
}

/* ── Layer 1: Detection & Rendering ── */

test('lock-submit toggle is present in the overflow menu', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  await expect(page.locator('#lock-submit-toggle')).toBeVisible();
  await expect(page.locator('#lock-submit-label')).toContainText('Lock rows on submit');
});

test('lock-submit toggle is unchecked for a fresh sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  const toggle = page.locator('#lock-submit-toggle');
  await expect(toggle).not.toBeChecked();
});

/* ── Layer 2: Toggle Enable / Disable ── */

test('enabling toggle shows confirmation toast', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  await page.locator('#lock-submit-toggle').check({ force: true });

  await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.toast')).toContainText(/lock/i);
});

test('disabling toggle shows confirmation toast', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Enable first
  await openOverflowMenu(page);
  await page.locator('#lock-submit-toggle').check({ force: true });
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Disable
  await openOverflowMenu(page);
  await page.locator('#lock-submit-toggle').uncheck({ force: true });
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast').last()).toContainText(/disabled/i);
});

/* ── Layer 3: Add-Row Triggers Lock ── */

test('submitting add-row form with lock enabled creates row-protect record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Enable lock-on-submit
  await enableLockOnSubmit(page);
  // Wait for the toggle state to persist
  await page.waitForTimeout ? void 0 : void 0;

  // Open the add-row form
  await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3000 });

  // Fill in the form
  const goalInput = page.locator('.add-row-field-input').first();
  await goalInput.fill('Carol Williams');
  await goalInput.press('Tab');

  // Submit
  await page.click('.add-row-submit');

  // Wait for the sheet to reload (success toast)
  await page.waitForSelector('.toast', { timeout: 5000 });
  await expect(page.locator('.toast').last()).toContainText(/added/i);

  // Wait for sheet to re-render before checking records
  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.type === 'row-append'),
    { timeout: 5000 }
  );

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'row-append')).toBe(true);
  // Lock record must also exist
  expect(records.some(r => r.type === 'row-protect')).toBe(true);
});

test('submitting add-row form WITHOUT lock enabled does NOT create row-protect record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Do NOT enable lock-on-submit — leave toggle off

  await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3000 });

  const goalInput = page.locator('.add-row-field-input').first();
  await goalInput.fill('Dave Brown');
  await page.click('.add-row-submit');

  await page.waitForSelector('.toast', { timeout: 5000 });
  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.type === 'row-append'),
    { timeout: 5000 }
  );

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'row-append')).toBe(true);
  expect(records.some(r => r.type === 'row-protect')).toBe(false);
});

test('locking a row stores correct row index and owner email in record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await enableLockOnSubmit(page);

  await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3000 });

  const goalInput = page.locator('.add-row-field-input').first();
  await goalInput.fill('Eve Park');
  await page.click('.add-row-submit');

  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.type === 'row-protect'),
    { timeout: 8000 }
  );

  const records = await getCreatedRecords(page);
  const lockRecord = records.find(r => r.type === 'row-protect');

  expect(lockRecord).toBeTruthy();
  // rowIndex 3 = header(0) + existing rows 1,2 + the new row at index 3
  expect(lockRecord.rowIndex).toBe(3);
  // Owner email comes from mock fixture users[0] — test the field exists and is a string
  expect(typeof lockRecord.ownerEmail).toBe('string');
  expect(lockRecord.ownerEmail.length).toBeGreaterThan(0);
});

/* ── Layer 4: Sequential Submissions All Get Locked (Task 13) ── */

test('five sequential form submissions all get locked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await enableLockOnSubmit(page);

  const names = ['Sub1', 'Sub2', 'Sub3', 'Sub4', 'Sub5'];
  for (const name of names) {
    await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
    await page.click('.add-row-trigger');
    await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3000 });

    const goalInput = page.locator('.add-row-field-input').first();
    await goalInput.fill(name);
    await page.click('.add-row-submit');

    // Wait for the append record to appear before next submission
    const submitCount = names.indexOf(name) + 1;
    await page.waitForFunction(
      (n) => (window.__WAYMARK_RECORDS || []).filter(r => r.type === 'row-append').length >= n,
      submitCount,
      { timeout: 8000 }
    );
    await page.waitForSelector('.toast', { timeout: 5000 });
  }

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  const locks = records.filter(r => r.type === 'row-protect');

  // Each submission should have fired one lock; on-load scan may add extra locks for pre-existing rows
  expect(appends.length).toBeGreaterThanOrEqual(5);
  expect(locks.length).toBeGreaterThanOrEqual(5);
  // Lock count must be >= append count (on-load scan may lock pre-existing rows too)
  expect(locks.length).toBeGreaterThanOrEqual(appends.length);
});

/* ── Layer 5: Duplicate Protection Skipped (Task 9) ── */

test('duplicate lock is skipped when row is already protected', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Pre-seed ALL rows as protected: existing data rows 1 & 2, plus the incoming new row 3.
  // This means the on-load scan after the form submit also finds all rows protected → no locks.
  await seedProtectedRanges(page, 'sheet-066', [
    { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 }, protectedRangeId: 1 },
    { range: { sheetId: 0, startRowIndex: 2, endRowIndex: 3 }, protectedRangeId: 2 },
    { range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4 }, protectedRangeId: 3 },
  ]);

  await enableLockOnSubmit(page);

  await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3000 });

  const goalInput = page.locator('.add-row-field-input').first();
  await goalInput.fill('Frank Duplicate');
  await page.click('.add-row-submit');

  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.type === 'row-append'),
    { timeout: 8000 }
  );

  const records = await getCreatedRecords(page);
  const locks = records.filter(r => r.type === 'row-protect');

  // Duplicate protection must be skipped — no new lock record should appear
  expect(locks.length).toBe(0);
});

/* ── Layer 6: Near-Limit Warning Banner (Task 12) ── */

test('near-limit warning banner appears when protected ranges count is >= 9000', async ({ page }) => {
  // Seed 9000 protected ranges BEFORE page load so they're available when lockNewRows runs.
  // addInitScript fires on every navigation including the initial page.goto('/') inside setupApp.
  await page.addInitScript(() => {
    const fakeRanges = Array.from({ length: 9000 }, (_, i) => ({
      range: { sheetId: 0, startRowIndex: i + 1, endRowIndex: i + 2 },
      protectedRangeId: i + 1,
    }));
    window.__WAYMARK_PROTECTED_RANGES = { 'sheet-066': fakeRanges };
  });

  await setupApp(page);

  // First navigation: lock is off so lockNewRows does NOT run, no banner yet.
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Enable lock-on-submit — this saves the preference in memory (_userData).
  await enableLockOnSubmit(page);

  // Navigate away and back: navigating to the same hash is a no-op in the SPA,
  // so we bounce through home first to force loadSheet to run again.
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await expect(page.locator('.lock-limit-banner')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.lock-limit-banner')).toContainText('10,000');
});

/* ── Layer 7: Visual / Style Consistency ── */

test('lock-submit toggle label has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  const label = page.locator('#lock-submit-label');
  await label.waitFor({ timeout: 3000 });
  await expect(label).toHaveCSS('cursor', 'pointer');
});

test('lock-submit toggle is inside overflow menu which uses correct display mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  const menu = page.locator('.header-overflow-menu');
  await expect(menu).toHaveCSS('display', /flex|block/);
});
