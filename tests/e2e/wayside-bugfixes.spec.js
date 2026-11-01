// @ts-check
/**
 * wayside-bugfixes.spec.js — regressions for the "wayboard bugs" sheet:
 * clickable chat links, optimistic/live chat, mic+camera release on call end,
 * accept-share Picker authorisation, and no re-prompt for decided shares.
 */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

test.use({
  permissions: ['microphone', 'camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('links in Wayside chat render as real anchors and never inject markup', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#home-wayside', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const { appendLinkified } = await import('/js/wayboard.js');
    const div = document.createElement('div');
    appendLinkified(div, 'see https://example.com/a?b=1, and <img src=x onerror=alert(1)> ok.');
    return {
      hrefs: [...div.querySelectorAll('a')].map(a => a.getAttribute('href')),
      targets: [...div.querySelectorAll('a')].map(a => a.getAttribute('target')),
      imgs: div.querySelectorAll('img').length,
      text: div.textContent,
    };
  });
  expect(result.hrefs).toEqual(['https://example.com/a?b=1']); // trailing comma trimmed
  expect(result.targets).toEqual(['_blank']);
  expect(result.imgs).toBe(0);
  expect(result.text).toContain('<img src=x');
});

test('Wayside chat message appears instantly without waiting for the sheet', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  await page.fill('#wayside-chat-input', 'hello https://example.com/x');
  await page.press('#wayside-chat-input', 'Enter');
  const line = page.locator('#wayside-chat-log .chat-self').last();
  await expect(line).toContainText('hello');
  await expect(line.locator('a')).toHaveAttribute('href', 'https://example.com/x');
});

test('ending a call releases the microphone even if the permission prompt was still pending', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#home-wayside', { timeout: 5_000 });

  const stopped = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    let resolveGum;
    const track = { stopped: false, stop() { this.stopped = true; }, kind: 'audio' };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => new Promise(r => { resolveGum = () => r(stream); }) },
    });
    const wc = new WaymarkConnect('race-test', { displayName: 'x' });
    const pending = wc.startCall({ audio: true, video: false }).catch(e => e.name);
    wc.endCall();          // user hangs up while the browser is still prompting
    resolveGum();          // permission granted afterwards
    const outcome = await pending;
    return { outcome, trackStopped: track.stopped, inCall: wc.inCall };
  });
  expect(stopped.outcome).toBe('AbortError');
  expect(stopped.trackStopped).toBe(true);
  expect(stopped.inCall).toBe(false);
});

test('accepting a share the app cannot read opens the Google Picker first; cancelling keeps it pending', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#home-wayside', { timeout: 5_000 });

  const res = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const storage = await import('/js/storage.js');
    const { api } = await import('/js/api-client.js');
    const origGet = api.sheets.getSpreadsheet;
    const origPick = api.picker.pickSpreadsheetForInvite;
    let pickerCalls = 0;
    let authorized = false;
    api.sheets.getSpreadsheet = async (id) => {
      if (id === 'unreadable-doc' && !authorized) throw new Error('403 not authorised');
      return origGet.call(api.sheets, id === 'unreadable-doc' ? 'sheet-001' : id);
    };
    api.picker.pickSpreadsheetForInvite = async () => { pickerCalls++; return null; };
    const cancelled = await collab.acceptSharedWaymark({ docId: 'unreadable-doc', docTitle: 'Shared thing' });
    const acceptedAfterCancel = storage.isShareAccepted('unreadable-doc');

    api.picker.pickSpreadsheetForInvite = async () => { pickerCalls++; authorized = true; return { id: 'unreadable-doc', name: 'Shared thing' }; };
    const ok = await collab.acceptSharedWaymark({ docId: 'unreadable-doc', docTitle: 'Shared thing' });
    const acceptedAfterPick = storage.isShareAccepted('unreadable-doc');

    api.sheets.getSpreadsheet = origGet;
    api.picker.pickSpreadsheetForInvite = origPick;
    return { cancelled, acceptedAfterCancel, ok, acceptedAfterPick, pickerCalls };
  });
  expect(res.cancelled).toBe(false);
  expect(res.acceptedAfterCancel).toBe(false);
  expect(res.ok).toBe(true);
  expect(res.acceptedAfterPick).toBe(true);
  expect(res.pickerCalls).toBe(2);
});

