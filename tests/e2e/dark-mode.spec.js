// @ts-check
/**
 * dark-mode.spec.js — Dark mode rendering verification across templates.
 *
 * Validates that the [data-theme="dark"] CSS overrides are applied correctly
 * and that key UI elements have proper contrast in dark mode.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ---------- Helper: switch to dark theme ---------- */
async function setDarkTheme(page) {
  await page.evaluate(() => {
    localStorage.setItem('waymark_theme', JSON.stringify('dark'));
    document.documentElement.setAttribute('data-theme', 'dark');
  });
}

/* ---------- Helper: get computed background RGB values ---------- */
async function getComputedBg(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return getComputedStyle(el).backgroundColor;
  }, selector);
}

/* ---------- Helper: verify element is not white/light in dark mode ---------- */
async function assertNotLightBackground(page, selector) {
  const bg = await getComputedBg(page, selector);
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return; // transparent is fine
  // Convert "rgb(r, g, b)" to check if it's too light
  const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return;
  const [, r, g, b] = match.map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // In dark mode, main surface backgrounds should not be very light (luminance > 0.8)
  expect(luminance, `${selector} has too-light background in dark mode: ${bg}`).toBeLessThan(0.85);
}

/* ═══════════════════════════════════════════════════════════════
   Theme Switching
   ═══════════════════════════════════════════════════════════════ */

test('theme switches to dark mode and body gets data-theme attribute', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_theme', JSON.stringify('dark'));
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(theme).toBe('dark');
});

test('dark mode sets dark background on the app root', async ({ page }) => {
  await setupApp(page);
  await setDarkTheme(page);
  const bg = await getComputedBg(page, 'body');
  expect(bg).not.toBeNull();
  // Background should be dark (not white)
  const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const [, r, g, b] = match.map(Number);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    expect(luminance).toBeLessThan(0.3);
  }
});

/* ═══════════════════════════════════════════════════════════════
   CSS Variable Registration
   ═══════════════════════════════════════════════════════════════ */

test('CSS custom properties --color-surface-alt and --color-hover are defined in light mode', async ({ page }) => {
  await setupApp(page);
  const values = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      surfaceAlt: style.getPropertyValue('--color-surface-alt').trim(),
      hover: style.getPropertyValue('--color-hover').trim(),
      radiusLg: style.getPropertyValue('--radius-lg').trim(),
    };
  });
  expect(values.surfaceAlt).not.toBe('');
  expect(values.hover).not.toBe('');
  expect(values.radiusLg).not.toBe('');
});

test('CSS custom properties override correctly in dark mode', async ({ page }) => {
  await setupApp(page);
  await setDarkTheme(page);
  const values = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bg: style.getPropertyValue('--color-bg').trim(),
      surface: style.getPropertyValue('--color-surface').trim(),
      surfaceAlt: style.getPropertyValue('--color-surface-alt').trim(),
      hover: style.getPropertyValue('--color-hover').trim(),
      border: style.getPropertyValue('--color-border').trim(),
    };
  });
  // bg should be dark in dark mode
  expect(values.bg).toBe('#0f172a');
  expect(values.surface).toBe('#1e293b');
  // surface-alt and hover should be defined (not empty)
  expect(values.surfaceAlt).not.toBe('');
  expect(values.hover).not.toBe('');
  expect(values.border).toBe('#334155');
});

