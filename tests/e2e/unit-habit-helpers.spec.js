/**
 * Unit tests for public/js/templates/habit/helpers.js
 *
 * Tests pure functions by dynamically importing the module in the browser
 * via Playwright — no build tools, no Node.js ESM shims needed.
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ────────── helper: import the module inside the browser ────────── */
async function importHelpers(page) {
  return page.evaluate(async () => {
    const mod = await import('/js/templates/habit/helpers.js');
    // Expose all exports as plain transferable values where possible
    return {
      STATE_CHAR: mod.STATE_CHAR,
      STATE_CYCLE: mod.STATE_CYCLE,
      STATE_VALUE: mod.STATE_VALUE,
      DAY_ABBR: mod.DAY_ABBR,
      DAY_NAMES: mod.DAY_NAMES,
      MONTH_NAMES: mod.MONTH_NAMES,
      MONTH_ABBR: mod.MONTH_ABBR,
    };
  });
}

/* Helper that calls a named function inside the browser and returns the result */
async function callHelper(page, fnName, ...args) {
  return page.evaluate(async ({ fnName, args }) => {
    const mod = await import('/js/templates/habit/helpers.js');
    return mod[fnName](...args);
  }, { fnName, args });
}

/* ================================================================
   Section 1: Constants
   ================================================================ */

test('habit constants have correct shapes', async ({ page }) => {
  await setupApp(page);
  const c = await importHelpers(page);

  expect(c.STATE_CHAR).toEqual({ done: '✓', partial: '~', missed: '✗', empty: '' });
  expect(c.STATE_CYCLE).toEqual(['empty', 'done', 'partial', 'missed']);
  expect(c.STATE_VALUE).toEqual({ done: '✓', partial: '~', missed: '✗', empty: '' });
  expect(c.DAY_ABBR).toHaveLength(7);
  expect(c.DAY_ABBR[0]).toBe('Mon');
  expect(c.DAY_ABBR[6]).toBe('Sun');
  expect(c.DAY_NAMES).toHaveLength(7);
  expect(c.MONTH_NAMES).toHaveLength(12);
  expect(c.MONTH_ABBR).toHaveLength(12);
});

/* ================================================================
   Section 2: habitState classifier
   ================================================================ */

test('habitState classifies done values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { habitState } = await import('/js/templates/habit/helpers.js');
    return {
      checkmark: habitState('✓'),
      heavyCheck: habitState('✔'),
      x: habitState('x'),
      X: habitState('X'),
      yes: habitState('yes'),
      Yes: habitState('Yes'),
      one: habitState('1'),
      trueStr: habitState('true'),
      done: habitState('done'),
      Done: habitState('Done'),
    };
  });
  for (const [key, val] of Object.entries(results)) {
    expect(val, `habitState for ${key}`).toBe('done');
  }
});

test('habitState classifies partial values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { habitState } = await import('/js/templates/habit/helpers.js');
    return {
      tilde: habitState('~'),
      half: habitState('half'),
      partial: habitState('partial'),
      fifty: habitState('50%'),
    };
  });
  for (const [key, val] of Object.entries(results)) {
    expect(val, `habitState for ${key}`).toBe('partial');
  }
});

test('habitState classifies missed values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { habitState } = await import('/js/templates/habit/helpers.js');
    return {
      missed: habitState('missed'),
      no: habitState('no'),
      zero: habitState('0'),
      falseStr: habitState('false'),
      skip: habitState('skip'),
      cross: habitState('✗'),
      heavyCross: habitState('✘'),
    };
  });
  for (const [key, val] of Object.entries(results)) {
    expect(val, `habitState for ${key}`).toBe('missed');
  }
});

test('habitState classifies empty values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { habitState } = await import('/js/templates/habit/helpers.js');
    return {
      empty: habitState(''),
      nullVal: habitState(null),
      undefinedVal: habitState(undefined),
      spaces: habitState('   '),
    };
  });
  for (const [key, val] of Object.entries(results)) {
    expect(val, `habitState for ${key}`).toBe('empty');
  }
});

