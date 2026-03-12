// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- Helper: open settings modal ---------- */

async function openSettings(page) {
  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
}

/* ---------- Helper: mock the /api/source endpoints ---------- */

async function mockSourceAPI(page, { ref = 'main', cachedRefs = ['main'] } = {}) {
  await page.route('**/api/source', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ref, owner: 'test', repo: 'waymark', cachedRefs }),
    });
  });
}

async function mockSwitchRef(page, { succeed = true } = {}) {
  const captured = [];
  await page.route('**/api/source/ref', route => {
    const body = route.request().postDataJSON();
    captured.push(body);
    if (succeed) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ref: body.ref, message: 'Switched' }),
      });
    }
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Ref not found' }),
    });
  });
  return captured;
}

/* ============================================================
   Visibility
   ============================================================ */

test('version section is hidden when github source is not active', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  await expect(page.locator('#settings-version-section')).toBeHidden();
});

test('version section is visible when github source is active', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);
  await openSettings(page);

  await expect(page.locator('#settings-version-section')).toBeVisible();
});

/* ============================================================
   Content & State
   ============================================================ */

test('version picker shows branch input and apply button', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);
  await openSettings(page);

  await expect(page.locator('#settings-github-ref')).toBeVisible();
  await expect(page.locator('#settings-apply-ref')).toBeVisible();
  await expect(page.locator('#settings-apply-ref')).toContainText('Apply');
});

test('version input prepopulates with saved ref', async ({ page }) => {
  await setupApp(page, { githubSource: true, githubRef: 'develop' });
  await mockSourceAPI(page, { ref: 'develop', cachedRefs: ['main', 'develop'] });
  await openSettings(page);

  await expect(page.locator('#settings-github-ref')).toHaveValue('develop');
});

test('currently serving label shows server ref', async ({ page }) => {
  await setupApp(page, { githubSource: true, githubRef: 'v2.1.0' });
  await mockSourceAPI(page, { ref: 'v2.1.0' });
  await openSettings(page);

  // Wait for fetchSourceInfo to update the label
  await page.waitForFunction(
    () => document.getElementById('settings-current-ref')?.textContent === 'v2.1.0',
    { timeout: 5_000 },
  );
  await expect(page.locator('#settings-current-ref')).toContainText('v2.1.0');
});

test('quick switch section shows default main tag', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);
  await openSettings(page);

  const mainTag = page.locator('.settings-ref-tag[data-ref="main"]');
  await expect(mainTag).toBeVisible();
  await expect(mainTag).toContainText('main');
});

test('quick switch populates cached refs from server', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page, { ref: 'main', cachedRefs: ['main', 'develop', 'v1.0'] });
  await openSettings(page);

  // Wait for fetchSourceInfo to add tags
  await page.waitForFunction(
    () => document.querySelectorAll('.settings-ref-tag').length >= 3,
    { timeout: 5_000 },
  );
  const tags = page.locator('.settings-ref-tag');
  await expect(tags).toHaveCount(3);
});

test('active quick switch tag matches saved ref', async ({ page }) => {
  await setupApp(page, { githubSource: true, githubRef: 'develop' });
  await mockSourceAPI(page, { ref: 'develop', cachedRefs: ['main', 'develop'] });
  await openSettings(page);

  // Wait for tags to populate
  await page.waitForFunction(
    () => document.querySelectorAll('.settings-ref-tag').length >= 2,
    { timeout: 5_000 },
  );

  const developTag = page.locator('.settings-ref-tag[data-ref="develop"]');
  await expect(developTag).toHaveClass(/active/);

  const mainTag = page.locator('.settings-ref-tag[data-ref="main"]');
  await expect(mainTag).not.toHaveClass(/active/);
});

/* ============================================================
   Apply — Error cases
   ============================================================ */

test('apply with empty input shows error message', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);
  await openSettings(page);

  // Clear the input
  await page.locator('#settings-github-ref').fill('');
  await page.locator('#settings-apply-ref').click();

  const status = page.locator('#settings-ref-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Please enter');
  await expect(status).toHaveClass(/settings-ref-status-error/);
});

test('apply with backend error shows failure message', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);
  await mockSwitchRef(page, { succeed: false });
  // Prevent reload in case it somehow succeeds
  await page.evaluate(() => { window.location.reload = () => {}; });
  await openSettings(page);

  await page.locator('#settings-github-ref').fill('nonexistent-branch');
  await page.locator('#settings-apply-ref').click();

  const status = page.locator('#settings-ref-status');
  await page.waitForSelector('.settings-ref-status-error', { timeout: 5_000 });
  await expect(status).toContainText('Failed');
});

/* ============================================================
   Apply — Success cases
   ============================================================ */

