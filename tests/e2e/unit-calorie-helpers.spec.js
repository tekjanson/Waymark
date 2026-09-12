/* ============================================================
   unit-calorie-helpers.spec.js — Unit tests for calorie/helpers.js
   Tests: macro scaling, day totals, net-calorie refund, fuzzy search
   ============================================================ */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* Column map matching the calorie template layout. */
const COLS = {
  date: 0, meal: 1, item: 2, qty: 3, unit: 4,
  calories: 5, protein: 6, carbs: 7, fat: 8, burned: 9, target: 10,
};

test('parseNum extracts numbers from unit strings', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    return [h.parseNum('12g'), h.parseNum('1.5 cups'), h.parseNum(''), h.parseNum('350')];
  });
  expect(r).toEqual([12, 1.5, 0, 350]);
});

test('scaleMacros scales from reference serving', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    // 100g chicken = 165 kcal, 31 p → 150g should be 1.5x
    return h.scaleMacros({ qty: 100, kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, 150);
  });
  expect(r.calories).toBe(248);
  expect(r.protein).toBe(46.5);
  expect(r.fat).toBe(5.4);
});

test('computeDayTotals sums food and exercise separately', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async (cols) => {
    const h = await import('/js/templates/calorie/helpers.js');
    const rows = [
      ['2026-09-12', 'Breakfast', 'Oatmeal', '150', 'g', '107', '3.8', '18', '2.3', '', '2200'],
      ['2026-09-12', 'Lunch', 'Chicken', '150', 'g', '248', '46.5', '0', '5.4', '', ''],
      ['2026-09-12', 'Exercise', 'Running', '30', 'min', '', '', '', '', '320', ''],
    ];
    return h.computeDayTotals(rows, cols);
  }, COLS);
  expect(r.food).toBe(355);
  expect(r.burned).toBe(320);
  expect(r.byMeal.Breakfast.calories).toBe(107);
  expect(r.byMeal.Lunch.calories).toBe(248);
});

test('computeNet refunds burned calories into remaining budget', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    // Target 2000, ate 1500, burned 300 → remaining = 2000 - 1500 + 300 = 800
    return h.computeNet(2000, 1500, 300);
  });
  expect(r.remaining).toBe(800);
  expect(r.net).toBe(1200);
});

test('resolveTarget reads target from date group, falls back to default', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async (cols) => {
    const h = await import('/js/templates/calorie/helpers.js');
    const withTarget = [['2026-09-12', 'Breakfast', 'X', '', '', '100', '', '', '', '', '1800']];
    const without = [['2026-09-12', 'Breakfast', 'X', '', '', '100', '', '', '', '', '']];
    return [h.resolveTarget(withTarget, cols), h.resolveTarget(without, cols)];
  }, COLS);
  expect(r[0]).toBe(1800);
  expect(r[1]).toBe(2000);
});

test('canonicalMeal maps arbitrary labels to buckets', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    return [h.canonicalMeal('breakfast'), h.canonicalMeal('Supper'), h.canonicalMeal('midday'), h.canonicalMeal('random')];
  });
  expect(r).toEqual(['Breakfast', 'Dinner', 'Lunch', 'Snacks']);
});

test('searchFoodDatabase ranks prefix over partial and stays under 25ms', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    const foods = [
      { name: 'Chicken breast, grilled', kcal: 165, qty: 100, unit: 'g' },
      { name: 'Fried chicken', kcal: 320, qty: 100, unit: 'g' },
      { name: 'Banana', kcal: 105, qty: 1, unit: 'medium' },
    ];
    const t0 = performance.now();
    const res = h.searchFoodDatabase('chicken', foods);
    const elapsed = performance.now() - t0;
    return { names: res.map(f => f.name), elapsed };
  });
  expect(r.names.length).toBe(2);
  expect(r.names).toContain('Chicken breast, grilled');
  expect(r.elapsed).toBeLessThan(25);
});

test('normalizeOffProduct converts Open Food Facts payload', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    return h.normalizeOffProduct({
      product_name: 'Test Cereal',
      brands: 'TestBrand',
      nutriments: { 'energy-kcal_100g': 380, proteins_100g: 8, carbohydrates_100g: 75, fat_100g: 5 },
    }, '123456');
  });
  expect(r.name).toBe('Test Cereal');
  expect(r.kcal).toBe(380);
  expect(r.protein).toBe(8);
  expect(r.barcode).toBe('123456');
});

test('loadFoodDatabase fetches the seeded reference dataset', async ({ page }) => {
  await setupApp(page);
  const count = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    const foods = await h.loadFoodDatabase();
    return foods.length;
  });
  expect(count).toBeGreaterThan(5000);
});

test('searchFoodDatabase stays fast over the full USDA dataset', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    const foods = await h.loadFoodDatabase();
    // Warm-up, then measure.
    h.searchFoodDatabase('chicken', foods);
    const t0 = performance.now();
    const res = h.searchFoodDatabase('chicken breast', foods);
    const elapsed = performance.now() - t0;
    return { count: res.length, elapsed, total: foods.length };
  });
  expect(r.total).toBeGreaterThan(5000);
  expect(r.count).toBeGreaterThan(0);
  expect(r.elapsed).toBeLessThan(25);
});

test('caloriesFromMet uses MET × weight × hours', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    // 9.8 MET running, 70 kg, 30 min → 9.8 * 70 * 0.5 = 343
    return [h.caloriesFromMet(9.8, 70, 30), h.caloriesFromMet(3.5, 80, 60)];
  });
  expect(r[0]).toBe(343);
  expect(r[1]).toBe(280);
});

test('loadExerciseDatabase fetches the compendium dataset', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    const acts = await h.loadExerciseDatabase();
    return { count: acts.length, sample: acts[0] };
  });
  expect(r.count).toBeGreaterThan(500);
  expect(r.sample).toHaveProperty('met');
});

test('searchExerciseDatabase finds activities by keyword', async ({ page }) => {
  await setupApp(page);
  const r = await page.evaluate(async () => {
    const h = await import('/js/templates/calorie/helpers.js');
    const acts = await h.loadExerciseDatabase();
    const t0 = performance.now();
    const res = h.searchExerciseDatabase('running', acts, 10);
    const elapsed = performance.now() - t0;
    return { names: res.map(a => a.name.toLowerCase()), elapsed };
  });
  expect(r.names.length).toBeGreaterThan(0);
  expect(r.names.some(n => n.includes('run'))).toBe(true);
  expect(r.elapsed).toBeLessThan(25);
});
