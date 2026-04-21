// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../helpers/test-utils');

/* ---------- Helper: open settings modal ---------- */

async function openSettings(page) {
  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
}

/**
 * Intercept the /__fixtures/folders.json response to inject a
 * .waymark-data.json entry inside the Waymark folder, then seed
 * window.__WAYMARK_JSON_FILES so readJsonFile returns the given data.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} driveData   content to store in the fake data file
 */
async function seedDriveUserData(page, driveData) {
  const DATA_FILE_ID = 'data-file-waymark-prefs';

  // Intercept folders fixture and inject the data file entry
  await page.route('**/__fixtures/folders.json', async route => {
    const original = await route.fetch();
    const json = await original.json();
    const waymark = (json.myDrive || []).find(f => f.name === 'Waymark');
    if (waymark) {
      waymark.children = waymark.children || [];
      // Remove any previous injection to avoid duplicates
      waymark.children = waymark.children.filter(c => c.name !== '.waymark-data.json');
      waymark.children.push({
        id: DATA_FILE_ID,
        name: '.waymark-data.json',
        mimeType: 'application/json',
      });
    }
    await route.fulfill({ json });
  });

  // Seed the in-memory JSON file store so readJsonFile returns our data
  await page.addInitScript(([id, data]) => {
    window.__WAYMARK_JSON_FILES = window.__WAYMARK_JSON_FILES || {};
    window.__WAYMARK_JSON_FILES[id] = data;
  }, [DATA_FILE_ID, driveData]);
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

/* ---------- Drive-backed theme persistence ---------- */

test('Drive dark preference is applied after login on a fresh device', async ({ page }) => {
  // Simulate Drive having dark stored (cross-device scenario: no localStorage theme)
  await seedDriveUserData(page, {
    version: 2,
    preferences: { theme: 'dark' },
    pinnedFolders: [],
    pinnedSheets: [],
    tutorialCompleted: true,
  });

  // Boot WITHOUT seeding localStorage theme — localStorage defaults to light
  await setupApp(page);

  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('dark');
});

test('Drive system preference is applied after login on a fresh device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });

  await seedDriveUserData(page, {
    version: 2,
    preferences: { theme: 'system' },
    pinnedFolders: [],
    pinnedSheets: [],
    tutorialCompleted: true,
  });

  await setupApp(page);

  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('dark');
});

test('Drive light preference is applied after login even when localStorage had dark', async ({ page }) => {
  // Another device set light; this device had dark in localStorage — Drive wins
  await seedDriveUserData(page, {
    version: 2,
    preferences: { theme: 'light' },
    pinnedFolders: [],
    pinnedSheets: [],
    tutorialCompleted: true,
  });

  await setupApp(page, { theme: 'dark' });

  const theme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(theme).toBe('light');
});

test('Drive theme is synced to localStorage after init', async ({ page }) => {
  await seedDriveUserData(page, {
    version: 2,
    preferences: { theme: 'dark' },
    pinnedFolders: [],
    pinnedSheets: [],
    tutorialCompleted: true,
  });

  await setupApp(page);

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_theme'))
  );
  expect(stored).toBe('dark');
});

test('top-bar toggle persists theme change to Drive (json-update record)', async ({ page }) => {
  await setupApp(page, { theme: 'light' });

  await page.click('#theme-toggle-btn');

  const records = await getCreatedRecords(page);
  const driveUpdates = records.filter(r => r.type === 'json-update');
  const themeUpdate = driveUpdates.find(r => r.content?.preferences?.theme === 'dark');
  expect(themeUpdate).toBeTruthy();
});

test('settings modal dark button persists theme to Drive (json-update record)', async ({ page }) => {
  await setupApp(page, { theme: 'light' });

  await openSettings(page);
  await page.click('#settings-theme-dark');

  const records = await getCreatedRecords(page);
  const driveUpdates = records.filter(r => r.type === 'json-update');
  const themeUpdate = driveUpdates.find(r => r.content?.preferences?.theme === 'dark');
  expect(themeUpdate).toBeTruthy();
});

test('settings modal system button persists theme to Drive (json-update record)', async ({ page }) => {
  await setupApp(page, { theme: 'light' });

  await openSettings(page);
  await page.click('#settings-theme-system');

  const records = await getCreatedRecords(page);
  const driveUpdates = records.filter(r => r.type === 'json-update');
  const themeUpdate = driveUpdates.find(r => r.content?.preferences?.theme === 'system');
  expect(themeUpdate).toBeTruthy();
});

/* ---------- Unit: userData.getTheme ---------- */

test('unit: userData.getTheme returns Drive-stored preference', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });

  const theme = await page.evaluate(async () => {
    const userData = await import('/js/user-data.js');
    return userData.getTheme();
  });
  expect(theme).toBe('dark');
});

test('unit: userData.setTheme updates in-memory preference', async ({ page }) => {
  await setupApp(page, { theme: 'light' });

  const theme = await page.evaluate(async () => {
    const userData = await import('/js/user-data.js');
    await userData.setTheme('dark');
    return userData.getTheme();
  });
  expect(theme).toBe('dark');
});

test('unit: userData.getTheme defaults to light when no preference set', async ({ page }) => {
  await setupApp(page);

  const theme = await page.evaluate(async () => {
    const userData = await import('/js/user-data.js');
    return userData.getTheme();
  });
  // Default is 'light'
  expect(theme).toBe('light');
});

