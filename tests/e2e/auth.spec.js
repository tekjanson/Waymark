// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, loginViaUI } = require('../helpers/test-utils');

/*
 * Auth tests — each test builds its own state from scratch.
 * No beforeEach, no shared context, fully parallelisable.
 */

test('shows login screen when not authenticated', async ({ page }) => {
  // No auth cookie injected — app should show login
  await page.goto('/');
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect(page.locator('#app-screen')).toBeHidden();
  await expect(page.locator('#login-btn')).toBeVisible();
});

test('UI login redirects through mock OAuth and loads app', async ({ page }) => {
  await loginViaUI(page);
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#login-screen')).toBeHidden();
});

test('displays user info after login', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#user-name')).toHaveText('Test User');
});

test('logout returns to login screen', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#app-screen')).toBeVisible();

  await page.click('#logout-btn');
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect(page.locator('#app-screen')).toBeHidden();
});

test('session restores on page reload (cookie-based)', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#app-screen')).toBeVisible();

  // Reload — the mock refresh cookie persists in this context
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#user-name')).toHaveText('Test User');
});
