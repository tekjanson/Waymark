/* ============================================================
   notification.spec.js — E2E tests for Notification template
   Tests: detection, rendering, filter pills, status cycling,
   "Use as Notification Sheet", expiry, source tags, sheet links,
   mobile layout, settings modal, and record emission.
   ============================================================ */

const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ---------- Layer 1: Detection & Settings-View Rendering ---------- */

test('notification template is detected for sheet-046', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-inline', { timeout: 5000 });
  await expect(page.locator('.notif-settings-inline')).toBeVisible();
});

test('notification sheet renders the settings control center', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-inline', { timeout: 5000 });
  await expect(page.locator('.notif-settings-inline-title')).toContainText('Notification Settings');
  await expect(page.locator('.notif-settings-grid')).toBeVisible();
});

test('settings view shows collaboration and built-in rule sections', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-inline', { timeout: 5000 });
  await expect(page.locator('.notif-collab-section')).toBeVisible();
  await expect(page.locator('.notif-sheet-section')).toBeVisible();
  await expect(page.locator('.notif-waymark-section')).toBeVisible();
});

/* ---------- Layer 2: Collaboration & rule toggles ---------- */

test('settings view renders four collaboration toggles with correct defaults', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-collab-toggle', { timeout: 5000 });
  expect(await page.locator('.notif-collab-toggle').count()).toBe(4);
  await expect(page.locator('.notif-collab-toggle[data-collab-key="collabShares"]')).toBeChecked();
  await expect(page.locator('.notif-collab-toggle[data-collab-key="collabChat"]')).toBeChecked();
  await expect(page.locator('.notif-collab-toggle[data-collab-key="collabAgent"]')).toBeChecked();
  await expect(page.locator('.notif-collab-toggle[data-collab-key="collabUpdates"]')).not.toBeChecked();
});

test('built-in rule toggles render unchecked by default in the sheet view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-toggle', { timeout: 5000 });
  const toggles = page.locator('.notif-settings-toggle');
  expect(await toggles.count()).toBe(4);
  const count = await toggles.count();
  for (let i = 0; i < count; i++) {
    await expect(toggles.nth(i)).not.toBeChecked();
  }
});

/* ---------- Layer 3: Auto-save (no Save button inline) ---------- */

test('toggling a collaboration setting auto-saves to localStorage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-collab-toggle[data-collab-key="collabChat"]', { timeout: 5000 });
  await page.locator('.notif-collab-toggle[data-collab-key="collabChat"]').uncheck();
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_notification_settings') || '{}')
  );
  expect(settings.collabChat).toBe(false);
});

test('enabling a built-in rule in the sheet view auto-saves', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-toggle', { timeout: 5000 });
  await page.locator('.notif-settings-toggle').first().check();
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_notification_settings') || '{}')
  );
  expect(Object.values(settings).some(v => v === true)).toBe(true);
});

/* ---------- Layer 4: Push-sheet connection (context-aware) ---------- */

test('sheet view offers to connect itself when not the active notification sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-sheet-section', { timeout: 5000 });
  await expect(page.locator('.notif-sheet-create-btn')).toContainText('Use this sheet for notifications');
});

test('clicking "Use this sheet for notifications" connects this sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-sheet-create-btn', { timeout: 5000 });
  await page.click('.notif-sheet-create-btn');
  const stored = await page.evaluate(() => localStorage.getItem('waymark_notif_sheet_id'));
  expect(stored).toBe('sheet-046');
  await expect(page.locator('.notif-sheet-status-ok')).toContainText('powers your notifications');
});

test('sheet view shows connected status when it is the active notification sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'sheet-046'));
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-inline', { timeout: 5000 });
  await expect(page.locator('.notif-sheet-status-ok')).toContainText('powers your notifications');
});

/* ---------- Layer 5: Per-Waymark alerts in the sheet view ---------- */

