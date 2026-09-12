// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

const SHEET = 'sheet-072';

function meal(page, name) {
  return page.locator('.calorie-meal', {
    has: page.locator('.calorie-meal-name', { hasText: name }),
  });
}

test('calorie sheet detected as Calorie & Fitness Tracker', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-root', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Calorie');
});

test('day view shows calorie ring, mascot and macro rings', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-hero', { timeout: 5_000 });
  await expect(page.locator('.calorie-ring-svg')).toHaveCount(1);
  await expect(page.locator('.calorie-mascot')).toBeVisible();
  await expect(page.locator('.calorie-macroring')).toHaveCount(3);
});

test('calorie ring center shows remaining budget (goal - food + exercise)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-ring-num', { timeout: 5_000 });
  // 2026-09-12: food 1326, burned 320, target 2200 → remaining 1194
  await expect(page.locator('.calorie-ring-num')).toHaveText('1194');
});

test('dashboard groups items into the four meal categories', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-meal', { timeout: 5_000 });
  const names = await page.locator('.calorie-meal-name').allTextContents();
  for (const m of ['Breakfast', 'Lunch', 'Dinner', 'Snacks']) {
    expect(names.some(n => n.includes(m))).toBe(true);
  }
});

test('date navigation moves between days', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-datenav-label', { timeout: 5_000 });
  await expect(page.locator('.calorie-datenav-label')).toHaveText('Today');
  await page.locator('.calorie-datenav-btn[aria-label="Previous day"]').click();
  await expect(page.locator('.calorie-datenav-label')).toContainText('Sep 11');
  await page.locator('.calorie-datenav-btn[aria-label="Next day"]').click();
  await expect(page.locator('.calorie-datenav-label')).toHaveText('Today');
});

test('week timeframe shows trend chart and averages', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-root', { timeout: 5_000 });
  await page.locator('.calorie-seg-btn', { hasText: 'Week' }).click();
  await page.waitForSelector('.calorie-chart svg', { timeout: 5_000 });
  await expect(page.locator('.calorie-avg-num')).toBeVisible();
  await expect(page.locator('.calorie-chart svg')).toHaveCount(1);
});

test('logging a food via meal action sheet recalculates the meal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-hero', { timeout: 5_000 });

  const before = await meal(page, 'Breakfast').locator('.calorie-food-row').count();

  await meal(page, 'Breakfast').locator('.calorie-meal-add').click();
  await page.waitForSelector('.calorie-actionsheet', { timeout: 5_000 });
  await page.locator('.calorie-actionsheet-btn', { hasText: 'Search foods' }).click();
  await page.waitForSelector('.calorie-search-input', { timeout: 5_000 });
  await page.fill('.calorie-search-input', 'banana');
  await page.waitForSelector('.calorie-search-item', { timeout: 5_000 });
  await page.locator('.calorie-search-item').first().click();
  await page.waitForSelector('.calorie-modal-submit', { timeout: 5_000 });
  await page.locator('.calorie-modal-submit').click();

  await page.waitForSelector('.calorie-modal-overlay', { state: 'detached', timeout: 5_000 });
  await expect.poll(async () => meal(page, 'Breakfast').locator('.calorie-food-row').count())
    .toBeGreaterThan(before);

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'row-append')).toBe(true);
});

test('logging exercise refunds burned calories into the ring', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-ring-num', { timeout: 5_000 });
  const before = parseInt(await page.locator('.calorie-ring-num').textContent() || '0', 10);

  await page.locator('.calorie-quick', { hasText: 'Exercise' }).click();
  await page.waitForSelector('.calorie-modal-overlay', { timeout: 5_000 });
  await page.fill('.calorie-manual-name', 'Cycling');
  await page.fill('.calorie-manual-cal', '250');
  await page.locator('.calorie-modal-submit').click();

  await page.waitForSelector('.calorie-modal-overlay', { state: 'detached', timeout: 5_000 });
  await expect.poll(async () => parseInt(await page.locator('.calorie-ring-num').textContent() || '0', 10))
    .toBe(before + 250);
});

test('voice mock pipeline logs itemized food and exercise rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-root', { timeout: 5_000 });

  await page.evaluate(() => {
    window.__WAYMARK_VOICE_MOCK = { items: [
      { type: 'food', name: 'Test Bagel', meal: 'Breakfast', serving_qty: 1, serving_unit: 'bagel', calories: 250, protein: 10, carbs: 48, fat: 1.5 },
      { type: 'exercise', name: 'Jumping jacks', duration_min: 10, calories_burned: 90 },
    ] };
  });

  await page.locator('.calorie-tool-btn[aria-label="Voice log"]').click();
  await page.waitForSelector('.calorie-ai-item', { timeout: 5_000 });
  await expect(page.locator('.calorie-ai-item')).toHaveCount(2);
  await page.locator('.calorie-ai-modal .calorie-modal-submit').click();
  await page.waitForSelector('.calorie-modal-overlay', { state: 'detached', timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBeGreaterThanOrEqual(2);
  const flat = JSON.stringify(appends);
  expect(flat).toContain('Test Bagel');
  expect(flat).toContain('Jumping jacks');
});

test('AI photo mock flow appends itemized rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-hero', { timeout: 5_000 });

  await page.evaluate(() => {
    window.__WAYMARK_VISION_MOCK = { items: [
      { name: 'Grilled steak', serving_qty: 200, serving_unit: 'g', calories: 460, protein: 52, carbs: 0, fat: 28 },
      { name: 'Mashed potatoes', serving_qty: 1, serving_unit: 'cup', calories: 210, protein: 4, carbs: 35, fat: 6 },
    ] };
  });

  await page.locator('.calorie-quick', { hasText: 'Photo' }).click();
  await page.waitForSelector('.calorie-ai-file', { timeout: 5_000 });
  await page.setInputFiles('.calorie-ai-file', {
    name: 'meal.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });

  await page.waitForSelector('.calorie-ai-item', { timeout: 5_000 });
  await expect(page.locator('.calorie-ai-item')).toHaveCount(2);
  await page.locator('.calorie-ai-modal .calorie-modal-submit').click();
  await page.waitForSelector('.calorie-modal-overlay', { state: 'detached', timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBeGreaterThanOrEqual(2);
});

test('profile modal computes a recommended calorie goal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-root', { timeout: 5_000 });

  await page.locator('.calorie-tool-btn[aria-label="Profile & goal"]').click();
  await page.waitForSelector('.calorie-p-input', { timeout: 5_000 });
  await page.fill('.calorie-serving-row:has(label:text-is("Age")) input', '30');
  await page.fill('.calorie-serving-row:has(label:text-is("Height")) input', '180');
  await page.fill('.calorie-serving-row:has(label:text-is("Weight")) input', '80');

  await page.waitForSelector('.calorie-p-preview-num', { timeout: 5_000 });
  const goal = parseInt(await page.locator('.calorie-p-preview-num').textContent() || '0', 10);
  expect(goal).toBeGreaterThan(1500);

  await page.locator('.calorie-modal-submit', { hasText: 'Save' }).click();
  await page.waitForSelector('.calorie-modal-overlay', { state: 'detached', timeout: 5_000 });
});
