/**
 * Unit tests for public/js/templates/garden.js pure helper functions.
 *
 * Tests plantIcon, parseGardenDate, fmtPlantDate, waterUrgencyClass,
 * and harvestDays by dynamically importing the module inside the browser.
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ================================================================
   Section 1: plantIcon
   ================================================================ */

test('plantIcon returns vegetable emoji for tomato/cucumber/carrot', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { plantIcon } = await import('/js/templates/garden.js');
    return { tomato: plantIcon('Tomato'), cucumber: plantIcon('Cucumber'), carrot: plantIcon('Carrot') };
  });
  // All three are vegetables → 🥦
  expect(results.tomato).toBe('🥦');
  expect(results.cucumber).toBe('🥦');
  expect(results.carrot).toBe('🥦');
});

test('plantIcon returns herb emoji for basil/mint/thyme', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { plantIcon } = await import('/js/templates/garden.js');
    return { basil: plantIcon('Basil'), mint: plantIcon('Mint'), thyme: plantIcon('Thyme') };
  });
  expect(results.basil).toBe('🌿');
  expect(results.mint).toBe('🌿');
  expect(results.thyme).toBe('🌿');
});

test('plantIcon returns flower emoji for rose/sunflower', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { plantIcon } = await import('/js/templates/garden.js');
    return { rose: plantIcon('Rose'), sunflower: plantIcon('Sunflower') };
  });
  expect(results.rose).toBe('🌸');
  expect(results.sunflower).toBe('🌸');
});

test('plantIcon returns strawberry emoji for strawberry/berry', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { plantIcon } = await import('/js/templates/garden.js');
    return { strawberry: plantIcon('Strawberry'), blueberry: plantIcon('Blueberry') };
  });
  expect(results.strawberry).toBe('🍓');
  expect(results.blueberry).toBe('🍓');
});

test('plantIcon returns generic seedling for unknown plants', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { plantIcon } = await import('/js/templates/garden.js');
    return plantIcon('Some Unknown Exotic Plant');
  });
  expect(result).toBe('🌱');
});

test('plantIcon handles empty and null input gracefully', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { plantIcon } = await import('/js/templates/garden.js');
    return { empty: plantIcon(''), nullVal: plantIcon(null), undef: plantIcon(undefined) };
  });
  expect(results.empty).toBe('🌱');
  expect(results.nullVal).toBe('🌱');
  expect(results.undef).toBe('🌱');
});

/* ================================================================
   Section 2: parseGardenDate
   ================================================================ */

test('parseGardenDate parses valid YYYY-MM-DD strings', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseGardenDate } = await import('/js/templates/garden.js');
    const d = parseGardenDate('2026-06-15');
    return d ? d.toISOString().slice(0, 10) : null;
  });
  expect(result).toBe('2026-06-15');
});

test('parseGardenDate returns null for empty/invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseGardenDate } = await import('/js/templates/garden.js');
    return {
      empty: parseGardenDate(''),
      nullVal: parseGardenDate(null),
      invalid: parseGardenDate('not a date'),
    };
  });
  expect(results.empty).toBeNull();
  expect(results.nullVal).toBeNull();
  expect(results.invalid).toBeNull();
});

/* ================================================================
   Section 3: fmtPlantDate
   ================================================================ */

test('fmtPlantDate formats YYYY-MM-DD to readable short form', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { fmtPlantDate } = await import('/js/templates/garden.js');
    return fmtPlantDate('2026-06-15');
  });
  expect(result).toMatch(/Jun\s+15/);
});

test('fmtPlantDate returns raw string for invalid input', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { fmtPlantDate } = await import('/js/templates/garden.js');
    return fmtPlantDate('not-a-date');
  });
  expect(result).toBe('not-a-date');
});

/* ================================================================
   Section 4: waterUrgencyClass
   ================================================================ */

test('waterUrgencyClass returns empty string when no last-watered date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { waterUrgencyClass } = await import('/js/templates/garden.js');
    return waterUrgencyClass('', 'Every 3 days');
  });
  expect(result).toBe('');
});

test('waterUrgencyClass returns overdue for very old last-watered date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { waterUrgencyClass } = await import('/js/templates/garden.js');
    // 2020-01-01 is many years ago with daily frequency — definitely overdue
    return waterUrgencyClass('2020-01-01', 'daily');
  });
  expect(result).toBe('garden-water-overdue');
});

test('waterUrgencyClass returns ok for recently watered plant', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { waterUrgencyClass } = await import('/js/templates/garden.js');
    // Compute a date string for today to guarantee "just watered"
    const today = new Date();
    const str = today.toISOString().slice(0, 10);
    return waterUrgencyClass(str, 'weekly');
  });
  expect(result).toBe('garden-water-ok');
});

test('waterUrgencyClass handles numeric frequency strings', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { waterUrgencyClass } = await import('/js/templates/garden.js');
    return waterUrgencyClass('2020-01-01', '3');
  });
  expect(result).toBe('garden-water-overdue');
});

/* ================================================================
   Section 5: harvestDays
   ================================================================ */

test('harvestDays returns null for empty input', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { harvestDays } = await import('/js/templates/garden.js');
    return harvestDays('');
  });
  expect(result).toBeNull();
});

test('harvestDays returns negative number for past harvest date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { harvestDays } = await import('/js/templates/garden.js');
    return harvestDays('2020-01-01');
  });
  expect(result).toBeLessThan(0);
});

test('harvestDays returns positive number for future harvest date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { harvestDays } = await import('/js/templates/garden.js');
    return harvestDays('2099-12-31');
  });
  expect(result).toBeGreaterThan(0);
});