test('habitState treats unknown non-empty string as done', async ({ page }) => {
  await setupApp(page);
  const result = await callHelper(page, 'habitState', 'banana');
  expect(result).toBe('done');
});

/* ================================================================
   Section 3: computeStreak
   ================================================================ */

test('computeStreak counts consecutive done from right', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeStreak } = await import('/js/templates/habit/helpers.js');
    const row = ['Habit', '✓', '✗', '✓', '✓', '✓'];
    const dayCols = [1, 2, 3, 4, 5];
    return computeStreak(row, dayCols);
  });
  expect(result).toBe(3); // last 3 are done, then a miss breaks it
});

test('computeStreak returns 0 when last day is not done', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeStreak } = await import('/js/templates/habit/helpers.js');
    const row = ['Habit', '✓', '✓', '✓', '✓', '✗'];
    return computeStreak(row, [1, 2, 3, 4, 5]);
  });
  expect(result).toBe(0);
});

test('computeStreak returns full length when all done', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeStreak } = await import('/js/templates/habit/helpers.js');
    const row = ['Habit', '✓', '✓', '✓', '✓', '✓', '✓', '✓'];
    return computeStreak(row, [1, 2, 3, 4, 5, 6, 7]);
  });
  expect(result).toBe(7);
});

test('computeStreak returns 0 for all empty', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeStreak } = await import('/js/templates/habit/helpers.js');
    const row = ['Habit', '', '', '', '', '', '', ''];
    return computeStreak(row, [1, 2, 3, 4, 5, 6, 7]);
  });
  expect(result).toBe(0);
});

/* ================================================================
   Section 4: computeMultiWeekStreak
   ================================================================ */

test('computeMultiWeekStreak counts across multiple weeks', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeMultiWeekStreak } = await import('/js/templates/habit/helpers.js');
    const weeks = [
      { rows: [['Exercise', '✓', '✓', '✓', '✓', '✓', '✓', '✓']] },
      { rows: [['Exercise', '✓', '✓', '✓', '✗', '✓', '✓', '✓']] },
    ];
    // Week 2 (index 1): 3 done from right, then break at col 4 (✗)
    return computeMultiWeekStreak('Exercise', weeks, 0, [1, 2, 3, 4, 5, 6, 7], 1);
  });
  expect(result).toBe(3);
});

test('computeMultiWeekStreak spans full weeks when all done', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeMultiWeekStreak } = await import('/js/templates/habit/helpers.js');
    const weeks = [
      { rows: [['Exercise', '✓', '✓', '✓', '✓', '✓', '✓', '✓']] },
      { rows: [['Exercise', '✓', '✓', '✓', '✓', '✓', '✓', '✓']] },
    ];
    return computeMultiWeekStreak('Exercise', weeks, 0, [1, 2, 3, 4, 5, 6, 7], 1);
  });
  expect(result).toBe(14);
});

test('computeMultiWeekStreak returns 0 when habit not found', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeMultiWeekStreak } = await import('/js/templates/habit/helpers.js');
    const weeks = [{ rows: [['Exercise', '✓', '✓']] }];
    return computeMultiWeekStreak('Missing', weeks, 0, [1, 2], 0);
  });
  expect(result).toBe(0);
});

/* ================================================================
   Section 5: parseGoal
   ================================================================ */

test('parseGoal parses keyword goals', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseGoal } = await import('/js/templates/habit/helpers.js');
    return {
      daily: parseGoal('daily'),
      Daily: parseGoal('Daily'),
      weekdays: parseGoal('weekdays'),
      weekday: parseGoal('weekday'),
      weekends: parseGoal('weekends'),
      weekend: parseGoal('weekend'),
    };
  });
  expect(results.daily).toBe(7);
  expect(results.Daily).toBe(7);
  expect(results.weekdays).toBe(5);
  expect(results.weekday).toBe(5);
  expect(results.weekends).toBe(2);
  expect(results.weekend).toBe(2);
});

