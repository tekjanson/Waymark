// @ts-check
/**
 * share-collab.spec.js — Bilateral 2-tab sharing sheet + notification sync.
 *
 * Granting a collaborator access provisions a dedicated bilateral Google Sheet
 * (Shared_Waymarks + WebRTC_Signaling tabs), logs the share, and the polling
 * engine turns collaborator entries into top-bar bell notifications.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('granting access provisions a bilateral 2-tab sharing sheet and logs the share', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.click('#share-btn');
  await page.waitForSelector('#share-modal', { timeout: 5_000 });
  await page.fill('.share-invite-email', 'collaborator@example.com');
  await page.click('.share-invite-grant-btn');
  await page.waitForSelector('.toast', { timeout: 5_000 });

  const records = await getCreatedRecords(page);

  // A dedicated bilateral sheet was created (deterministic .waymark-share name).
  const bilateral = records.find(r => r.title && r.title.startsWith('.waymark-share-'));
  expect(bilateral).toBeTruthy();

  // Both tabs were written.
  const tabWrites = records.filter(r => r.type === 'tab-write');
  const tabTitles = tabWrites.map(r => r.tabTitle);
  expect(tabTitles).toContain('Shared_Waymarks');
  expect(tabTitles).toContain('WebRTC_Signaling');

  // The share was logged to the Shared_Waymarks ledger.
  const ledgerRow = records.find(r => r.type === 'row-append' && r.sheetTitle === 'Shared_Waymarks');
  expect(ledgerRow).toBeTruthy();

  // The collaborator was granted access to the bilateral sheet.
  const perm = records.find(r => r.type === 'drive-permission' && r.email === 'collaborator@example.com');
  expect(perm).toBeTruthy();
});

test('bilateral sheet is found-or-created idempotently per contact', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const ids = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const a = await collab.ensureBilateralSheet('dup@example.com');
    const b = await collab.ensureBilateralSheet('dup@example.com');
    return [a.sheetId, b.sheetId];
  });

  expect(ids[0]).toBe(ids[1]);
});

test('notification sync pushes collaborator shares to the bell', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const storage = await import('/js/storage.js');

    const { sheetId } = await collab.ensureBilateralSheet('friend@example.com');
    const now = new Date().toISOString();
    // A row authored by the collaborator (not the current user).
    await api.sheets.appendRows(sheetId, 'Shared_Waymarks', [[
      'sheet-001', 'Groceries', 'friend@example.com', now, now, 'friend@example.com', 'shared', 'Shared Groceries with you',
    ]]);

    const pushed = await collab.pollBilateralSheets();
    const notifs = storage.getNotifications();
    return { pushed, title: notifs[0] && notifs[0].title, sheet: notifs[0] && notifs[0].sheetId };
  });

  expect(result.pushed).toBe(1);
  expect(result.title).toContain('friend@example.com');
  expect(result.sheet).toBe('sheet-001');

  // The bell badge reflects the unread notification.
  await expect(page.locator('.notif-bell-badge')).toBeVisible({ timeout: 3_000 });
});

test('polling does not notify about the current user own shares', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const pushed = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    // recordSharedWaymark writes as the current user and advances the cursor,
    // so a subsequent poll must find nothing new to notify about.
    await collab.recordSharedWaymark('selfcheck@example.com', {
      sheetId: 'sheet-002', title: 'My List', changeType: 'shared', summary: 'x',
    });
    return collab.pollBilateralSheets();
  });

  expect(pushed).toBe(0);
});