test('an accepted share is not re-announced when the ledger is re-polled, and Clear all survives a re-sync', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  const res = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const storage = await import('/js/storage.js');
    const notif = await import('/js/notifications.js');
    const { api } = await import('/js/api-client.js');
    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'spam@example.com' });
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-001', 'Groceries', 'checklist', 'testuser@gmail.com', '', 'writer', new Date().toISOString(), 'Shared',
    ]]);
    await collab.pollShareLedgers();
    await collab.acceptSharedWaymark({ docId: 'sheet-001', ledgerSheetId: sheetId });

    // Simulate a reload that lost the cursor: the ledger is read from row 0 again.
    storage.setBilateralCursor(sheetId, 0);
    storage.setBilateralCursor(`testuser@gmail.com:${sheetId}`, 0);
    storage.setNotifications([]);
    await collab.pollShareLedgers();
    const shareNotifs = storage.getNotifications().filter(n => n.type === 'share').length;

    // addNotification keeps one share prompt per document.
    notif.addNotification({ id: 'a', type: 'share', title: 'A shared X', sheetId: 'doc-1' });
    notif.addNotification({ id: 'b', type: 'share', title: 'B shared X', sheetId: 'doc-1' });
    const perDoc = storage.getNotifications().filter(n => n.sheetId === 'doc-1').length;

    notif.clearAll();
    return { shareNotifs, perDoc, cleared: storage.getClearedNotifKeys().length > 0 };
  });
  expect(res.shareNotifs).toBe(0);
  expect(res.perDoc).toBe(1);
  expect(res.cleared).toBe(true);
});

test('clicking close (✕) button in Wayside closes chat and restores placeholder even with 1 contact', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  // Crew is auto-selected, close button is visible
  const closeBtn = page.locator('#wayside-close-btn');
  await expect(closeBtn).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#wayside-chat-input')).toBeVisible();

  // Click close button
  await closeBtn.click();

  // Empty state is restored
  await expect(page.locator('#wayside-placeholder')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#wayside-sheet-line')).toContainText('Pick a crew or Waymarker');
  await expect(page.locator('.crew-row.active')).toHaveCount(0);

  // Click the crew row again to reopen
  await page.locator('#home-wayside .crew-row').first().click();
  await expect(page.locator('#wayside-close-btn')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#wayside-chat-input')).toBeVisible();
});

test('Wayside video call activates media container, local video PiP, and call controls', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  // Start video call using the dedicated video call button
  await page.click('#wayside-video-call-btn');
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call', { timeout: 5_000 });

  // Media container and local video are visible
  const mediaContainer = page.locator('#wayside-media-container');
  await expect(mediaContainer).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#wayside-local-video')).toBeVisible();
  await expect(page.locator('#wayside-remote-video')).toBeVisible();

  // Call bar controls are visible
  const muteBtn = page.locator('#wayside-mute-btn');
  const camBtn = page.locator('#wayside-cam-btn');
  await expect(muteBtn).toBeVisible();
  await expect(camBtn).toBeVisible();

  // Toggle mute and camera
  await muteBtn.click();
  await expect(muteBtn).toContainText('Unmute');
  await muteBtn.click();
  await expect(muteBtn).toContainText('Mute');

  await camBtn.click();
  await expect(camBtn).toContainText('Cam On');
  await camBtn.click();
  await expect(camBtn).toContainText('Cam Off');

  // End call
  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toHaveText('📹 Call');
  await expect(mediaContainer).toBeHidden();
});

test('Wayside audio call starts voice session without showing video container', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  // Start audio call using the primary call button
  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call', { timeout: 5_000 });

  // Media container stays hidden for audio-only calls
  const mediaContainer = page.locator('#wayside-media-container');
  await expect(mediaContainer).toBeHidden();

  // Call bar controls: mute is visible, cam button is hidden
  const muteBtn = page.locator('#wayside-mute-btn');
  const camBtn = page.locator('#wayside-cam-btn');
  await expect(muteBtn).toBeVisible();
  await expect(camBtn).toBeHidden();

  // End call
  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toHaveText('📹 Call');
});

