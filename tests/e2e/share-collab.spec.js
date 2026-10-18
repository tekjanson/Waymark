// @ts-check
/**
 * share-collab.spec.js — Auto-provisioned Share Ledger + notification sync.
 *
 * Granting a collaborator access provisions a dedicated "WayMark Share Ledger"
 * sheet (Shared_Docs + Presence + Chat + WebRTC_Signaling tabs), logs the
 * document, writes the ledger id back into the Contacts Waymark, and the poll
 * engine turns collaborator shares into top-bar bell notifications.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('granting access provisions a 4-tab Share Ledger and logs the document', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.click('#share-btn');
  await page.waitForSelector('#share-modal', { timeout: 5_000 });
  await page.fill('.share-invite-email', 'collaborator@example.com');
  await page.click('.share-invite-grant-btn');
  await page.waitForSelector('.toast', { timeout: 5_000 });

  const records = await getCreatedRecords(page);

  // A dedicated ledger sheet was created.
  const ledger = records.find(r => r.title && r.title.startsWith('.waymark-ledger-'));
  expect(ledger).toBeTruthy();

  // All four tabs were written.
  const tabTitles = records.filter(r => r.type === 'tab-write').map(r => r.tabTitle);
  expect(tabTitles).toContain('Shared_Docs');
  expect(tabTitles).toContain('Presence');
  expect(tabTitles).toContain('Chat');
  expect(tabTitles).toContain('WebRTC_Signaling');

  // The document was logged to the Shared_Docs ledger.
  const ledgerRow = records.find(r => r.type === 'row-append' && r.sheetTitle === 'Shared_Docs');
  expect(ledgerRow).toBeTruthy();

  // The collaborator was granted access to the ledger sheet.
  const perm = records.find(r => r.type === 'drive-permission' && r.email === 'collaborator@example.com');
  expect(perm).toBeTruthy();
});

test('ledger is found-or-created idempotently per contact', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const ids = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const a = await collab.ensureShareLedger({ contactEmail: 'dup@example.com' });
    const b = await collab.ensureShareLedger({ contactEmail: 'dup@example.com' });
    return [a.sheetId, b.sheetId];
  });

  expect(ids[0]).toBe(ids[1]);
});

test('notification sync pushes documents shared WITH me to the bell', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const storage = await import('/js/storage.js');

    // A ledger a collaborator shared with me (current user = testuser@gmail.com).
    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'friend@example.com' });
    const now = new Date().toISOString();
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-001', 'Groceries', 'checklist', 'testuser@gmail.com', '', 'reader', now, 'Shared',
    ]]);

    const pushed = await collab.pollShareLedgers();
    const notifs = storage.getNotifications();
    return { pushed, title: notifs[0] && notifs[0].title, sheet: notifs[0] && notifs[0].sheetId };
  });

  expect(result.pushed).toBe(1);
  expect(result.title).toContain('Groceries');
  expect(result.sheet).toBe('sheet-001');
  await expect(page.locator('.notif-bell-badge')).toBeVisible({ timeout: 3_000 });
});

test('polling does not notify about documents I shared with others', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const pushed = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    // I share a doc WITH a contact — Shared_With_Email is them, not me.
    await collab.shareDocumentWithContact({
      contactEmail: 'someone@example.com', docId: 'sheet-002', docTitle: 'My List', permission: 'reader',
    });
    return collab.pollShareLedgers();
  });

  expect(pushed).toBe(0);
});

test('ledger id is written back into the Contacts Waymark share column', async ({ page }) => {
  // Pin the Wayfarer Crews contacts book so the write-back can find it.
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Wayfarer Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const wroteBack = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    // Load the contacts book into the mock cache first.
    await api.sheets.getSpreadsheet('sheet-077');
    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'mike@example.com' });
    const data = await api.sheets.getSpreadsheet('sheet-077');
    const values = (data.tabs[0] && data.tabs[0].values) || data.values;
    // Mike is row 3 (index 2 of data, +1 header) with Share_Data_Sheet at col 5.
    const mikeRow = values.find(r => (r[2] || '').toLowerCase() === 'mike@example.com');
    return { ledgerId: sheetId, shareCell: mikeRow && mikeRow[5] };
  });

  expect(wroteBack.shareCell).toBe(wroteBack.ledgerId);
});

test('social pipeline: presence publish/read round-trips through the ledger', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const presence = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const target = { group: 'Family Crew' };
    await collab.publishPresence(target, { status: 'online', activeWaymarkId: 'home' });
    return collab.readPresence(target);
  });

  expect(presence.length).toBeGreaterThanOrEqual(1);
  expect(presence[0].email).toBe('testuser@gmail.com');
  expect(presence[0].status).toBe('online');
});

test('social pipeline: chat send/read round-trips through the ledger', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const chat = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const target = { contactEmail: 'pal@example.com' };
    await collab.sendChat(target, 'On my way to the trailhead!');
    return collab.readChat(target);
  });

  expect(chat.length).toBe(1);
  expect(chat[0].text).toBe('On my way to the trailhead!');
  expect(chat[0].sender).toBe('testuser@gmail.com');
});
