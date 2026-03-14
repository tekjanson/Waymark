/**
 * Unit tests for public/js/templates/recipe/helpers.js
 *
 * Tests pure functions: parseQuantity, formatNumber, scaleQuantity,
 * scaleServings, parseQtyNumber, normaliseUnit, convertUnit, and constants.
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ================================================================
   Section 1: FRAC_MAP constant
   ================================================================ */

test('recipe FRAC_MAP has 15 Unicode fraction entries', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { FRAC_MAP } = await import('/js/templates/recipe/helpers.js');
    return { count: Object.keys(FRAC_MAP).length, half: FRAC_MAP['½'], quarter: FRAC_MAP['¼'] };
  });
  expect(result.count).toBe(15);
  expect(result.half).toBe(0.5);
  expect(result.quarter).toBe(0.25);
});

/* ================================================================
   Section 2: parseQuantity
   ================================================================ */

test('parseQuantity parses simple integer + unit', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQuantity } = await import('/js/templates/recipe/helpers.js');
    return parseQuantity('2 tbsp');
  });
  expect(result.number).toBe(2);
  expect(result.unit).toBe('tbsp');
});

test('parseQuantity parses number glued to unit', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQuantity } = await import('/js/templates/recipe/helpers.js');
    return parseQuantity('400g');
  });
  expect(result.number).toBe(400);
  expect(result.unit).toBe('g');
});

test('parseQuantity parses slash fractions', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQuantity } = await import('/js/templates/recipe/helpers.js');
    return parseQuantity('1/2 cup');
  });
  expect(result.number).toBeCloseTo(0.5, 3);
  expect(result.unit).toBe('cup');
});

test('parseQuantity parses mixed numbers with slash', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQuantity } = await import('/js/templates/recipe/helpers.js');
    return parseQuantity('1 1/2 cups');
  });
  expect(result.number).toBeCloseTo(1.5, 3);
  expect(result.unit).toBe('cups');
});

test('parseQuantity parses Unicode fractions', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQuantity } = await import('/js/templates/recipe/helpers.js');
    return parseQuantity('½ tsp');
  });
  expect(result.number).toBeCloseTo(0.5, 3);
  expect(result.unit).toBe('tsp');
});

test('parseQuantity parses mixed Unicode fraction', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQuantity } = await import('/js/templates/recipe/helpers.js');
    return parseQuantity('1½ tsp');
  });
  expect(result.number).toBeCloseTo(1.5, 3);
  expect(result.unit).toBe('tsp');
});

test('parseQuantity returns null number for non-numeric text', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQuantity } = await import('/js/templates/recipe/helpers.js');
    return parseQuantity('pinch of salt');
  });
  expect(result.number).toBeNull();
  expect(result.extra).toBe('pinch of salt');
});

test('parseQuantity returns null for empty input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseQuantity } = await import('/js/templates/recipe/helpers.js');
    return {
      empty: parseQuantity(''),
      nullVal: parseQuantity(null),
      undef: parseQuantity(undefined),
    };
  });
  expect(results.empty.number).toBeNull();
  expect(results.nullVal.number).toBeNull();
  expect(results.undef.number).toBeNull();
});

/* ================================================================
   Section 3: formatNumber
   ================================================================ */

test('formatNumber formats whole numbers', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatNumber } = await import('/js/templates/recipe/helpers.js');
    return {
      zero: formatNumber(0),
      one: formatNumber(1),
      ten: formatNumber(10),
    };
  });
  expect(results.zero).toBe('0');
  expect(results.one).toBe('1');
  expect(results.ten).toBe('10');
});

test('formatNumber converts common fractions to Unicode', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatNumber } = await import('/js/templates/recipe/helpers.js');
    return {
      half: formatNumber(0.5),
      quarter: formatNumber(0.25),
      threeQuarter: formatNumber(0.75),
      third: formatNumber(1/3),
      twoThirds: formatNumber(2/3),
    };
  });
  expect(results.half).toBe('½');
  expect(results.quarter).toBe('¼');
  expect(results.threeQuarter).toBe('¾');
  expect(results.third).toBe('⅓');
  expect(results.twoThirds).toBe('⅔');
});

test('formatNumber handles mixed numbers', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatNumber } = await import('/js/templates/recipe/helpers.js');
    return {
      oneAndHalf: formatNumber(1.5),
      twoAndQuarter: formatNumber(2.25),
      threeAndThird: formatNumber(3 + 1/3),
    };
  });
  expect(results.oneAndHalf).toBe('1 ½');
  expect(results.twoAndQuarter).toBe('2 ¼');
  expect(results.threeAndThird).toBe('3 ⅓');
});