test('Wayside incoming call displays animated incoming card with Accept, Accept Video, and Decline', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  // Start + end a call so the signaling mesh (and window.__WAYMARK_CONNECT) exists
  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call', { timeout: 5_000 });
  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toHaveText('📹 Call');

  // Trigger an incoming call through the real signaling hook
  await page.evaluate(() => {
    if (window.__WAYMARK_CONNECT?.onCallActive) {
      window.__WAYMARK_CONNECT.onCallActive('peer-alice', 'Alice Explorer');
    }
  });

  const card = page.locator('.wayside-incoming-call');
  await expect(card).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.social-incoming-caller')).toContainText('Alice Explorer');
  await expect(page.locator('.social-incoming-accept')).toBeVisible();
  await expect(page.locator('.social-incoming-accept-video')).toBeVisible();
  const declineBtn = page.locator('.social-incoming-decline');
  await expect(declineBtn).toBeVisible();

  // Decline hides incoming call card and adds system decline message
  await declineBtn.click();
  await expect(card).toBeHidden();
  await expect(page.locator('#wayside-chat-log')).toContainText('You declined the call');
});

test('re-clicking the active crew does not leak or duplicate chat widgets', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  // Crew is auto-selected; count the number of inputs and chat logs
  await expect(page.locator('#wayside-chat-input')).toHaveCount(1);
  await expect(page.locator('#wayside-chat-log')).toHaveCount(1);

  // Re-click the first crew row twice
  await page.locator('#home-wayside .crew-row').first().click();
  await page.locator('#home-wayside .crew-row').first().click();

  // Exactly one widget remains mounted
  await expect(page.locator('#wayside-chat-input')).toHaveCount(1);
  await expect(page.locator('#wayside-chat-log')).toHaveCount(1);
  await expect(page.locator('#wayside-call-btn')).toHaveCount(1);
});

test('an active Wayside call survives a home re-render (pins changed / navigating back home)', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  await page.click('#wayside-video-call-btn');
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call', { timeout: 5_000 });

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('waymark:pins-changed')));
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  // Same widget is re-mounted with the live call intact
  await expect(page.locator('.social-chat-panel')).toHaveCount(1);
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call');
  await expect(page.locator('#wayside-media-container')).toBeVisible();
  const state = await page.evaluate(() => ({
    inCall: window.__WAYMARK_CONNECT?.inCall,
    tracksLive: window.__WAYMARK_CONNECT?.localStream?.getTracks().every(t => t.readyState === 'live'),
  }));
  expect(state.inCall).toBe(true);
  expect(state.tracksLive).toBe(true);
});

