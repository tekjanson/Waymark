const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ─── parseProgress ─── */

test('parseProgress returns 0 for empty/null/undefined input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/okr/helpers.js');
    return {
      empty: parseProgress(''),
      nullVal: parseProgress(null),
      undef: parseProgress(undefined),
      spaces: parseProgress('   '),
    };
  });
  expect(results.empty).toBe(0);
  expect(results.nullVal).toBe(0);
  expect(results.undef).toBe(0);
  expect(results.spaces).toBe(0);
});

test('parseProgress parses percentage strings', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/okr/helpers.js');
    return {
      zero: parseProgress('0%'),
      fifty: parseProgress('50%'),
      hundred: parseProgress('100%'),
      decimal: parseProgress('75.5%'),
    };
  });
  expect(results.zero).toBe(0);
  expect(results.fifty).toBe(50);
  expect(results.hundred).toBe(100);
  expect(results.decimal).toBe(76); // rounded
});

test('parseProgress parses plain numbers', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/okr/helpers.js');
    return {
      sixty: parseProgress('60'),
      eighty: parseProgress('80'),
    };
  });
  expect(results.sixty).toBe(60);
  expect(results.eighty).toBe(80);
});

test('parseProgress treats 0–1 decimal fractions as percentages', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/okr/helpers.js');
    return {
      half: parseProgress('0.5'),
      threequarters: parseProgress('0.75'),
      one: parseProgress('1'),
    };
  });
  expect(results.half).toBe(50);
  expect(results.threequarters).toBe(75);
  expect(results.one).toBe(100);
});

test('parseProgress clamps values to 0–100', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/okr/helpers.js');
    return {
      over: parseProgress('150%'),
      negative: parseProgress('-10%'),
    };
  });
  expect(results.over).toBe(100);
  expect(results.negative).toBe(0);
});

test('parseProgress returns 0 for non-numeric strings', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/okr/helpers.js');
    return parseProgress('on track');
  });
  expect(result).toBe(0);
});

/* ─── rollupProgress ─── */

test('rollupProgress returns 0 for empty array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { rollupProgress } = await import('/js/templates/okr/helpers.js');
    return rollupProgress([]);
  });
  expect(result).toBe(0);
});

test('rollupProgress computes average of progress values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { rollupProgress } = await import('/js/templates/okr/helpers.js');
    return {
      even: rollupProgress([60, 80, 100]),  // avg = 80
      mixed: rollupProgress([90, 80, 55]),  // avg = ~75
      single: rollupProgress([42]),
    };
  });
  expect(results.even).toBe(80);
  expect(results.mixed).toBe(75);
  expect(results.single).toBe(42);
});

test('rollupProgress rounds to integer', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { rollupProgress } = await import('/js/templates/okr/helpers.js');
    return rollupProgress([33, 66, 100]); // avg = 66.33 → 66
  });
  expect(Number.isInteger(result)).toBe(true);
});

/* ─── progressClass ─── */

test('progressClass returns okr-progress-low for values below 40', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { progressClass } = await import('/js/templates/okr/helpers.js');
    return { zero: progressClass(0), thirty: progressClass(30), thirtynine: progressClass(39) };
  });
  expect(results.zero).toBe('okr-progress-low');
  expect(results.thirty).toBe('okr-progress-low');
  expect(results.thirtynine).toBe('okr-progress-low');
});

test('progressClass returns okr-progress-mid for 40–69', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { progressClass } = await import('/js/templates/okr/helpers.js');
    return { forty: progressClass(40), sixty: progressClass(60), sixtynine: progressClass(69) };
  });
  expect(results.forty).toBe('okr-progress-mid');
  expect(results.sixty).toBe('okr-progress-mid');
  expect(results.sixtynine).toBe('okr-progress-mid');
});