/* ═══════════════════════════════════════════════════════════════
   Kanban Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('kanban board renders in dark mode with proper lane headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });
  await setDarkTheme(page);

  // Lane headers should have colored text in dark mode
  const backlogHeader = page.locator('.kanban-lane-backlog .kanban-lane-header').first();
  if (await backlogHeader.count() > 0) {
    const color = await backlogHeader.evaluate(el => getComputedStyle(el).color);
    expect(color).not.toBe('');
  }
});

test('kanban stage badges have proper dark-mode backgrounds', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-stage-done', { timeout: 5000 });
  await setDarkTheme(page);

  const doneBadge = page.locator('.kanban-stage-done').first();
  const bg = await doneBadge.evaluate(el => getComputedStyle(el).backgroundColor);
  // Should not be the light green #dcfce7
  expect(bg).not.toMatch(/rgb\(220,\s*252,\s*231\)/);
  expect(bg).not.toBe('rgb(220, 252, 231)');
});

test('kanban due-date badges use dark-mode colors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await setDarkTheme(page);
  // If overdue badges exist, they should use dark-friendly colors
  const overdueBadge = page.locator('.kanban-due-overdue').first();
  if (await overdueBadge.count() > 0) {
    const bg = await overdueBadge.evaluate(el => getComputedStyle(el).backgroundColor);
    // Should not be pure light red #fee2e2
    expect(bg).not.toBe('rgb(254, 226, 226)');
  }
});

/* ═══════════════════════════════════════════════════════════════
   Budget Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('budget rows render in dark mode without white backgrounds', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-row', { timeout: 5000 });
  await setDarkTheme(page);

  // The budget container should not be white
  await assertNotLightBackground(page, '#checklist-view');
});

test('budget positive/negative amounts use dark-mode contrast colors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-row', { timeout: 5000 });
  await setDarkTheme(page);

  // Check that dark mode overrides exist for color tokens
  const tokenValues = await page.evaluate(() => ({
    success: getComputedStyle(document.documentElement).getPropertyValue('--color-success').trim(),
    error: getComputedStyle(document.documentElement).getPropertyValue('--color-error').trim(),
  }));
  // In dark mode, success should be bright green
  expect(tokenValues.success).toBe('#22c55e');
  expect(tokenValues.error).toBe('#ef4444');
});

/* ═══════════════════════════════════════════════════════════════
   Testcases Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('testcases status badges use dark-friendly backgrounds in dark mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row', { timeout: 5000 });
  await setDarkTheme(page);

  // Pass badge should not be light green
  const passBadge = page.locator('.tc-status-btn.tc-pass').first();
  if (await passBadge.count() > 0) {
    const bg = await passBadge.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(220, 252, 231)'); // not #dcfce7
  }
});

test('testcases fail rows use dark-friendly highlight in dark mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('.tc-row', { timeout: 5000 });
  await setDarkTheme(page);

  const failRow = page.locator('.tc-row.tc-row-fail').first();
  if (await failRow.count() > 0) {
    const bg = await failRow.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(254, 242, 242)'); // not #fef2f2
  }
});

/* ═══════════════════════════════════════════════════════════════
   Changelog Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('changelog type badges use dark-mode colors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-022');
  await page.waitForSelector('.changelog-entry', { timeout: 5000 });
  await setDarkTheme(page);

  const addedBadge = page.locator('.changelog-type-added').first();
  if (await addedBadge.count() > 0) {
    const bg = await addedBadge.evaluate(el => getComputedStyle(el).backgroundColor);
    // Should not be the light #dcfce7 in dark mode
    expect(bg).not.toBe('rgb(220, 252, 231)');
  }

  const breakingBadge = page.locator('.changelog-type-breaking').first();
  if (await breakingBadge.count() > 0) {
    const bg = await breakingBadge.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(254, 226, 226)'); // not #fee2e2
  }
});

/* ═══════════════════════════════════════════════════════════════
   OKR Dark Mode (uses --color-surface-alt and --color-hover)
   ═══════════════════════════════════════════════════════════════ */

test('okr objective headers use surface-alt in light mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-objective-header', { timeout: 5000 });

  const header = page.locator('.okr-objective-header').first();
  const bg = await header.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('');
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('okr renders in dark mode with proper contrast', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-objective-header', { timeout: 5000 });
  await setDarkTheme(page);

  // Objective header should have dark background (not light)
  const header = page.locator('.okr-objective-header').first();
  await assertNotLightBackground(page, '.okr-objective-header');

  // OKR group should not have a white background
  const bg = await getComputedBg(page, '.okr-group');
  if (bg) {
    expect(bg).not.toBe('rgb(255, 255, 255)');
  }
});

test('okr key result progress bar is visible in dark mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-kr-row', { timeout: 5000 });
  await setDarkTheme(page);

  // Progress bar track should be visible (not transparent)
  const progressTrack = page.locator('.okr-kr-bar-track').first();
  if (await progressTrack.count() > 0) {
    const bg = await progressTrack.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  }
});

/* ═══════════════════════════════════════════════════════════════
   Gantt Dark Mode (SVG-based, uses CSS variables for all colors)
   ═══════════════════════════════════════════════════════════════ */

test('gantt chart renders in dark mode without errors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-wrapper', { timeout: 5000 });
  await setDarkTheme(page);

  // Gantt wrapper should exist and not have white background
  await expect(page.locator('.gantt-wrapper')).toBeVisible();
  await assertNotLightBackground(page, '.gantt-wrapper');
});

test('gantt SVG header background uses surface-alt token in dark mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-label-header', { timeout: 5000 });
  await setDarkTheme(page);

  const header = page.locator('.gantt-label-header').first();
  if (await header.count() > 0) {
    const bg = await header.evaluate(el => getComputedStyle(el).backgroundColor);
    // In dark mode, surface-alt is #162032 — not white or light gray
    expect(bg).not.toBe('rgb(255, 255, 255)');
    expect(bg).not.toBe('rgb(241, 245, 249)'); // not light #f1f5f9
  }
});