test('per-Waymark section lists shared Waymarks in the sheet view', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_shared_doc_ledgers', JSON.stringify({
      'sheet-xyz': [{ ledgerSheetId: 'l1', docTitle: 'Budget Q3' }],
    }));
  });
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-waymark-section', { timeout: 5000 });
  await expect(page.locator('.notif-waymark-toggle[data-doc-id="sheet-xyz"]')).toBeVisible();
});

/* ---------- Layer 6: Layout ---------- */

test('settings sheet view renders without horizontal overflow at 375px', async ({ page }) => {
  await setupApp(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-inline', { timeout: 5000 });
  const overflow = await page.evaluate(() => {
    const eln = document.querySelector('.notif-settings-inline');
    return eln ? eln.scrollWidth - eln.clientWidth : 0;
  });
  expect(overflow).toBeLessThanOrEqual(2);
});

/* ---------- Layer 7: Notifications.js Settings Modal Integration ---------- */

test('notification settings modal shows Notification Sheet section', async ({ page }) => {
  await setupApp(page);
  // Navigate home then open notification settings via bell button
  await page.goto('http://localhost:3000');
  await page.waitForSelector('.notif-bell', { timeout: 5000 });
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel', { timeout: 3000 });
  // Open settings
  await page.click('.notif-settings-btn');
  await page.waitForSelector('.notif-settings-modal', { timeout: 3000 });
  await expect(page.locator('.notif-sheet-section')).toBeVisible();
  await expect(page.locator('.notif-sheet-section .notif-sheet-label')).toContainText('Push notification sheet');
});

test('settings modal shows configured sheet ID when one is set', async ({ page }) => {
  await setupApp(page, {});
  // Pre-set a notification sheet ID in localStorage
  await page.goto('http://localhost:3000');
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'sheet-046'));
  await page.reload();
  await page.waitForSelector('.notif-bell', { timeout: 5000 });
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('.notif-settings-modal', { timeout: 3000 });
  await expect(page.locator('.notif-sheet-status-text')).toContainText('Connected');
});

test('clear button in settings modal removes the configured sheet ID', async ({ page }) => {
  await setupApp(page);
  await page.goto('http://localhost:3000');
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'sheet-046'));
  await page.reload();
  await page.waitForSelector('.notif-bell', { timeout: 5000 });
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('.notif-sheet-clear', { timeout: 3000 });
  await page.click('.notif-sheet-clear');
  const stored = await page.evaluate(() => localStorage.getItem('waymark_notif_sheet_id'));
  expect(stored).toBeNull();
  await expect(page.locator('.notif-sheet-status-text')).toContainText('No push notification sheet is connected yet');
});

/* ---------- Layer 8: Mobile Responsiveness ---------- */

test('settings sheet view collapses to a single column on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-inline', { timeout: 5000 });
  const cols = await page.evaluate(() => {
    const grid = document.querySelector('.notif-settings-inline .notif-settings-grid');
    return grid ? getComputedStyle(grid).columnCount : '';
  });
  expect(cols === '1' || cols === 'auto').toBeTruthy();
});

/* ---------- Layer 9: Auto-Creation & Bell Connection ---------- */

test('panel shows "View Notification Sheet" link when sheet is configured', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'sheet-046'));
  await page.reload();
  await page.waitForSelector('.notif-bell', { timeout: 5000 });
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel', { timeout: 3000 });
  await expect(page.locator('.notif-sheet-link')).toBeVisible();
  await expect(page.locator('.notif-sheet-link')).toContainText('View Notification Sheet');
});

test('panel does NOT show sheet link when no sheet is configured', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5000 });
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel', { timeout: 3000 });
  const linkCount = await page.locator('.notif-sheet-link').count();
  expect(linkCount).toBe(0);
});

test('sheet view shows "powers your notifications" when it is the configured sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'sheet-046'));
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-inline', { timeout: 5000 });
  await expect(page.locator('.notif-sheet-status-ok')).toContainText('powers your notifications');
});

