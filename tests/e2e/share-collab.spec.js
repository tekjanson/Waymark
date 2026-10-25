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

test('sharing with a Waymarker Crew grants Drive permissions to all crew members and logs per-member rows', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    await api.sheets.getSpreadsheet('sheet-077');

    const ledgerId = await collab.shareDocumentWithContact({
      group: 'Family Crew',
      docId: 'sheet-001',
      docTitle: 'Groceries',
      waymarkType: 'checklist',
      permission: 'writer',
    });

    const data = await api.sheets.getSpreadsheet(ledgerId);
    const sharedDocsTab = data.tabs.find(t => t.title === 'Shared_Docs');
    return {
      ledgerId,
      sharedRows: (sharedDocsTab?.values || []).slice(1),
    };
  });

  const records = await getCreatedRecords(page);
  const perms = records.filter(r => r.type === 'drive-permission');
  const permEmails = perms.map(p => p.email);

  // Family Crew in sheet-077 has kailey@example.com, mike@example.com, and stewart@example.com
  expect(permEmails).toContain('kailey@example.com');
  expect(permEmails).toContain('mike@example.com');
  expect(permEmails).toContain('stewart@example.com');
  expect(result.sharedRows.map(r => r[3])).toContain('kailey@example.com');
  expect(result.sharedRows.map(r => r[3])).toContain('mike@example.com');
  expect(result.sharedRows.map(r => r[3])).toContain('stewart@example.com');
});

test('presence heartbeats upsert the user row in-place instead of appending duplicate rows', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const target = { contactEmail: 'heartbeat@example.com' };

    await collab.publishPresence(target, { status: 'online', activeWaymarkId: 'home' });
    await collab.publishPresence(target, { status: 'away', activeWaymarkId: 'sheet-001' });
    await collab.publishPresenceEverywhere({ status: 'online', activeWaymarkId: 'sheet-002' });

    const { sheetId } = await collab.ensureShareLedger(target);
    const data = await api.sheets.getSpreadsheet(sheetId);
    const presenceTab = data.tabs.find(t => t.title === 'Presence');
    const presenceList = await collab.readPresence(target);
    return {
      rowCount: (presenceTab?.values || []).length - 1,
      presenceList,
      activeCell: presenceTab?.values?.[1]?.[5] || '',
    };
  });

  expect(result.rowCount).toBe(1);
  expect(result.presenceList).toHaveLength(1);
  expect(result.presenceList[0].status).toBe('online');
  expect(result.activeCell).toBe('sheet-002');
});

test('collaborator chat messages push a notification to the bell on pollShareLedgers', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const storage = await import('/js/storage.js');

    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'trailmate@example.com' });
    await api.sheets.appendRows(sheetId, 'Chat', [[
      'msg-remote-1',
      new Date().toISOString(),
      'trailmate@example.com',
      'testuser@gmail.com',
      'Meet at the summit at noon!',
      '',
    ]]);

    const pushed = await collab.pollShareLedgers();
    const notifs = storage.getNotifications();
    return { pushed, notif: notifs[0] || null };
  });

  expect(result.pushed).toBe(1);
  expect(result.notif).toBeTruthy();
  expect(result.notif.type).toBe('chat');
  expect(result.notif.body).toContain('Meet at the summit at noon!');
  await expect(page.locator('.notif-bell-badge')).toBeVisible({ timeout: 3_000 });
});

test('deep-link invite with ledger parameter registers the shared ledger and triggers notifications', async ({ page }) => {
  await setMockUser(page, { id: 'alice', name: 'Alice', email: 'alice@example.com' });
  await setupApp(page);

  const inviteData = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const ledgerId = await collab.shareDocumentWithContact({
      contactEmail: 'bob@example.com',
      docId: 'sheet-001',
      docTitle: 'Groceries',
      waymarkType: 'checklist',
      permission: 'writer',
    });
    return { ledgerId };
  });

  const bobPage = await page.context().newPage();
  await setMockUser(bobPage, { id: 'bob', name: 'Bob', email: 'bob@example.com' });
  await setupApp(bobPage);
  await bobPage.goto(`/?fileId=sheet-001&fileName=Groceries&ledger=${encodeURIComponent(inviteData.ledgerId)}&from=alice%40example.com#/`);
  await bobPage.waitForSelector('#checklist-items', { timeout: 10_000 });

  const bobState = await bobPage.evaluate(async () => {
    const userData = await import('/js/user-data.js');
    const storage = await import('/js/storage.js');
    return {
      ledgers: userData.getShareLedgers(),
      notifs: storage.getNotifications(),
      hash: window.location.hash,
    };
  });

  expect(bobState.hash).toBe('#/sheet/sheet-001');
  expect(bobState.ledgers.some(l => l.sheetId === inviteData.ledgerId)).toBe(true);
  expect(bobState.notifs.some(n => n.sheetId === 'sheet-001' && n.title.includes('Groceries'))).toBe(true);
  await bobPage.close();
});