test('SocialChatWidget never renders literal "null" text in header or root and exchanges bidirectional video + audio between two peers', async ({ page }) => {
  // A real two-peer WebRTC handshake (ICE + DTLS + renegotiation glare) is
  // CPU-bound; under heavy parallel test load the connection legitimately takes
  // longer, so give this test extra headroom beyond the 30s default.
  test.setTimeout(60_000);
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  // 1. Verify no literal "null" text node appears anywhere in the Wayside widget header or subtitle
  const textCheck = await page.evaluate(() => {
    const header = document.querySelector('#home-wayside .social-chat-header');
    const subtitle = document.querySelector('#home-wayside #wayside-sheet-line');
    const directNullNodes = [];
    for (const el of [header, subtitle, document.querySelector('#home-wayside .social-chat-panel')]) {
      if (!el) continue;
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === 'null') {
          directNullNodes.push(el.className);
        }
      }
    }
    return {
      headerText: header?.textContent || '',
      subtitleText: subtitle?.textContent || '',
      directNullNodes,
    };
  });
  expect(textCheck.directNullNodes).toEqual([]);
  expect(textCheck.headerText).not.toContain('null');
  expect(textCheck.subtitleText).not.toContain('Linked: null');

  // 2. Mount two SocialChatWidget peers on a shared room and run a full bidirectional video + audio call,
  //    including simultaneous renegotiation (glare) over DataChannel.
  const callResult = await page.evaluate(async () => {
    const { SocialChatWidget } = await import('/js/social-widget.js');

    // Shared in-memory sheet signal store for 2 peers
    const cells = Array.from({ length: 45 }, () => Array(21).fill(''));
    const makeSignal = () => ({
      readAll: async () => cells.map(r => [...r]),
      writeCell: async (row, col, val) => {
        if (!cells[row]) cells[row] = Array(21).fill('');
        cells[row][col] = val;
      },
    });

    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    document.body.append(hostA, hostB);

    const widgetA = new SocialChatWidget({
      mode: 'embedded',
      sheetId: 'call-room-e2e',
      displayName: 'Alice',
      signal: makeSignal(),
      mountTo: hostA,
    });
    const widgetB = new SocialChatWidget({
      mode: 'floating',
      sheetId: 'call-room-e2e',
      displayName: 'Bob',
      signal: makeSignal(),
      mountTo: hostB,
    });

    try {
      // Wait for DataChannel between Alice and Bob to open
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const dcA = widgetA.session.connect?.connectedPeers()?.length || 0;
        const dcB = widgetB.session.connect?.connectedPeers()?.length || 0;
        if (dcA > 0 && dcB > 0) break;
        await new Promise(r => setTimeout(r, 50));
      }

      // Alice starts a video call and Bob accepts with video simultaneously (triggers glare test)
      await Promise.all([
        widgetA.toggleCall({ video: true }),
        widgetB.toggleCall({ video: true }),
      ]);

      // Wait for both peers to receive each other's remote video AND audio streams
      const mediaDeadline = Date.now() + 20000;
      while (Date.now() < mediaDeadline) {
        const aRemVideo = widgetA.remoteVideo?.srcObject?.getVideoTracks()?.length || 0;
        const bRemVideo = widgetB.remoteVideo?.srcObject?.getVideoTracks()?.length || 0;
        const aRemAudio = widgetA.remoteAudio?.srcObject?.getAudioTracks()?.length || 0;
        const bRemAudio = widgetB.remoteAudio?.srcObject?.getAudioTracks()?.length || 0;
        if (aRemVideo > 0 && bRemVideo > 0 && aRemAudio > 0 && bRemAudio > 0) break;
        await new Promise(r => setTimeout(r, 50));
      }

      const pcA = Array.from(widgetA.session.connect._rtc.values())[0]?.pc;
      const pcB = Array.from(widgetB.session.connect._rtc.values())[0]?.pc;

      // Let the status labels settle to their final state. After glare
      // renegotiation the DataChannel can briefly flip pairing→connected, so
      // poll for the settled value instead of sampling a transient.
      const statusDeadline = Date.now() + 10000;
      while (Date.now() < statusDeadline) {
        if (widgetA.statusLabel?.textContent === 'Connected'
          && widgetB.statusLabel?.textContent === 'Connected'
          && pcA?.signalingState === 'stable'
          && pcB?.signalingState === 'stable') break;
        await new Promise(r => setTimeout(r, 50));
      }

      return {
        statusA: widgetA.statusLabel?.textContent,
        statusB: widgetB.statusLabel?.textContent,
        signalingA: pcA?.signalingState,
        signalingB: pcB?.signalingState,
        aLocalVideo: widgetA.localVideo?.srcObject?.getVideoTracks()?.length || 0,
        bLocalVideo: widgetB.localVideo?.srcObject?.getVideoTracks()?.length || 0,
        aRemoteVideo: widgetA.remoteVideo?.srcObject?.getVideoTracks()?.length || 0,
        bRemoteVideo: widgetB.remoteVideo?.srcObject?.getVideoTracks()?.length || 0,
        aRemoteAudio: widgetA.remoteAudio?.srcObject?.getAudioTracks()?.length || 0,
        bRemoteAudio: widgetB.remoteAudio?.srcObject?.getAudioTracks()?.length || 0,
        aMediaVisible: !widgetA.mediaContainer.classList.contains('hidden'),
        bMediaVisible: !widgetB.mediaContainer.classList.contains('hidden'),
        aAudioCtxState: widgetA.session.connect?._audioCtx?.state,
        bAudioCtxState: widgetB.session.connect?._audioCtx?.state,
      };
    } finally {
      widgetA.destroy();
      widgetB.destroy();
      hostA.remove();
      hostB.remove();
    }
  });

  expect(callResult.statusA).toBe('Connected');
  expect(callResult.statusB).toBe('Connected');
  expect(callResult.signalingA).toBe('stable');
  expect(callResult.signalingB).toBe('stable');
  expect(callResult.aLocalVideo).toBe(1);
  expect(callResult.bLocalVideo).toBe(1);
  expect(callResult.aRemoteVideo).toBe(1);
  expect(callResult.bRemoteVideo).toBe(1);
  expect(callResult.aRemoteAudio).toBe(1);
  expect(callResult.bRemoteAudio).toBe(1);
  expect(callResult.aMediaVisible).toBe(true);
  expect(callResult.bMediaVisible).toBe(true);
});
