// @ts-check
/* ============================================================
   server-perf.spec.js — Server performance regression tests
   Verifies that the HTML caching and middleware optimizations
   introduced for the page-refresh CPU spike do not break
   existing behavior.
   ============================================================ */

const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('app renders home view correctly on initial load', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('#app-screen')).not.toHaveClass(/hidden/);
});

test('WAYMARK_LOCAL flag is injected into HTML by serveIndex', async ({ page }) => {
  await setupApp(page);
  const isLocal = await page.evaluate(() => window.__WAYMARK_LOCAL === true);
  expect(isLocal).toBe(true);
});

test('index page is served with Content-Type text/html', async ({ page }) => {
  let htmlContentType = '';
  page.on('response', (resp) => {
    const url = resp.url();
    if (url.match(/localhost:\d+\/?$/) || url.match(/localhost:\d+\/$/)) {
      htmlContentType = resp.headers()['content-type'] || '';
    }
  });
  await setupApp(page);
  expect(htmlContentType).toContain('text/html');
});

test('app loads consistently on a second page.goto (simulates browser refresh)', async ({ page }) => {
  // First load
  await setupApp(page);
  await expect(page.locator('#home-view')).toBeVisible();

  // Second load — simulates hard refresh (Ctrl+R)
  await setupApp(page);
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('#app-screen')).not.toHaveClass(/hidden/);
});

test('app renders template correctly after two consecutive page loads', async ({ page }) => {
  // Simulate refresh then navigating to a sheet
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#checklist-view')).toBeVisible();

  // Reload the page (hard refresh scenario)
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#checklist-view')).toBeVisible();
});

test('HTML response preserves no-cache header after caching changes', async ({ page }) => {
  let htmlCacheControl = '';
  page.on('response', (resp) => {
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('text/html') && resp.url().includes('localhost')) {
      htmlCacheControl = resp.headers()['cache-control'] || '';
    }
  });
  await setupApp(page);
  expect(htmlCacheControl).toContain('no-cache');
  expect(htmlCacheControl).toContain('must-revalidate');
});

test('CSS files still have correct no-cache headers after middleware optimization', async ({ page }) => {
  const cssHeaders = [];
  page.on('response', (resp) => {
    if (resp.url().endsWith('.css')) {
      cssHeaders.push(resp.headers()['cache-control'] || '');
    }
  });
  await setupApp(page);
  expect(cssHeaders.length).toBeGreaterThan(0);
  for (const h of cssHeaders) {
    expect(h).toContain('no-cache');
    expect(h).toContain('must-revalidate');
  }
});

test('JS files still have correct no-cache headers after middleware optimization', async ({ page }) => {
  const jsHeaders = [];
  page.on('response', (resp) => {
    const url = resp.url();
    if (url.endsWith('.js') && url.includes('localhost') && !url.includes('playwright')) {
      jsHeaders.push(resp.headers()['cache-control'] || '');
    }
  });
  await setupApp(page);
  expect(jsHeaders.length).toBeGreaterThan(0);
  for (const h of jsHeaders) {
    expect(h).toContain('no-cache');
    expect(h).toContain('must-revalidate');
  }
});
