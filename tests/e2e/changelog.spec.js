// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('changelog detected as Changelog template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-022');
  await page.waitForSelector('.changelog-entry', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Changelog');
});

test('changelog groups entries by version', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-022');
  await page.waitForSelector('.changelog-version', { timeout: 5_000 });

  const versions = page.locator('.changelog-version-tag');
  expect(await versions.count()).toBeGreaterThanOrEqual(4);

  const tags = await versions.allTextContents();
  expect(tags).toContain('2.3.0');
});

test('changelog shows type badges (Added, Fixed, Breaking)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-022');
  await page.waitForSelector('.changelog-type-badge', { timeout: 5_000 });

  const badges = await page.locator('.changelog-type-badge').allTextContents();
  expect(badges.some(b => b.includes('Added'))).toBe(true);
  expect(badges.some(b => b.includes('Fixed'))).toBe(true);
  expect(badges.some(b => b.includes('Breaking'))).toBe(true);
});
