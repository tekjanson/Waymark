// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('social wall detected as Social Feed template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-feed', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Social');
});

test('social feed renders posts with author avatars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-post', { timeout: 5_000 });

  const posts = page.locator('.social-post');
  expect(await posts.count()).toBeGreaterThan(0);

  // Each post should have an avatar
  const avatars = page.locator('.social-avatar');
  expect(await avatars.count()).toBeGreaterThan(0);
});

test('social feed shows comment threads', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-post', { timeout: 5_000 });

  // Should have comment containers from sub-rows
  const comments = page.locator('.social-comment');
  expect(await comments.count()).toBeGreaterThan(0);
});

test('social feed shows category badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-post', { timeout: 5_000 });

  const badges = page.locator('.social-post-category');
  expect(await badges.count()).toBeGreaterThan(0);
});

test('social profile header shows dominant author', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-profile-header', { timeout: 5_000 });

  // Profile header should exist with author name
  await expect(page.locator('.social-profile-name')).not.toBeEmpty();
});

/* ---------- Directory view ---------- */

test('social directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-social/Social%20Walls'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('social directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-social/Social%20Walls'; });
  await page.waitForSelector('.social-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});

/* ---------- Live Chat (P2P) ---------- */

test('social wall shows Connect button in profile header', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-profile-header', { timeout: 5_000 });
  await expect(page.locator('.social-connect-btn')).toBeVisible();
  await expect(page.locator('.social-connect-btn')).toContainText('Connect');
});

test('clicking Connect opens live chat panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-connect-btn', { timeout: 5_000 });
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });
  await expect(page.locator('.social-chat-panel')).toBeVisible();
  await expect(page.locator('.social-chat-title')).toContainText('Live Chat');
  await expect(page.locator('.social-chat-input')).toBeVisible();
});

test('chat panel can be minimized and closed', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  // Minimize
  await page.click('.social-chat-minimize');
  await expect(page.locator('.social-chat-panel')).toHaveClass(/social-chat-minimized/);

  // Expand
  await page.click('.social-chat-minimize');
  await expect(page.locator('.social-chat-panel')).not.toHaveClass(/social-chat-minimized/);

  // Close
  await page.click('.social-chat-close');
  await expect(page.locator('.social-chat-panel')).toHaveCount(0);
});

test('two tabs can exchange messages via BroadcastChannel', async ({ context }) => {
  // Use two pages in the same context so BroadcastChannel works between them
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  await setupApp(page1);
  await setupApp(page2);

  // Both navigate to the same social sheet
  await navigateToSheet(page1, 'sheet-030');
  await navigateToSheet(page2, 'sheet-030');

  // Both connect
  await page1.click('.social-connect-btn');
  await page1.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  await page2.click('.social-connect-btn');
  await page2.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  // Wait for peer discovery (BroadcastChannel announce/welcome)
  await page1.waitForFunction(
    () => document.querySelector('.social-chat-peer-count')?.textContent?.includes('1 peer'),
    { timeout: 5_000 },
  );

  // Page 1 sends a message
  await page1.fill('.social-chat-input', 'Hello from tab 1!');
  await page1.click('.social-chat-send');

  // Page 2 should receive it
  await page2.waitForSelector('.social-chat-bubble-text', { timeout: 5_000 });
  await expect(page2.locator('.social-chat-bubble-text').first()).toContainText('Hello from tab 1!');

  // Page 2 replies
  await page2.fill('.social-chat-input', 'Hello back from tab 2!');
  await page2.click('.social-chat-send');

  // Page 1 should receive the reply
  await page1.waitForFunction(
    () => document.querySelectorAll('.social-chat-bubble').length >= 2,
    { timeout: 5_000 },
  );
  const bubbles1 = page1.locator('.social-chat-bubble-text');
  await expect(bubbles1.nth(1)).toContainText('Hello back from tab 2!');
});