test('parseGoal parses numeric goals', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseGoal } = await import('/js/templates/habit/helpers.js');
    return {
      fiveX: parseGoal('5x/week'),
      threeX: parseGoal('3x/week'),
      twoTimes: parseGoal('2 times/week'),
      sixX: parseGoal('6x'),
      plain5: parseGoal('5'),
    };
  });
  expect(results.fiveX).toBe(5);
  expect(results.threeX).toBe(3);
  expect(results.twoTimes).toBe(2);
  expect(results.sixX).toBe(6);
  expect(results.plain5).toBe(5);
});

test('parseGoal returns 0 for empty or unparseable', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseGoal } = await import('/js/templates/habit/helpers.js');
    return {
      empty: parseGoal(''),
      nullVal: parseGoal(null),
      garbage: parseGoal('whenever'),
    };
  });
  expect(results.empty).toBe(0);
  expect(results.nullVal).toBe(0);
  expect(results.garbage).toBe(0);
});

/* ================================================================
   Section 6: parseWeekDate
   ================================================================ */

test('parseWeekDate parses ISO dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseWeekDate } = await import('/js/templates/habit/helpers.js');
    const d = parseWeekDate('2026-03-10');
    return d ? { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() } : null;
  });
  expect(result).toEqual({ y: 2026, m: 2, d: 10 });
});

test('parseWeekDate parses US dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseWeekDate } = await import('/js/templates/habit/helpers.js');
    const d = parseWeekDate('03/10/2026');
    return d ? { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() } : null;
  });
  expect(result).toEqual({ y: 2026, m: 2, d: 10 });
});

test('parseWeekDate returns null for invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseWeekDate } = await import('/js/templates/habit/helpers.js');
    return {
      empty: parseWeekDate(''),
      nullVal: parseWeekDate(null),
      garbage: parseWeekDate('not-a-date-xyz'),
      undef: parseWeekDate(undefined),
    };
  });
  expect(results.empty).toBeNull();
  expect(results.nullVal).toBeNull();
  expect(results.garbage).toBeNull();
  expect(results.undef).toBeNull();
});

/* ================================================================
   Section 7: formatWeekISO / formatWeekLabel
   ================================================================ */

test('formatWeekISO formats as YYYY-MM-DD', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatWeekISO } = await import('/js/templates/habit/helpers.js');
    return formatWeekISO(new Date(2026, 2, 10)); // March 10, 2026
  });
  expect(result).toBe('2026-03-10');
});

test('formatWeekISO pads single-digit months and days', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatWeekISO } = await import('/js/templates/habit/helpers.js');
    return formatWeekISO(new Date(2026, 0, 5)); // Jan 5
  });
  expect(result).toBe('2026-01-05');
});

test('formatWeekLabel produces human-readable label', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatWeekLabel } = await import('/js/templates/habit/helpers.js');
    return formatWeekLabel(new Date(2026, 2, 10));
  });
  expect(result).toMatch(/Week of Mar 10, 2026/);
});

/* ================================================================
   Section 8: getUniqueWeeks
   ================================================================ */

test('getUniqueWeeks groups rows by week and sorts ascending', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getUniqueWeeks } = await import('/js/templates/habit/helpers.js');
    const rows = [
      ['2026-03-17', 'Exercise', '✓'],
      ['2026-03-10', 'Exercise', '✓'],
      ['2026-03-10', 'Reading',  '✗'],
      ['2026-03-17', 'Reading',  '✓'],
    ];
    const weeks = getUniqueWeeks(rows, 0);
    return weeks.map(w => ({ iso: w.iso, rowCount: w.rows.length }));
  });
  expect(result).toHaveLength(2);
  expect(result[0].iso).toBe('2026-03-10');
  expect(result[0].rowCount).toBe(2);
  expect(result[1].iso).toBe('2026-03-17');
  expect(result[1].rowCount).toBe(2);
});

