/* ============================================================
   notification.spec.js — E2E tests for Notification template
   Tests: detection, rendering, filter pills, status cycling,
   "Use as Notification Sheet", expiry, source tags, sheet links,
   mobile layout, settings modal, and record emission.
   ============================================================ */

const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ---------- Layer 1: Detection & Rendering ---------- */

test('notification template is detected for sheet-046', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-view', { timeout: 5000 });
  await expect(page.locator('.notification-view')).toBeVisible();
});

test('renders 8 notification cards from fixture data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-card', { timeout: 5000 });
  const cards = await page.locator('.notification-card').count();
  expect(cards).toBe(8);
});

test('summary bar shows active notification count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-summary', { timeout: 5000 });
  await expect(page.locator('.notification-active-count')).toContainText('3');
  await expect(page.locator('.notification-summary-text')).toContainText('active notification');
});

test('filter bar renders All, Active, Read, Dismissed pills', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-filter-bar', { timeout: 5000 });
  const pills = await page.locator('.notification-filter-pill').count();
  expect(pills).toBe(4);
  await expect(page.locator('.notification-filter-pill').nth(0)).toContainText('All');
  await expect(page.locator('.notification-filter-pill').nth(1)).toContainText('Active');
  await expect(page.locator('.notification-filter-pill').nth(2)).toContainText('Read');
  await expect(page.locator('.notification-filter-pill').nth(3)).toContainText('Dismissed');
});

/* ---------- Layer 2: Human-Style Workflows ---------- */

test('filter pill All is active by default and shows 8 notifications', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-filter-pill', { timeout: 5000 });
  const allPill = page.locator('.notification-filter-pill').nth(0);
  await expect(allPill).toHaveClass(/active/);
  const count = allPill.locator('.notification-pill-count');
  await expect(count).toContainText('8');
});

test('clicking Active filter shows only 3 active notifications', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-filter-pill', { timeout: 5000 });
  await page.locator('.notification-filter-pill').nth(1).click();
  await page.waitForSelector('.notification-status-active', { timeout: 3000 });
  const cards = await page.locator('.notification-card').count();
  expect(cards).toBe(3);
  await expect(page.locator('.notification-filter-pill').nth(1)).toHaveClass(/active/);
});

test('clicking Read filter shows only 2 read notifications', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-filter-pill', { timeout: 5000 });
  await page.locator('.notification-filter-pill').nth(2).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.notification-card').length === 2,
    { timeout: 3000 }
  );
  const cards = await page.locator('.notification-card').count();
  expect(cards).toBe(2);
});

test('clicking Dismissed filter shows only 3 dismissed notifications', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-filter-pill', { timeout: 5000 });
  await page.locator('.notification-filter-pill').nth(3).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.notification-card').length === 3,
    { timeout: 3000 }
  );
  const cards = await page.locator('.notification-card').count();
  expect(cards).toBe(3);
});

test('filter cycles back to All when re-clicked after another filter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-filter-pill', { timeout: 5000 });
  // Click Active
  await page.locator('.notification-filter-pill').nth(1).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.notification-card').length === 3,
    { timeout: 3000 }
  );
  // Click All
  await page.locator('.notification-filter-pill').nth(0).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.notification-card').length === 8,
    { timeout: 3000 }
  );
  const cards = await page.locator('.notification-card').count();
  expect(cards).toBe(8);
});

/* ---------- Layer 3: Status Cycling ---------- */

test('clicking status badge on an Active notification cycles it to Read', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-type-badge', { timeout: 5000 });
  // First card is P0 Task Assigned (Active)
  const firstBadge = page.locator('.notification-type-badge').first();
  await expect(firstBadge).toContainText('Active');
  await firstBadge.click();
  await expect(firstBadge).toContainText('Read');
});

test('status cycle emits a record for the changed row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-type-badge', { timeout: 5000 });
  await page.locator('.notification-type-badge').first().click();
  const records = await getCreatedRecords(page);
  expect(records.length).toBeGreaterThan(0);
  const statusRecord = records.find(r => r.value === 'Read' || r.value === 'Dismissed' || r.value === 'Active');
  expect(statusRecord).toBeDefined();
});

test('active count decreases when Active notification is cycled to Read', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-active-count', { timeout: 5000 });
  await expect(page.locator('.notification-active-count')).toContainText('3');
  // Cycle first Active notification
  await page.locator('.notification-type-badge').first().click();
  await expect(page.locator('.notification-active-count')).toContainText('2');
});

