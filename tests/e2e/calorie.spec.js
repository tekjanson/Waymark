// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

const SHEET = 'sheet-072';

function breakfast(page) {
  return page.locator('.calorie-meal', {
    has: page.locator('.calorie-meal-name', { hasText: 'Breakfast' }),
  });
}

test('calorie sheet detected as Calorie & Fitness Tracker', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-banner', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Calorie');
});

test('net-calorie banner shows the Goal - Food + Exercise = Remaining equation', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-banner', { timeout: 5_000 });

  // 2026-09-12: food = 1326, burned = 320, target = 2200 → remaining = 1194
  const labels = await page.locator('.calorie-eq-lbl').allTextContents();
  expect(labels).toEqual(expect.arrayContaining(['Goal', 'Food', 'Exercise', 'Remaining']));

  await expect(page.locator('.calorie-eq-remaining .calorie-eq-num')).toHaveText('1194');
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

test('logging a food via search recalculates the meal summary', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-banner', { timeout: 5_000 });

  const before = await breakfast(page).locator('.calorie-food-row').count();

  await breakfast(page).locator('.calorie-action-search').click();
  await page.waitForSelector('.calorie-search-input', { timeout: 5_000 });
  await page.fill('.calorie-search-input', 'banana');
  await page.waitForSelector('.calorie-search-item', { timeout: 5_000 });
  await page.locator('.calorie-search-item').first().click();
  await page.waitForSelector('.calorie-modal-submit', { timeout: 5_000 });
  await page.locator('.calorie-modal-submit').click();

  // Modal closes, dashboard re-renders with the new Breakfast row.
  await page.waitForSelector('.calorie-modal-overlay', { state: 'detached', timeout: 5_000 });
  await expect.poll(async () => breakfast(page).locator('.calorie-food-row').count())
    .toBeGreaterThan(before);

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'row-append')).toBe(true);
});

test('logging an exercise refunds burned calories into the remaining budget', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-banner', { timeout: 5_000 });

  const remainingBefore = parseInt(
    await page.locator('.calorie-eq-remaining .calorie-eq-num').textContent() || '0', 10);

  await page.locator('.calorie-action-exercise').click();
  await page.waitForSelector('.calorie-modal-overlay', { timeout: 5_000 });
  await page.fill('.calorie-manual-name', 'Cycling');
  await page.fill('.calorie-manual-cal', '250');
  await page.locator('.calorie-modal-submit').click();

  await page.waitForSelector('.calorie-modal-overlay', { state: 'detached', timeout: 5_000 });
  await expect.poll(async () => parseInt(
    await page.locator('.calorie-eq-remaining .calorie-eq-num').textContent() || '0', 10))
    .toBe(remainingBefore + 250);
});

test('exercise search auto-computes burned calories from MET', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-banner', { timeout: 5_000 });

  await page.locator('.calorie-action-exercise').click();
  await page.waitForSelector('.calorie-search-input', { timeout: 5_000 });
  await page.fill('.calorie-search-input', 'running');
  await page.waitForSelector('.calorie-search-item', { timeout: 5_000 });
  await page.locator('.calorie-search-item').first().click();

  // Duration drives the MET calorie estimate; burned should auto-populate.
  await page.fill('.calorie-serving-row:has(label:text-is("Duration (min)")) input', '30');
  await expect.poll(async () =>
    parseInt(await page.locator('.calorie-manual-cal').inputValue() || '0', 10))
    .toBeGreaterThan(0);
});

test('AI photo mock flow appends itemized rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.calorie-banner', { timeout: 5_000 });

  // Inject a deterministic vision result (no camera / API key needed).
  await page.evaluate(() => {
    window.__WAYMARK_VISION_MOCK = {
      items: [
        { name: 'Grilled steak', serving_qty: 200, serving_unit: 'g', calories: 460, protein: 52, carbs: 0, fat: 28 },
        { name: 'Mashed potatoes', serving_qty: 1, serving_unit: 'cup', calories: 210, protein: 4, carbs: 35, fat: 6 },
      ],
    };
  });

  await breakfast(page).locator('.calorie-action-ai').click();
  await page.waitForSelector('.calorie-ai-file', { timeout: 5_000 });

  await page.setInputFiles('.calorie-ai-file', {
    name: 'meal.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });

  // Breakdown modal shows the two mocked items.
  await page.waitForSelector('.calorie-ai-item', { timeout: 5_000 });
  await expect(page.locator('.calorie-ai-item')).toHaveCount(2);

  await page.locator('.calorie-ai-modal .calorie-modal-submit').click();
  await page.waitForSelector('.calorie-modal-overlay', { state: 'detached', timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBeGreaterThanOrEqual(2);
  const flat = JSON.stringify(appends);
  expect(flat).toContain('Grilled steak');
  expect(flat).toContain('Mashed potatoes');
});
