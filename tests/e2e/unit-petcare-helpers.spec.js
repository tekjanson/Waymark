// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- petIcon ---------- */

test('petIcon returns dog emoji for "Dog"', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { petIcon } = await import('/js/templates/petcare.js');
    return petIcon('Dog');
  });
  expect(result).toBe('🐕');
});

test('petIcon is case-insensitive', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { petIcon } = await import('/js/templates/petcare.js');
    return {
      dog: petIcon('dog'),
      DOG: petIcon('DOG'),
      cat: petIcon('cat'),
      Cat: petIcon('Cat'),
    };
  });
  expect(results.dog).toBe('🐕');
  expect(results.DOG).toBe('🐕');
  expect(results.cat).toBe('🐈');
  expect(results.Cat).toBe('🐈');
});

test('petIcon returns paw emoji for unknown type', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { petIcon } = await import('/js/templates/petcare.js');
    return {
      unknown: petIcon('Lizard'),
      empty: petIcon(''),
      nullVal: petIcon(null),
    };
  });
  expect(results.unknown).toBe('🐾');
  expect(results.empty).toBe('🐾');
  expect(results.nullVal).toBe('🐾');
});

test('petIcon handles known types: rabbit, fish, bird, hamster', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { petIcon } = await import('/js/templates/petcare.js');
    return {
      rabbit: petIcon('Rabbit'),
      fish: petIcon('Fish'),
      bird: petIcon('Bird'),
      hamster: petIcon('Hamster'),
    };
  });
  expect(results.rabbit).toBe('🐇');
  expect(results.fish).toBe('🐠');
  expect(results.bird).toBe('🐦');
  expect(results.hamster).toBe('🐹');
});

/* ---------- fmtDate ---------- */

test('fmtDate formats ISO date as human-readable string', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { fmtDate } = await import('/js/templates/petcare.js');
    return fmtDate('2026-01-15');
  });
  expect(result).toMatch(/Jan/);
  expect(result).toMatch(/15/);
  expect(result).toMatch(/2026/);
});

test('fmtDate returns empty string for empty/null input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { fmtDate } = await import('/js/templates/petcare.js');
    return {
      empty: fmtDate(''),
      nullVal: fmtDate(null),
    };
  });
  expect(results.empty).toBe('');
  expect(results.nullVal).toBe('');
});

test('fmtDate returns raw string for invalid date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { fmtDate } = await import('/js/templates/petcare.js');
    return fmtDate('not-a-date');
  });
  expect(result).toBe('not-a-date');
});

/* ---------- apptClass ---------- */

test('apptClass returns overdue for past date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { apptClass } = await import('/js/templates/petcare.js');
    return apptClass('2020-01-01'); // clearly in the past
  });
  expect(result).toBe('petcare-due-overdue');
});

test('apptClass returns later for far future date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { apptClass } = await import('/js/templates/petcare.js');
    return apptClass('2099-12-31'); // very far future
  });
  expect(result).toBe('petcare-due-later');
});

test('apptClass returns empty string for empty or invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { apptClass } = await import('/js/templates/petcare.js');
    return {
      empty: apptClass(''),
      invalid: apptClass('not-a-date'),
      nullVal: apptClass(null),
    };
  });
  expect(results.empty).toBe('');
  expect(results.invalid).toBe('');
  expect(results.nullVal).toBe('');
});

test('apptClass with frozen date returns correct classes for all urgency levels', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { apptClass } = await import('/js/templates/petcare.js');
    const RealDate = Date;
    const frozenNow = new RealDate('2026-06-15T12:00:00');
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) return new RealDate(frozenNow);
        super(...args);
      }
    };
    globalThis.Date.now = () => frozenNow.getTime();
    try {
      return {
        overdue:   apptClass('2026-06-13'),   // 2 days ago
        soon:      apptClass('2026-06-18'),   // 3 days from now
        upcoming:  apptClass('2026-06-30'),   // 15 days from now
        later:     apptClass('2026-09-01'),   // 78 days from now
      };
    } finally {
      globalThis.Date = RealDate;
    }
  });
  expect(results.overdue).toBe('petcare-due-overdue');
  expect(results.soon).toBe('petcare-due-soon');
  expect(results.upcoming).toBe('petcare-due-upcoming');
  expect(results.later).toBe('petcare-due-later');
});