test('sheet view offers connect when a different sheet is configured', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'some-other-sheet'));
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-settings-inline', { timeout: 5000 });
  await expect(page.locator('.notif-sheet-create-btn')).toContainText('Use this sheet for notifications');
  expect(await page.locator('.notif-sheet-status-ok').count()).toBe(0);
});

test('connecting this sheet swaps the connect button for connected status', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notif-sheet-create-btn', { timeout: 5000 });
  await page.click('.notif-sheet-create-btn');
  await page.waitForSelector('.notif-sheet-status-ok', { timeout: 3000 });
  await expect(page.locator('.notif-sheet-status-ok')).toContainText('powers your notifications');
  const btnCount = await page.locator('.notif-sheet-create-btn').count();
  expect(btnCount).toBe(0);
});

test('settings modal shows "Open Sheet" link when sheet is configured', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'sheet-046'));
  await page.reload();
  await page.waitForSelector('.notif-bell', { timeout: 5000 });
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('.notif-settings-modal', { timeout: 3000 });
  await expect(page.locator('.notif-sheet-view-link')).toBeVisible();
  await expect(page.locator('.notif-sheet-view-link')).toContainText('Open Sheet');
});

test('settings modal does NOT show "Open Sheet" link when no sheet configured', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5000 });
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('.notif-settings-modal', { timeout: 3000 });
  const linkCount = await page.locator('.notif-sheet-view-link').count();
  expect(linkCount).toBe(0);
});

/* ---------- Layer 7: Rule Builder — Overflow Button & Modal ---------- */

test('notification rules button appears in overflow menu on sheet view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('#notif-rules-btn')).toBeVisible();
  await expect(page.locator('#notif-rules-btn')).toContainText('Notification rules');
});

test('rule builder modal opens when clicking notification rules button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });
  await expect(page.locator('.notif-rule-builder')).toBeVisible();
  await expect(page.locator('.notif-rule-builder .modal-header h3')).toContainText('Notification Rules');
});

test('rule builder shows empty state when no rules configured', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });
  await expect(page.locator('.notif-rules-empty')).toBeVisible();
  await expect(page.locator('.notif-rules-empty')).toContainText('No rules configured');
});

test('add rule button creates a new rule row with condition and action sections', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });

  // Click add rule
  await page.click('.notif-rule-add');
  await page.waitForSelector('.notif-rule-row', { timeout: 3000 });

  // Empty state should be gone
  const emptyCount = await page.locator('.notif-rules-empty').count();
  expect(emptyCount).toBe(0);

  // Rule row should have condition and action sections
  await expect(page.locator('.notif-rule-condition')).toBeVisible();
  await expect(page.locator('.notif-rule-action')).toBeVisible();

  // Should have IF / THEN labels
  await expect(page.locator('.notif-rule-if')).toContainText('IF');
  await expect(page.locator('.notif-rule-then')).toContainText('THEN');
});

test('rule row column dropdown contains sheet headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });
  await page.click('.notif-rule-add');
  await page.waitForSelector('.notif-rule-row', { timeout: 3000 });

  // Column dropdown should contain the kanban headers
  const colOptions = await page.locator('.notif-rule-col option').allTextContents();
  expect(colOptions).toContain('— Column —');
  expect(colOptions).toContain('Task');
  expect(colOptions).toContain('Stage');
  expect(colOptions).toContain('Priority');
});

test('rule row operator dropdown has all 10 operators', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });
  await page.click('.notif-rule-add');
  await page.waitForSelector('.notif-rule-row', { timeout: 3000 });

  const opOptions = await page.locator('.notif-rule-op option').allTextContents();
  // 1 default prompt + 10 operators = 11 total
  expect(opOptions.length).toBe(11);
  expect(opOptions).toContain('equals');
  expect(opOptions).toContain('does not equal');
  expect(opOptions).toContain('contains');
  expect(opOptions).toContain('does not contain');
  expect(opOptions).toContain('greater than');
  expect(opOptions).toContain('less than');
  expect(opOptions).toContain('is before today');
  expect(opOptions).toContain('is after today');
  expect(opOptions).toContain('is empty');
  expect(opOptions).toContain('is not empty');
});

