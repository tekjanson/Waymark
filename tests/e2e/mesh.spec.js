const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ============================================================
   mesh.spec.js — E2E tests for Browser Mesh features

   Tests the mesh config UI in settings, opt-in/opt-out behavior,
   and command channel fundamentals. Mesh is OFF by default.
   ============================================================ */

/* ---------- Settings UI — Mesh Section Rendering ---------- */

test('mesh settings section renders in settings modal', async ({ page }) => {
  await setupApp(page);
  // Open settings via avatar click
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  // Mesh section should exist
  const section = page.locator('#settings-mesh-section');
  await expect(section).toBeVisible();
  await expect(section.locator('h4')).toContainText('Browser Mesh');
});

test('mesh is disabled by default — toggle unchecked', async ({ page }) => {
  await setupApp(page);
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  const toggle = page.locator('#settings-mesh-enabled');
  await expect(toggle).not.toBeChecked();
});

test('mesh details are hidden when mesh is disabled', async ({ page }) => {
  await setupApp(page);
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  const details = page.locator('.mesh-config-details');
  await expect(details).toBeHidden();
});

/* ---------- Enable/Disable Toggle ---------- */

test('enabling mesh reveals config details and shows toast', async ({ page }) => {
  await setupApp(page);
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  // Enable mesh
  await page.click('#settings-mesh-enabled');
  await expect(page.locator('#settings-mesh-enabled')).toBeChecked();

  // Details should become visible
  const details = page.locator('.mesh-config-details');
  await expect(details).toBeVisible();

  // Toast should appear
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast').first()).toContainText('Mesh enabled');
});

test('disabling mesh hides config details', async ({ page }) => {
  await setupApp(page);
  // Pre-seed mesh enabled
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  // Should be checked initially
  await expect(page.locator('#settings-mesh-enabled')).toBeChecked();
  await expect(page.locator('.mesh-config-details')).toBeVisible();

  // Disable mesh
  await page.click('#settings-mesh-enabled');
  await expect(page.locator('#settings-mesh-enabled')).not.toBeChecked();
  await expect(page.locator('.mesh-config-details')).toBeHidden();
});

/* ---------- Status Indicator ---------- */

test('status shows disabled when mesh is off', async ({ page }) => {
  await setupApp(page);
  // Pre-enable mesh to see status, then check
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  // Status dot should exist and reflect listening state
  const dot = page.locator('.mesh-status-dot');
  await expect(dot).toBeVisible();
});

test('mesh status text shows peer ID when enabled', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  const statusText = page.locator('.mesh-status-text');
  await expect(statusText).toContainText('Peer ID');
});

/* ---------- Connection Settings Inputs ---------- */

test('connection settings inputs have correct default values', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  // Max peers default: 10
  const maxPeers = page.locator('#settings-mesh-max-peers');
  await expect(maxPeers).toHaveValue('10');

  // Timeout default: 30000
  const timeout = page.locator('#settings-mesh-timeout');
  await expect(timeout).toHaveValue('30000');

  // Heartbeat default: 15000
  const heartbeat = page.locator('#settings-mesh-heartbeat');
  await expect(heartbeat).toHaveValue('15000');
});

test('changing max peers persists to localStorage', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  const maxPeers = page.locator('#settings-mesh-max-peers');
  await maxPeers.fill('5');
  await maxPeers.dispatchEvent('change');

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_mesh_max_peers'))
  );
  expect(stored).toBe(5);
});

/* ---------- Sub-Feature Toggles ---------- */

test('sub-feature toggles render and default to off', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  // All sub-feature toggles should be unchecked by default
  await expect(page.locator('#settings-mesh-task-queue')).not.toBeChecked();
  await expect(page.locator('#settings-mesh-crdt')).not.toBeChecked();
  await expect(page.locator('#settings-mesh-eval-farm')).not.toBeChecked();
  await expect(page.locator('#settings-mesh-swarm')).not.toBeChecked();
});

test('enabling a sub-feature persists to storage', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  // Enable task queue
  await page.click('#settings-mesh-task-queue');
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_mesh_task_queue'))
  );
  expect(stored).toBe(true);
});

/* ---------- ICE Server Configuration ---------- */

test('ICE server textarea is editable', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  const textarea = page.locator('#settings-mesh-ice');
  await expect(textarea).toBeVisible();
  await textarea.fill('stun:custom.stun.example.com:3478');
  await textarea.dispatchEvent('change');

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_mesh_ice_servers'))
  );
  expect(stored).toEqual([{ urls: 'stun:custom.stun.example.com:3478' }]);
});

/* ---------- Opt-Out Safety ---------- */

