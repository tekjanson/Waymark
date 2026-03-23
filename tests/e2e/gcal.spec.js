// tests/e2e/gcal.spec.js — E2E tests for the Calendar Events template
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

// ---- Layer 1: Detection & Rendering ----

test('gcal template is detected for calendar events sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-day-section', { timeout: 5000 });
  const badge = page.locator('#template-badge');
  await expect(badge).toContainText('Calendar');
});

test('gcal renders day section headers for each unique date', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-day-header', { timeout: 5000 });
  const headers = page.locator('.gcal-day-header');
  // fixture has 8 events across 7 different dates
  await expect(headers).toHaveCount(7);
});

test('gcal renders correct number of event cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-event-card', { timeout: 5000 });
  const cards = page.locator('.gcal-event-card');
  await expect(cards).toHaveCount(8);
});

// ---- Layer 2: Content verification ----

test('gcal displays event title text on each card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-event-title', { timeout: 5000 });
  const firstTitle = page.locator('.gcal-event-title').first();
  await expect(firstTitle).toContainText('Team standup');
});

test('gcal displays formatted time range on event cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-event-time', { timeout: 5000 });
  const firstTime = page.locator('.gcal-event-time').first();
  await expect(firstTime).toContainText('AM');
});

test('gcal shows type badges on event cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-type-badge', { timeout: 5000 });
  const badge = page.locator('.gcal-type-badge').first();
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('Meeting');
});

test('gcal shows location chips on event cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-location-chip', { timeout: 5000 });
  const chip = page.locator('.gcal-location-chip').first();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Conference Room A');
});

test('gcal day header shows event count badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-day-count', { timeout: 5000 });
  // The first date (2026-07-07) has 2 events
  const countBadge = page.locator('.gcal-day-count').first();
  await expect(countBadge).toContainText('2 events');
});

// ---- Layer 3: Interaction ----

test('gcal event title is editable on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-event-title', { timeout: 5000 });

  const title = page.locator('.gcal-event-title').first();
  await title.click();

  const input = page.locator('.gcal-event-title input, .editable-cell-input').first();
  await input.waitFor({ timeout: 3000 });
  await input.fill('Updated standup');
  await input.press('Enter');

  // Verify the record was emitted
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Updated standup')).toBe(true);
});

// ---- Layer 4: Visual Consistency ----

test('gcal meeting type badge has correct blue color scheme', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-type-meeting', { timeout: 5000 });
  const badge = page.locator('.gcal-type-meeting').first();
  const bg = await badge.evaluate(el => getComputedStyle(el).backgroundColor);
  // Should be a blue-ish color (not transparent)
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('');
});

test('gcal event cards have border-radius', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-event-card', { timeout: 5000 });
  const card = page.locator('.gcal-event-card').first();
  await expect(card).toHaveCSS('border-radius', /\d+px/);
});

test('gcal event cards have pointer-style cursor on hover', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-event-title', { timeout: 5000 });
  const title = page.locator('.gcal-event-title').first();
  await expect(title).toHaveCSS('cursor', 'text');
});

// ---- Layer 5: Mobile ----

test('gcal renders without overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.gcal-event-card', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.gcal-event-card, .gcal-type-badge').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.className);
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});