test('getUniqueWeeks skips rows with invalid dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getUniqueWeeks } = await import('/js/templates/habit/helpers.js');
    const rows = [
      ['2026-03-10', 'Exercise', '✓'],
      ['invalid',    'Reading',  '✗'],
      ['',           'Sleep',    '✓'],
    ];
    return getUniqueWeeks(rows, 0).length;
  });
  expect(result).toBe(1);
});

/* ================================================================
   Section 9: Date utility functions
   ================================================================ */

test('getWeekStart returns Monday for any day of the week', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { getWeekStart } = await import('/js/templates/habit/helpers.js');
    return [
      // Wed March 12, 2026 — should return Mon March 9
      getWeekStart(new Date(2026, 2, 12)).getDate(),
      // Sun March 15, 2026 — should return Mon March 9
      getWeekStart(new Date(2026, 2, 15)).getDate(),
      // Mon March 9, 2026 — should return itself
      getWeekStart(new Date(2026, 2, 9)).getDate(),
    ];
  });
  expect(results[0]).toBe(9);
  expect(results[1]).toBe(9);
  expect(results[2]).toBe(9);
});

test('getNextWeekStart returns Monday 7 days later', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getNextWeekStart } = await import('/js/templates/habit/helpers.js');
    const next = getNextWeekStart(new Date(2026, 2, 9)); // Mon March 9
    return { d: next.getDate(), m: next.getMonth() };
  });
  expect(result).toEqual({ d: 16, m: 2 });
});

test('dateToDayIndex maps JS days to Mon=0 Sun=6', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { dateToDayIndex } = await import('/js/templates/habit/helpers.js');
    return {
      mon: dateToDayIndex(new Date(2026, 2, 9)),   // Monday
      wed: dateToDayIndex(new Date(2026, 2, 11)),  // Wednesday
      sun: dateToDayIndex(new Date(2026, 2, 15)),  // Sunday
    };
  });
  expect(results.mon).toBe(0);
  expect(results.wed).toBe(2);
  expect(results.sun).toBe(6);
});

test('formatDayLabel produces readable day label', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatDayLabel } = await import('/js/templates/habit/helpers.js');
    return formatDayLabel(new Date(2026, 2, 14)); // Saturday
  });
  expect(result).toMatch(/Saturday/);
  expect(result).toMatch(/Mar 14/);
});

test('formatMonthLabel formats month and year', async ({ page }) => {
  await setupApp(page);
  const result = await callHelper(page, 'formatMonthLabel', 2026, 2);
  expect(result).toBe('March 2026');
});

test('formatQuarterLabel formats quarter and year', async ({ page }) => {
  await setupApp(page);
  const result = await callHelper(page, 'formatQuarterLabel', 2026, 0);
  expect(result).toBe('Q1 2026');
});

/* ================================================================
   Section 10: getMonthCalendar
   ================================================================ */

test('getMonthCalendar returns weeks with 7-day rows', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getMonthCalendar } = await import('/js/templates/habit/helpers.js');
    const weeks = getMonthCalendar(2026, 2); // March 2026
    return {
      weekCount: weeks.length,
      allSevenCols: weeks.every(w => w.length === 7),
      // March 1, 2026 is a Sunday → first week should have nulls for Mon–Sat
      firstWeekFirstDay: weeks[0][0], // Mon should be null (Feb day)
      firstWeekSunday: weeks[0][6] ? weeks[0][6].getDate() : null, // Sun should be Mar 1
    };
  });
  expect(result.allSevenCols).toBe(true);
  expect(result.weekCount).toBeGreaterThanOrEqual(4);
  expect(result.weekCount).toBeLessThanOrEqual(6);
  expect(result.firstWeekFirstDay).toBeNull(); // Mon is outside March
  expect(result.firstWeekSunday).toBe(1); // Sun Mar 1
});

