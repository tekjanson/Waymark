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

test('schedule sorts events by time within each day', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.template-schedule-block', { timeout: 5_000 });

  // Monday events should be in time order: 8:00, 10:00, 2:00
  const mondaySection = page.locator('.template-schedule-day').first();
  const times = await mondaySection.locator('.template-schedule-time').allTextContents();
  expect(times.length).toBe(3);
  expect(times[0]).toContain('8:00');
  expect(times[1]).toContain('10:00');
  expect(times[2]).toContain('2:00');
});

test('schedule detects and highlights time conflicts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.schedule-conflict', { timeout: 5_000 });

  // Tuesday has two events at 9:00 AM — both should be flagged
  const badges = page.locator('.schedule-conflict-badge');
  expect(await badges.count()).toBe(2);
  await expect(badges.first()).toContainText('Conflict');
});

test('schedule has Today button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-011');
  await page.waitForSelector('.schedule-today-btn', { timeout: 5_000 });

  const btn = page.locator('.schedule-today-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('Today');
});

/* ---------- Directory view ---------- */

test('schedule directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-schedules/Schedules'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('schedule directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-schedules/Schedules'; });
  await page.waitForSelector('.schedule-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});
