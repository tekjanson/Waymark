// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ---------- Notification Bell ---------- */

test('notification bell renders in top bar', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('.notif-bell')).toBeVisible();
  await expect(page.locator('.notif-bell-icon')).toContainText('🔔');
});

test('notification badge is hidden when no notifications', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('.notif-badge')).toBeHidden();
});

test('clicking bell opens notification panel', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('.notif-panel')).toBeVisible();
  await expect(page.locator('.notif-panel-title')).toContainText('Notifications');
});

test('empty notification panel shows no notifications message', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('.notif-empty')).toContainText('No notifications');
});

test('clicking bell again closes notification panel', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-bell');
  await expect(page.locator('.notif-panel')).toHaveClass(/hidden/);
});

/* ---------- Kanban Notifications ---------- */

test('loading kanban sheet with overdue tasks shows notification badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Badge should appear with count
  await expect(page.locator('.notif-badge')).toBeVisible();
  const count = await page.locator('.notif-badge').textContent();
  expect(parseInt(count)).toBeGreaterThan(0);
});

test('kanban overdue notification appears in panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });

  // Should have overdue notification
  const items = page.locator('.notif-item');
  await expect(items.first()).toBeVisible();
  const messages = await items.allTextContents();
  expect(messages.some(m => m.includes('overdue'))).toBe(true);
});

test('kanban P0 notification appears in panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });

  const messages = await page.locator('.notif-item').allTextContents();
  expect(messages.some(m => m.includes('P0') || m.includes('critical'))).toBe(true);
});

test('clicking clear all removes all notifications', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-clear-btn');

  await expect(page.locator('.notif-empty')).toContainText('No notifications');
  await expect(page.locator('.notif-badge')).toBeHidden();
});

test('notification panel shows clear all button', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('.notif-clear-btn')).toBeVisible();
  await expect(page.locator('.notif-clear-btn')).toContainText('Clear all');
});

test('clicking notification item navigates to sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Navigate home first
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 3000 });

  // Click notification to navigate back
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-item', { timeout: 3000 });
  await page.click('.notif-item');

  // Should navigate back to the sheet
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toContain('sheet-028');
});

test('opening notification panel marks all as read', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Badge should show unread count
  await expect(page.locator('.notif-badge')).toBeVisible();

  // Open panel — marks as read
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });

  // Badge should now be hidden
  await expect(page.locator('.notif-badge')).toBeHidden();
});

/* ---------- Notification Settings ---------- */

test('notification panel shows settings button', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('.notif-settings-btn')).toBeVisible();
});

test('clicking settings button opens notification settings modal', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('#notif-settings-modal', { timeout: 3000 });
  await expect(page.locator('.notif-settings-modal')).toBeVisible();
  await expect(page.locator('.notif-settings-modal')).toContainText('Notification Settings');
});

test('notification settings shows toggle for each rule', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('#notif-settings-modal', { timeout: 3000 });
  const rules = page.locator('.notif-settings-rule');
  await expect(rules).toHaveCount(4);
});

test('notification settings toggles are checked by default', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('#notif-settings-modal', { timeout: 3000 });
  const toggles = page.locator('.notif-settings-toggle');
  const count = await toggles.count();
  for (let i = 0; i < count; i++) {
    await expect(toggles.nth(i)).toBeChecked();
  }
});

test('notification settings shows Google Sheets email link', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('#notif-settings-modal', { timeout: 3000 });
  await expect(page.locator('.notif-settings-email')).toBeVisible();
  await expect(page.locator('.notif-settings-link')).toContainText('Google Sheets email notifications');
});

test('saving notification settings persists to localStorage', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('#notif-settings-modal', { timeout: 3000 });

  // Uncheck first toggle
  const firstToggle = page.locator('.notif-settings-toggle').first();
  await firstToggle.uncheck();
  await page.click('.notif-settings-save');

  // Modal should close
  await expect(page.locator('#notif-settings-modal')).toHaveCount(0);

  // Check localStorage
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_notification_settings'))
  );
  expect(settings.kanbanOverdue).toBe(false);
});

