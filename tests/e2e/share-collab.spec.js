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

async function setMockUser(page, { id, name, email }) {
  await page.route('**/__fixtures/users.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id, name, email, picture: '' }]),
  }));
}

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

test('two contacts resolve the same social ledger and can see each other\'s chat', async ({ page }) => {
  await setMockUser(page, { id: 'alice', name: 'Alice', email: 'alice@example.com' });
  await setupApp(page);

  const aliceSheetId = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const target = { contactEmail: 'bob@example.com' };
    const { sheetId } = await collab.ensureShareLedger(target);
    await collab.sendChat(target, 'Hi Bob, this is Alice.');
    return sheetId;
  });

  // A second browser page gets its own account and local user-data mapping,
  // while sharing the mock Drive files with the first page.
  const bobPage = await page.context().newPage();
  await setMockUser(bobPage, { id: 'bob', name: 'Bob', email: 'bob@example.com' });
  await setupApp(bobPage);

  const bobResult = await bobPage.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const target = { contactEmail: 'alice@example.com' };
    const { sheetId } = await collab.ensureShareLedger(target);
    const messagesBeforeReply = await collab.readChat(target);
    await collab.sendChat(target, 'Hi Alice, I can see your message.');
    return { sheetId, messagesBeforeReply };
  });

  expect(bobResult.sheetId).toBe(aliceSheetId);
  expect(bobResult.messagesBeforeReply.map(message => message.text)).toContain('Hi Bob, this is Alice.');

  // Reload Alice's app to pick up the shared sheet from Drive, as a separate
  // account session would, then verify Bob's reply arrived on that same ledger.
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
  const aliceMessages = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    return collab.readChat({ contactEmail: 'bob@example.com' });
  });
  expect(aliceMessages.map(message => message.text)).toContain('Hi Alice, I can see your message.');
  await bobPage.close();
});

test('existing per-contact ledgers converge on the same legacy sheet for both contacts', async ({ page }) => {
  await page.addInitScript(() => {
    const sharedDocs = ['Document_ID', 'Document_Title', 'Waymark_Type', 'Shared_With_Email', 'Group', 'Permission_Level', 'Shared_Timestamp', 'Status'];
    const presence = ['User_Email', 'Display_Name', 'Group', 'Online_Status', 'Last_Heartbeat_UTC', 'Active_Waymark_ID'];
    const chat = ['Message_ID', 'Timestamp_UTC', 'Sender_Email', 'Target_Group_Or_Contact', 'Message_Text', 'Attached_Waymark_Link'];
    const signaling = ['Session_ID', 'Caller_Email', 'Callee_Email', 'SDP_Offer_Answer_JSON', 'ICE_Candidates_JSON', 'Call_Status'];
    const ledger = (id, title, messageId, sender, text) => ({
      id,
      title,
      sheetTitle: 'Shared_Docs',
      values: [sharedDocs],
      tabs: [
        { title: 'Shared_Docs', numericSheetId: 0, values: [sharedDocs] },
        { title: 'Presence', numericSheetId: 1, values: [presence] },
        { title: 'Chat', numericSheetId: 2, values: [chat, [messageId, new Date().toISOString(), sender, '', text, '']] },
        { title: 'WebRTC_Signaling', numericSheetId: 3, values: [signaling] },
      ],
    });
    localStorage.setItem('waymark_mock_created_sheets_v1', JSON.stringify({
      'created-sheet-legacy-a': ledger('created-sheet-legacy-a', '.waymark-ledger-contact:alice@example.com', 'msg-a', 'bob@example.com', 'Old conversation'),
      'created-sheet-legacy-b': ledger('created-sheet-legacy-b', '.waymark-ledger-contact:bob@example.com', 'msg-b', 'alice@example.com', 'Other old conversation'),
    }));
  });

  await setMockUser(page, { id: 'alice', name: 'Alice', email: 'alice@example.com' });
  await setupApp(page);
  const aliceResult = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const target = { contactEmail: 'bob@example.com' };
    const ledger = await collab.findExistingShareLedger(target);
    const messages = await collab.readChat(target);
    return { ledger, messages };
  });

  const bobPage = await page.context().newPage();
  await setMockUser(bobPage, { id: 'bob', name: 'Bob', email: 'bob@example.com' });
  await setupApp(bobPage);
  const bobResult = await bobPage.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const target = { contactEmail: 'alice@example.com' };
    const ledger = await collab.findExistingShareLedger(target);
    const messages = await collab.readChat(target);
    return { ledger, messages };
  });

  expect(aliceResult.ledger.sheetId).toBe('created-sheet-legacy-a');
  expect(aliceResult.messages.map(message => message.text)).toContain('Other old conversation');
  expect(bobResult.ledger.sheetId).toBe(aliceResult.ledger.sheetId);
  expect(bobResult.messages.map(message => message.text)).toContain('Old conversation');
  expect(bobResult.messages.map(message => message.text)).toContain('Other old conversation');
  await bobPage.close();
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
  // Pin the Waymarker Crews contacts book so the write-back can find it.
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
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
