// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/*
 * Search tests — each test fully bootstraps the app with
 * preconditioned auth + explorer state, then exercises search.
 */

test('search bar is visible after login', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await expect(page.locator('#search-input')).toBeVisible();
  await expect(page.locator('#search-btn')).toBeVisible();
});

test('search for "grocery" returns matching sheet', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await page.fill('#search-input', 'grocery');
  await page.click('#search-btn');

  await page.waitForSelector('#search-view:not(.hidden)');

  const summary = page.locator('#search-summary');
  await expect(summary).toContainText('grocery');

  const results = page.locator('.sheet-list-item');
  expect(await results.count()).toBeGreaterThanOrEqual(1);
  await expect(results.first()).toContainText('Grocery List');
});

test('search for "chore" returns chores sheet', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await page.fill('#search-input', 'chore');
  await page.click('#search-btn');

  await page.waitForSelector('#search-view:not(.hidden)');
  await expect(page.locator('.sheet-list-item').first()).toContainText('Weekly Chores');
});

test('search for "home" returns home repairs sheet', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await page.fill('#search-input', 'home');
  await page.click('#search-btn');

  await page.waitForSelector('#search-view:not(.hidden)');
  await expect(page.locator('.sheet-list-item').first()).toContainText('Home Repairs');
});

test('search with no match shows empty state', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await page.fill('#search-input', 'xyznonexistent');
  await page.click('#search-btn');

  await page.waitForSelector('#search-view:not(.hidden)');
  await expect(page.locator('#no-results')).toBeVisible();
});

test('clicking a search result navigates to checklist', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await page.fill('#search-input', 'grocery');
  await page.click('#search-btn');

  await page.waitForSelector('.sheet-list-item', { timeout: 5_000 });
  await page.click('.sheet-list-item');

  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5_000 });
  await expect(page.locator('#checklist-title')).toHaveText('Grocery List');
});

test('search form submits via Enter key', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await page.fill('#search-input', 'repair');
  await page.press('#search-input', 'Enter');

  await page.waitForSelector('#search-view:not(.hidden)');
  const summary = page.locator('#search-summary');
  await expect(summary).not.toBeEmpty();
});

test('search updates URL hash', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  await page.fill('#search-input', 'grocery');
  await page.click('#search-btn');

  await page.waitForSelector('#search-view:not(.hidden)');
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toContain('#/search?q=grocery');
});
