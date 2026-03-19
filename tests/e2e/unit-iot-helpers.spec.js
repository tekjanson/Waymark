const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

test('parseNumber parses numeric strings and rejects invalid values', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseNumber } = await import('/js/templates/iot/helpers.js');
    return {
      int: parseNumber('42'),
      float: parseNumber('3.14'),
      blank: parseNumber(''),
      bad: parseNumber('abc'),
    };
  });
  expect(result.int).toBe(42);
  expect(result.float).toBeCloseTo(3.14, 6);
  expect(result.blank).toBeNull();
  expect(result.bad).toBeNull();
});

test('normaliseAlert maps variants to canonical states', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { normaliseAlert } = await import('/js/templates/iot/helpers.js');
    return {
      normal: normaliseAlert('ok'),
      watch: normaliseAlert('warning'),
      alert: normaliseAlert('critical'),
      offline: normaliseAlert('down'),
      unknown: normaliseAlert('mystery'),
    };
  });
  expect(result.normal).toBe('Normal');
  expect(result.watch).toBe('Watch');
  expect(result.alert).toBe('Alert');
  expect(result.offline).toBe('Offline');
  expect(result.unknown).toBeNull();
});

test('evaluateThreshold classifies low, normal, high, and unknown', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { evaluateThreshold } = await import('/js/templates/iot/helpers.js');
    return {
      low: evaluateThreshold(5, 10, 20),
      normal: evaluateThreshold(15, 10, 20),
      high: evaluateThreshold(25, 10, 20),
      unknown: evaluateThreshold(null, 10, 20),
    };
  });
  expect(result.low).toBe('low');
  expect(result.normal).toBe('normal');
  expect(result.high).toBe('high');
  expect(result.unknown).toBe('unknown');
});

test('resolveState prefers explicit alerts over inferred thresholds', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { resolveState } = await import('/js/templates/iot/helpers.js');
    return {
      explicit: resolveState(12, 10, 20, 'offline'),
      inferredAlert: resolveState(25, 10, 20, ''),
      inferredNormal: resolveState(15, 10, 20, ''),
      inferredOffline: resolveState(null, 10, 20, ''),
    };
  });
  expect(result.explicit).toBe('Offline');
  expect(result.inferredAlert).toBe('Alert');
  expect(result.inferredNormal).toBe('Normal');
  expect(result.inferredOffline).toBe('Offline');
});

test('formatReading and formatTimestamp return readable output', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatReading, formatTimestamp } = await import('/js/templates/iot/helpers.js');
    return {
      reading: formatReading(22.44, 'C'),
      noReading: formatReading(null, 'C'),
      ts: formatTimestamp('2026-03-18T10:20:00Z'),
      badTs: formatTimestamp('not-a-date'),
    };
  });
  expect(result.reading).toBe('22.4 C');
  expect(result.noReading).toBe('No reading');
  expect(result.ts.length).toBeGreaterThan(4);
  expect(result.badTs).toBe('not-a-date');
});

test('averageReading uses numeric entries only', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { averageReading } = await import('/js/templates/iot/helpers.js');
    return {
      avg: averageReading([{ reading: 10 }, { reading: null }, { reading: 20 }]),
      none: averageReading([{ reading: null }, { reading: null }]),
    };
  });
  expect(result.avg).toBe(15);
  expect(result.none).toBeNull();
});
