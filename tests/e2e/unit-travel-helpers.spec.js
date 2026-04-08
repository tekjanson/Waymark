// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------------------------------------------------------------
   Unit tests for travel.js helpers — parseCost
   Run via: npx playwright test tests/e2e/unit-travel-helpers.spec.js
   --------------------------------------------------------------- */

test('parseCost extracts simple dollar amounts', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      simple: parseCost('$80'),
      withDecimal: parseCost('$24.50'),
      withThousands: parseCost('$1,200'),
    };
  });
  expect(results.simple).toBe(80);
  expect(results.withDecimal).toBe(24.50);
  expect(results.withThousands).toBe(1200);
});

test('parseCost extracts first amount from annotated costs', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      withAdults: parseCost('$49 (2 adults)'),
      withNights: parseCost('$220–$350/night x 2 nights'),
      withAdultsToddler: parseCost('$44 (2 adults + toddler)'),
    };
  });
  expect(results.withAdults).toBe(49);
  expect(results.withNights).toBe(220);
  expect(results.withAdultsToddler).toBe(44);
});

test('parseCost handles tilde-prefixed approximations', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      gas: parseCost('~$30 gas'),
      complex: parseCost('~$40 gas + $10 tolls'),
      noSymbol: parseCost('~30'),
    };
  });
  expect(results.gas).toBe(30);
  expect(results.complex).toBe(40);  // first dollar amount wins
  expect(results.noSymbol).toBe(30);
});

test('parseCost returns 0 for FREE values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      free: parseCost('FREE'),
      freeWithNote: parseCost('FREE with ATB Pass'),
      freeFromPark: parseCost('FREE from the US side park'),
    };
  });
  expect(results.free).toBe(0);
  expect(results.freeWithNote).toBe(0);
  expect(results.freeFromPark).toBe(0);
});

test('parseCost handles FREE with extra cost note', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      freeParking: parseCost('FREE (+ $15 parking)'),
      freePaint: parseCost('FREE (~$5 spray paint)'),
    };
  });
  // These have additional costs that ARE real dollar amounts
  expect(results.freeParking).toBe(15);
  expect(results.freePaint).toBe(5);
});

test('parseCost returns 0 for null, undefined, and empty string', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      nullVal: parseCost(null),
      undefinedVal: parseCost(undefined),
      empty: parseCost(''),
    };
  });
  expect(results.nullVal).toBe(0);
  expect(results.undefinedVal).toBe(0);
  expect(results.empty).toBe(0);
});

test('parseCost handles bare number without currency sign', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      bare: parseCost('120'),
      withRange: parseCost('220–350'),  // bare leading number
    };
  });
  expect(results.bare).toBe(120);
  expect(results.withRange).toBe(220);
});

test('parseCost handles range costs correctly (takes minimum/first value)', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      rangeNight: parseCost('$140–$170/night'),
      rangeTotal: parseCost('$220–$460 total (2 nights)'),
      rangeWithAdults: parseCost('$80–$120 dinner'),
    };
  });
  // First dollar amount extracted in each case
  expect(results.rangeNight).toBe(140);
  expect(results.rangeTotal).toBe(220);
  expect(results.rangeWithAdults).toBe(80);
});

test('parseCost does not concatenate digits from separate numbers (regression)', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseCost } = await import('/js/templates/travel.js');
    return {
      // Old bug: "$30 for museum (2 adults); FREE outdoor" → 302 (concatenated)
      oldBugCase: parseCost('$30 for museum (2 adults); FREE outdoor'),
      // Old bug: "$220–$350/night x 2 nights" → 220350
      rangeCase: parseCost('$220–$350/night x 2 nights'),
    };
  });
  expect(results.oldBugCase).toBe(30);   // NOT 302
  expect(results.rangeCase).toBe(220);   // NOT 220350
});