test('getMonthCalendar only includes dates in the given month', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getMonthCalendar } = await import('/js/templates/habit/helpers.js');
    const weeks = getMonthCalendar(2026, 2); // March 2026
    const allDates = weeks.flat().filter(d => d !== null);
    return {
      allInMarch: allDates.every(d => d.getMonth() === 2),
      count: allDates.length,
    };
  });
  expect(result.allInMarch).toBe(true);
  expect(result.count).toBe(31); // March has 31 days
});

/* ================================================================
   Section 11: Quarter helpers
   ================================================================ */

test('getQuarter maps months to quarters', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { getQuarter } = await import('/js/templates/habit/helpers.js');
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(m => getQuarter(m));
  });
  expect(results).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
});

test('getQuarterMonths returns three months for each quarter', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { getQuarterMonths } = await import('/js/templates/habit/helpers.js');
    return [0, 1, 2, 3].map(q => getQuarterMonths(q));
  });
  expect(results[0]).toEqual([0, 1, 2]);
  expect(results[1]).toEqual([3, 4, 5]);
  expect(results[2]).toEqual([6, 7, 8]);
  expect(results[3]).toEqual([9, 10, 11]);
});

/* ================================================================
   Section 12: Completion rate helpers
   ================================================================ */

test('weekCompletionRate computes rate across rows and days', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { weekCompletionRate } = await import('/js/templates/habit/helpers.js');
    const rows = [
      ['Habit1', '✓', '✓', '✗', '✓'],
      ['Habit2', '✓', '✗', '✗', '✓'],
    ];
    return weekCompletionRate(rows, [1, 2, 3, 4]);
  });
  // 5 done out of 8 total = 0.625
  expect(result).toBeCloseTo(0.625, 3);
});

test('weekCompletionRate counts partial as 0.5', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { weekCompletionRate } = await import('/js/templates/habit/helpers.js');
    const rows = [['Habit', '~', '~']];
    return weekCompletionRate(rows, [1, 2]);
  });
  expect(result).toBeCloseTo(0.5, 3); // 0.5+0.5 = 1.0 / 2 = 0.5
});

test('weekCompletionRate returns 0 for all empty', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { weekCompletionRate } = await import('/js/templates/habit/helpers.js');
    const rows = [['Habit', '', '', '']];
    return weekCompletionRate(rows, [1, 2, 3]);
  });
  expect(result).toBe(0);
});

test('dayCompletionRate computes rate for a single day column', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { dayCompletionRate } = await import('/js/templates/habit/helpers.js');
    const rows = [
      ['Habit1', '✓', ''],
      ['Habit2', '~',  ''],
      ['Habit3', '✗', ''],
      ['Habit4', '✓', ''],
    ];
    return dayCompletionRate(rows, 1);
  });
  // 2 done + 0.5 partial = 2.5 / 4 = 0.625
  expect(result).toBeCloseTo(0.625, 3);
});

test('dayCompletionRate returns -1 for empty rows', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { dayCompletionRate } = await import('/js/templates/habit/helpers.js');
    return dayCompletionRate([], 1);
  });
  expect(result).toBe(-1);
});

/* ================================================================
   Section 13: dayHabitStates
   ================================================================ */

test('dayHabitStates returns name and state for each row', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { dayHabitStates } = await import('/js/templates/habit/helpers.js');
    const rows = [
      ['Exercise', '✓'],
      ['Reading', '✗'],
      ['Meditate', ''],
    ];
    return dayHabitStates(rows, 0, 1);
  });
  expect(result).toEqual([
    { name: 'Exercise', state: 'done' },
    { name: 'Reading',  state: 'missed' },
    { name: 'Meditate', state: 'empty' },
  ]);
});

