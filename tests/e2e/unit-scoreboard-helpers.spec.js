/**
 * Unit tests for public/js/templates/scoreboard.js pure helper functions.
 *
 * Tests medalIcon, rankSuffix, parseScore, and formatScore by dynamically
 * importing the module inside the browser context.
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ================================================================
   Section 1: medalIcon
   ================================================================ */

test('medalIcon returns 🥇 for rank 1', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { medalIcon } = await import('/js/templates/scoreboard.js');
    return medalIcon(1);
  });
  expect(result).toBe('🥇');
});

test('medalIcon returns 🥈 for rank 2', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { medalIcon } = await import('/js/templates/scoreboard.js');
    return medalIcon(2);
  });
  expect(result).toBe('🥈');
});

test('medalIcon returns 🥉 for rank 3', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { medalIcon } = await import('/js/templates/scoreboard.js');
    return medalIcon(3);
  });
  expect(result).toBe('🥉');
});

test('medalIcon returns empty string for rank 4+', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { medalIcon } = await import('/js/templates/scoreboard.js');
    return { four: medalIcon(4), ten: medalIcon(10), zero: medalIcon(0) };
  });
  expect(results.four).toBe('');
  expect(results.ten).toBe('');
  expect(results.zero).toBe('');
});

/* ================================================================
   Section 2: rankSuffix
   ================================================================ */

test('rankSuffix formats 1 as "1st"', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { rankSuffix } = await import('/js/templates/scoreboard.js');
    return rankSuffix(1);
  });
  expect(result).toBe('1st');
});

test('rankSuffix formats 2 as "2nd" and 3 as "3rd"', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { rankSuffix } = await import('/js/templates/scoreboard.js');
    return { two: rankSuffix(2), three: rankSuffix(3) };
  });
  expect(results.two).toBe('2nd');
  expect(results.three).toBe('3rd');
});

test('rankSuffix formats 4–20 with "th"', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { rankSuffix } = await import('/js/templates/scoreboard.js');
    return { four: rankSuffix(4), eleven: rankSuffix(11), twenty: rankSuffix(20) };
  });
  expect(results.four).toBe('4th');
  expect(results.eleven).toBe('11th');
  expect(results.twenty).toBe('20th');
});

test('rankSuffix formats 21 as "21st" (handles teens/decades boundary)', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { rankSuffix } = await import('/js/templates/scoreboard.js');
    return { twentyOne: rankSuffix(21), twentyTwo: rankSuffix(22), hundredFirst: rankSuffix(101) };
  });
  expect(results.twentyOne).toBe('21st');
  expect(results.twentyTwo).toBe('22nd');
  expect(results.hundredFirst).toBe('101st');
});

/* ================================================================
   Section 3: parseScore
   ================================================================ */

test('parseScore parses plain integer strings', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseScore } = await import('/js/templates/scoreboard.js');
    return { a: parseScore('4250'), b: parseScore('0'), c: parseScore('1') };
  });
  expect(results.a).toBe(4250);
  expect(results.b).toBe(0);
  expect(results.c).toBe(1);
});

test('parseScore strips commas from thousands', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseScore } = await import('/js/templates/scoreboard.js');
    return parseScore('1,234,567');
  });
  expect(result).toBe(1234567);
});

test('parseScore handles floating point scores', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseScore } = await import('/js/templates/scoreboard.js');
    return parseScore('98.65');
  });
  expect(result).toBeCloseTo(98.65);
});

test('parseScore returns 0 for empty, null, or invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseScore } = await import('/js/templates/scoreboard.js');
    return {
      empty: parseScore(''),
      nullVal: parseScore(null),
      garbage: parseScore('abc'),
      undef: parseScore(undefined),
    };
  });
  expect(results.empty).toBe(0);
  expect(results.nullVal).toBe(0);
  expect(results.garbage).toBe(0);
  expect(results.undef).toBe(0);
});

/* ================================================================
   Section 4: formatScore
   ================================================================ */

test('formatScore formats small numbers without commas', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatScore } = await import('/js/templates/scoreboard.js');
    return formatScore(999);
  });
  expect(result).toBe('999');
});

test('formatScore formats thousands with commas', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatScore } = await import('/js/templates/scoreboard.js');
    return formatScore(4250);
  });
  expect(result).toBe('4,250');
});

test('formatScore round-trips with parseScore', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseScore, formatScore } = await import('/js/templates/scoreboard.js');
    const n = parseScore('1,234,567');
    return formatScore(n);
  });
  expect(result).toBe('1,234,567');
});