test('value input hides when selecting no-value operators', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });
  await page.click('.notif-rule-add');
  await page.waitForSelector('.notif-rule-row', { timeout: 3000 });

  // Value input is visible by default
  const valInput = page.locator('.notif-rule-val');
  await expect(valInput).toBeVisible();

  // Select "is empty" — value input should hide
  await page.selectOption('.notif-rule-op', 'is_empty');
  await expect(valInput).toBeHidden();

  // Select "equals" — value input should show again
  await page.selectOption('.notif-rule-op', 'equals');
  await expect(valInput).toBeVisible();

  // Select "is before today" — value input should hide
  await page.selectOption('.notif-rule-op', 'before_today');
  await expect(valInput).toBeHidden();
});

test('delete button removes a rule row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });

  // Add two rules
  await page.click('.notif-rule-add');
  await page.click('.notif-rule-add');
  const rows = await page.locator('.notif-rule-row').count();
  expect(rows).toBe(2);

  // Delete the first one
  await page.locator('.notif-rule-delete').first().click();
  await expect(page.locator('.notif-rule-row')).toHaveCount(1);

  // Delete the last one — should show empty state again
  await page.locator('.notif-rule-delete').first().click();
  await expect(page.locator('.notif-rules-empty')).toBeVisible();
});

test('save button persists rules to localStorage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });

  // Add a rule and configure it
  await page.click('.notif-rule-add');
  await page.waitForSelector('.notif-rule-row', { timeout: 3000 });
  await page.selectOption('.notif-rule-col', 'Stage');
  await page.selectOption('.notif-rule-op', 'equals');
  await page.fill('.notif-rule-val', 'Done');
  await page.selectOption('.notif-rule-type', 'success');
  await page.fill('.notif-rule-msg', 'Tasks completed: {count}');

  // Save
  await page.click('.notif-settings-save');

  // Modal should close
  await expect(page.locator('#notif-rule-builder-modal')).toBeHidden();

  // Toast should appear
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast')).toContainText('1 notification rule');

  // Check localStorage
  const stored = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('waymark_notification_rules') || '{}');
    return data['sheet-017'];
  });
  expect(stored).toBeDefined();
  expect(stored.length).toBe(1);
  expect(stored[0].column).toBe('Stage');
  expect(stored[0].operator).toBe('equals');
  expect(stored[0].value).toBe('Done');
  expect(stored[0].notifType).toBe('success');
  expect(stored[0].message).toBe('Tasks completed: {count}');
  expect(stored[0].enabled).toBe(true);
});

test('rule builder loads existing rules from localStorage', async ({ page }) => {
  await setupApp(page);

  // Pre-seed a rule in localStorage
  await page.evaluate(() => {
    const rules = {
      'sheet-017': [{
        id: 'test-rule-1',
        column: 'Priority',
        operator: 'equals',
        value: 'High',
        notifType: 'alert',
        message: 'High priority tasks: {count}',
        enabled: true,
      }],
    };
    localStorage.setItem('waymark_notification_rules', JSON.stringify(rules));
  });

  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });

  // Rule row should be present (no empty state)
  const emptyCount = await page.locator('.notif-rules-empty').count();
  expect(emptyCount).toBe(0);
  await expect(page.locator('.notif-rule-row')).toHaveCount(1);

  // Verify values loaded correctly
  const colVal = await page.locator('.notif-rule-col').inputValue();
  expect(colVal).toBe('Priority');
  const opVal = await page.locator('.notif-rule-op').inputValue();
  expect(opVal).toBe('equals');
  const valVal = await page.locator('.notif-rule-val').inputValue();
  expect(valVal).toBe('High');
  const typeVal = await page.locator('.notif-rule-type').inputValue();
  expect(typeVal).toBe('alert');
  const msgVal = await page.locator('.notif-rule-msg').inputValue();
  expect(msgVal).toBe('High priority tasks: {count}');
});