test('disabling kanban overdue rule suppresses overdue notifications', async ({ page }) => {
  await setupApp(page);

  // Disable kanban overdue via localStorage
  await page.evaluate(() => {
    localStorage.setItem('waymark_notification_settings', JSON.stringify({
      kanbanOverdue: false, kanbanP0: true, budgetOverspend: true, checklistOverdue: true,
    }));
  });

  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open panel — should only have P0, not overdue
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  const items = page.locator('.notif-item');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).textContent();
    expect(text).not.toContain('overdue');
  }
});

/* ---------- Notification Dedup & Auto-Resolve ---------- */

test('stored notifications have no duplicate keys after loading kanban', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  const notifications = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_notifications') || '[]')
  );
  expect(notifications.length).toBeGreaterThan(0);

  // Verify no duplicate keys
  const keys = notifications.map(n => n.key);
  const uniqueKeys = new Set(keys);
  expect(uniqueKeys.size).toBe(keys.length);
});

test('notification keys do not contain date suffixes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  const notifications = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_notifications') || '[]')
  );
  expect(notifications.length).toBeGreaterThan(0);

  // No notification key should end with a date pattern (YYYY-MM-DD)
  for (const n of notifications) {
    expect(n.key).not.toMatch(/\d{4}-\d{2}-\d{2}$/);
  }
});

test('old date-suffixed notifications are migrated on init', async ({ page }) => {
  await setupApp(page);

  // Pre-populate with old-format notification
  await page.evaluate(() => {
    localStorage.setItem('waymark_notifications', JSON.stringify([
      { key: 'kanban-overdue-sheet-999-2026-01-15', message: 'old notif', read: false, timestamp: '2026-01-15T00:00:00Z', sheetId: 'sheet-999' },
      { key: 'kanban-p0-sheet-999', message: 'new format notif', read: false, timestamp: '2026-03-15T00:00:00Z', sheetId: 'sheet-999' },
    ]));
  });

  // Reload to trigger init migration
  await page.reload();
  await page.waitForSelector('.notif-bell', { timeout: 5000 });

  const notifications = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_notifications') || '[]')
  );

  // Old date-suffixed notification should be removed
  expect(notifications.length).toBe(1);
  expect(notifications[0].key).toBe('kanban-p0-sheet-999');
});

test('notification message includes specific overdue count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });

  const messages = await page.locator('.notif-item-message').allTextContents();
  const overdueMsg = messages.find(m => m.includes('overdue'));
  expect(overdueMsg).toBeTruthy();
  // Message should contain a count like "3 overdue tasks"
  expect(overdueMsg).toMatch(/\d+ overdue task/);
});

/* ---------- Improved Email Section ---------- */

test('email notification section shows step-by-step instructions', async ({ page }) => {
  await setupApp(page);
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3000 });
  await page.click('.notif-settings-btn');
  await page.waitForSelector('#notif-settings-modal', { timeout: 3000 });

  await expect(page.locator('.notif-settings-email-heading')).toContainText('Email Notifications');
  await expect(page.locator('.notif-email-steps')).toBeVisible();

  const steps = page.locator('.notif-email-steps li');
  expect(await steps.count()).toBe(3);
  await expect(steps.nth(0)).toContainText('Google Sheets');
  await expect(steps.nth(1)).toContainText('Notification rules');
});

test('auto-refresh does not re-trigger notification evaluation within throttle window', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Record notification state
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_notifications') || '[]')
  );

  // Simulate auto-refresh triggering sheet-rendered event
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('waymark:sheet-rendered', {
      detail: { sheetId: 'sheet-028', title: 'Test', templateKey: 'kanban', rows: [], cols: {} },
    }));
  });

  // Notifications should be unchanged (throttle blocked re-evaluation)
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_notifications') || '[]')
  );
  expect(after.length).toBe(before.length);
  expect(after.map(n => n.key)).toEqual(before.map(n => n.key));
});