/* ================================================================
   Section 14: findWeekForDate
   ================================================================ */

test('findWeekForDate returns correct index', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { findWeekForDate } = await import('/js/templates/habit/helpers.js');
    const weeks = [
      { iso: '2026-03-09' },
      { iso: '2026-03-16' },
      { iso: '2026-03-23' },
    ];
    // Wed March 18 falls in week of March 16
    return findWeekForDate(weeks, new Date(2026, 2, 18));
  });
  expect(result).toBe(1);
});

test('findWeekForDate returns -1 when date not in any week', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { findWeekForDate } = await import('/js/templates/habit/helpers.js');
    const weeks = [{ iso: '2026-03-09' }];
    return findWeekForDate(weeks, new Date(2026, 3, 1));
  });
  expect(result).toBe(-1);
});

/* ================================================================
   Section 15: getWeekStartsInRange
   ================================================================ */

test('getWeekStartsInRange returns Mondays in a date range', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getWeekStartsInRange } = await import('/js/templates/habit/helpers.js');
    const start = new Date(2026, 2, 9);  // Mon March 9
    const end = new Date(2026, 2, 25);   // Wed March 25
    return getWeekStartsInRange(start, end);
  });
  expect(result).toEqual(['2026-03-09', '2026-03-16', '2026-03-23']);
});

/* ================================================================
   Section 16: WEEK_COL_PATTERN
   ================================================================ */

test('WEEK_COL_PATTERN matches expected header strings', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { WEEK_COL_PATTERN } = await import('/js/templates/habit/helpers.js');
    return {
      weekOf: WEEK_COL_PATTERN.test('week of'),
      Week: WEEK_COL_PATTERN.test('week'),
      date: WEEK_COL_PATTERN.test('date'),
      period: WEEK_COL_PATTERN.test('period'),
      weekStart: WEEK_COL_PATTERN.test('week start'),
      starting: WEEK_COL_PATTERN.test('starting'),
      random: WEEK_COL_PATTERN.test('habits'),
    };
  });
  expect(results.weekOf).toBe(true);
  expect(results.Week).toBe(true);
  expect(results.date).toBe(true);
  expect(results.period).toBe(true);
  expect(results.weekStart).toBe(true);
  expect(results.starting).toBe(true);
  expect(results.random).toBe(false);
});

/* ================================================================
   Section 8: findClosestWeek
   ================================================================ */

test('findClosestWeek returns -1 for empty weeks array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { findClosestWeek } = await import('/js/templates/habit/helpers.js');
    return findClosestWeek([], new Date('2026-02-15'));
  });
  expect(result).toBe(-1);
});

test('findClosestWeek returns -1 for null/undefined weeks', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { findClosestWeek } = await import('/js/templates/habit/helpers.js');
    return {
      nullWeeks: findClosestWeek(null, new Date('2026-02-15')),
      undefinedWeeks: findClosestWeek(undefined, new Date('2026-02-15')),
    };
  });
  expect(results.nullWeeks).toBe(-1);
  expect(results.undefinedWeeks).toBe(-1);
});

test('findClosestWeek finds exact matching week', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { findClosestWeek } = await import('/js/templates/habit/helpers.js');
    const weeks = [
      { date: new Date('2026-01-26'), iso: '2026-01-26', rows: [] },
      { date: new Date('2026-02-02'), iso: '2026-02-02', rows: [] },
      { date: new Date('2026-02-09'), iso: '2026-02-09', rows: [] },
    ];
    return findClosestWeek(weeks, new Date('2026-02-02'));
  });
  expect(result).toBe(1);
});