test('rule builder modal closes via X button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });
  await expect(page.locator('.notif-rule-builder')).toBeVisible();

  // Close via X
  await page.click('.notif-rule-builder .notif-settings-close');
  await expect(page.locator('#notif-rule-builder-modal')).toBeHidden();
});

test('rule builder modal closes via overlay click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await page.click('#more-actions-btn');
  await page.waitForSelector('.header-overflow-menu:not(.hidden)', { timeout: 3000 });
  await page.click('#notif-rules-btn');
  await page.waitForSelector('#notif-rule-builder-modal', { timeout: 3000 });
  await expect(page.locator('.notif-rule-builder')).toBeVisible();

  // Close via overlay click
  await page.click('#notif-rule-builder-modal', { position: { x: 5, y: 5 } });
  await expect(page.locator('#notif-rule-builder-modal')).toBeHidden();
});

test('settings modal shows custom rules section with rule count', async ({ page }) => {
  await setupApp(page);

  // Pre-seed rules for two sheets
  await page.evaluate(() => {
    const rules = {
      'sheet-017': [
        { id: 'r1', column: 'Stage', operator: 'equals', value: 'Done', notifType: 'info', message: '', enabled: true },
        { id: 'r2', column: 'Priority', operator: 'equals', value: 'High', notifType: 'alert', message: '', enabled: true },
      ],
      'sheet-999': [
        { id: 'r3', column: 'Status', operator: 'contains', value: 'open', notifType: 'warning', message: '', enabled: true },
      ],
    };
    localStorage.setItem('waymark_notification_rules', JSON.stringify(rules));
  });

  await page.waitForSelector('.notif-bell', { timeout: 5000 });
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('.notif-settings-modal', { timeout: 3000 });

  // Custom rules section should be visible
  await expect(page.locator('.notif-custom-rules-section')).toBeVisible();
  // Should mention the total rule count
  const sectionText = await page.locator('.notif-custom-rules-section').textContent();
  expect(sectionText).toContain('3');
});

/* ---------- Directory view ---------- */

test('notification directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-notifications/Notification%20Centers'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('notification directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-notifications/Notification%20Centers'; });
  await page.waitForSelector('.notification-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});

/* ---------- Layer 10: Push Notification Sheet ↔ Social/Wayside & Rule Evaluation ---------- */

test('collaborator shares and Wayside chats write rows into the connected Push Notification Sheet', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5000 });

  const result = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const storage = await import('/js/storage.js');

    // Connect sheet-046 as the active Push Notification Sheet
    storage.setNotifSheetId('sheet-046');

    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'partner@example.com' });
    const now = new Date().toISOString();
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-001', 'Trail Supplies', 'checklist', 'testuser@gmail.com', '', 'writer', now, 'Shared',
    ]]);
    await api.sheets.appendRows(sheetId, 'Chat', [[
      'msg-notif-1', now, 'partner@example.com', 'testuser@gmail.com', 'Check the supplies list!', '',
    ]]);

    const pushed = await collab.pollShareLedgers();
    return { pushed };
  });

  expect(result.pushed).toBe(2);
  const records = await getCreatedRecords(page);
  const notifSheetAppends = records.filter(r => r.type === 'row-append' && r.spreadsheetId === 'sheet-046');
  expect(notifSheetAppends.length).toBe(2);
  const flatValues = notifSheetAppends.flatMap(r => r.rows || []).map(row => row.join(' ')).join(' | ');
  expect(flatValues).toContain('Trail Supplies');
  expect(flatValues).toContain('Check the supplies list!');
});

