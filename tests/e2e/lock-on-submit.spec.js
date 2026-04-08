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
  const lockRecord = records.find(r => r.type === 'row-protect' && r.description !== 'waymark:lock-on-submit');

  expect(lockRecord).toBeTruthy();
  // rowIndex 3 = header(0) + existing rows 1,2 + the new row at index 3
  expect(lockRecord.rowIndex).toBe(3);
  // Data row locks use empty editors — ownerEmail must be null
  expect(lockRecord.ownerEmail).toBeNull();
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
  // Exclude the waymark:lock-on-submit marker (created by enableLockOnSubmit) — that's config, not a data row lock
  const locks = records.filter(r => r.type === 'row-protect' && r.description !== 'waymark:lock-on-submit');

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

/* ── Layer 8: Lock Icon Rendering on Protected Rows (Row 14) ── */

test('lock icon appears on rows that are server-side protected', async ({ page }) => {
  // Pre-seed row 1 (Alice) as protected before page loads
  await page.addInitScript(() => {
    window.__WAYMARK_PROTECTED_RANGES = {
      'sheet-066': [
        { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 }, protectedRangeId: 1 },
      ],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Row 1 (Alice) should have a lock icon; row 2 (Bob) should not
  const rows = page.locator('.template-tracker-row');
  await expect(rows.first().locator('.tracker-row-lock')).toBeVisible();
  await expect(rows.nth(1).locator('.tracker-row-lock')).toHaveCount(0);
});

test('lock icon is absent when no rows are protected', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Default mock: no protected ranges → no lock icons
  await expect(page.locator('.tracker-row-lock')).toHaveCount(0);
});

/* ── Layer 9: Editor Cannot Bypass a Locked Row (Row 18) ── */

test('clicking editable cell on a protected row shows locked toast instead of opening input', async ({ page }) => {
  // Pre-seed row 1 (Alice) as protected
  await page.addInitScript(() => {
    window.__WAYMARK_PROTECTED_RANGES = {
      'sheet-066': [
        { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 }, protectedRangeId: 1 },
      ],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Click the label cell on the first row (Alice — which is protected)
  const firstRowLabel = page.locator('.template-tracker-row').first().locator('.template-tracker-label');
  await firstRowLabel.click();

  // Should show a "locked" toast — no input should appear
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast')).toContainText(/locked/i);
  await expect(firstRowLabel.locator('input.editable-cell-input')).toHaveCount(0);
});

test('editing a non-protected row opens input normally', async ({ page }) => {
  // Only protect row 1 (Alice); row 2 (Bob) remains editable
  await page.addInitScript(() => {
    window.__WAYMARK_PROTECTED_RANGES = {
      'sheet-066': [
        { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 }, protectedRangeId: 1 },
      ],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Click the label of the SECOND row (Bob — not protected)
  const secondRowLabel = page.locator('.template-tracker-row').nth(1).locator('.template-tracker-label');
  await secondRowLabel.click();

  // An input should appear (edit mode opens)
  await expect(secondRowLabel.locator('input.editable-cell-input')).toBeVisible({ timeout: 3000 });
});

/* ── Layer 10: Unit Test — addProtectedRange Payload Shape (Row 19) ── */

test('addProtectedRange with ownerEmail stores editors correctly', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    window.__WAYMARK_PROTECTED_RANGES = {};
    window.__WAYMARK_RECORDS = [];

    const { api } = await import('/js/api-client.js');
    await api.sheets.addProtectedRange('test-sheet-payload', 42, 7, 'owner@example.com', 'waymark:lock-on-submit');

    const ranges = window.__WAYMARK_PROTECTED_RANGES['test-sheet-payload'] || [];
    const record = (window.__WAYMARK_RECORDS || []).find(r => r.spreadsheetId === 'test-sheet-payload');
    if (!ranges.length || !record) return null;
    const pr = ranges[0];
    return {
      sheetId: pr.range.sheetId,
      startRowIndex: pr.range.startRowIndex,
      endRowIndex: pr.range.endRowIndex,
      warningOnly: pr.warningOnly,
      editorsUser: pr.editors.users[0],
      description: pr.description,
      recordRowIndex: record.rowIndex,
      recordOwnerEmail: record.ownerEmail,
    };
  });

  expect(result).not.toBeNull();
  expect(result.sheetId).toBe(42);
  expect(result.startRowIndex).toBe(7);
  expect(result.endRowIndex).toBe(8);
  expect(result.warningOnly).toBe(false);
  expect(result.editorsUser).toBe('owner@example.com');
  expect(result.description).toBe('waymark:lock-on-submit');
  expect(result.recordRowIndex).toBe(7);
  expect(result.recordOwnerEmail).toBe('owner@example.com');
});

test('addProtectedRange with null ownerEmail uses empty editors list', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    window.__WAYMARK_PROTECTED_RANGES = {};
    window.__WAYMARK_RECORDS = [];

    const { api } = await import('/js/api-client.js');
    await api.sheets.addProtectedRange('test-empty-editors', 0, 3, null);

    const ranges = window.__WAYMARK_PROTECTED_RANGES['test-empty-editors'] || [];
    const record = (window.__WAYMARK_RECORDS || []).find(r => r.spreadsheetId === 'test-empty-editors');
    if (!ranges.length || !record) return null;
    const pr = ranges[0];
    return {
      editorsCount: pr.editors.users.length,
      recordOwnerEmail: record.ownerEmail,
    };
  });

  expect(result).not.toBeNull();
  // Empty editors list — nobody bypasses except the spreadsheet owner
  expect(result.editorsCount).toBe(0);
  expect(result.recordOwnerEmail).toBeNull();
});