test('WebRTC signaling adapter reads and writes cells on the WebRTC_Signaling tab', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const target = await collab.getSignalingTarget({ contactEmail: 'peer@example.com' });
    await target.signal.writeCell(1, 19, JSON.stringify({ peerId: 'peer-1', name: 'Test', ts: Date.now() }));
    const matrix = await target.signal.readAll();
    return {
      tab: target.tab,
      cellValue: matrix?.[1]?.[19] || '',
    };
  });

  expect(result.tab).toBe('WebRTC_Signaling');
  expect(result.cellValue).toContain('peer-1');
});

test('multi-user collaboration: Alice edits a shared Waymark and Bob receives an update notification and live sheet refresh', async ({ page }) => {
  await setMockUser(page, { id: 'alice', name: 'Alice', email: 'alice@example.com' });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.checklist-row', { timeout: 5_000 });

  // Alice shares sheet-001 with Bob
  const ledgerId = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    return collab.shareDocumentWithContact({
      contactEmail: 'bob@example.com',
      docId: 'sheet-001',
      docTitle: 'Groceries',
      waymarkType: 'checklist',
      permission: 'writer',
    });
  });
  expect(ledgerId).toBeTruthy();

  // Bob opens his session in a second page and views the shared sheet-001
  const bobPage = await page.context().newPage();
  await setMockUser(bobPage, { id: 'bob', name: 'Bob', email: 'bob@example.com' });
  await setupApp(bobPage);
  await bobPage.evaluate(async (id) => {
    const collab = await import('/js/collab.js');
    await collab.registerSharedLedger({ sheetId: id, contactEmail: 'alice@example.com' });
  }, ledgerId);
  await navigateToSheet(bobPage, 'sheet-001');
  await bobPage.waitForSelector('.checklist-row', { timeout: 5_000 });

  // Find the first uncompleted item on sheet-001 and check it off on Alice's page
  const targetText = await page.locator('.checklist-row:not(.completed) .checklist-item-text').first().textContent();
  await page.locator('.checklist-row:not(.completed) .checklist-checkbox').first().click();

  // Wait for Alice's mutation to be recorded in Shared_Docs and polled by Bob
  const bobUpdate = await bobPage.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const storage = await import('/js/storage.js');
    // Wait briefly if Alice's async notifySheetMutation is still in flight
    for (let attempt = 0; attempt < 10; attempt++) {
      await collab.pollShareLedgers();
      const notifs = storage.getNotifications();
      const upd = notifs.find(n => n.type === 'update' && n.sheetId === 'sheet-001');
      if (upd) return upd;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  });

  expect(bobUpdate).toBeTruthy();
  expect(bobUpdate.title).toContain('alice@example.com');
  expect(bobUpdate.title).toContain('Grocery List');
  expect(bobUpdate.body).toContain('Updated');

  // Verify Bob's open sheet-001 auto-refreshed to reflect Alice's edit
  await expect(bobPage.locator('.checklist-row', { hasText: targetText || '' })).toHaveClass(/completed/, { timeout: 5_000 });
  await bobPage.close();
});

