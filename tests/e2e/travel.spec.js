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
