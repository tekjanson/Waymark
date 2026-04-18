// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../helpers/test-utils');

/* ---------- Helper: open settings modal ---------- */

async function openSettings(page) {
  const userName = page.locator('#user-name');
  const avatar = page.locator('#user-avatar');
  if (await userName.isVisible()) {
    await userName.click();
  } else {
    await avatar.click();
  }
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
}

/** Get the latest json-update record whose content has preferences. */
async function getLastPrefsRecord(page) {
  const records = await getCreatedRecords(page);
  const prefs = records
    .filter(r => r.type === 'json-update' && r.content?.preferences)
    .pop();
  return prefs?.content?.preferences || null;
}

/* ============================================================
   Open / Close
   ============================================================ */

test('settings modal opens when clicking user name', async ({ page }) => {
  await setupApp(page);

  const userName = page.locator('#user-name');
  await userName.waitFor({ state: 'visible', timeout: 5_000 });
  await userName.click();

  const modal = page.locator('#settings-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('.settings-modal')).toBeVisible();
});

test('settings modal shows user profile info', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  const name = page.locator('#settings-user-name');
  await expect(name).not.toBeEmpty();
});

test('settings modal closes on Done button', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  await page.locator('#settings-done-btn').click();
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);
});

test('settings modal closes on X button', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  await page.locator('#settings-modal-close').click();
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);
});

test('settings modal closes on overlay click', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  // Click the overlay (outside the modal content)
  await page.locator('#settings-modal').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);
});

test('settings modal shows auto-refresh toggle', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  const toggle = page.locator('#settings-auto-refresh');
  await expect(toggle).toBeVisible();
  // Default should be checked (auto-refresh = true)
  await expect(toggle).toBeChecked();
});

test('settings modal shows sort order select', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  const select = page.locator('#settings-sort-order');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('name');
});

test('settings modal shows import folder with default', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  const folderName = page.locator('#settings-import-folder');
  await expect(folderName).toContainText('Waymark / Imports');

  const chooseBtn = page.locator('#settings-choose-folder');
  await expect(chooseBtn).toBeVisible();
});

test('settings modal body is scrollable on mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await openSettings(page);

  const scrollState = await page.evaluate(() => {
    const body = document.querySelector('#settings-modal .settings-body');
    if (!body) return null;
    const before = body.scrollTop;
    body.scrollTop = 120;
    return {
      overflowY: window.getComputedStyle(body).overflowY,
      before,
      after: body.scrollTop,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    };
  });

  expect(scrollState).not.toBeNull();
  expect(['auto', 'scroll']).toContain(scrollState.overflowY);
  expect(scrollState.scrollHeight).toBeGreaterThanOrEqual(scrollState.clientHeight);
  expect(scrollState.after).toBeGreaterThanOrEqual(scrollState.before);
});

test.skip('settings choose folder opens folder browser — replaced by Google Picker', async ({ page }) => {
});

test.skip('settings folder browser shows breadcrumb trail — replaced by Google Picker', async ({ page }) => {
});

test.skip('settings folder browser clicking folder navigates into it — replaced by Google Picker', async ({ page }) => {
});

/* ============================================================
   Theme Persistence — saved to Drive
   ============================================================ */

test('clicking Dark theme button persists to Drive', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  // Click the Dark theme button
  await page.locator('#settings-theme-dark').click();

  // The Dark button should become active
  await expect(page.locator('#settings-theme-dark')).toHaveClass(/active/);
  await expect(page.locator('#settings-theme-light')).not.toHaveClass(/active/);

  // Verify `data-theme="dark"` was applied to <html>
  const htmlTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(htmlTheme).toBe('dark');

  // Verify preference was saved to Drive
  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.theme).toBe('dark');
});

test('clicking Light theme button persists to Drive', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  // First switch to dark so we can switch back
  await page.locator('#settings-theme-dark').click();

  // Clear records to isolate the next write
  await page.evaluate(() => { window.__WAYMARK_RECORDS.length = 0; });

  // Now click Light
  await page.locator('#settings-theme-light').click();
  await expect(page.locator('#settings-theme-light')).toHaveClass(/active/);

  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.theme).toBe('light');
});

