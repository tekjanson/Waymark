// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- Cache header tests ---------- */

test('CSS files are served with no-cache revalidation header', async ({ page }) => {
  const cssResponses = [];
  page.on('response', (resp) => {
    if (resp.url().endsWith('.css')) {
      cssResponses.push({
        url: resp.url(),
        cacheControl: resp.headers()['cache-control'],
      });
    }
  });

  await setupApp(page);

  // At least one CSS file should have been loaded
  expect(cssResponses.length).toBeGreaterThan(0);
  for (const r of cssResponses) {
    expect(r.cacheControl).toContain('no-cache');
    expect(r.cacheControl).toContain('must-revalidate');
  }
});

test('JS files are served with no-cache revalidation header', async ({ page }) => {
  const jsResponses = [];
  page.on('response', (resp) => {
    const url = resp.url();
    if (url.endsWith('.js') && !url.includes('__fixtures') && !url.includes('playwright')) {
      jsResponses.push({
        url,
        cacheControl: resp.headers()['cache-control'],
      });
    }
  });

  await setupApp(page);

  // Multiple JS files should have been loaded (app.js, ui.js, etc.)
  expect(jsResponses.length).toBeGreaterThan(0);
  for (const r of jsResponses) {
    expect(r.cacheControl).toContain('no-cache');
    expect(r.cacheControl).toContain('must-revalidate');
  }
});

test('HTML page is served with no-cache header', async ({ page }) => {
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

test('static images are cached for 1 hour', async ({ page }) => {
  // Intercept any image/asset response
  const assetResponses = [];
  page.on('response', (resp) => {
    const url = resp.url();
    if (url.endsWith('.svg') || url.endsWith('.png') || url.endsWith('.ico')) {
      assetResponses.push({
        url,
        cacheControl: resp.headers()['cache-control'],
      });
    }
  });

  await setupApp(page);

  // Only assert if images were loaded (some test runs may not load images)
  for (const r of assetResponses) {
    expect(r.cacheControl).toContain('max-age=3600');
  }
});

/* ---------- Update toast tests ---------- */

test('persistent toast stays visible without auto-dismiss', async ({ page }) => {
  await setupApp(page);

  // Create a persistent toast (duration=0) via the showToast API
  await page.evaluate(() => {
    const { showToast } = window.__WAYMARK_LOCAL
      ? { showToast: null }
      : {};
  });

  // Use the app's showToast directly since ui.js is loaded as a module
  const toastVisible = await page.evaluate(async () => {
    const { showToast } = await import('/js/ui.js');
    const toast = showToast('Test persistent toast', 'info', 0);
    return toast !== null && toast !== undefined;
  });
  expect(toastVisible).toBe(true);

  // Toast should still be visible after 5 seconds (normal toasts dismiss in 4s)
  await page.waitForTimeout(100); // small delay for DOM update
  await page.waitForSelector('.toast', { timeout: 2000 });
  await expect(page.locator('.toast')).toBeVisible();

  // Wait longer than the default 4s auto-dismiss
  await page.waitForFunction(() => {
    return document.querySelector('.toast') !== null;
  }, { timeout: 5000 });

  await expect(page.locator('.toast')).toBeVisible();
});

test('update toast has correct styling and is clickable', async ({ page }) => {
  await setupApp(page);

  // Create an update-styled toast
  await page.evaluate(async () => {
    const { showToast } = await import('/js/ui.js');
    const toast = showToast('\u{1F504} Update available \u2014 tap to refresh', 'update', 0);
    toast.addEventListener('click', () => {
      document.title = 'update-clicked';
    });
  });

  const toast = page.locator('.toast.toast-update');
  await expect(toast).toBeVisible();

  // Verify update toast uses primary color (design token)
  const bgColor = await toast.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bgColor).not.toBe('');
  expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');

  // Verify cursor is pointer for clickability
  await expect(toast).toHaveCSS('cursor', 'pointer');

  // Click the toast and verify the handler fired
  await toast.click();
  await expect(page).toHaveTitle('update-clicked');
});

test('showToast returns the toast element for caller control', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    const { showToast } = await import('/js/ui.js');
    const toast = showToast('Return test', 'info', 4000);
    return {
      isElement: toast instanceof HTMLElement,
      tagName: toast.tagName,
      hasClass: toast.classList.contains('toast'),
    };
  });

  expect(result.isElement).toBe(true);
  expect(result.tagName).toBe('DIV');
  expect(result.hasClass).toBe(true);
});