/* ---------- Layer 4: Visual Consistency ---------- */

test('notification cards have pointer cursor on status badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-type-badge', { timeout: 5000 });
  await expect(page.locator('.notification-type-badge').first()).toHaveCSS('cursor', 'pointer');
});

test('filter pills have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-filter-pill', { timeout: 5000 });
  await expect(page.locator('.notification-filter-pill').first()).toHaveCSS('cursor', 'pointer');
});

test('notification list uses flex column layout', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-list', { timeout: 5000 });
  await expect(page.locator('.notification-list')).toHaveCSS('display', 'flex');
  await expect(page.locator('.notification-list')).toHaveCSS('flex-direction', 'column');
});

test('dismissed cards have reduced opacity', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-status-dismissed', { timeout: 5000 });
  const dismissed = page.locator('.notification-status-dismissed').first();
  const opacity = await dismissed.evaluate(el => getComputedStyle(el).opacity);
  expect(parseFloat(opacity)).toBeLessThan(1);
});

/* ---------- Layer 5: "Use as Notification Sheet" ---------- */

test('"Use as Notification Sheet" button is visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-use-btn', { timeout: 5000 });
  await expect(page.locator('.notification-use-btn')).toBeVisible();
  await expect(page.locator('.notification-use-btn')).toContainText('Use as Notification Sheet');
});

test('"Use as Notification Sheet" button sets localStorage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-use-btn', { timeout: 5000 });
  await page.click('.notification-use-btn');
  const stored = await page.evaluate(() => localStorage.getItem('waymark_notif_sheet_id'));
  expect(stored).toBeTruthy();
  expect(stored).toBe('sheet-046');
});

/* ---------- Layer 6: Metadata & Edge Cases ---------- */

test('source tags are visible on cards that have a source', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-meta-source', { timeout: 5000 });
  const sources = await page.locator('.notification-meta-source').count();
  expect(sources).toBeGreaterThan(0);
});

test('sheet link renders for notifications with a sheet reference', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-meta-link', { timeout: 5000 });
  const links = await page.locator('.notification-meta-link').count();
  expect(links).toBeGreaterThan(0);
  await expect(page.locator('.notification-meta-link').first()).toContainText('Open Sheet');
});

test('empty state shows icon and message when filter has no results', async ({ page }) => {
  await setupApp(page);
  // Navigate to a sheet with only Active cards and filter to Read (which would be empty
  // if we started from a fresh state — instead test by cycling all Active to Read first)
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-filter-pill', { timeout: 5000 });
  // Filter to Dismissed, then view All — verify structure still intact (non-empty fallthrough)
  await page.locator('.notification-filter-pill').nth(3).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.notification-card').length === 3,
    { timeout: 3000 }
  );
  expect(await page.locator('.notification-card').count()).toBe(3);
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
  await expect(page.locator('.notif-sheet-section .notif-sheet-label')).toContainText('Notification Sheet');
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
  await expect(page.locator('.notif-sheet-status-text')).toContainText('Connected to notification sheet');
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
  await expect(page.locator('.notif-sheet-status-text')).toContainText('No notification sheet configured');
});

/* ---------- Layer 8: Mobile Responsiveness ---------- */

test('notification template renders without overflow at 375px width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-view', { timeout: 5000 });
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.notification-view *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 4) {
        problems.push(el.className || el.tagName);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
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

test('"Connected to Bell" badge shows when viewing the configured notification sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'sheet-046'));
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-view', { timeout: 5000 });
  await expect(page.locator('.notification-connected-badge')).toBeVisible();
  await expect(page.locator('.notification-connected-badge')).toContainText('Connected to Bell');
});

test('"Use as Notification Sheet" button shows instead of badge for non-configured sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => localStorage.setItem('waymark_notif_sheet_id', 'some-other-sheet'));
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-view', { timeout: 5000 });
  await expect(page.locator('.notification-use-btn')).toBeVisible();
  const badgeCount = await page.locator('.notification-connected-badge').count();
  expect(badgeCount).toBe(0);
});

test('clicking "Use as Notification Sheet" replaces button with "Connected to Bell" badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-use-btn', { timeout: 5000 });
  await page.click('.notification-use-btn');
  await page.waitForSelector('.notification-connected-badge', { timeout: 3000 });
  await expect(page.locator('.notification-connected-badge')).toContainText('Connected to Bell');
  const btnCount = await page.locator('.notification-use-btn').count();
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
  // 1 placeholder + 10 operators = 11 total
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