test('custom notification rules evaluate on sheet load and push alerts to bell and connected Notification Sheet', async ({ page }) => {
  await setupApp(page);

  await page.evaluate(() => {
    localStorage.setItem('waymark_notif_sheet_id', 'sheet-046');
    const rules = {
      'sheet-017': [{
        id: 'done-rule-1',
        column: 'Stage',
        operator: 'equals',
        value: 'Done',
        notifType: 'success',
        message: 'Completed tasks in {sheet}: {count}',
        enabled: true,
      }],
    };
    localStorage.setItem('waymark_notification_rules', JSON.stringify(rules));
  });

  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  const itemTexts = await page.locator('.notif-item').allTextContents();
  expect(itemTexts.some(t => t.includes('Completed tasks in'))).toBe(true);

  const records = await getCreatedRecords(page);
  const notifSheetAppends = records.filter(r => r.type === 'row-append' && r.spreadsheetId === 'sheet-046');
  const flatValues = notifSheetAppends.flatMap(r => r.rows || []).map(row => row.join(' ')).join(' | ');
  expect(flatValues).toContain('Completed tasks in');
});

test('pollNotificationSheet syncs Active rows from the connected Notification Sheet into the bell', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5000 });

  const syncResult = await page.evaluate(async () => {
    const notifications = await import('/js/notifications.js');
    const storage = await import('/js/storage.js');
    storage.setNotifSheetId('sheet-046');
    const added = await notifications.pollNotificationSheet();
    return { added, unread: notifications.getUnreadCount() };
  });

  // sheet-046 has 3 Active notifications in fixture data
  expect(syncResult.added).toBe(3);
  expect(syncResult.unread).toBe(3);
  await expect(page.locator('.notif-badge')).toBeVisible();
  await expect(page.locator('.notif-badge')).toHaveText('3');
});

test('a shared Waymark pushed into the connected sheet surfaces Accept/Reject in the bell', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5000 });

  await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const storage = await import('/js/storage.js');

    storage.setNotifSheetId('sheet-046');
    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'sender@example.com' });
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-001', 'Shared Checklist', 'checklist', 'testuser@gmail.com', '', 'writer', new Date().toISOString(), 'Shared',
    ]]);
    await collab.pollShareLedgers();
  });

  // Share actions now live in the bell panel, not the sheet view.
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  const shareItem = page.locator('.notif-item', { hasText: 'Shared Checklist' });
  await expect(shareItem).toBeVisible();
  await expect(shareItem.locator('.notif-accept-btn')).toBeVisible();
  await expect(shareItem.locator('.notif-reject-btn')).toBeVisible();
});

test('collaboration notification toggles in settings modal persist and control update alerts', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5000 });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('.notif-settings-modal', { timeout: 3000 });

  // Built-in rule count remains 4 while 4 collaboration toggles are present
  // (shares, chat, AI agent, and shared-Waymark edits).
  await expect(page.locator('.notif-settings-rule')).toHaveCount(4);
  await expect(page.locator('.notif-collab-rule')).toHaveCount(4);

  // Uncheck collabUpdates and save
  const updatesToggle = page.locator('.notif-collab-toggle[data-collab-key="collabUpdates"]');
  await updatesToggle.uncheck();
  await page.click('.notif-settings-save');
  await expect(page.locator('#notif-settings-modal')).toBeHidden();

  const result = await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const storage = await import('/js/storage.js');

    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'editor@example.com' });
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-001', 'Groceries', 'checklist', 'testuser@gmail.com', '', 'writer', new Date().toISOString(), 'Updated|editor@example.com|Edited item',
    ]]);
    const pushed = await collab.pollShareLedgers();
    return {
      savedSettings: storage.getNotificationSettings(),
      pushed,
    };
  });

  expect(result.savedSettings.collabUpdates).toBe(false);
  expect(result.pushed).toBe(0);
});

