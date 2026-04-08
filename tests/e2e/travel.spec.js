// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('travel itinerary detected as Travel Itinerary template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-025');
  await page.waitForSelector('.travel-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Travel');
});

test('travel itinerary shows date headers and booking refs', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-025');
  await page.waitForSelector('.travel-date-header', { timeout: 5_000 });

  const dates = page.locator('.travel-date-header');
  expect(await dates.count()).toBeGreaterThanOrEqual(5);

  // Booking references shown
  const refs = await page.locator('.travel-booking-ref').allTextContents();
  expect(refs.some(r => r.includes('AA-1234'))).toBe(true);
});

test('travel itinerary shows activity icons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-025');
  await page.waitForSelector('.travel-card-icon', { timeout: 5_000 });

  const icons = await page.locator('.travel-card-icon').allTextContents();
  expect(icons.some(i => i.includes('✈️'))).toBe(true);
  expect(icons.some(i => i.includes('🏨'))).toBe(true);
});

test('travel itinerary shows cost summary bar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-025');
  await page.waitForSelector('.travel-summary', { timeout: 5_000 });

  const costText = await page.locator('.travel-summary-cost').textContent();
  expect(costText).toContain('1,932');

  const activitiesText = await page.locator('.travel-summary-item:nth-child(2) .travel-summary-value').textContent();
  expect(activitiesText.trim()).toBe('9');
});

test('travel itinerary shows departure countdown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-025');
  await page.waitForSelector('.travel-summary', { timeout: 5_000 });

  const countdown = page.locator('.travel-summary-countdown .travel-summary-value');
  expect(await countdown.count()).toBe(1);
  const text = await countdown.textContent();
  expect(text).toMatch(/\d+ days? away/);
});

test('travel itinerary shows map links for locations', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-025');
  await page.waitForSelector('.travel-card', { timeout: 5_000 });

  const mapLinks = page.locator('.travel-map-link');
  expect(await mapLinks.count()).toBeGreaterThanOrEqual(5);

  const href = await mapLinks.first().getAttribute('href');
  expect(href).toContain('google.com/maps');
});

/* ---------- Directory view ---------- */

test('travel directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-travel/Travel%20Itineraries'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('travel directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-travel/Travel%20Itineraries'; });
  await page.waitForSelector('.travel-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});

/* ---------- Roadtrip fixture: new 7-column format (Link / Cost / People / Notes) ---------- */

test('travel roadtrip detected as Travel Itinerary template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Travel');
});

test('travel roadtrip URL link column renders as clickable anchor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-booking-link', { timeout: 5_000 });

  const link = page.locator('.travel-booking-link').first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^https?:\/\//);
});

test('travel roadtrip link cells open in new tab', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-booking-link', { timeout: 5_000 });

  const target = await page.locator('.travel-booking-link').first().getAttribute('target');
  expect(target).toBe('_blank');
});

test('travel roadtrip link button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-booking-link', { timeout: 5_000 });

  await expect(page.locator('.travel-booking-link').first()).toHaveCSS('cursor', 'pointer');
});

test('travel roadtrip shows Google Maps route button for multiple locations', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-map-route-btn', { timeout: 5_000 });

  const btn = page.locator('.travel-map-route-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('View Route');
});

test('travel roadtrip route button links to Google Maps directions', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-map-route-btn', { timeout: 5_000 });

  const href = await page.locator('.travel-map-route-btn').getAttribute('href');
  expect(href).toContain('google.com/maps/dir/');
});

test('travel roadtrip route button includes multiple location segments', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-map-route-btn', { timeout: 5_000 });

  const href = await page.locator('.travel-map-route-btn').getAttribute('href');
  const afterDir = href.split('/dir/')[1];
  const segments = afterDir.split('/').filter(Boolean);
  expect(segments.length).toBeGreaterThanOrEqual(3);
});

test('travel roadtrip route button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-map-route-btn', { timeout: 5_000 });

  await expect(page.locator('.travel-map-route-btn')).toHaveCSS('cursor', 'pointer');
});

test('travel roadtrip parseCost correctly handles complex cost formats in total', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-summary-cost', { timeout: 5_000 });

  // $80 + $49 + $30 + $60 + $49 + $64 + FREE(0) + $30 = 362
  const costText = await page.locator('.travel-summary-cost').textContent();
  const num = parseInt(costText.replace(/[^\d]/g, ''), 10);
  expect(num).toBe(362);
});

test('travel roadtrip FREE cost rows contribute zero to total', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-summary', { timeout: 5_000 });

  const costText = await page.locator('.travel-summary-cost').textContent();
  // Total should be 362, not inflated
  expect(costText).not.toContain('363');
  const num = parseInt(costText.replace(/[^\d]/g, ''), 10);
  expect(num).toBe(362);
});

test('travel roadtrip People column shows informational count badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-people', { timeout: 5_000 });

  const people = page.locator('.travel-people').first();
  await expect(people).toBeVisible();
  const text = await people.textContent();
  expect(text).toMatch(/\d+/);
});

test('travel roadtrip Notes column shows booking details in card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-notes', { timeout: 5_000 });

  const notes = page.locator('.travel-notes').first();
  await expect(notes).toBeVisible();
  const text = await notes.textContent();
  expect(text.length).toBeGreaterThan(5);
});

test('travel roadtrip shows correct activity count in summary', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-summary', { timeout: 5_000 });

  const activitiesText = await page.locator('.travel-summary-item:nth-child(2) .travel-summary-value').textContent();
  expect(activitiesText.trim()).toBe('8');
});

test('travel roadtrip date headers appear for each distinct date', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-065');
  await page.waitForSelector('.travel-date-header', { timeout: 5_000 });

  const headers = page.locator('.travel-date-header');
  expect(await headers.count()).toBeGreaterThanOrEqual(5);
});