test('formatNumber rounds odd decimals', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatNumber } = await import('/js/templates/recipe/helpers.js');
    return formatNumber(1.7);
  });
  expect(result).toBe('1.7');
});

/* ================================================================
   Section 4: scaleQuantity
   ================================================================ */

test('scaleQuantity doubles a quantity', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { scaleQuantity } = await import('/js/templates/recipe/helpers.js');
    return scaleQuantity('2 tbsp', 2);
  });
  expect(result).toBe('4 tbsp');
});

test('scaleQuantity halves a quantity', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { scaleQuantity } = await import('/js/templates/recipe/helpers.js');
    return scaleQuantity('2 cups', 0.5);
  });
  expect(result).toBe('1 cups');
});

test('scaleQuantity returns original at scale 1', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { scaleQuantity } = await import('/js/templates/recipe/helpers.js');
    return scaleQuantity('2 tbsp', 1);
  });
  expect(result).toBe('2 tbsp');
});

test('scaleQuantity preserves no-space formatting', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { scaleQuantity } = await import('/js/templates/recipe/helpers.js');
    return scaleQuantity('400g', 2);
  });
  expect(result).toBe('800g');
});

test('scaleQuantity returns original for non-numeric text', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { scaleQuantity } = await import('/js/templates/recipe/helpers.js');
    return scaleQuantity('a pinch', 3);
  });
  expect(result).toBe('a pinch');
});

/* ================================================================
   Section 5: scaleServings
   ================================================================ */

test('scaleServings scales numeric servings', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { scaleServings } = await import('/js/templates/recipe/helpers.js');
    return {
      doubled: scaleServings('4', 2),
      halved: scaleServings('4', 0.5),
      same: scaleServings('4', 1),
    };
  });
  expect(results.doubled).toBe('8');
  expect(results.halved).toBe('2');
  expect(results.same).toBe('4');
});

test('scaleServings returns original for non-numeric input', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { scaleServings } = await import('/js/templates/recipe/helpers.js');
    return scaleServings('a lot', 2);
  });
  expect(result).toBe('a lot');
});

/* ================================================================
   Section 6: parseQtyNumber
   ================================================================ */

test('parseQtyNumber parses decimals and integers', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseQtyNumber } = await import('/js/templates/recipe/helpers.js');
    return {
      integer: parseQtyNumber('5'),
      decimal: parseQtyNumber('3.5'),
    };
  });
  expect(results.integer).toBe(5);
  expect(results.decimal).toBe(3.5);
});

test('parseQtyNumber parses slash fractions', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQtyNumber } = await import('/js/templates/recipe/helpers.js');
    return parseQtyNumber('1/2');
  });
  expect(result).toBeCloseTo(0.5, 3);
});

test('parseQtyNumber parses mixed numbers', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQtyNumber } = await import('/js/templates/recipe/helpers.js');
    return parseQtyNumber('1 1/2');
  });
  expect(result).toBeCloseTo(1.5, 3);
});

test('parseQtyNumber parses Unicode fractions', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseQtyNumber } = await import('/js/templates/recipe/helpers.js');
    return {
      half: parseQtyNumber('½'),
      oneAndHalf: parseQtyNumber('1½'),
    };
  });
  expect(results.half).toBeCloseTo(0.5, 3);
  expect(results.oneAndHalf).toBeCloseTo(1.5, 3);
});

test('parseQtyNumber returns null for empty/invalid', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseQtyNumber } = await import('/js/templates/recipe/helpers.js');
    return {
      empty: parseQtyNumber(''),
      nullVal: parseQtyNumber(null),
      text: parseQtyNumber('some text'),
    };
  });
  expect(results.empty).toBeNull();
  expect(results.nullVal).toBeNull();
  expect(results.text).toBeNull();
});

/* ================================================================
   Section 7: UNIT_ALIASES, TO_ML, TO_G
   ================================================================ */

test('recipe UNIT_ALIASES maps common unit names', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { UNIT_ALIASES } = await import('/js/templates/recipe/helpers.js');
    return {
      teaspoon: UNIT_ALIASES['teaspoon'],
      tablespoons: UNIT_ALIASES['tablespoons'],
      cups: UNIT_ALIASES['cups'],
      ounces: UNIT_ALIASES['ounces'],
      pounds: UNIT_ALIASES['pounds'],
      grams: UNIT_ALIASES['grams'],
      kilograms: UNIT_ALIASES['kilograms'],
      ml: UNIT_ALIASES['ml'],
      milliliters: UNIT_ALIASES['milliliters'],
    };
  });
  expect(results.teaspoon).toBe('tsp');
  expect(results.tablespoons).toBe('tbsp');
  expect(results.cups).toBe('cup');
  expect(results.ounces).toBe('oz');
  expect(results.pounds).toBe('lb');
  expect(results.grams).toBe('g');
  expect(results.kilograms).toBe('kg');
  expect(results.ml).toBe('ml');
  expect(results.milliliters).toBe('ml');
});

