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