test('accepting a shared Waymark from the notification bell updates ledger status to Accepted and adds to Recent Waymarks', async ({ page }) => {
  await setMockUser(page, { id: 'bob', name: 'Bob', email: 'bob@example.com' });
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const ledgerId = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'alice@example.com' });
    const now = new Date().toISOString();
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-001', 'Groceries', 'checklist', 'bob@example.com', '', 'writer', now, 'Shared',
    ]]);
    await collab.pollShareLedgers();
    return sheetId;
  });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3_000 });
  await expect(page.locator('.notif-accept-btn')).toBeVisible();
  await expect(page.locator('.notif-reject-btn')).toBeVisible();
  await expect(page.locator('.notif-call-btn')).toBeVisible();

  await page.click('.notif-accept-btn');
  await expect(page.locator('.notif-decision-accepted')).toBeVisible();

  const postAccept = await page.evaluate(async (lId) => {
    const { api } = await import('/js/api-client.js');
    const userData = await import('/js/user-data.js');
    const storage = await import('/js/storage.js');
    const data = await api.sheets.getSpreadsheet(lId);
    const sharedTab = data.tabs.find(t => t.title === 'Shared_Docs');
    return {
      accepted: storage.isShareAccepted('sheet-001'),
      recentIds: userData.getRecentSheets().map(s => s.id),
      rowStatus: sharedTab?.values?.[1]?.[7] || '',
    };
  }, ledgerId);

  expect(postAccept.accepted).toBe(true);
  expect(postAccept.recentIds).toContain('sheet-001');
  expect(postAccept.rowStatus).toBe('Accepted');
});

test('rejecting a shared Waymark from the notification bell marks ledger Rejected, hides the file, and mutes future updates', async ({ page }) => {
  await setMockUser(page, { id: 'bob', name: 'Bob', email: 'bob@example.com' });
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const ledgerId = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'spammer@example.com' });
    const now = new Date().toISOString();
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-002', 'Unwanted File', 'checklist', 'bob@example.com', '', 'reader', now, 'Shared',
    ]]);
    await collab.pollShareLedgers();
    return sheetId;
  });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3_000 });
  await page.click('.notif-reject-btn');
  await expect(page.locator('.notif-decision-rejected')).toBeVisible();

  // Now simulate the sender making subsequent edits to the rejected sheet-002
  const postReject = await page.evaluate(async (lId) => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const userData = await import('/js/user-data.js');
    const storage = await import('/js/storage.js');

    const data = await api.sheets.getSpreadsheet(lId);
    const sharedTab = data.tabs.find(t => t.title === 'Shared_Docs');
    const initialRejectedStatus = sharedTab?.values?.[1]?.[7] || '';

    // Append an update row from spammer@example.com for the rejected sheet-002
    await api.sheets.appendRows(lId, 'Shared_Docs', [[
      'sheet-002', 'Unwanted File', 'checklist', 'bob@example.com', '', 'writer', new Date().toISOString(), 'Updated|spammer@example.com|Added more rows',
    ]]);
    const pushedAfterReject = await collab.pollShareLedgers();
    const updateNotifs = storage.getNotifications().filter(n => n.type === 'update' && n.sheetId === 'sheet-002');

    return {
      isRejected: storage.isShareRejected('sheet-002'),
      isHidden: userData.isItemHidden('sheet-002'),
      initialRejectedStatus,
      pushedAfterReject,
      updateNotifCount: updateNotifs.length,
    };
  }, ledgerId);

  expect(postReject.isRejected).toBe(true);
  expect(postReject.isHidden).toBe(true);
  expect(postReject.initialRejectedStatus).toBe('Rejected');
  expect(postReject.pushedAfterReject).toBe(0);
  expect(postReject.updateNotifCount).toBe(0);
});

test('passive digest diff detection pushes an update notification when an accepted shared sheet changes externally', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const diffResult = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const storage = await import('/js/storage.js');

    // Accept sheet-001 (stores initial digest)
    await collab.acceptSharedWaymark({
      docId: 'sheet-001',
      docTitle: 'Groceries',
      waymarkType: 'checklist',
      from: 'alice@example.com',
    });

    // Simulate an external Google Sheets edit directly on sheet-001
    await api.sheets.appendRows('sheet-001', 'Sheet1', [['Organic Honey', 'false', 'Pantry', '2026-05-01']]);

    const pushed = await collab.checkSharedSheetDiffs();
    const notifs = storage.getNotifications();
    const diffNotif = notifs.find(n => n.type === 'update' && n.sheetId === 'sheet-001');
    return { pushed, diffNotif };
  });

  expect(diffResult.pushed).toBe(1);
  expect(diffResult.diffNotif).toBeTruthy();
  expect(diffResult.diffNotif.title).toContain('Grocery List');
  expect(diffResult.diffNotif.body).toContain('new row');
});

