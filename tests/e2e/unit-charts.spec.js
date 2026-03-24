// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ================================================================
   unit-charts.spec.js — Unit tests for charts.js pure helpers
   
   Tests: normalizeValues, polarToCartesian, computePieAngles,
          formatAxisLabel
   All tests run in the browser via page.evaluate + dynamic import.
   ================================================================ */

/* ---------- normalizeValues ---------- */

test('normalizeValues returns correct min/max/normalized for positive array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normalizeValues } = await import('/js/templates/charts.js');
    return normalizeValues([0, 50, 100]);
  });
  expect(result.min).toBe(0);
  expect(result.max).toBe(100);
  expect(result.normalized).toHaveLength(3);
  expect(result.normalized[0]).toBeCloseTo(0);
  expect(result.normalized[1]).toBeCloseTo(0.5);
  expect(result.normalized[2]).toBeCloseTo(1);
});

test('normalizeValues clamps min to 0 when all values are non-negative', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normalizeValues } = await import('/js/templates/charts.js');
    return normalizeValues([10, 20, 30]);
  });
  expect(result.min).toBe(0);
  expect(result.max).toBe(30);
});

test('normalizeValues handles negative values correctly', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normalizeValues } = await import('/js/templates/charts.js');
    return normalizeValues([-10, 0, 10]);
  });
  expect(result.min).toBe(-10);
  expect(result.max).toBe(10);
  expect(result.normalized[0]).toBeCloseTo(0);
  expect(result.normalized[1]).toBeCloseTo(0.5);
  expect(result.normalized[2]).toBeCloseTo(1);
});

test('normalizeValues handles empty array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normalizeValues } = await import('/js/templates/charts.js');
    return normalizeValues([]);
  });
  expect(result.min).toBe(0);
  expect(result.max).toBe(0);
  expect(result.normalized).toHaveLength(0);
});

test('normalizeValues handles single-value array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normalizeValues } = await import('/js/templates/charts.js');
    return normalizeValues([42]);
  });
  expect(result.min).toBe(0);
  expect(result.max).toBe(42);
  expect(result.normalized[0]).toBeCloseTo(1);
});

test('normalizeValues handles all-zero array without crashing', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normalizeValues } = await import('/js/templates/charts.js');
    return normalizeValues([0, 0, 0]);
  });
  expect(result.min).toBe(0);
  expect(result.max).toBe(0);
  expect(result.normalized.every(v => v === 0)).toBe(true);
});

/* ---------- polarToCartesian ---------- */

test('polarToCartesian: 0 degrees points to top (north)', async ({ page }) => {
  await setupApp(page);
  const pt = await page.evaluate(async () => {
    const { polarToCartesian } = await import('/js/templates/charts.js');
    return polarToCartesian(100, 100, 50, 0);
  });
  expect(pt.x).toBeCloseTo(100, 1);
  expect(pt.y).toBeCloseTo(50, 1);
});

test('polarToCartesian: 90 degrees points to right (east)', async ({ page }) => {
  await setupApp(page);
  const pt = await page.evaluate(async () => {
    const { polarToCartesian } = await import('/js/templates/charts.js');
    return polarToCartesian(100, 100, 50, 90);
  });
  expect(pt.x).toBeCloseTo(150, 1);
  expect(pt.y).toBeCloseTo(100, 1);
});

test('polarToCartesian: 180 degrees points to bottom (south)', async ({ page }) => {
  await setupApp(page);
  const pt = await page.evaluate(async () => {
    const { polarToCartesian } = await import('/js/templates/charts.js');
    return polarToCartesian(100, 100, 50, 180);
  });
  expect(pt.x).toBeCloseTo(100, 1);
  expect(pt.y).toBeCloseTo(150, 1);
});

test('polarToCartesian: 270 degrees points to left (west)', async ({ page }) => {
  await setupApp(page);
  const pt = await page.evaluate(async () => {
    const { polarToCartesian } = await import('/js/templates/charts.js');
    return polarToCartesian(100, 100, 50, 270);
  });
  expect(pt.x).toBeCloseTo(50, 1);
  expect(pt.y).toBeCloseTo(100, 1);
});

