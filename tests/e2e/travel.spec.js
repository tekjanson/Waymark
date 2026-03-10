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