test('findClosestWeek finds nearest week when no exact match', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { findClosestWeek } = await import('/js/templates/habit/helpers.js');
    const weeks = [
      { date: new Date('2026-01-26'), iso: '2026-01-26', rows: [] },
      { date: new Date('2026-02-02'), iso: '2026-02-02', rows: [] },
      { date: new Date('2026-02-09'), iso: '2026-02-09', rows: [] },
    ];
    return {
      beforeAll: findClosestWeek(weeks, new Date('2025-12-01')),
      afterAll: findClosestWeek(weeks, new Date('2027-06-15')),
      midWeek: findClosestWeek(weeks, new Date('2026-02-05')),
    };
  });
  expect(results.beforeAll).toBe(0);
  expect(results.afterAll).toBe(2);
  expect(results.midWeek).toBe(1); // closest to Feb 2
});

test('findClosestWeek works with single-element array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { findClosestWeek } = await import('/js/templates/habit/helpers.js');
    return findClosestWeek(
      [{ date: new Date('2026-03-09'), iso: '2026-03-09', rows: [] }],
      new Date('2026-01-01')
    );
  });
  expect(result).toBe(0);
});

/* ================================================================
   Section 9: computeMonthHabitStreaks
   ================================================================ */

test('computeMonthHabitStreaks returns empty for month with no data', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeMonthHabitStreaks } = await import('/js/templates/habit/helpers.js');
    const weeks = [
      { date: new Date('2026-01-26'), iso: '2026-01-26', rows: [['Exercise', '', '✓', '', '', '', '', '', '']] },
    ];
    const cols = { text: 0, days: [2, 3, 4, 5, 6, 7, 8] };
    return computeMonthHabitStreaks(weeks, cols, 2026, 5); // June — no data
  });
  expect(result).toEqual([]);
});

test('computeMonthHabitStreaks computes streaks for month with data', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeMonthHabitStreaks } = await import('/js/templates/habit/helpers.js');
    const weeks = [
      {
        date: new Date('2026-02-02'), iso: '2026-02-02',
        rows: [
          ['Exercise', '2026-02-02', '✓', '✓', '✓', '✓', '✓', '✓', '✓'],
          ['Meditate', '2026-02-02', '✓', '', '✓', '', '', '', ''],
        ],
      },
      {
        date: new Date('2026-02-09'), iso: '2026-02-09',
        rows: [
          ['Exercise', '2026-02-09', '✓', '✓', '✓', '✓', '✓', '✓', '✓'],
          ['Meditate', '2026-02-09', '✓', '✓', '', '', '', '', ''],
        ],
      },
    ];
    const cols = { text: 0, days: [2, 3, 4, 5, 6, 7, 8] };
    return computeMonthHabitStreaks(weeks, cols, 2026, 1); // February
  });
  expect(result).toHaveLength(2);
  expect(result[0].name).toBe('Exercise');
  expect(result[0].streak).toBe(14); // All done in both weeks
  expect(result[0].allDone).toBe(true);
  expect(result[1].name).toBe('Meditate');
  expect(result[1].streak).toBe(0); // Last days not done
  expect(result[1].allDone).toBe(false);
});

test('computeMonthHabitStreaks handles partial month overlap', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeMonthHabitStreaks } = await import('/js/templates/habit/helpers.js');
    const weeks = [
      {
        date: new Date('2026-01-26'), iso: '2026-01-26',
        rows: [['Read', '2026-01-26', '✓', '✓', '✓', '✓', '✓', '✓', '✓']],
      },
      {
        date: new Date('2026-02-02'), iso: '2026-02-02',
        rows: [['Read', '2026-02-02', '', '', '', '', '✓', '✓', '✓']],
      },
    ];
    const cols = { text: 0, days: [2, 3, 4, 5, 6, 7, 8] };
    // February: only week of Feb 2 fully in Feb, week of Jan 26 overlaps
    return computeMonthHabitStreaks(weeks, cols, 2026, 1);
  });
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe('Read');
  // Streak computed from right: last 3 days done in Feb 2 week, then hits empty → returns 3
  expect(result[0].streak).toBe(3);
  expect(result[0].allDone).toBe(false);
});
