// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,

  /* ── Parallelism ── */
  fullyParallel: true,                        // every test runs independently
  workers: process.env.CI ? 4 : undefined,    // auto-detect locally, cap in CI

  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',

    /* Each test gets a fresh BrowserContext (Playwright default).
       Explicitly clear storageState so nothing leaks between tests. */
    storageState: undefined,
  },

  webServer: {
    command: 'WAYMARK_LOCAL=true node server/index.js',
    port: 3000,
    cwd: require('path').resolve(__dirname, '..'),
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../playwright-report' }],
  ],
});
