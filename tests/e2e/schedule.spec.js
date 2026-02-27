// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('weekly schedule detected as Schedule template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.template-schedule-block', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Schedule');

  // Should group by day
  const dayLabels = page.locator('.template-schedule-day-label');
  expect(await dayLabels.count()).toBeGreaterThanOrEqual(5);  // Mon-Fri

  // Check time and event text
  const times = await page.locator('.template-schedule-time').allTextContents();
  expect(times.some(t => t.includes('8:00 AM'))).toBe(true);

  const events = await page.locator('.template-schedule-event-name').allTextContents();
  expect(events).toContain('Team Standup');
});

test('schedule shows location info', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.template-schedule-location', { timeout: 5_000 });

  const locations = await page.locator('.template-schedule-location').allTextContents();
  expect(locations.some(l => l.includes('Conference Room'))).toBe(true);
});
