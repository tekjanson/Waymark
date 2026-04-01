// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('marketing detected as Content Workbench template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Content Workbench');
});

test('marketing renders scoreboard with post count and engagements', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-scoreboard', { timeout: 5_000 });

  await expect(page.locator('.marketing-scoreboard')).toBeVisible();
  const items = page.locator('.marketing-score-item');
  expect(await items.count()).toBe(5);
});

test('marketing renders what\'s working section for top posts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-whats-working', { timeout: 5_000 });

  await expect(page.locator('.marketing-whats-working')).toBeVisible();
  const topPosts = page.locator('.marketing-top-post');
  expect(await topPosts.count()).toBeGreaterThanOrEqual(2);
});

test('marketing renders platform breakdown cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-platforms', { timeout: 5_000 });

  await expect(page.locator('.marketing-platforms')).toBeVisible();
  const platCards = page.locator('.marketing-plat-card');
  expect(await platCards.count()).toBeGreaterThanOrEqual(2);
});

test('marketing renders post cards for all rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card', { timeout: 5_000 });

  const cards = page.locator('.marketing-card');
  expect(await cards.count()).toBe(11);
});

test('marketing status badge cycles on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-stage-btn', { timeout: 5_000 });

  const firstBtn = page.locator('.marketing-stage-btn').first();
  const initialText = await firstBtn.textContent();
  await firstBtn.click();

  const newText = await firstBtn.textContent();
  expect(newText).not.toBe(initialText);

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
});

test('marketing card shows platform badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card-platform', { timeout: 5_000 });

  const badges = page.locator('.marketing-card-platform');
  expect(await badges.count()).toBeGreaterThan(0);
});

test('marketing card shows engagement stats for posted content', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card-eng', { timeout: 5_000 });

  await expect(page.locator('.marketing-card-eng').first()).toBeVisible();
  const stats = page.locator('.marketing-eng-stat');
  expect(await stats.count()).toBeGreaterThan(0);
});

test('marketing card shows status-specific border colors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card', { timeout: 5_000 });

  await expect(page.locator('.marketing-card-posted').first()).toBeVisible();
  await expect(page.locator('.marketing-card-idea').first()).toBeVisible();
  await expect(page.locator('.marketing-card-drafting').first()).toBeVisible();
});

test('marketing post body is editable via inline edit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card-body', { timeout: 5_000 });

  const bodyEl = page.locator('.marketing-card-body').first();
  await bodyEl.click();

  const input = page.locator('.marketing-card-body input.editable-cell-input');
  await expect(input).toBeVisible({ timeout: 3_000 });
  await input.fill('Updated post content');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'Updated post content')).toBe(true);
});
