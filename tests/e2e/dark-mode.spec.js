// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- Helper: open settings modal ---------- */

async function openSettings(page) {
  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
}

/* ---------- Dark mode persistence tests ---------- */

test('defaults to light theme when no preference is stored', async ({ page }) => {
  await setupApp(page);

  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('light');
});

test('applies dark theme from localStorage before page renders (no flash)', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });

  // data-theme must already be set by the inline flash-prevention script
  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('dark');
});

test('applies light theme from localStorage before page renders', async ({ page }) => {
  await setupApp(page, { theme: 'light' });

  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('light');
});

test('top-bar toggle switches from light to dark and saves to localStorage', async ({ page }) => {
  await setupApp(page, { theme: 'light' });

  await page.click('#theme-toggle-btn');

  const [theme, stored] = await page.evaluate(() => [
    document.documentElement.getAttribute('data-theme'),
    JSON.parse(localStorage.getItem('waymark_theme')),
  ]);
  expect(theme).toBe('dark');
  expect(stored).toBe('dark');
});

test('top-bar toggle switches from dark to light and saves to localStorage', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });

  await page.click('#theme-toggle-btn');

  const [theme, stored] = await page.evaluate(() => [
    document.documentElement.getAttribute('data-theme'),
    JSON.parse(localStorage.getItem('waymark_theme')),
  ]);
  expect(theme).toBe('light');
  expect(stored).toBe('light');
});

test('theme persists across page reload', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });

  // Reload the page — flash-prevention script must re-apply the saved theme
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });

  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('dark');
});

test('toggle icon shows moon when light theme is active', async ({ page }) => {
  await setupApp(page, { theme: 'light' });

  const icon = await page.textContent('#theme-toggle-icon');
  expect(icon).toBe('🌙');
});

test('toggle icon shows sun when dark theme is active', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });

  const icon = await page.textContent('#theme-toggle-icon');
  expect(icon).toBe('☀️');
});

test('settings modal light button marks active and saves light theme', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });

  await openSettings(page);

  await page.click('#settings-theme-light');

  const [theme, stored, btnActive] = await page.evaluate(() => [
    document.documentElement.getAttribute('data-theme'),
    JSON.parse(localStorage.getItem('waymark_theme')),
    document.getElementById('settings-theme-light').classList.contains('active'),
  ]);
  expect(theme).toBe('light');
  expect(stored).toBe('light');
  expect(btnActive).toBe(true);
});

test('settings modal dark button marks active and saves dark theme', async ({ page }) => {
  await setupApp(page, { theme: 'light' });

  await openSettings(page);

  await page.click('#settings-theme-dark');

  const [theme, stored, btnActive] = await page.evaluate(() => [
    document.documentElement.getAttribute('data-theme'),
    JSON.parse(localStorage.getItem('waymark_theme')),
    document.getElementById('settings-theme-dark').classList.contains('active'),
  ]);
  expect(theme).toBe('dark');
  expect(stored).toBe('dark');
  expect(btnActive).toBe(true);
});

test('settings modal reflects current theme on open', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });

  await openSettings(page);

  const darkBtnActive = await page.evaluate(() =>
    document.getElementById('settings-theme-dark').classList.contains('active')
  );
  const lightBtnActive = await page.evaluate(() =>
    document.getElementById('settings-theme-light').classList.contains('active')
  );
  expect(darkBtnActive).toBe(true);
  expect(lightBtnActive).toBe(false);
});

test('system theme preference resolves using prefers-color-scheme media query', async ({ page }) => {
  // Emulate a system that prefers dark
  await page.emulateMedia({ colorScheme: 'dark' });
  await setupApp(page, { theme: 'system' });

  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('dark');
});

test('system theme resolves to light when system prefers light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await setupApp(page, { theme: 'system' });

  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('light');
});
