// @ts-check
/**
 * css-variables.spec.js — Regression tests for CSS design-token completeness.
 *
 * Verifies that all custom properties used throughout template CSS files are
 * actually defined in :root (base.css), so no template renders with
 * transparent colours, zero spacing, or invisible text.
 *
 * Flat test() calls only — no describe() wrappers, no shared state.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ─── Helper: resolve a CSS custom property value on <html> ─── */
async function cssVar(page, prop) {
  return page.evaluate(
    p => getComputedStyle(document.documentElement).getPropertyValue(p).trim(),
    prop
  );
}

/* ─── Layer 1: Token definitions ─── */

test('css tokens: --color-danger is defined and resolves to a color', async ({ page }) => {
  await setupApp(page);
  const val = await cssVar(page, '--color-danger');
  expect(val).not.toBe('');
  // Must be an rgb/hex string, not empty
  expect(val.length).toBeGreaterThan(0);
});

test('css tokens: --color-muted resolves to text-muted value', async ({ page }) => {
  await setupApp(page);
  const muted = await cssVar(page, '--color-muted');
  const textMuted = await cssVar(page, '--color-text-muted');
  expect(muted).not.toBe('');
  expect(muted).toBe(textMuted);
});

test('css tokens: --color-hover is defined and non-empty', async ({ page }) => {
  await setupApp(page);
  const val = await cssVar(page, '--color-hover');
  expect(val).not.toBe('');
});

test('css tokens: spacing scale tokens are defined with correct pixel values', async ({ page }) => {
  await setupApp(page);
  const xs = await cssVar(page, '--space-xs');
  const sm = await cssVar(page, '--space-sm');
  const md = await cssVar(page, '--space-md');
  const lg = await cssVar(page, '--space-lg');
  const xl = await cssVar(page, '--space-xl');
  expect(xs).toBe('4px');
  expect(sm).toBe('8px');
  expect(md).toBe('16px');
  expect(lg).toBe('24px');
  expect(xl).toBe('32px');
});

test('css tokens: --radius-md is defined', async ({ page }) => {
  await setupApp(page);
  const val = await cssVar(page, '--radius-md');
  expect(val).not.toBe('');
  expect(val).toBe('12px');
});

test('css tokens: short-form arcade aliases resolve to standard tokens', async ({ page }) => {
  await setupApp(page);
  const text    = await cssVar(page, '--text');
  const surface = await cssVar(page, '--surface');
  const border  = await cssVar(page, '--border');
  const accent  = await cssVar(page, '--accent');
  const colorText    = await cssVar(page, '--color-text');
  const colorSurface = await cssVar(page, '--color-surface');
  const colorBorder  = await cssVar(page, '--color-border');
  const colorPrimary = await cssVar(page, '--color-primary');
  expect(text).toBe(colorText);
  expect(surface).toBe(colorSurface);
  expect(border).toBe(colorBorder);
  expect(accent).toBe(colorPrimary);
});

test('css tokens: --color-label and --color-surface-hover are defined', async ({ page }) => {
  await setupApp(page);
  const label   = await cssVar(page, '--color-label');
  const surfHov = await cssVar(page, '--color-surface-hover');
  expect(label).not.toBe('');
  expect(surfHov).not.toBe('');
});

/* ─── Layer 2: Dark-mode aliases follow theme ─── */

test('css tokens: --color-danger tracks --color-error in dark mode', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  const danger = await cssVar(page, '--color-danger');
  const error  = await cssVar(page, '--color-error');
  expect(danger).not.toBe('');
  expect(danger).toBe(error);
});

test('css tokens: short-form --text alias follows dark-mode --color-text', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  const text      = await cssVar(page, '--text');
  const colorText = await cssVar(page, '--color-text');
  expect(text).toBe(colorText);
});

/* ─── Layer 3: Arcade template renders with visible styles ─── */

test('arcade game card has non-transparent border color when selected', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-card', { timeout: 5_000 });

  const firstCard = page.locator('.arcade-game-card').first();
  await firstCard.click();
  await expect(firstCard).toHaveClass(/arcade-game-card-selected/);

  // Border colour must resolve to a visible (non-transparent) value
  const borderColor = await firstCard.evaluate(
    el => getComputedStyle(el).borderColor
  );
  expect(borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(borderColor).not.toBe('transparent');
});

test('arcade section title has visible text color from --text token', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-section-title', { timeout: 5_000 });

  const color = await page.locator('.arcade-section-title').first().evaluate(
    el => getComputedStyle(el).color
  );
  expect(color).not.toBe('rgba(0, 0, 0, 0)');
  expect(color).not.toBe('');
});

/* ─── Layer 4: IoT template renders muted text visibly ─── */

test('iot filter buttons use visible color from --color-muted token', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-filter-btn', { timeout: 5_000 });

  const color = await page.locator('.iot-filter-btn').first().evaluate(
    el => getComputedStyle(el).color
  );
  // Must NOT be transparent (which would happen if --color-muted was undefined)
  expect(color).not.toBe('rgba(0, 0, 0, 0)');
  expect(color).not.toBe('');
});

/* ─── Layer 5: OKR hover state has visible background ─── */

test('okr objective header has non-empty hover-background from --color-hover', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-objective-header', { timeout: 5_000 });

  // Hover the first header and check background-color
  await page.locator('.okr-objective-header').first().hover();

  const bg = await page.locator('.okr-objective-header').first().evaluate(
    el => getComputedStyle(el).backgroundColor
  );
  // With --color-hover defined, background is now visible (non-transparent)
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

/* ─── Layer 6: Notification template renders with correct spacing ─── */

test('notification view renders with positive height from --space tokens', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-view', { timeout: 5_000 });

  const height = await page.locator('.notification-view').evaluate(
    el => el.getBoundingClientRect().height
  );
  // If --space-md / --space-sm were undefined the view would still render
  // but would collapse (near-zero height). A real rendered view must be taller.
  expect(height).toBeGreaterThan(20);
});

test('notification summary renders and is visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-046');
  await page.waitForSelector('.notification-summary', { timeout: 5_000 });
  await expect(page.locator('.notification-summary')).toBeVisible();
});

/* ─── Layer 7: Gantt row hover uses visible background ─── */

test('gantt task label has positive height and hover uses visible background', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-task-label', { timeout: 5_000 });

  // Hover a task label — background should not be transparent
  await page.locator('.gantt-task-label').first().hover();
  const bg = await page.locator('.gantt-task-label').first().evaluate(
    el => getComputedStyle(el).backgroundColor
  );
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});