test('incoming WebRTC call on a shared ledger pushes a call notification with Join Call button', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const callResult = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const storage = await import('/js/storage.js');

    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'caller@example.com' });
    await api.sheets.appendRows(sheetId, 'WebRTC_Signaling', [[
      'session-101', 'caller@example.com', 'testuser@gmail.com', '{"type":"offer"}', '[]', 'ringing',
    ]]);

    const pushed = await collab.pollShareLedgers();
    const callNotif = storage.getNotifications().find(n => n.type === 'call');
    return { pushed, callNotif };
  });

  expect(callResult.pushed).toBe(1);
  expect(callResult.callNotif).toBeTruthy();
  expect(callResult.callNotif.title).toContain('caller@example.com');

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3_000 });
  const callBtn = page.locator('.notif-call-btn').first();
  await expect(callBtn).toContainText('Join Call');
});

test('notification popup renders fully inside mobile viewport with vertical item layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'mobilefriend@example.com' });
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-001', 'Groceries', 'checklist', 'testuser@gmail.com', '', 'writer', new Date().toISOString(), 'Shared',
    ]]);
    await collab.pollShareLedgers();
  });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3_000 });

  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.notif-panel');
    const item = document.querySelector('.notif-item');
    const title = document.querySelector('.notif-item-title');
    const actions = document.querySelector('.notif-item-actions');
    const acceptBtn = document.querySelector('.notif-accept-btn');
    const pRect = panel.getBoundingClientRect();
    const tRect = title.getBoundingClientRect();
    const aRect = actions.getBoundingClientRect();
    const bRect = acceptBtn.getBoundingClientRect();
    return {
      vw: window.innerWidth,
      panelLeft: pRect.left,
      panelRight: pRect.right,
      panelWidth: pRect.width,
      flexDir: getComputedStyle(item).flexDirection,
      titleTop: tRect.top,
      actionsTop: aRect.top,
      acceptVisible: bRect.left >= 0 && bRect.right <= window.innerWidth && bRect.width > 0 && bRect.height > 0,
    };
  });

  expect(layout.panelLeft).toBeGreaterThanOrEqual(0);
  expect(layout.panelRight).toBeLessThanOrEqual(layout.vw);
  expect(layout.panelWidth).toBeGreaterThan(280);
  expect(layout.flexDir).toBe('column');
  expect(layout.actionsTop).toBeGreaterThan(layout.titleTop);
  expect(layout.acceptVisible).toBe(true);
});