test('polarToCartesian: distance from centre always equals radius', async ({ page }) => {
  await setupApp(page);
  const distances = await page.evaluate(async () => {
    const { polarToCartesian } = await import('/js/templates/charts.js');
    const cx = 200, cy = 150, r = 80;
    return [0, 45, 90, 135, 180, 225, 270, 315].map(angle => {
      const pt = polarToCartesian(cx, cy, r, angle);
      return Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
    });
  });
  distances.forEach(d => expect(d).toBeCloseTo(80, 1));
});

/* ---------- computePieAngles ---------- */

test('computePieAngles: two equal segments each get 180 degrees', async ({ page }) => {
  await setupApp(page);
  const angles = await page.evaluate(async () => {
    const { computePieAngles } = await import('/js/templates/charts.js');
    return computePieAngles([{ value: 1 }, { value: 1 }]);
  });
  expect(angles).toHaveLength(2);
  expect(angles[0].startAngle).toBeCloseTo(0);
  expect(angles[0].endAngle).toBeCloseTo(180);
  expect(angles[1].startAngle).toBeCloseTo(180);
  expect(angles[1].endAngle).toBeCloseTo(360);
  expect(angles[0].fraction).toBeCloseTo(0.5);
});

test('computePieAngles: end angle of last segment is always 360', async ({ page }) => {
  await setupApp(page);
  const angles = await page.evaluate(async () => {
    const { computePieAngles } = await import('/js/templates/charts.js');
    return computePieAngles([{ value: 3 }, { value: 1 }, { value: 6 }]);
  });
  expect(angles[2].endAngle).toBeCloseTo(360);
});

test('computePieAngles: fractions sum to 1', async ({ page }) => {
  await setupApp(page);
  const angles = await page.evaluate(async () => {
    const { computePieAngles } = await import('/js/templates/charts.js');
    return computePieAngles([{ value: 25 }, { value: 25 }, { value: 50 }]);
  });
  const total = angles.reduce((s, a) => s + a.fraction, 0);
  expect(total).toBeCloseTo(1);
});

test('computePieAngles: empty array returns empty array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computePieAngles } = await import('/js/templates/charts.js');
    return computePieAngles([]);
  });
  expect(result).toHaveLength(0);
});

test('computePieAngles: all-zero values produce zero fractions', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computePieAngles } = await import('/js/templates/charts.js');
    return computePieAngles([{ value: 0 }, { value: 0 }]);
  });
  result.forEach(a => expect(a.fraction).toBe(0));
});

/* ---------- formatAxisLabel ---------- */

test('formatAxisLabel: integers rendered exactly', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatAxisLabel } = await import('/js/templates/charts.js');
    return { zero: formatAxisLabel(0), hundred: formatAxisLabel(100), neg: formatAxisLabel(-5) };
  });
  expect(results.zero).toBe('0');
  expect(results.hundred).toBe('100');
  expect(results.neg).toBe('-5');
});

test('formatAxisLabel: thousands use k suffix', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatAxisLabel } = await import('/js/templates/charts.js');
    return { k1: formatAxisLabel(1000), k1500: formatAxisLabel(1500), k10: formatAxisLabel(10000) };
  });
  expect(results.k1).toBe('1k');
  expect(results.k1500).toBe('1.5k');
  expect(results.k10).toBe('10k');
});

test('formatAxisLabel: millions use M suffix', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatAxisLabel } = await import('/js/templates/charts.js');
    return formatAxisLabel(1_500_000);
  });
  expect(result).toBe('1.5M');
});

test('formatAxisLabel: non-integer decimals trimmed to 3 significant figures', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatAxisLabel } = await import('/js/templates/charts.js');
    return formatAxisLabel(3.14159);
  });
  expect(result).toBe('3.14');
});

test('formatAxisLabel: non-finite inputs return "0"', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatAxisLabel } = await import('/js/templates/charts.js');
    return { inf: formatAxisLabel(Infinity), nan: formatAxisLabel(NaN) };
  });
  expect(results.inf).toBe('0');
  expect(results.nan).toBe('0');
});
