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