test('no WebRTC connections when mesh is disabled', async ({ page }) => {
  await setupApp(page);

  // Verify no BroadcastChannel messages are posted
  const bcActivity = await page.evaluate(() => {
    return new Promise(resolve => {
      const bc = new BroadcastChannel('waymark-mesh');
      let received = false;
      bc.onmessage = () => { received = true; };
      setTimeout(() => {
        bc.close();
        resolve(received);
      }, 1000);
    });
  });

  expect(bcActivity).toBe(false);
});

/* ---------- Worker Concurrency Setting ---------- */

test('worker concurrency input has correct default', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  const concurrency = page.locator('#settings-mesh-concurrency');
  await expect(concurrency).toHaveValue('3');
});

/* ---------- Settings Modal Close and Reopen ---------- */

test('mesh settings persist across modal close and reopen', async ({ page }) => {
  await setupApp(page);

  // Open settings and enable mesh
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });
  await page.click('#settings-mesh-enabled');
  await expect(page.locator('#settings-mesh-enabled')).toBeChecked();

  // Close modal
  await page.click('#settings-done-btn');
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);

  // Reopen modal — mesh should still be enabled
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#settings-mesh-enabled')).toBeChecked();
  await expect(page.locator('.mesh-config-details')).toBeVisible();
});

/* ---------- Responsive: Settings on Mobile ---------- */

test('mesh settings render at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_mesh_enabled', 'true');
  });
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });

  // On mobile, #user-name is display:none — open modal directly
  await page.evaluate(() => {
    document.getElementById('settings-modal').classList.remove('hidden');
  });
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });

  const section = page.locator('#settings-mesh-section');
  await expect(section).toBeVisible();

  // Check nothing overflows
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('#settings-mesh-section *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className || el.tagName);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ============================================================
   Template: Mesh Queue (sheet-057)

   Tests the task queue sheet template — detection, rendering,
   interaction (status cycling, detail panels), visual polish,
   and data persistence via emitEdit.
   ============================================================ */

const { navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ---------- Layer 1: Detection & Rendering ---------- */

test('mesh template detected for sheet-057', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-task-row', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Mesh Queue');
});

test('mesh template renders all 6 task rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-task-row', { timeout: 5_000 });

  await expect(page.locator('.mesh-task-row')).toHaveCount(6);
});

test('mesh template renders header with Task Queue title', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-header', { timeout: 5_000 });

  await expect(page.locator('.mesh-header')).toBeVisible();
  await expect(page.locator('.mesh-header-title')).toContainText('Task Queue');
  await expect(page.locator('.mesh-col-labels')).toBeVisible();
});

test('mesh template renders task IDs truncated to 16 chars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-task-id', { timeout: 5_000 });

  const ids = page.locator('.mesh-task-id');
  const count = await ids.count();
  for (let i = 0; i < count; i++) {
    const txt = await ids.nth(i).textContent();
    expect(txt.trim().length).toBeLessThanOrEqual(16);
  }
});

test('mesh template renders all five status badge classes from fixture', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-status', { timeout: 5_000 });

  // Fixture has done, running, pending, failed, cancelled tasks
  await expect(page.locator('.mesh-status-done').first()).toBeVisible();
  await expect(page.locator('.mesh-status-running').first()).toBeVisible();
  await expect(page.locator('.mesh-status-pending').first()).toBeVisible();
  await expect(page.locator('.mesh-status-failed').first()).toBeVisible();
  await expect(page.locator('.mesh-status-cancelled').first()).toBeVisible();
});

test('mesh template renders high, normal, and low priority badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-priority', { timeout: 5_000 });

  await expect(page.locator('.mesh-priority-high').first()).toBeVisible();
  await expect(page.locator('.mesh-priority-normal').first()).toBeVisible();
  await expect(page.locator('.mesh-priority-low').first()).toBeVisible();
});

/* ---------- Layer 2: Human-Style Workflow ---------- */

test('mesh template shows summary with progress bar and task count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-summary', { timeout: 5_000 });

  await expect(page.locator('.mesh-progress-bar')).toBeVisible();
  // 1 done out of 6 = 16%
  await expect(page.locator('.mesh-progress-label')).toContainText('% done');
  await expect(page.locator('.mesh-progress-label')).toContainText('6 tasks');
});

test('mesh template status badge click cycles pending → done and updates text', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-status', { timeout: 5_000 });

  const allBadges = page.locator('.mesh-status');
  const count = await allBadges.count();
  let pendingIdx = -1;
  for (let i = 0; i < count; i++) {
    const cls = await allBadges.nth(i).getAttribute('class');
    if (cls && cls.includes('mesh-status-pending')) { pendingIdx = i; break; }
  }
  expect(pendingIdx).toBeGreaterThanOrEqual(0);

  const badge = allBadges.nth(pendingIdx);
  await badge.click();

  // STATUS_CYCLE: pending → done
  await expect(badge).toHaveClass(/mesh-status-done/);
  await expect(badge).toContainText('Done');
});