test('gantt task labels have readable text color in dark mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-055');
  await page.waitForSelector('.gantt-task-name', { timeout: 5000 });
  await setDarkTheme(page);

  // Verify the --color-text variable resolves to a light value in dark mode
  const textColor = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim()
  );
  // Dark mode --color-text should be a light color like #e2e8f0
  expect(textColor).not.toBe('');
  expect(textColor).not.toBe('#1e293b'); // should not be the light-mode dark text

  // Assignee labels use --color-text-secondary (not error red, always readable)
  const assignee = page.locator('.gantt-task-assignee').first();
  if (await assignee.count() > 0) {
    const color = await assignee.evaluate(el => getComputedStyle(el).color);
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const [, r, g, b] = match.map(Number);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      expect(luminance).toBeGreaterThan(0.3); // assignee text should not be near-black
    }
  }
});

/* ═══════════════════════════════════════════════════════════════
   CRM Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('crm pipeline cards use dark-mode colors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5000 });
  await setDarkTheme(page);

  // CRM won card should not have light green background #f0fdf4
  const wonCard = page.locator('.crm-card-won').first();
  if (await wonCard.count() > 0) {
    const bg = await wonCard.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(240, 253, 244)'); // not #f0fdf4
  }
});

/* ═══════════════════════════════════════════════════════════════
   Habit Tracker Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('habit tracker done cells use proper dark-mode colors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-018');
  // Habit sheet shows day view — wait for a habit item (any status)
  await page.waitForSelector('.habit-day-item, .habit-grid-row', { timeout: 5000 });
  await setDarkTheme(page);

  // Day view: done habit items should use dark-mode colors
  const dayDone = page.locator('.habit-day-item-done').first();
  if (await dayDone.count() > 0) {
    const bg = await dayDone.evaluate(el => getComputedStyle(el).backgroundColor);
    // Should not be light green #dcfce7 in dark mode
    expect(bg).not.toBe('rgb(220, 252, 231)');
  }

  // Week/grid view: habit grid cells
  const doneCell = page.locator('.habit-done').first();
  if (await doneCell.count() > 0) {
    const bg = await doneCell.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(220, 252, 231)');
  }
});

/* ═══════════════════════════════════════════════════════════════
   Recipe Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('recipe cards render in dark mode without white backgrounds', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5000 });
  await setDarkTheme(page);

  await assertNotLightBackground(page, '#checklist-view');
});

/* ═══════════════════════════════════════════════════════════════
   Timesheet Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('timesheet accent colors adapt to dark mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-020');
  await page.waitForSelector('.ts-row', { timeout: 5000 });
  await setDarkTheme(page);

  const groupTitle = page.locator('.ts-group-title').first();
  if (await groupTitle.count() > 0) {
    const color = await groupTitle.evaluate(el => getComputedStyle(el).color);
    // Should not be the dark indigo #4338ca on dark background
    expect(color).not.toBe('rgb(67, 56, 202)');
  }
});

/* ═══════════════════════════════════════════════════════════════
   Automation Dark Mode
   ═══════════════════════════════════════════════════════════════ */

test('automation status badges use dark-mode colors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-card', { timeout: 5000 });
  await setDarkTheme(page);

  const doneBadge = page.locator('.automation-status-done').first();
  if (await doneBadge.count() > 0) {
    const bg = await doneBadge.evaluate(el => getComputedStyle(el).backgroundColor);
    // Should not be light green in dark mode
    expect(bg).not.toBe('rgb(220, 252, 231)');
  }
});

/* ═══════════════════════════════════════════════════════════════
   Tint tokens in dark mode
   ═══════════════════════════════════════════════════════════════ */

test('tint-green background token is dark-mode appropriate', async ({ page }) => {
  await setupApp(page);
  await setDarkTheme(page);
  const tintBg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--tint-green-bg').trim()
  );
  // In dark mode, tint-green-bg should be rgba (dark semi-transparent), not #dcfce7
  expect(tintBg).not.toBe('#dcfce7');
  expect(tintBg).toMatch(/rgba/); // should be rgba in dark mode
});

test('tint-red background token is dark-mode appropriate', async ({ page }) => {
  await setupApp(page);
  await setDarkTheme(page);
  const tintBg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--tint-red-bg').trim()
  );
  expect(tintBg).not.toBe('#fee2e2');
  expect(tintBg).toMatch(/rgba/);
});