test('progressClass returns okr-progress-high for 70+', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { progressClass } = await import('/js/templates/okr/helpers.js');
    return { seventy: progressClass(70), ninety: progressClass(90), hundred: progressClass(100) };
  });
  expect(results.seventy).toBe('okr-progress-high');
  expect(results.ninety).toBe('okr-progress-high');
  expect(results.hundred).toBe('okr-progress-high');
});

/* ─── normaliseQuarter ─── */

test('normaliseQuarter returns empty string for empty/null input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { normaliseQuarter } = await import('/js/templates/okr/helpers.js');
    return {
      empty: normaliseQuarter(''),
      nullVal: normaliseQuarter(null),
      undef: normaliseQuarter(undefined),
    };
  });
  expect(results.empty).toBe('');
  expect(results.nullVal).toBe('');
  expect(results.undef).toBe('');
});

test('normaliseQuarter parses standard Q1 2026 format', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normaliseQuarter } = await import('/js/templates/okr/helpers.js');
    return normaliseQuarter('Q1 2026');
  });
  expect(result).toBe('Q1 2026');
});

test('normaliseQuarter parses hyphenated variants', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normaliseQuarter } = await import('/js/templates/okr/helpers.js');
    return normaliseQuarter('Q2-2026');
  });
  expect(result).toBe('Q2 2026');
});

test('normaliseQuarter parses lowercase q', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normaliseQuarter } = await import('/js/templates/okr/helpers.js');
    return normaliseQuarter('q3 2026');
  });
  expect(result).toBe('Q3 2026');
});

/* ─── collectQuarters ─── */

test('collectQuarters returns empty array when col index is negative', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { collectQuarters } = await import('/js/templates/okr/helpers.js');
    return collectQuarters([['A', 'B', 'Q1 2026']], -1);
  });
  expect(result).toEqual([]);
});

test('collectQuarters returns sorted unique quarters', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { collectQuarters } = await import('/js/templates/okr/helpers.js');
    const rows = [
      ['Obj', 'KR', 'Q2 2026'],
      ['Obj', 'KR', 'Q1 2026'],
      ['Obj', 'KR', 'Q2 2026'],
      ['Obj', 'KR', 'Q3 2026'],
    ];
    return collectQuarters(rows, 2);
  });
  expect(result).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026']);
});

/* ─── groupByObjective ─── */

test('groupByObjective groups rows by objective column', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { groupByObjective } = await import('/js/templates/okr/helpers.js');
    const rows = [
      ['Grow Revenue', 'Hit $10M ARR', '90%'],
      ['Grow Revenue', 'Close 20 deals', '80%'],
      ['Improve Quality', 'Reduce bugs', '70%'],
    ];
    const groups = groupByObjective(rows, 0);
    return groups.map(g => ({ objective: g.objective, count: g.rows.length }));
  });
  expect(result).toEqual([
    { objective: 'Grow Revenue', count: 2 },
    { objective: 'Improve Quality', count: 1 },
  ]);
});

test('groupByObjective places empty-objective rows under previous objective', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { groupByObjective } = await import('/js/templates/okr/helpers.js');
    const rows = [
      ['Grow Revenue', 'Hit $10M ARR', '90%'],
      ['', 'Close 20 deals', '80%'],  // empty objective — should go under Grow Revenue
      ['Improve Quality', 'Reduce bugs', '70%'],
    ];
    const groups = groupByObjective(rows, 0);
    return groups.map(g => ({ objective: g.objective, count: g.rows.length }));
  });
  expect(result).toEqual([
    { objective: 'Grow Revenue', count: 2 },
    { objective: 'Improve Quality', count: 1 },
  ]);
});

test('groupByObjective handles single-objective sheet', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { groupByObjective } = await import('/js/templates/okr/helpers.js');
    const rows = [
      ['One Goal', 'KR A', '50%'],
      ['One Goal', 'KR B', '60%'],
      ['One Goal', 'KR C', '70%'],
    ];
    const groups = groupByObjective(rows, 0);
    return { count: groups.length, krs: groups[0].rows.length };
  });
  expect(result.count).toBe(1);
  expect(result.krs).toBe(3);
});