test('full end-to-end two-user sharing, mobile notification triage, collaborative editing, and Wayside connection', async ({ page }) => {
  // 1. User A (Alice) signs in with a Contacts sheet containing Bob (bob@example.com)
  await setMockUser(page, { id: 'alice', name: 'Alice', email: 'alice@example.com' });
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });

  // Add Bob to Alice's Contacts sheet (sheet-077)
  await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    await api.sheets.getSpreadsheet('sheet-077');
    await api.sheets.appendRows('sheet-077', 'Sheet1', [[
      'Bob Trailmate', 'Partner', 'bob@example.com', '555-0199', 'Trail Crew', '', '',
    ]]);
  });

  // 2. Alice opens Groceries (sheet-001), opens Share Modal, selects Bob from Contacts picker, and grants Writer access
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });
  await page.click('#share-btn');
  await page.waitForSelector('#share-modal', { timeout: 5_000 });

  await page.waitForSelector('.share-invite-contact-select option[value="bob@example.com"]', { state: 'attached', timeout: 5_000 });
  await page.selectOption('.share-invite-contact-select', 'bob@example.com');
  await expect(page.locator('.share-invite-email')).toHaveValue('bob@example.com');
  await page.selectOption('.share-invite-role', 'writer');
  await page.click('.share-invite-grant-btn');
  await page.waitForSelector('.toast', { timeout: 5_000 });

  const inviteLink = await page.locator('.share-invite-link').inputValue();
  expect(inviteLink).toContain('ledger=');
  await page.click('#share-modal .modal-close');

  // Verify ledger ID was written back into Alice's Contacts sheet for Bob
  const aliceLedgerId = await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    const data = await api.sheets.getSpreadsheet('sheet-077');
    const rows = data.tabs?.[0]?.values || data.values || [];
    const bobRow = rows.find(r => (r[2] || '').toLowerCase() === 'bob@example.com');
    return bobRow ? bobRow[5] : '';
  });
  expect(aliceLedgerId).toBeTruthy();

  // 3. Open a second browser page for User B (Bob) on a mobile viewport (375x812)
  const bobPage = await page.context().newPage();
  await bobPage.setViewportSize({ width: 375, height: 812 });
  await setMockUser(bobPage, { id: 'bob', name: 'Bob', email: 'bob@example.com' });
  await setupApp(bobPage);
  await bobPage.evaluate(async (ledgerId) => {
    const collab = await import('/js/collab.js');
    const storage = await import('/js/storage.js');
    storage.setNotifications([]);
    await collab.registerSharedLedger({
      sheetId: ledgerId,
      contactEmail: 'alice@example.com',
      ownerEmail: 'alice@example.com',
    });
  }, aliceLedgerId);

  // 4. Bob sees the unread notification badge on mobile, opens the bell popup, verifies it is on-screen, and clicks Accept
  await expect(bobPage.locator('.notif-bell-badge')).toBeVisible({ timeout: 5_000 });
  await bobPage.click('.notif-bell');
  await bobPage.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3_000 });

  const bobPanelBox = await bobPage.locator('.notif-panel').boundingBox();
  expect(bobPanelBox.x).toBeGreaterThanOrEqual(0);
  expect(bobPanelBox.x + bobPanelBox.width).toBeLessThanOrEqual(375);

  const acceptBtn = bobPage.locator('.notif-accept-btn').first();
  await expect(acceptBtn).toBeVisible();
  await acceptBtn.click();
  await expect(bobPage.locator('.notif-decision-badge').first()).toContainText('Accepted');

  // 5. Bob opens the shared Groceries Waymark and logs a collaborative change
  await navigateToSheet(bobPage, 'sheet-001');
  await bobPage.waitForSelector('#checklist-items', { timeout: 5_000 });
  await bobPage.evaluate(async () => {
    const collab = await import('/js/collab.js');
    await collab.notifySheetMutation({
      docId: 'sheet-001',
      docTitle: 'Grocery List',
      waymarkType: 'checklist',
      action: 'add',
      rowLabel: 'Trail Mix',
    });
    await collab.sendChat({ contactEmail: 'alice@example.com' }, 'Accepted the list and added Trail Mix!');
  });

  // 6. Back on Alice's page, reload to pick up shared mock sheet updates from Bob's session and poll ledgers
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
  const aliceSync = await page.evaluate(async (ledgerId) => {
    const collab = await import('/js/collab.js');
    const storage = await import('/js/storage.js');
    const userData = await import('/js/user-data.js');
    await userData.addShareLedger({
      key: 'contact-pair:alice@example.com::bob@example.com',
      contactEmail: 'bob@example.com',
      sheetId: ledgerId,
      ownerEmail: 'alice@example.com',
    });
    const pushed = await collab.pollShareLedgers();
    const notifs = storage.getNotifications();
    const chat = await collab.readChat({ contactEmail: 'bob@example.com' });
    return {
      pushed,
      hasUpdateNotif: notifs.some(n => n.type === 'update' && n.sheetId === 'sheet-001' && n.body.includes('Trail Mix')),
      hasChatNotif: notifs.some(n => n.type === 'chat' && n.body.includes('Accepted the list')),
      chatTexts: chat.map(m => m.text),
    };
  }, aliceLedgerId);

  expect(aliceSync.pushed).toBeGreaterThanOrEqual(2);
  expect(aliceSync.hasUpdateNotif).toBe(true);
  expect(aliceSync.hasChatNotif).toBe(true);
  expect(aliceSync.chatTexts).toContain('Accepted the list and added Trail Mix!');

  // 7. Alice clicks the Call button in the notification popup to start a Wayside call with Bob
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3_000 });
  await page.locator('.notif-call-btn').first().click();

  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call', { timeout: 5_000 });
  await page.click('#wayside-call-btn');
  await bobPage.close();
});