test('apply sends ref to backend and shows success', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);
  const captured = await mockSwitchRef(page);
  // Prevent reload so we can inspect the status message
  await page.evaluate(() => { window.location.reload = () => {}; });
  await openSettings(page);

  await page.locator('#settings-github-ref').fill('feature/new-ui');
  await page.locator('#settings-apply-ref').click();

  // Verify success status appears
  await page.waitForSelector('.settings-ref-status-success', { timeout: 5_000 });
  await expect(page.locator('#settings-ref-status')).toContainText('Switched to');
  await expect(page.locator('#settings-ref-status')).toContainText('feature/new-ui');

  // Verify the backend received the correct ref
  expect(captured.length).toBe(1);
  expect(captured[0].ref).toBe('feature/new-ui');
});

test('enter key in input triggers apply', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);
  const captured = await mockSwitchRef(page);
  await page.evaluate(() => { window.location.reload = () => {}; });
  await openSettings(page);

  await page.locator('#settings-github-ref').fill('hotfix/v3');
  await page.locator('#settings-github-ref').press('Enter');

  await page.waitForSelector('.settings-ref-status-success', { timeout: 5_000 });
  expect(captured.length).toBe(1);
  expect(captured[0].ref).toBe('hotfix/v3');
});

test('currently serving label updates after successful apply', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);
  await mockSwitchRef(page);
  await page.evaluate(() => { window.location.reload = () => {}; });
  await openSettings(page);

  await page.locator('#settings-github-ref').fill('v3.0.0');
  await page.locator('#settings-apply-ref').click();

  await page.waitForSelector('.settings-ref-status-success', { timeout: 5_000 });
  await expect(page.locator('#settings-current-ref')).toContainText('v3.0.0');
});

/* ============================================================
   Quick Switch — Click behavior
   ============================================================ */

test('clicking quick switch tag fills input and applies', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page, { ref: 'main', cachedRefs: ['main', 'develop'] });
  const captured = await mockSwitchRef(page);
  await page.evaluate(() => { window.location.reload = () => {}; });
  await openSettings(page);

  // Wait for additional tags to populate
  await page.waitForFunction(
    () => document.querySelectorAll('.settings-ref-tag').length >= 2,
    { timeout: 5_000 },
  );

  // Click the "develop" tag
  await page.locator('.settings-ref-tag[data-ref="develop"]').click();

  // The input should now contain "develop"
  await expect(page.locator('#settings-github-ref')).toHaveValue('develop');

  // And the apply should have been triggered
  await page.waitForSelector('.settings-ref-status-success', { timeout: 5_000 });
  expect(captured.length).toBe(1);
  expect(captured[0].ref).toBe('develop');
});

/* ============================================================
   Interaction — apply button disabled during request
   ============================================================ */

test('apply button is disabled while request is in flight', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);

  // Delay the response so we can observe the disabled state
  await page.route('**/api/source/ref', async route => {
    await new Promise(r => setTimeout(r, 500));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ref: 'slow-branch', message: 'ok' }),
    });
  });
  await page.evaluate(() => { window.location.reload = () => {}; });
  await openSettings(page);

  await page.locator('#settings-github-ref').fill('slow-branch');
  await page.locator('#settings-apply-ref').click();

  // Button should be disabled immediately after click
  await expect(page.locator('#settings-apply-ref')).toBeDisabled();

  // After response arrives, button should re-enable
  await page.waitForSelector('.settings-ref-status-success', { timeout: 5_000 });
  await expect(page.locator('#settings-apply-ref')).toBeEnabled();
});

/* ============================================================
   Info status during switch
   ============================================================ */

test('switching text shown while request is pending', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);

  // Delay response so we can check the "Switching…" message
  await page.route('**/api/source/ref', async route => {
    await new Promise(r => setTimeout(r, 300));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ref: 'test', message: 'ok' }),
    });
  });
  await page.evaluate(() => { window.location.reload = () => {}; });
  await openSettings(page);

  await page.locator('#settings-github-ref').fill('test');
  await page.locator('#settings-apply-ref').click();

  // "Switching…" info status should appear immediately
  await page.waitForSelector('.settings-ref-status-info', { timeout: 2_000 });
  await expect(page.locator('#settings-ref-status')).toContainText('Switching');
});

/* ============================================================
   Settings re-open preserves state
   ============================================================ */

test('re-opening settings modal shows version section each time', async ({ page }) => {
  await setupApp(page, { githubSource: true });
  await mockSourceAPI(page);

  // First open
  await openSettings(page);
  await expect(page.locator('#settings-version-section')).toBeVisible();

  // Close
  await page.locator('#settings-done-btn').click();
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);

  // Second open — version section should still be visible
  await openSettings(page);
  await expect(page.locator('#settings-version-section')).toBeVisible();
});