test('recipe TO_ML has correct conversion factors', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { TO_ML } = await import('/js/templates/recipe/helpers.js');
    return { tsp: TO_ML['tsp'], tbsp: TO_ML['tbsp'], cup: TO_ML['cup'], ml: TO_ML['ml'] };
  });
  expect(result.ml).toBe(1);
  expect(result.tsp).toBeCloseTo(4.929, 2);
  expect(result.tbsp).toBeCloseTo(14.787, 2);
  expect(result.cup).toBeCloseTo(236.588, 2);
});

test('recipe TO_G has correct conversion factors', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { TO_G } = await import('/js/templates/recipe/helpers.js');
    return { g: TO_G['g'], kg: TO_G['kg'], oz: TO_G['oz'], lb: TO_G['lb'] };
  });
  expect(result.g).toBe(1);
  expect(result.kg).toBe(1000);
  expect(result.oz).toBeCloseTo(28.3495, 3);
  expect(result.lb).toBeCloseTo(453.592, 2);
});

/* ================================================================
   Section 8: normaliseUnit
   ================================================================ */

test('normaliseUnit maps known aliases to canonical keys', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { normaliseUnit } = await import('/js/templates/recipe/helpers.js');
    return {
      tsp: normaliseUnit('teaspoon'),
      tbsp: normaliseUnit('Tablespoons'),
      cup: normaliseUnit('CUPS'),
      oz: normaliseUnit('ounces'),
      lb: normaliseUnit('pounds'),
    };
  });
  expect(results.tsp).toBe('tsp');
  expect(results.tbsp).toBe('tbsp');
  expect(results.cup).toBe('cup');
  expect(results.oz).toBe('oz');
  expect(results.lb).toBe('lb');
});

test('normaliseUnit returns null for unknown units', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { normaliseUnit } = await import('/js/templates/recipe/helpers.js');
    return {
      empty: normaliseUnit(''),
      nullVal: normaliseUnit(null),
      unknown: normaliseUnit('cloves'),
      pinch: normaliseUnit('pinch'),
    };
  });
  expect(results.empty).toBeNull();
  expect(results.nullVal).toBeNull();
  expect(results.unknown).toBeNull();
  expect(results.pinch).toBeNull();
});

/* ================================================================
   Section 9: convertUnit
   ================================================================ */

test('convertUnit converts cups to ml (metric)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { convertUnit } = await import('/js/templates/recipe/helpers.js');
    return convertUnit(2, 'cup', 'metric');
  });
  expect(result).not.toBeNull();
  expect(result.unit).toBe('ml');
  expect(result.qty).toBeCloseTo(473.176, 0);
});

test('convertUnit converts grams to ounces (imperial)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { convertUnit } = await import('/js/templates/recipe/helpers.js');
    return convertUnit(100, 'g', 'imperial');
  });
  expect(result).not.toBeNull();
  expect(result.unit).toBe('oz');
  expect(result.qty).toBeCloseTo(3.527, 1);
});

test('convertUnit returns null for original system', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { convertUnit } = await import('/js/templates/recipe/helpers.js');
    return convertUnit(2, 'cups', 'original');
  });
  expect(result).toBeNull();
});

test('convertUnit returns null when already in target system', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { convertUnit } = await import('/js/templates/recipe/helpers.js');
    return convertUnit(100, 'ml', 'metric'); // ml is already metric
  });
  expect(result).toBeNull();
});

test('convertUnit returns null for unknown units', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { convertUnit } = await import('/js/templates/recipe/helpers.js');
    return convertUnit(2, 'cloves', 'metric');
  });
  expect(result).toBeNull();
});

test('convertUnit converts large volumes to appropriate units', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { convertUnit } = await import('/js/templates/recipe/helpers.js');
    // 5 liters to imperial — should pick a reasonable unit
    return convertUnit(5, 'l', 'imperial');
  });
  expect(result).not.toBeNull();
  expect(result.unit).toBe('gal');
  expect(result.qty).toBeCloseTo(1.32, 1);
});

test('convertUnit converts large weights to appropriate units', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { convertUnit } = await import('/js/templates/recipe/helpers.js');
    // 2 lb to metric — should be in g or kg
    return convertUnit(2, 'lb', 'metric');
  });
  expect(result).not.toBeNull();
  expect(result.unit).toBe('g');
  expect(result.qty).toBeCloseTo(907.184, 0);
});
