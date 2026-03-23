// tests/e2e/unit-gcal-helpers.spec.js — Unit tests for gcal template helpers
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

// ---- evtTypeIcon ----

test('evtTypeIcon returns correct emoji for known types', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { evtTypeIcon } = await import('/js/templates/gcal.js');
    return {
      meeting:     evtTypeIcon('meeting'),
      appointment: evtTypeIcon('appointment'),
      personal:    evtTypeIcon('personal'),
      social:      evtTypeIcon('social'),
      work:        evtTypeIcon('work'),
      other:       evtTypeIcon('other'),
    };
  });
  expect(results.meeting).toBe('🤝');
  expect(results.appointment).toBe('📌');
  expect(results.personal).toBe('🌿');
  expect(results.social).toBe('🎉');
  expect(results.work).toBe('💼');
  expect(results.other).toBe('📅');
});

test('evtTypeIcon falls back to 📅 for unknown types', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { evtTypeIcon } = await import('/js/templates/gcal.js');
    return {
      empty:   evtTypeIcon(''),
      null_:   evtTypeIcon(null),
      unknown: evtTypeIcon('workshop'),
    };
  });
  expect(results.empty).toBe('📅');
  expect(results.null_).toBe('📅');
  expect(results.unknown).toBe('📅');
});

test('evtTypeIcon is case-insensitive', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { evtTypeIcon } = await import('/js/templates/gcal.js');
    return {
      upper:  evtTypeIcon('MEETING'),
      mixed:  evtTypeIcon('Personal'),
      padded: evtTypeIcon('  work  '),
    };
  });
  expect(results.upper).toBe('🤝');
  expect(results.mixed).toBe('🌿');
  expect(results.padded).toBe('💼');
});

// ---- evtTypeClass ----

test('evtTypeClass returns correct CSS class for known types', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { evtTypeClass } = await import('/js/templates/gcal.js');
    return {
      meeting:  evtTypeClass('meeting'),
      personal: evtTypeClass('personal'),
      unknown:  evtTypeClass('brunch'),
    };
  });
  expect(results.meeting).toBe('gcal-type-meeting');
  expect(results.personal).toBe('gcal-type-personal');
  expect(results.unknown).toBe('gcal-type-other');
});

// ---- fmtEvtDate ----

test('fmtEvtDate formats a date string as readable day heading', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { fmtEvtDate } = await import('/js/templates/gcal.js');
    // A date far in the future will always be "Mon, Jul 7"
    return fmtEvtDate('2026-07-07');
  });
  expect(result).toMatch(/Jul 7/);
  expect(result).toMatch(/\w+, Jul 7/);
});

test('fmtEvtDate handles falsy input gracefully', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { fmtEvtDate } = await import('/js/templates/gcal.js');
    return {
      empty: fmtEvtDate(''),
      null_: fmtEvtDate(null),
      bad:   fmtEvtDate('not-a-date'),
    };
  });
  expect(results.empty).toBe('');
  expect(results.null_).toBe('');
  expect(results.bad).toBe('not-a-date');
});

// ---- fmtEvtTime ----

test('fmtEvtTime converts HH:MM to 12-hour format', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { fmtEvtTime } = await import('/js/templates/gcal.js');
    return {
      morning:   fmtEvtTime('09:00'),
      afternoon: fmtEvtTime('14:30'),
      noon:      fmtEvtTime('12:00'),
      midnight:  fmtEvtTime('00:00'),
    };
  });
  expect(results.morning).toBe('9:00 AM');
  expect(results.afternoon).toBe('2:30 PM');
  expect(results.noon).toBe('12:00 PM');
  expect(results.midnight).toBe('12:00 AM');
});

test('fmtEvtTime handles edge cases gracefully', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { fmtEvtTime } = await import('/js/templates/gcal.js');
    return {
      empty:   fmtEvtTime(''),
      noColon: fmtEvtTime('0900'),
      null_:   fmtEvtTime(null),
    };
  });
  expect(results.empty).toBe('');
  expect(results.noColon).toBe('0900');
  expect(results.null_).toBe('');
});

// ---- sortByDateTime ----

test('sortByDateTime sorts events by date then time ascending', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { sortByDateTime } = await import('/js/templates/gcal.js');
    const rows = [
      ['Event C', '2026-07-10', '09:00'],
      ['Event A', '2026-07-07', '14:00'],
      ['Event B', '2026-07-07', '09:00'],
    ];
    return sortByDateTime(rows, 1, 2).map(r => r[0]);
  });
  expect(result[0]).toBe('Event B');
  expect(result[1]).toBe('Event A');
  expect(result[2]).toBe('Event C');
});

test('sortByDateTime handles empty array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { sortByDateTime } = await import('/js/templates/gcal.js');
    return sortByDateTime([], 1, 2);
  });
  expect(result).toHaveLength(0);
});

test('sortByDateTime does not mutate the original array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { sortByDateTime } = await import('/js/templates/gcal.js');
    const rows = [['B', '2026-07-10', '09:00'], ['A', '2026-07-07', '09:00']];
    const sorted = sortByDateTime(rows, 1, 2);
    return {
      originalFirst: rows[0][0],
      sortedFirst:   sorted[0][0],
    };
  });
  expect(result.originalFirst).toBe('B');
  expect(result.sortedFirst).toBe('A');
});