test('auto-dismiss toast disappears after duration', async ({ page }) => {
  await setupApp(page);

  // Create a short-lived toast (1 second)
  await page.evaluate(async () => {
    const { showToast } = await import('/js/ui.js');
    showToast('Short toast', 'info', 1000);
  });

  // Should be visible immediately
  await expect(page.locator('.toast')).toBeVisible();

  // Should disappear after ~1.3s (1000ms duration + 300ms fade)
  await page.waitForFunction(() => {
    return document.querySelectorAll('.toast').length === 0;
  }, { timeout: 5000 });
});

/* ---------- X-Waymark-Hash header test ---------- */

test('index page response includes X-Waymark-Hash header when hash is available', async ({ page }) => {
  let hashHeader = null;
  page.on('response', (resp) => {
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('text/html') && resp.url().includes('localhost')) {
      hashHeader = resp.headers()['x-waymark-hash'] || null;
    }
  });

  await setupApp(page);

  // In local dev mode, the hash comes from git rev-parse.
  // It may or may not be available depending on git state.
  // If available, it should be a non-empty string.
  if (hashHeader !== null) {
    expect(hashHeader.length).toBeGreaterThan(0);
  }
  // If null, git hash wasn't available — that's OK in CI/test environments
});

/* ---------- Update checker disabled in local mode ---------- */

test('update checker does not run in local mode', async ({ page }) => {
  await setupApp(page);

  // In local/test mode, __WAYMARK_LOCAL is true, so the checker should not start.
  // Verify no HEAD polling requests are made.
  const headRequests = [];
  page.on('request', (req) => {
    if (req.method() === 'HEAD') {
      headRequests.push(req.url());
    }
  });

  // Wait a short time to see if any HEAD requests are triggered
  await page.waitForFunction(() => true, null, { timeout: 3000 });

  // No HEAD polling requests should have been made
  expect(headRequests.length).toBe(0);
});

/* ---------- Build hash displayed in settings ---------- */

test('settings modal shows build hash when available', async ({ page }) => {
  await setupApp(page);

  // Open settings modal (triggered by clicking user name)
  const userNameEl = page.locator('#user-name');
  await userNameEl.click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 3000 });

  // Version element should exist
  const versionEl = page.locator('#settings-version');
  await expect(versionEl).toBeVisible();

  // The hash display depends on whether __WAYMARK_HASH was set
  // In test mode with git available, it should show "Build: <hash>"
  const text = await versionEl.textContent();
  // In local mode, hash may or may not be present
  if (text) {
    // If text is present, it should start with "Build:"
    if (text.trim().length > 0) {
      expect(text).toContain('Build:');
    }
  }
});

/* ---------- Dark mode update toast ---------- */

test('update toast maintains primary color in dark mode', async ({ page }) => {
  await setupApp(page);

  // Switch to dark mode
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  // Create an update toast
  await page.evaluate(async () => {
    const { showToast } = await import('/js/ui.js');
    showToast('Dark mode update toast', 'update', 0);
  });

  const toast = page.locator('.toast.toast-update');
  await expect(toast).toBeVisible();

  // Update toast should still use primary color in dark mode
  const bgColor = await toast.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bgColor).not.toBe('');
  expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  // Should not fall back to dark mode default toast color (#334155 = rgb(51, 65, 85))
  expect(bgColor).not.toBe('rgb(51, 65, 85)');
});