test('mesh template clicking task row shows detail panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-task-row:has(.mesh-detail)', { timeout: 5_000 });

  // Use :has() to find the first row with a detail panel
  const firstRowWithDetail = page.locator('.mesh-task-row:has(.mesh-detail)').first();
  const detailPanel = firstRowWithDetail.locator('.mesh-detail');

  // Detail starts hidden
  await expect(detailPanel).toHaveClass(/hidden/);

  // Click on the task-id (non-interactive, left edge) to bubble up to mainRow listener
  await firstRowWithDetail.locator('.mesh-task-id').click();
  await expect(detailPanel).not.toHaveClass(/hidden/);

  // Clicking again collapses it
  await firstRowWithDetail.locator('.mesh-task-id').click();
  await expect(detailPanel).toHaveClass(/hidden/);
});

test('mesh template detail panel shows input JSON', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-task-row:has(.mesh-detail)', { timeout: 5_000 });

  const firstRowWithDetail = page.locator('.mesh-task-row:has(.mesh-detail)').first();
  const detailPanel = firstRowWithDetail.locator('.mesh-detail');

  // Click the task-id to open the detail panel
  await firstRowWithDetail.locator('.mesh-task-id').click();
  await expect(detailPanel).not.toHaveClass(/hidden/);

  // Detail should show the Input section
  await expect(firstRowWithDetail.locator('.mesh-detail-label').first()).toContainText('Input');
  await expect(firstRowWithDetail.locator('.mesh-detail-json').first()).toBeVisible();
});

test('mesh template failed task detail shows error section', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-row-failed:has(.mesh-detail)', { timeout: 5_000 });

  const failedRow = page.locator('.mesh-row-failed');
  // Click task-id to open detail (non-interactive area, avoids status badge intercept)
  await failedRow.locator('.mesh-task-id').click();

  await expect(failedRow.locator('.mesh-detail')).not.toHaveClass(/hidden/);
  await expect(failedRow.locator('.mesh-detail-error')).toBeVisible();
  await expect(failedRow.locator('.mesh-detail-error-label')).toContainText('Error');
});

/* ---------- Layer 3: Interaction Quality ---------- */

test('mesh template status badges have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-status', { timeout: 5_000 });

  await expect(page.locator('.mesh-status').first()).toHaveCSS('cursor', 'pointer');
});

test('mesh template row classes reflect task status', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-task-row', { timeout: 5_000 });

  await expect(page.locator('.mesh-row-done').first()).toBeVisible();
  await expect(page.locator('.mesh-row-running').first()).toBeVisible();
  await expect(page.locator('.mesh-row-pending').first()).toBeVisible();
  await expect(page.locator('.mesh-row-failed').first()).toBeVisible();
  await expect(page.locator('.mesh-row-cancelled').first()).toBeVisible();
});

test('mesh template shows dash for tasks with no assigned worker', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-no-worker', { timeout: 5_000 });

  await expect(page.locator('.mesh-no-worker').first()).toContainText('—');
});

/* ---------- Layer 4: Visual Consistency ---------- */

test('mesh template renders without horizontal overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-task-row', { timeout: 5_000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.mesh-task-list *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.className);
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ---------- Layer 5: Data Persistence ---------- */

test('mesh template status badge click emits edit record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-status', { timeout: 5_000 });

  const allBadges = page.locator('.mesh-status');
  const count = await allBadges.count();
  let pendingIdx = -1;
  for (let i = 0; i < count; i++) {
    const cls = await allBadges.nth(i).getAttribute('class');
    if (cls && cls.includes('mesh-status-pending')) { pendingIdx = i; break; }
  }
  expect(pendingIdx).toBeGreaterThanOrEqual(0);

  await allBadges.nth(pendingIdx).click();

  const records = await getCreatedRecords(page);
  expect(records.length).toBeGreaterThan(0);
  // Status cycled to Done
  expect(records.some(r => r.value === 'Done')).toBe(true);
});

/* ---------- Layer 6: Edge Cases ---------- */

test('mesh template shows empty state for header-only sheet', async ({ page }) => {
  // Intercept the fixture file served by the dev server
  await page.route('**/__fixtures/sheets/mesh-queue.json', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'sheet-057',
        title: 'Waymark Task Queue',
        sheetTitle: 'Sheet1',
        values: [['Task ID', 'Type', 'Status', 'Priority', 'Worker ID', 'Created', 'Started', 'Completed', 'Input', 'Output', 'Error']],
      }),
    });
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.mesh-task-list', { timeout: 5_000 });
  await expect(page.locator('.mesh-empty')).toBeVisible();
  await expect(page.locator('.mesh-empty')).toContainText('No tasks');
  // Summary should not be shown for empty queue
  await expect(page.locator('.mesh-summary')).toHaveCount(0);
});
