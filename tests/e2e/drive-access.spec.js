// @ts-check
/**
 * drive-access.spec.js — Two-tier Google Drive access + "shared just works".
 *
 * Standard access (drive.file) is the default: the app only sees files the
 * user creates or picks. Full access (…/auth/drive) is an opt-in upgrade that
 * makes Waymarks shared with the user appear and open without the Picker.
 *
 * The mock /auth/refresh echoes the tier from the waymark_drive_access cookie,
 * which setupApp seeds via the `driveAccess` option.
 *
 * Verifies:
 *   1. Standard tier → Settings shows "Standard access" + an upgrade button.
 *   2. Standard tier → the "Shared with me" home section stays hidden.
 *   3. Full tier    → Settings shows the granted state, upgrade button hidden.
 *   4. Full tier    → the "Shared with me" home section lists shared items.
 *   5. Full tier    → clicking a shared item opens it.
 */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ──────────────────── Helper ──────────────────── */

async function openSettings(page) {
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });
}

/* ──────────────────── Tests ──────────────────── */

test('standard access shows the upgrade button in settings', async ({ page }) => {
  await setupApp(page); // default tier = drive.file
  await openSettings(page);
  await expect(page.locator('#drive-access-tier')).toContainText('Standard access');
  await expect(page.locator('#settings-upgrade-drive')).toBeVisible();
});

test('standard access keeps the shared-with-me home section hidden', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#home-shared')).toBeHidden();
});

test('full access shows granted state and hides the upgrade button', async ({ page }) => {
  await setupApp(page, { driveAccess: 'full' });
  await openSettings(page);
  await expect(page.locator('#drive-access-tier')).toContainText('Full access granted');
  await expect(page.locator('#settings-upgrade-drive')).toBeHidden();
});

test('full access lists items in the shared-with-me home section', async ({ page }) => {
  await setupApp(page, { driveAccess: 'full' });
  await page.waitForSelector('#home-shared:not(.hidden)', { timeout: 5000 });
  const count = await page.locator('#home-shared-list .pinned-card').count();
  expect(count).toBeGreaterThan(0);
  await expect(page.locator('#home-shared-list .badge-shared').first()).toBeVisible();
});

test('full access opens a shared item on click', async ({ page }) => {
  await setupApp(page, { driveAccess: 'full' });
  await page.waitForSelector('#home-shared:not(.hidden)', { timeout: 5000 });
  await page.locator('#home-shared-list .pinned-card').first().click();
  // The seeded shared items are folders — clicking opens the folder view.
  await page.waitForSelector('#folder-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#folder-view')).toBeVisible();
});