test('clicking System theme button persists to Drive', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  await page.locator('#settings-theme-system').click();
  await expect(page.locator('#settings-theme-system')).toHaveClass(/active/);

  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.theme).toBe('system');
});

test('top-bar theme toggle persists to Drive', async ({ page }) => {
  await setupApp(page);

  // Click the top-bar theme toggle (switches light → dark)
  const toggleBtn = page.locator('#theme-toggle-btn');
  await toggleBtn.click();

  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.theme).toBe('dark');
});

/* ============================================================
   Auto-refresh Persistence
   ============================================================ */

test('unchecking auto-refresh persists to Drive', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  // Auto-refresh defaults to checked
  await expect(page.locator('#settings-auto-refresh')).toBeChecked();

  // Uncheck it
  await page.locator('#settings-auto-refresh').uncheck();
  await expect(page.locator('#settings-auto-refresh')).not.toBeChecked();

  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.autoRefresh).toBe(false);
});

test('checking auto-refresh persists to Drive', async ({ page }) => {
  await setupApp(page, { autoRefresh: false });
  await openSettings(page);

  await expect(page.locator('#settings-auto-refresh')).not.toBeChecked();

  await page.locator('#settings-auto-refresh').check();

  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.autoRefresh).toBe(true);
});

/* ============================================================
   Sort Order Persistence
   ============================================================ */

test('changing sort order persists to Drive', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  await expect(page.locator('#settings-sort-order')).toHaveValue('name');

  await page.locator('#settings-sort-order').selectOption('modified');

  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.sortOrder).toBe('modified');
});

/* ============================================================
   Import Folder Persistence
   ============================================================ */

test('selecting import folder persists to Drive', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  // Click choose folder — Picker auto-returns {id: 'f1', name: 'Groceries'} in mock mode
  await page.locator('#settings-choose-folder').click();

  // Import folder label should update
  await expect(page.locator('#settings-import-folder')).toContainText('Groceries');

  // Verify persisted to Drive
  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.importFolderName).toBe('Groceries');
  expect(prefs.importFolderId).toBeTruthy();
});

test('resetting import folder persists null to Drive', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  // Select a folder via Picker — auto-returns {id: 'f1', name: 'Groceries'} in mock mode
  await page.locator('#settings-choose-folder').click();
  await expect(page.locator('#settings-import-folder')).toContainText('Groceries');

  // Reset button should now be visible
  await expect(page.locator('#settings-reset-folder')).toBeVisible();

  // Clear records
  await page.evaluate(() => { window.__WAYMARK_RECORDS.length = 0; });

  // Click reset
  await page.locator('#settings-reset-folder').click();

  // Label should go back to default
  await expect(page.locator('#settings-import-folder')).toContainText('Waymark / Imports');

  // Verify null persisted to Drive
  const prefs = await getLastPrefsRecord(page);
  expect(prefs).not.toBeNull();
  expect(prefs.importFolderId).toBeNull();
  expect(prefs.importFolderName).toBeNull();
});

/* ============================================================
   Import Folder persists to localStorage as fallback
   ============================================================ */

test('import folder syncs to localStorage', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  // Select folder via Picker — auto-returns {id: 'f1', name: 'Groceries'} in mock mode
  await page.locator('#settings-choose-folder').click();
  await expect(page.locator('#settings-import-folder')).toContainText('Groceries');

  // Verify localStorage was synced
  const lsName = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_import_folder_name'))
  );
  expect(lsName).toBe('Groceries');

  const lsId = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_import_folder_id'))
  );
  expect(lsId).toBeTruthy();
});

/* ============================================================
   Theme persists to localStorage
   ============================================================ */

test('theme change syncs to localStorage', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  await page.locator('#settings-theme-dark').click();

  const lsTheme = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_theme'))
  );
  expect(lsTheme).toBe('dark');
});