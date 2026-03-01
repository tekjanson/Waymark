/**
 * test-utils.js — Playwright page helpers for WayMark E2E tests.
 *
 * DESIGN:  Every test gets a fresh BrowserContext (Playwright default).
 *          `setupApp()` programmatically injects auth cookies and
 *          optional localStorage state BEFORE navigating, so each test
 *          starts with a fully preconditioned app — no shared state,
 *          no UI login clicks, safe to parallelise.
 */

/* ────────── Mock-auth cookie (matches server/auth.js local mode) ────────── */

const MOCK_AUTH_COOKIE = {
  name:     'waymark_refresh',
  value:    'mock-refresh-token',
  domain:   'localhost',
  path:     '/auth',
  httpOnly: true,
  secure:   false,
  sameSite: 'Lax',
};

/* ────────── Core setup ────────── */

/**
 * Boot the app in a fully isolated, preconditioned state.
 *
 * 1. Injects the mock refresh-token cookie (auth precondition).
 * 2. Optionally seeds localStorage (pinned folders, preferences).
 * 3. Navigates to `/` and waits for the app screen to appear.
 * 4. Optionally waits for the Drive Explorer to render.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} [opts]
 * @param {boolean}  [opts.waitForExplorer=false]  wait for sidebar folders
 * @param {Object[]} [opts.pinnedFolders=[]]       folders to pre-pin
 * @param {boolean}  [opts.autoRefresh]             auto-refresh pref (default true)
 * @param {boolean}  [opts.sidebarOpen]             sidebar pref (default true)
 * @param {boolean}  [opts.tutorialCompleted]        tutorial pref (default true — suppresses auto-start)
 * @param {string}   [opts.hash]                    initial URL hash (e.g. '#/sheet/sheet-001')
 */
async function setupApp(page, opts = {}) {
  const {
    waitForExplorer = false,
    pinnedFolders   = [],
    autoRefresh,
    sidebarOpen,
    tutorialCompleted = true,
    hash,
  } = opts;

  /* 1. Auth — inject cookie before any navigation */
  await page.context().addCookies([MOCK_AUTH_COOKIE]);

  /* 2. LocalStorage — use addInitScript so values exist before app JS runs */
  const lsEntries = {};
  if (pinnedFolders.length) lsEntries.pinned_folders = pinnedFolders;
  if (autoRefresh !== undefined) lsEntries.auto_refresh = autoRefresh;
  if (sidebarOpen !== undefined) lsEntries.sidebar_open = sidebarOpen;
  lsEntries.tutorial_completed = tutorialCompleted;

  if (Object.keys(lsEntries).length) {
    await page.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem('waymark_' + key, JSON.stringify(value));
      }
    }, lsEntries);
  }

  /* 3. Navigate */
  const url = hash ? `/${hash}` : '/';
  await page.goto(url);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });

  /* 4. Optional: wait for explorer */
  if (waitForExplorer) {
    await page.waitForSelector('.folder-item', { timeout: 10_000 });
  }
}

/**
 * Exercise the full UI login flow (click "Sign in with Google").
 * Only used by auth-specific tests that verify the login journey itself.
 *
 * @param {import('@playwright/test').Page} page
 */
async function loginViaUI(page) {
  await page.goto('/');
  await page.waitForSelector('#login-btn', { state: 'visible' });
  await page.click('#login-btn');
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
}

/* ────────── Navigation helpers ────────── */

async function navigateToHome(page) {
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)');
}

async function navigateToSheet(page, sheetId) {
  await page.evaluate((id) => { window.location.hash = `#/sheet/${id}`; }, sheetId);
  await page.waitForSelector('#checklist-view:not(.hidden)');
}

/* ────────── Assertion helpers ────────── */

async function getCreatedRecords(page) {
  return page.evaluate(() => window.__WAYMARK_RECORDS || []);
}

async function waitForChecklistRows(page, n = 1) {
  await page.waitForFunction(
    (min) => document.querySelectorAll('.checklist-row').length >= min,
    n,
    { timeout: 10_000 },
  );
}

async function getChecklistTexts(page) {
  return page.$$eval('.checklist-item-text', els => els.map(e => e.textContent.trim()));
}

async function getCompletedCount(page) {
  return page.$$eval('.checklist-row.completed', els => els.length);
}

async function waitForExplorer(page) {
  await page.waitForSelector('.folder-item', { timeout: 10_000 });
}

async function getExplorerFolderNames(page) {
  return page.$$eval('.folder-name', els => els.map(e => e.textContent.trim()));
}

/* ────────── Exports ────────── */

module.exports = {
  setupApp,
  loginViaUI,
  navigateToHome,
  navigateToSheet,
  getCreatedRecords,
  waitForChecklistRows,
  getChecklistTexts,
  getCompletedCount,
  waitForExplorer,
  getExplorerFolderNames,
};