/* ── Layer 11: Owner-Configured Lock ── */
/* Lock-on-submit is stored as a waymark:lock-on-submit protected range on the header row.
   This makes the config PERSISTENT FOR ALL USERS on ALL DEVICES without localStorage. */

test('toggle is checked and disabled when sheet has pre-existing protected ranges', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WAYMARK_PROTECTED_RANGES = {
      'sheet-066': [
        // Config marker — signals lock-on-submit is enabled for this sheet
        { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, description: 'waymark:lock-on-submit', protectedRangeId: 99, editors: { users: [] } },
        { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 }, protectedRangeId: 1 },
      ],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  const toggle = page.locator('#lock-submit-toggle');

  // Must be checked (owner-configured = on)
  await expect(toggle).toBeChecked();
  // Must be disabled (user cannot override)
  const isDisabled = await toggle.isDisabled();
  expect(isDisabled).toBe(true);
});

test('toggle label title says owner-configured when protected ranges exist', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WAYMARK_PROTECTED_RANGES = {
      'sheet-066': [
        { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, description: 'waymark:lock-on-submit', protectedRangeId: 99, editors: { users: [] } },
        { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 }, protectedRangeId: 1 },
      ],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  const label = page.locator('#lock-submit-label');
  const title = await label.getAttribute('title');
  expect(title).toMatch(/owner/i);
});

test('submitting a row auto-locks WITHOUT enabling toggle when protected ranges pre-exist', async ({ page }) => {
  // Pre-seed the waymark:lock-on-submit marker — signals owner has enabled lock-on-submit
  await page.addInitScript(() => {
    window.__WAYMARK_PROTECTED_RANGES = {
      'sheet-066': [
        { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, description: 'waymark:lock-on-submit', protectedRangeId: 99, editors: { users: [] } },
        { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 }, protectedRangeId: 1 },
      ],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Do NOT manually enable the toggle — owner configuration should take effect automatically
  await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3000 });

  const goalInput = page.locator('.add-row-field-input').first();
  await goalInput.fill('Grace Auto-Lock');
  await page.click('.add-row-submit');

  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.type === 'row-protect'),
    { timeout: 8000 }
  );

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'row-protect')).toBe(true);
});

