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

/* ---------- Directory view ---------- */

test('guide directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-guides/Instruction%20Guides'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('guide directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-guides/Instruction%20Guides'; });
  await page.waitForSelector('.guide-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});

/* ---------- Many-slides scroll behaviour ---------- */

test('guide rail has overflow-y set so it scrolls independently with many slides', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.guide-thumb', { timeout: 5_000 });
  const overflowY = await page.locator('.guide-rail').evaluate(el => getComputedStyle(el).overflowY);
  expect(['auto', 'scroll']).toContain(overflowY);
});

test('guide rail has a capped height on the many-slides fixture', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.guide-thumb', { timeout: 5_000 });
  const railBox = await page.locator('.guide-rail').boundingBox();
  const cardBodyBox = await page.locator('.guide-card-body').first().boundingBox();
  // Rail must not overflow the viewport vertically
  expect(railBox.height).toBeLessThan(page.viewportSize().height);
  // Stage (second grid child) must start near the top of the card body, not be pushed far down
  expect(railBox.y).toBeCloseTo(cardBodyBox.y, -2);
});

test('guide many-slides fixture renders 12 thumbnails in the rail', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.guide-thumb', { timeout: 5_000 });
  const thumbCount = await page.locator('.guide-card').first().locator('.guide-thumb').count();
  expect(thumbCount).toBe(12);
});

test('guide many-slides rail does not cause page overflow', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.guide-card', { timeout: 5_000 });
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = page.viewportSize().width;
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 2);
});