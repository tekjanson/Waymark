// @ts-check
/**
 * mobile-layout.spec.js — Tests for mobile rendering and responsive layout.
 *
 * Verifies the top-bar, body layout, and critical UI elements render correctly
 * on narrow (375px) and mid-width (768px) viewports without horizontal overflow.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ────────────────── Top-bar at 375px ────────────────── */

test('top-bar renders without horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  // No horizontal scrollbar — body should not overflow
  const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
  expect(bodyScrollWidth).toBeLessThanOrEqual(375 + 2); // 2px tolerance
});

test('top-bar elements are all visible within viewport at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  // The top-bar itself must be within viewport bounds
  const topBar = page.locator('#top-bar');
  await expect(topBar).toBeVisible();
  const rect = await topBar.boundingBox();
  expect(rect).toBeTruthy();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(376); // within 375px + 1px rounding
});

test('sign-out button is visible and within viewport at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  const logoutBtn = page.locator('#logout-btn');
  await expect(logoutBtn).toBeVisible();

  const rect = await logoutBtn.boundingBox();
  expect(rect).toBeTruthy();
  // Button should not hang off the right edge
  expect(rect.x + rect.width).toBeLessThanOrEqual(376);
});

test('search bar remains usable width at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  const input = page.locator('#search-input');
  await expect(input).toBeVisible();
  const width = await input.evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThanOrEqual(150);
});

test('search bar remains usable width at 412px (Android class viewport)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await setupApp(page);

  const input = page.locator('#search-input');
  await expect(input).toBeVisible();
  const width = await input.evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThanOrEqual(220);
});

test('tutorial button is hidden at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  // Tutorial button should be hidden on narrow mobile screens
  await expect(page.locator('#tutorial-btn')).toBeHidden();
});

test('tutorial button is visible at 768px', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await setupApp(page);

  await expect(page.locator('#tutorial-btn')).toBeVisible();
});

test('sidebar toggle and brand link are within viewport at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  const sidebarToggle = page.locator('#sidebar-toggle');
  const brand = page.locator('.brand');

  await expect(sidebarToggle).toBeVisible();
  await expect(brand).toBeVisible();

  const brandRect = await brand.boundingBox();
  expect(brandRect).toBeTruthy();
  // Brand must not extend off the right edge
  expect(brandRect.x + brandRect.width).toBeLessThanOrEqual(376);
});

test('theme toggle button is accessible at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  const themeBtn = page.locator('#theme-toggle-btn');
  await expect(themeBtn).toBeVisible();

  // Can be clicked without errors
  await themeBtn.click();
  // Theme toggles (html attribute should change)
  const theme = await page.locator('html').getAttribute('data-theme');
  expect(['light', 'dark']).toContain(theme);
});

/* ────────────────── Body layout at 375px ────────────────── */

test('main content area fills full width at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  const content = page.locator('#content');
  await expect(content).toBeVisible();

  const rect = await content.boundingBox();
  expect(rect).toBeTruthy();
  // Content should fill nearly the full viewport width (sidebar is off-canvas on mobile)
  expect(rect.width).toBeGreaterThanOrEqual(340);
});

test('home view renders without overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  await expect(page.locator('#home-view')).toBeVisible();

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('#home-view *').forEach(el => {
      // Skip elements inside intentional horizontal-scroll containers
      const scrollParent = el.closest('[class*="quick-actions"], [class*="scroll"]');
      if (scrollParent) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 4) {
        problems.push({ tag: el.tagName, className: el.className.toString().slice(0, 60) });
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

test('sidebar is hidden off-canvas when closed at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);

  // Close sidebar if open
  const sidebar = page.locator('#sidebar');
  const isOpen = await sidebar.evaluate(el => el.classList.contains('sidebar-open'));
  if (isOpen) {
    await page.locator('#sidebar-toggle').click();
    await page.waitForTimeout(300); // transition completes
  }

  // On mobile, closed sidebar should be translated off-canvas (left of viewport)
  const rect = await sidebar.boundingBox();
  if (rect) {
    // Either hidden or off the left edge — sidebar should not be visible in viewport
    const isOffCanvas = rect.x + rect.width <= 0;
    const isHidden = rect.width === 0;
    expect(isOffCanvas || isHidden).toBe(true);
  }
});

/* ────────────────── Top-bar at 768px (tablet) ────────────────── */

test('top-bar renders correctly at 768px', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await setupApp(page);

  const topBar = page.locator('#top-bar');
  await expect(topBar).toBeVisible();

  const rect = await topBar.boundingBox();
  expect(rect).toBeTruthy();
  expect(rect.x + rect.width).toBeLessThanOrEqual(769);
});

test('sign-out button is accessible at 768px', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await setupApp(page);

  const logoutBtn = page.locator('#logout-btn');
  await expect(logoutBtn).toBeVisible();

  const rect = await logoutBtn.boundingBox();
  expect(rect).toBeTruthy();
  expect(rect.x + rect.width).toBeLessThanOrEqual(769);
});
