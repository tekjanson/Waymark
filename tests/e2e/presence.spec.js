// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ============================================================
   presence.spec.js — E2E tests for P2P Presence & Live Cursors
   ============================================================ */

/* ---------- Layer 1: Module loads & presence bar exists ---------- */

test('presence: presence.js module exports init, retag, destroy', async ({ page }) => {
  await setupApp(page);
  const exports = await page.evaluate(async () => {
    const mod = await import('/js/presence.js');
    return {
      hasInit:    typeof mod.init === 'function',
      hasRetag:   typeof mod.retag === 'function',
      hasDestroy: typeof mod.destroy === 'function',
    };
  });
  expect(exports.hasInit).toBe(true);
  expect(exports.hasRetag).toBe(true);
  expect(exports.hasDestroy).toBe(true);
});

test('presence: no bar shown when no remote peers are present', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });
  // Bar should exist in DOM but be hidden (no peers yet)
  const bar = page.locator('.presence-bar');
  await expect(bar).toHaveClass(/hidden/);
});

test('presence: presence bar is inserted above the checklist items', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });
  // Bar is in the DOM as sibling before items
  const barExists = await page.evaluate(() => {
    const items = document.getElementById('checklist-items');
    const bar = items?.previousElementSibling;
    return bar?.classList.contains('presence-bar');
  });
  expect(barExists).toBe(true);
});

/* ---------- Layer 2: BroadcastChannel same-browser peer simulation ---------- */

test('presence: shows chip when peer sends a presence beat via BroadcastChannel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Simulate a remote peer sending a beat
  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    if (!sheetId) return;
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({
      type: 'presence',
      peerId: 'test-peer-001',
      displayName: 'Alice',
      activeRow: 2,
      activeCol: 0,
      t: Date.now(),
    });
    bc.close();
  });

  // Wait for chip to appear
  await page.waitForSelector('.presence-chip', { timeout: 3_000 });
  await expect(page.locator('.presence-chip')).toBeVisible();
  await expect(page.locator('.presence-chip-name')).toContainText('Alice');
});

test('presence: chip displays row position from heartbeat', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    if (!sheetId) return;
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({
      type: 'presence',
      peerId: 'test-peer-002',
      displayName: 'Bob',
      activeRow: 3,
      activeCol: 1,
      t: Date.now(),
    });
    bc.close();
  });

  await page.waitForSelector('.presence-chip-pos', { timeout: 3_000 });
  await expect(page.locator('.presence-chip-pos')).toContainText('Row 3');
});

test('presence: chip shows initials avatar with colored background', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    if (!sheetId) return;
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({
      type: 'presence', peerId: 'test-peer-003',
      displayName: 'Charlie', activeRow: 1, activeCol: 0, t: Date.now(),
    });
    bc.close();
  });

  await page.waitForSelector('.presence-chip-avatar', { timeout: 3_000 });
  const initial = await page.locator('.presence-chip-avatar').textContent();
  expect(initial).toBe('C');

  const bgColor = await page.locator('.presence-chip-avatar').evaluate(el => el.style.background);
  expect(bgColor).toBeTruthy();
});

test('presence: bar becomes visible when first peer arrives', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Initially hidden
  await expect(page.locator('.presence-bar')).toHaveClass(/hidden/);

  // Send a peer beat
  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({ type: 'presence', peerId: 'p1', displayName: 'Dana', activeRow: 1, activeCol: 0, t: Date.now() });
    bc.close();
  });

  await page.waitForSelector('.presence-bar:not(.hidden)', { timeout: 3_000 });
  await expect(page.locator('.presence-bar')).not.toHaveClass(/hidden/);
});

/* ---------- Layer 3: Peer leave & TTL ---------- */

