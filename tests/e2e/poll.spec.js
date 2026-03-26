// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('poll detected as Poll / Survey template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-021');
  await page.waitForSelector('.poll-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Poll');
});

test('poll renders bar chart with vote counts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-021');
  await page.waitForSelector('.poll-bar', { timeout: 5_000 });

  const bars = page.locator('.poll-bar');
  expect(await bars.count()).toBe(5);

  // Total votes shown
  const total = page.locator('.poll-total');
  await expect(total).toContainText('25');
});

test('poll shows percentage labels inside wide bars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-021');
  await page.waitForSelector('.poll-bar', { timeout: 5_000 });

  // bars with >15% width should have inline percentage labels
  const labels = page.locator('.poll-bar-label');
  expect(await labels.count()).toBeGreaterThan(0);
  const text = await labels.first().textContent();
  expect(text).toMatch(/\d+%/);
});

test('poll has live mode toggle button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-021');
  await page.waitForSelector('.poll-live-btn', { timeout: 5_000 });

  const btn = page.locator('.poll-live-btn');
  await expect(btn).toBeVisible();
  // click to activate
  await btn.click();
  await expect(btn).toHaveClass(/poll-live-active/);
  // click to deactivate
  await btn.click();
  expect(await btn.getAttribute('class')).not.toContain('poll-live-active');
});

test('poll bars have CSS transition for animation', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-021');
  await page.waitForSelector('.poll-bar', { timeout: 5_000 });

  const transition = await page.locator('.poll-bar').first().evaluate(
    el => getComputedStyle(el).transition
  );
  expect(transition).toContain('width');
});

/* ---------- Directory view ---------- */

test('poll directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-polls/Polls'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('poll directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-polls/Polls'; });
  await page.waitForSelector('.poll-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});
