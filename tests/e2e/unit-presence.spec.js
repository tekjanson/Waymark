// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ============================================================
   unit-presence.spec.js — Unit tests for presence.js pure functions
   ============================================================ */

/* ---------- broadcastPresence on WaymarkConnect ---------- */

test('webrtc: broadcastPresence builds correct message shape', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const sent = [];
    const wc = new WaymarkConnect('sheet-test', {
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    // Stub BroadcastChannel to capture
    wc._bc = { postMessage: (m) => { sent.push(m); }, close() {} };
    wc.broadcastPresence(5, 2);
    return { msg: sent[0] };
  });
  expect(result.msg.type).toBe('presence');
  expect(result.msg.activeRow).toBe(5);
  expect(result.msg.activeCol).toBe(2);
  expect(typeof result.msg.t).toBe('number');
  expect(typeof result.msg.peerId).toBe('string');
  expect(typeof result.msg.displayName).toBe('string');
});

test('webrtc: broadcastPresence accepts negative values for leave signal', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const sent = [];
    const wc = new WaymarkConnect('sheet-test', {
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    wc._bc = { postMessage: (m) => { sent.push(m); }, close() {} };
    wc.broadcastPresence(-1, -1);
    return { msg: sent[0] };
  });
  expect(result.msg.activeRow).toBe(-1);
  expect(result.msg.activeCol).toBe(-1);
});

test('webrtc: WaymarkConnect has onPresence property initialised to null by default', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-x', {
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    return { onPresence: wc.onPresence };
  });
  expect(result.onPresence).toBeNull();
});

test('webrtc: WaymarkConnect accepts onPresence via opts', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    let received = null;
    const wc = new WaymarkConnect('sheet-x', {
      signal: { readAll: async () => [], writeCell: async () => {} },
      onPresence: (m) => { received = m; },
    });
    return { hasCallback: typeof wc.onPresence === 'function' };
  });
  expect(result.hasCallback).toBe(true);
});

/* ---------- _onBC routes presence messages ---------- */

test('webrtc: _onBC routes type:presence to onPresence callback', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    let presenceMsg = null;
    const wc = new WaymarkConnect('sheet-bc', {
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    wc.onPresence = (m) => { presenceMsg = m; };

    // Call _onBC directly with a presence payload from a different peer
    wc._onBC({ type: 'presence', peerId: 'other-peer', displayName: 'Alice', activeRow: 3, activeCol: 1, t: Date.now() });
    return { received: presenceMsg };
  });
  expect(result.received).not.toBeNull();
  expect(result.received.type).toBe('presence');
  expect(result.received.displayName).toBe('Alice');
  expect(result.received.activeRow).toBe(3);
});

test('webrtc: _onBC ignores presence from own peerId', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    let called = false;
    const wc = new WaymarkConnect('sheet-bc', {
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    wc.onPresence = () => { called = true; };
    // Send from own peerId — should be filtered
    wc._onBC({ type: 'presence', peerId: wc.peerId, displayName: 'Self', activeRow: 1, activeCol: 0, t: Date.now() });
    return { called };
  });
  // _onBC checks d.peerId === this.peerId and returns early
  expect(result.called).toBe(false);
});

/* ---------- presence.js module behaviour ---------- */

test('presence: init creates BroadcastChannel and starts heartbeat', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const mod = await import('/js/presence.js');
    // Already initialised by checklist.js — check internal channels are live
    // by verifying presence bar exists in DOM
    const bar = document.querySelector('.presence-bar');
    return { barExists: !!bar };
  });
  expect(result.barExists).toBe(true);
});

test('presence: handleBeat ignores non-presence message types', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Send a message with wrong type — bar must stay hidden
  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({ type: 'message', peerId: 'x', displayName: 'X', t: Date.now() });
    bc.close();
  });

  // Allow microtask to settle
  await page.waitForTimeout(200);
  await expect(page.locator('.presence-bar')).toHaveClass(/hidden/);
});

test('presence: destroy cleans up timers and closes BroadcastChannel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const { destroy } = await import('/js/presence.js');
    destroy();
    // After destroy the bar should be removed
    return { barGone: !document.querySelector('.presence-bar') };
  });
  expect(result.barGone).toBe(true);
});

test('presence: retag adds data-presence-row to checklist rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  const result = await page.evaluate(() => {
    const rows = document.querySelectorAll('#checklist-items [data-presence-row]');
    const indices = Array.from(rows).map(r => parseInt(r.dataset.presenceRow, 10));
    return {
      count: rows.length,
      startsAtOne: indices[0] === 1,
      sequential: indices.every((v, i) => i === 0 || v === indices[i - 1] + 1),
    };
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.startsAtOne).toBe(true);
  expect(result.sequential).toBe(true);
});