test('toggle unchecked and enabled when sheet has NO protected ranges', async ({ page }) => {
  // No pre-seeded protected ranges — toggle should be available
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  const toggle = page.locator('#lock-submit-toggle');

  await expect(toggle).not.toBeChecked();
  const isDisabled = await toggle.isDisabled();
  expect(isDisabled).toBe(false);
});

/* ── Layer 12: Toggle Writes/Deletes Config Marker in Sheet ── */
/* The lock config is stored IN the sheet as a protected range with
   description 'waymark:lock-on-submit'. This persists for ALL users. */

test('enabling toggle creates a waymark:lock-on-submit protected range on row 0', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // No pre-seeded ranges
  const before = await page.evaluate(() =>
    (window.__WAYMARK_PROTECTED_RANGES?.['sheet-066'] || [])
      .filter(pr => pr.description === 'waymark:lock-on-submit').length
  );
  expect(before).toBe(0);

  await enableLockOnSubmit(page);

  // A waymark:lock-on-submit marker must now exist for row 0
  const after = await page.evaluate(() => {
    const ranges = window.__WAYMARK_PROTECTED_RANGES?.['sheet-066'] || [];
    const marker = ranges.find(pr => pr.description === 'waymark:lock-on-submit');
    if (!marker) return null;
    return { rowIndex: marker.range.startRowIndex, endRowIndex: marker.range.endRowIndex };
  });
  expect(after).not.toBeNull();
  expect(after.rowIndex).toBe(0);
  expect(after.endRowIndex).toBe(1);
});

test('disabling toggle removes the waymark:lock-on-submit marker', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  // Enable first
  await enableLockOnSubmit(page);
  const before = await page.evaluate(() =>
    (window.__WAYMARK_PROTECTED_RANGES?.['sheet-066'] || [])
      .some(pr => pr.description === 'waymark:lock-on-submit')
  );
  expect(before).toBe(true);

  // Disable
  await openOverflowMenu(page);
  await page.locator('#lock-submit-toggle').uncheck({ force: true });
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Marker must be removed
  const after = await page.evaluate(() =>
    (window.__WAYMARK_PROTECTED_RANGES?.['sheet-066'] || [])
      .some(pr => pr.description === 'waymark:lock-on-submit')
  );
  expect(after).toBe(false);
});

test('lock config persists for all users: loading sheet with marker shows toggle locked', async ({ page }) => {
  // Simulate another user (or same user, different device) who finds the marker already in the sheet
  await page.addInitScript(() => {
    window.__WAYMARK_PROTECTED_RANGES = {
      'sheet-066': [
        { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, description: 'waymark:lock-on-submit', protectedRangeId: 99, editors: { users: [] } },
      ],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await openOverflowMenu(page);
  const toggle = page.locator('#lock-submit-toggle');
  // Toggle must be checked (marker detected) and disabled (owner-configured)
  await expect(toggle).toBeChecked();
  const isDisabled = await toggle.isDisabled();
  expect(isDisabled).toBe(true);
});

test('data row locks use empty editors — only spreadsheet owner can bypass', async ({ page }) => {
  // Pre-seed the lock marker so lock-on-submit is active from load
  await page.addInitScript(() => {
    window.__WAYMARK_PROTECTED_RANGES = {
      'sheet-066': [
        { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, description: 'waymark:lock-on-submit', protectedRangeId: 99, editors: { users: [] } },
      ],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-066');
  await page.waitForSelector('.template-tracker-row', { timeout: 5000 });

  await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-form:not(.hidden)', { timeout: 3000 });

  await page.locator('.add-row-field-input').first().fill('Test Empty Editors');
  await page.click('.add-row-submit');

  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.type === 'row-protect' && r.description !== 'waymark:lock-on-submit'),
    { timeout: 8000 }
  );

  const records = await getCreatedRecords(page);
  const dataRowLock = records.find(r => r.type === 'row-protect' && r.description !== 'waymark:lock-on-submit');

  expect(dataRowLock).toBeTruthy();
  // Data row lock must have null ownerEmail (empty editors)
  expect(dataRowLock.ownerEmail).toBeNull();
});

