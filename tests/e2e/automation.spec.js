// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('automation detected as Automation template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-card', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Automation');
});

test('automation renders workflow cards with steps', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-card', { timeout: 5_000 });

  // Fixture has 3 workflows: Login Flow, Dashboard Check, Logout Flow
  const cards = page.locator('.automation-card');
  await expect(cards).toHaveCount(3);

  // Each card should have a title
  const titles = page.locator('.automation-card-title');
  await expect(titles.first()).not.toBeEmpty();
});

test('automation renders step numbers and action badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-step', { timeout: 5_000 });

  // Should have step numbers
  const stepNums = page.locator('.automation-step-num');
  expect(await stepNums.count()).toBeGreaterThan(0);

  // Should have action badges
  const actionBadges = page.locator('.automation-action-badge');
  expect(await actionBadges.count()).toBeGreaterThan(0);
});

test('automation shows status badges with correct classes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-status', { timeout: 5_000 });

  // Fixture has Done, Running, Pending, Failed, Skipped statuses
  await expect(page.locator('.automation-status-done').first()).toBeVisible();
  await expect(page.locator('.automation-status-pending').first()).toBeVisible();
});

test('automation shows progress bars in summary', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-summary', { timeout: 5_000 });

  const progressBars = page.locator('.automation-progress-bar');
  expect(await progressBars.count()).toBeGreaterThan(0);

  // Summary text should mention completion percentage
  const summaryText = page.locator('.automation-summary-text');
  expect(await summaryText.first().textContent()).toMatch(/\d+% complete/);
});

test('automation status badge click cycles state', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-status', { timeout: 5_000 });

  // Find the first pending status badge by position — use all status badges
  const allBadges = page.locator('.automation-status');
  const count = await allBadges.count();

  // Find a pending badge index
  let pendingIdx = -1;
  for (let i = 0; i < count; i++) {
    const cls = await allBadges.nth(i).getAttribute('class');
    if (cls.includes('automation-status-pending')) { pendingIdx = i; break; }
  }
  expect(pendingIdx).toBeGreaterThanOrEqual(0);

  // Click it — the nth locator is stable regardless of class changes
  const badge = allBadges.nth(pendingIdx);
  await badge.click();

  // After clicking pending, it should cycle to running
  await expect(badge).toHaveClass(/automation-status-running/);
});

test('automation renders target selectors as code', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-target', { timeout: 5_000 });

  const targets = page.locator('.automation-target');
  expect(await targets.count()).toBeGreaterThan(0);
});

test('automation step count badge shows correct count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-036');
  await page.waitForSelector('.automation-step-count', { timeout: 5_000 });

  // Login Flow has 6 steps
  const firstCount = page.locator('.automation-step-count').first();
  await expect(firstCount).toContainText('6 steps');
});

/* ---------- Directory view ---------- */

test('automation directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-automations/Automations'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('automation directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-automations/Automations'; });
  await page.waitForSelector('.automation-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});
