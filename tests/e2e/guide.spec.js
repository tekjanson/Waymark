// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('guide fixture is detected as Instruction Guide', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-049');
  await page.waitForSelector('.guide-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Instruction Guide');
});

test('guide renders multiple deck cards with slide thumbnails', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-049');
  await page.waitForSelector('.guide-thumb', { timeout: 5_000 });
  await expect(page.locator('.guide-card')).toHaveCount(2);
  await expect(page.locator('.guide-card').first().locator('.guide-thumb')).toHaveCount(3);
});

test('guide next button advances the active slide', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-049');
  const firstCard = page.locator('.guide-card').first();
  await firstCard.locator('.guide-nav-next').click();
  await expect(firstCard.locator('.guide-counter')).toContainText('2 / 3');
  await expect(firstCard.locator('.guide-slide-title')).toContainText('Know what goes in');
});

test('guide thumbnail click changes the visible stage content', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-049');
  const firstCard = page.locator('.guide-card').first();
  await firstCard.locator('.guide-thumb').nth(2).click();
  await expect(firstCard.locator('.guide-slide-title')).toContainText('Avoid contamination');
  await expect(firstCard.locator('.guide-counter')).toContainText('3 / 3');
});

test('guide status button cycles and emits an edit record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-049');
  const secondCard = page.locator('.guide-card').nth(1);
  const status = secondCard.locator('.guide-status');
  await expect(status).toContainText('In Progress');
  await status.click();
  await expect(status).toContainText('Ready');
  const records = await getCreatedRecords(page);
  expect(records.length).toBeGreaterThan(0);
  expect(records.some(r => r.value === 'Ready')).toBe(true);
});

test('guide stage exposes objective, visual cue, and duration chips', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-049');
  const firstCard = page.locator('.guide-card').first();
  await expect(firstCard.locator('.guide-objective')).toBeVisible();
  await expect(firstCard.locator('.guide-visual-cue')).toBeVisible();
  await expect(firstCard.locator('.guide-duration')).toContainText('2 min');
});

test('guide uses deck layout and clickable controls', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-049');
  await expect(page.locator('.guide-card-body').first()).toHaveCSS('display', /grid|flex/);
  await expect(page.locator('.guide-thumb').first()).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('.guide-status').first()).toHaveCSS('cursor', 'pointer');
});

test('guide remains within viewport on mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-049');
  await page.waitForSelector('.guide-card', { timeout: 5_000 });
  const overflows = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('.guide-card *').forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.right > window.innerWidth + 2) issues.push(node.className || node.tagName);
    });
    return issues;
  });
  expect(overflows).toHaveLength(0);
});