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

  // expand all collapsed versions so all badges are rendered
  const headers = page.locator('.changelog-version-header');
  const count = await headers.count();
  for (let i = 1; i < count; i++) {
    await headers.nth(i).click();
  }
  await page.waitForSelector('.changelog-version:nth-child(2) .changelog-entry', { timeout: 3_000 });

  const badges = await page.locator('.changelog-type-badge').allTextContents();
  expect(badges.some(b => b.includes('Added'))).toBe(true);
  expect(badges.some(b => b.includes('Fixed'))).toBe(true);
  expect(badges.some(b => b.includes('Breaking'))).toBe(true);
});

test('changelog latest version expanded, others collapsed', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-022');
  await page.waitForSelector('.changelog-version', { timeout: 5_000 });

  const versions = page.locator('.changelog-version');
  // first version body should be visible (expanded)
  const firstBody = versions.nth(0).locator('.changelog-body');
  await expect(firstBody).toBeVisible();
  // second version should have no body yet (lazy) or hidden
  const secondBody = versions.nth(1).locator('.changelog-body');
  expect(await secondBody.count()).toBe(0);
});

test('changelog click header expands collapsed version', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-022');
  await page.waitForSelector('.changelog-version', { timeout: 5_000 });

  // click second version header to expand
  const secondHeader = page.locator('.changelog-version').nth(1).locator('.changelog-version-header');
  await secondHeader.click();
  const secondBody = page.locator('.changelog-version').nth(1).locator('.changelog-body');
  await expect(secondBody).toBeVisible();
  // entries should appear via lazySection
  const entries = secondBody.locator('.changelog-entry');
  expect(await entries.count()).toBeGreaterThan(0);
});

test('changelog sidebar has version nav buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-022');
  await page.waitForSelector('.changelog-sidebar', { timeout: 5_000 });

  const btns = page.locator('.changelog-nav-btn');
  expect(await btns.count()).toBeGreaterThanOrEqual(4);
  const texts = await btns.allTextContents();
  expect(texts).toContain('2.3.0');
  expect(texts).toContain('2.0.0');
});

/* ---------- Directory view ---------- */

test('changelog directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-changelogs/Changelogs'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('changelog directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-changelogs/Changelogs'; });
  await page.waitForSelector('.changelog-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});
