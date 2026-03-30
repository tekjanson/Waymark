// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('password manager detected from fixture', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.passwords-card', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Password Manager');

  // Check cards rendered (9 entries in the fixture)
  const cards = page.locator('.passwords-card');
  expect(await cards.count()).toBe(9);
});

test('password cards show site names and usernames', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.passwords-card', { timeout: 5_000 });

  // Site names rendered
  const sites = await page.locator('.passwords-card-site').allTextContents();
  expect(sites).toContain('GitHub');
  expect(sites).toContain('Netflix');

  // Usernames rendered as editable fields
  const usernames = page.locator('.passwords-field-value.editable-cell');
  expect(await usernames.count()).toBeGreaterThan(0);
});

test('password cards grouped by category', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.passwords-category-header', { timeout: 5_000 });

  const headers = await page.locator('.passwords-category-name').allTextContents();
  expect(headers.length).toBeGreaterThanOrEqual(3);
  // Fixture has Development, Personal, Entertainment, Work, Finance, Social categories
  expect(headers.some(h => h === 'Work')).toBe(true);
});

test('password search filters cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.passwords-card', { timeout: 5_000 });

  const searchInput = page.locator('.passwords-search');
  await searchInput.fill('GitHub');

  // Only GitHub card should be visible
  const visibleCards = page.locator('.passwords-card:not(.hidden)');
  expect(await visibleCards.count()).toBe(1);
});

test('password site name is editable inline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.passwords-card-site.editable-cell', { timeout: 5_000 });

  const siteCell = page.locator('.passwords-card-site.editable-cell').first();
  await siteCell.click();
  const input = page.locator('.passwords-card-site.editable-cell input.editable-cell-input').first();
  await input.waitFor({ timeout: 3_000 });
  await input.fill('GitLab');
  await input.press('Enter');

  // Verify the edit was recorded
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'GitLab')).toBe(true);
});