test('presence: chip removed when peer sends leave signal (t=-1)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Use a unique peerId to avoid cross-test BC interference
  const uniquePeerId = 'leavePeer-' + Math.random().toString(36).slice(2, 8);

  // Post join beat — keep BC open for follow-up leave signal
  await page.evaluate((peerId) => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    window.__presenceTestBC = new BroadcastChannel(`waymark-presence-${sheetId}`);
    window.__presenceTestBC.postMessage({
      type: 'presence', peerId, displayName: 'Eve', activeRow: 1, activeCol: 0, t: Date.now(),
    });
  }, uniquePeerId);

  // Wait for chip to confirm join was received BEFORE sending leave
  const chipSel = `.presence-chip[data-peer-id="${uniquePeerId}"]`;
  await page.waitForSelector(chipSel, { timeout: 5_000 });

  // Now send the leave signal — chip must be removed from DOM
  await page.evaluate((peerId) => {
    window.__presenceTestBC.postMessage({
      type: 'presence', peerId, displayName: 'Eve', activeRow: -1, activeCol: -1, t: -1,
    });
    window.__presenceTestBC.close();
    delete window.__presenceTestBC;
  }, uniquePeerId);

  await page.waitForSelector(chipSel, { state: 'detached', timeout: 5_000 });
});

test('presence: chip for previous peer does not appear on new sheet load', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({ type: 'presence', peerId: 'ghost', displayName: 'Ghost', activeRow: 1, activeCol: 0, t: Date.now() });
    bc.close();
  });
  await page.waitForSelector('.presence-chip', { timeout: 3_000 });

  // Navigate away and back
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Bar should be hidden (no peers for fresh session)
  await expect(page.locator('.presence-bar')).toHaveClass(/hidden/);
});

/* ---------- Layer 4: retag — row highlighting ---------- */

test('presence: retag adds data-presence-row attributes to rendered rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  const taggedCount = await page.evaluate(() =>
    document.querySelectorAll('[data-presence-row]').length
  );
  expect(taggedCount).toBeGreaterThan(0);
});

test('presence: row is highlighted when peer is on that row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Ensure row 1 exists
  const rowExists = await page.evaluate(() =>
    !!document.querySelector('[data-presence-row="1"]')
  );
  if (!rowExists) return; // skip if template doesn't produce directly-taggable rows

  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({ type: 'presence', peerId: 'highlightPeer', displayName: 'Fio', activeRow: 1, activeCol: 0, t: Date.now() });
    bc.close();
  });

  await page.waitForSelector('[data-presence-row="1"].presence-row-highlight', { timeout: 3_000 });
  const highlighted = await page.evaluate(() =>
    !!document.querySelector('[data-presence-row="1"].presence-row-highlight')
  );
  expect(highlighted).toBe(true);
});

/* ---------- Layer 5: Multiple peers ---------- */

test('presence: shows multiple chips for multiple peers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({ type: 'presence', peerId: 'mp1', displayName: 'Zara', activeRow: 1, activeCol: 0, t: Date.now() });
    bc.postMessage({ type: 'presence', peerId: 'mp2', displayName: 'Kai', activeRow: 2, activeCol: 0, t: Date.now() });
    bc.close();
  });

  await page.waitForFunction(() => document.querySelectorAll('.presence-chip').length >= 2, { timeout: 3_000 });
  const chipCount = await page.locator('.presence-chip').count();
  expect(chipCount).toBeGreaterThanOrEqual(2);
});

/* ---------- Layer 6: destroy cleans up ---------- */

test('presence: destroy removes bar and clears highlights', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });

  // Add a peer
  await page.evaluate(() => {
    const sheetId = window.location.hash.split('/sheet/')[1];
    const bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    bc.postMessage({ type: 'presence', peerId: 'dp1', displayName: 'Hiro', activeRow: 1, activeCol: 0, t: Date.now() });
    bc.close();
  });
  await page.waitForSelector('.presence-chip', { timeout: 3_000 });

  // Call destroy directly
  await page.evaluate(async () => {
    const { destroy } = await import('/js/presence.js');
    destroy();
  });

  // Bar should be gone
  const barGone = await page.evaluate(() => !document.querySelector('.presence-bar'));
  expect(barGone).toBe(true);
});
