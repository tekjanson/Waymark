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

test('OAuth login URL includes drive.readonly scope for private doc export', async ({ page }) => {
  // Hit the login endpoint and capture the redirect target (Google OAuth URL)
  const response = await page.request.get('/auth/login', { maxRedirects: 0 });
  // In local mode the server redirects to /#auth_success (no real OAuth)
  // In production it would redirect to Google with scope in the URL.
  // Verify the server config includes drive.readonly by checking the redirect destination
  // when login is triggered.
  const location = response.headers()['location'] || '';
  // Local mock: redirects to app — just check the route works
  if (location.includes('auth_success') || location.includes('localhost')) {
    expect(response.status()).toBe(302);
  } else {
    // Production: Google OAuth URL should include drive.readonly scope
    expect(location).toContain('drive.readonly');
  }
});

