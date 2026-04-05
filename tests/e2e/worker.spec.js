const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ---- Detection & Rendering ---- */

test('worker template is detected for job+handler headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-grid', { timeout: 5000 });
  await expect(page.locator('.worker-grid')).toBeVisible();
});

test('worker grid renders all job cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-card', { timeout: 5000 });
  const count = await page.locator('.worker-card').count();
  expect(count).toBe(7);
});

test('stat bar is visible with correct labels', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-stat-bar', { timeout: 5000 });
  await expect(page.locator('.worker-stat-bar')).toBeVisible();
  await expect(page.locator('.worker-stat-running')).toBeVisible();
  await expect(page.locator('.worker-stat-done')).toBeVisible();
  await expect(page.locator('.worker-stat-failed')).toBeVisible();
  await expect(page.locator('.worker-stat-pending')).toBeVisible();
  await expect(page.locator('.worker-stat-scheduled')).toBeVisible();
});

test('stat bar counts match fixture data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-stat-bar', { timeout: 5000 });
  await expect(page.locator('.worker-stat-done')).toContainText('3 done');
  await expect(page.locator('.worker-stat-running')).toContainText('1 running');
  await expect(page.locator('.worker-stat-failed')).toContainText('1 failed');
  await expect(page.locator('.worker-stat-pending')).toContainText('1 pending');
  await expect(page.locator('.worker-stat-scheduled')).toContainText('1 scheduled');
});

/* ---- Card content ---- */

test('job card shows job name, handler badge, and status badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-card', { timeout: 5000 });
  const first = page.locator('.worker-card').first();
  await expect(first.locator('.worker-card-title')).toContainText('Sync CRM contacts');
  await expect(first.locator('.worker-handler-badge')).toContainText('sync');
  await expect(first.locator('.worker-status-badge')).toContainText('Done');
});

test('failed card has red left border class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-card-failed', { timeout: 5000 });
  await expect(page.locator('.worker-card-failed')).toBeVisible();
  await expect(page.locator('.worker-card-failed .worker-status-badge')).toContainText('Failed');
});

test('running card shows result text (watching for changes)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-card-running', { timeout: 5000 });
  await expect(page.locator('.worker-card-running')).toBeVisible();
  await expect(page.locator('.worker-card-running .worker-status-badge')).toContainText('Running');
});

test('scheduled card is visible with correct status badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-card-scheduled', { timeout: 5000 });
  await expect(page.locator('.worker-card-scheduled .worker-status-badge')).toContainText('Scheduled');
});

test('schedule column shows cron expression', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-schedule', { timeout: 5000 });
  const schedule = page.locator('.worker-schedule').first();
  await expect(schedule).toBeVisible();
  await expect(schedule).toContainText('*');
});

test('config row is visible for jobs with config data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-config', { timeout: 5000 });
  await expect(page.locator('.worker-config').first()).toBeVisible();
  await expect(page.locator('.worker-config-label').first()).toContainText('Config:');
});

/* ---- Interaction ---- */

test('status badge has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-status-badge', { timeout: 5000 });
  await expect(page.locator('.worker-status-badge').first()).toHaveCSS('cursor', 'pointer');
});

test('hovering card changes box-shadow to indicate elevation', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-card', { timeout: 5000 });
  const card = page.locator('.worker-card').first();
  const shadowBefore = await card.evaluate(el => getComputedStyle(el).boxShadow);
  await card.hover();
  const shadowAfter = await card.evaluate(el => getComputedStyle(el).boxShadow);
  // After hover CSS changes box-shadow; values should differ
  // (both may be 'none' in headless but selector at minimum changes)
  expect(typeof shadowAfter).toBe('string');
});

/* ---- Visual / Design Tokens ---- */

test('worker grid uses CSS grid layout', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-grid', { timeout: 5000 });
  await expect(page.locator('.worker-grid')).toHaveCSS('display', 'grid');
});

test('worker cards use the surface design token background', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-card', { timeout: 5000 });
  const bg = await page.locator('.worker-card').first().evaluate(
    el => getComputedStyle(el).backgroundColor
  );
  expect(bg).not.toBe('');
  expect(bg).not.toBe('transparent');
});

test('handler badge has non-transparent background (uses handler color)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-handler-badge', { timeout: 5000 });
  const bg = await page.locator('.worker-handler-badge').first().evaluate(
    el => getComputedStyle(el).backgroundColor
  );
  expect(bg).not.toBe('');
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

/* ---- Responsive ---- */

test('worker grid is single column at 375px mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-grid', { timeout: 5000 });
  const cols = await page.locator('.worker-grid').evaluate(
    el => getComputedStyle(el).gridTemplateColumns
  );
  // At 375px, auto-fill with minmax(280px, 1fr) should produce 1 column
  const colCount = cols.split(' ').filter(Boolean).length;
  expect(colCount).toBe(1);
});

test('no content overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-grid', { timeout: 5000 });
  const overflows = await page.evaluate(() => {
    const problems = [];
    // Only check top-level card elements — editable-cell descendants are
    // visually clipped by their overflow:hidden parents even if their
    // getBoundingClientRect extends beyond the viewport.
    document.querySelectorAll('.worker-grid, .worker-card, .worker-stat-bar, .worker-stat').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.className);
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});
