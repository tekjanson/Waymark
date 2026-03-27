// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ============================================================
   Unit tests for public/js/templates/mesh/helpers.js

   All pure function tests — no DOM, no API, no side effects.
   Functions are imported via page.evaluate() + dynamic import().
   ============================================================ */

/* ---------- classifyStatus ---------- */

test('classifyStatus maps done synonyms', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/mesh/helpers.js');
    return {
      done: classifyStatus('done'),
      complete: classifyStatus('complete'),
      success: classifyStatus('success'),
      pass: classifyStatus('pass'),
      DONE: classifyStatus('DONE'),
      Done: classifyStatus('Done'),
    };
  });
  expect(results.done).toBe('done');
  expect(results.complete).toBe('done');
  expect(results.success).toBe('done');
  expect(results.pass).toBe('done');
  expect(results.DONE).toBe('done');
  expect(results.Done).toBe('done');
});

test('classifyStatus maps running synonyms', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/mesh/helpers.js');
    return {
      running: classifyStatus('running'),
      run: classifyStatus('run'),
      active: classifyStatus('active'),
      inProgress: classifyStatus('in_progress'),
      RUNNING: classifyStatus('RUNNING'),
    };
  });
  expect(results.running).toBe('running');
  expect(results.run).toBe('running');
  expect(results.active).toBe('running');
  expect(results.RUNNING).toBe('running');
});

test('classifyStatus maps failed synonyms', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/mesh/helpers.js');
    return {
      failed: classifyStatus('failed'),
      fail: classifyStatus('fail'),
      error: classifyStatus('error'),
      broken: classifyStatus('broken'),
    };
  });
  expect(results.failed).toBe('failed');
  expect(results.fail).toBe('failed');
  expect(results.error).toBe('failed');
  expect(results.broken).toBe('failed');
});

test('classifyStatus maps cancelled synonyms', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/mesh/helpers.js');
    return {
      cancelled: classifyStatus('cancelled'),
      cancel: classifyStatus('cancel'),
      aborted: classifyStatus('aborted'),
      skipped: classifyStatus('skipped'),
    };
  });
  expect(results.cancelled).toBe('cancelled');
  expect(results.cancel).toBe('cancelled');
  expect(results.aborted).toBe('cancelled');
  expect(results.skipped).toBe('cancelled');
});

test('classifyStatus defaults unknown values to pending', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/mesh/helpers.js');
    return {
      empty: classifyStatus(''),
      nullVal: classifyStatus(null),
      undefinedVal: classifyStatus(undefined),
      garbage: classifyStatus('xyz_unknown'),
      pending: classifyStatus('pending'),
    };
  });
  expect(results.empty).toBe('pending');
  expect(results.nullVal).toBe('pending');
  expect(results.undefinedVal).toBe('pending');
  expect(results.garbage).toBe('pending');
  expect(results.pending).toBe('pending');
});

/* ---------- statusLabel ---------- */

test('statusLabel returns human-readable label for each canonical status', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { statusLabel } = await import('/js/templates/mesh/helpers.js');
    return {
      pending: statusLabel('pending'),
      running: statusLabel('running'),
      done: statusLabel('done'),
      failed: statusLabel('failed'),
      cancelled: statusLabel('cancelled'),
      unknown: statusLabel('unknown'),
    };
  });
  expect(results.pending).toBe('Pending');
  expect(results.running).toBe('Running');
  expect(results.done).toBe('Done');
  expect(results.failed).toBe('Failed');
  expect(results.cancelled).toBe('Cancelled');
  expect(results.unknown).toBe('Pending'); // fallback
});

/* ---------- nextStatus ---------- */

test('nextStatus advances through cycle: pending→done→failed→cancelled→pending', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { nextStatus } = await import('/js/templates/mesh/helpers.js');
    return {
      fromPending: nextStatus('pending'),
      fromDone: nextStatus('done'),
      fromFailed: nextStatus('failed'),
      fromCancelled: nextStatus('cancelled'),
    };
  });
  expect(results.fromPending).toBe('done');
  expect(results.fromDone).toBe('failed');
  expect(results.fromFailed).toBe('cancelled');
  expect(results.fromCancelled).toBe('pending');
});

test('nextStatus skips running in the cycle', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { nextStatus, STATUS_CYCLE } = await import('/js/templates/mesh/helpers.js');
    return { cycleIncludesRunning: STATUS_CYCLE.includes('running') };
  });
  expect(result.cycleIncludesRunning).toBe(false);
});

/* ---------- priorityRank ---------- */

test('priorityRank returns correct numeric ranks', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { priorityRank } = await import('/js/templates/mesh/helpers.js');
    return {
      high: priorityRank('high'),
      critical: priorityRank('critical'),
      urgent: priorityRank('urgent'),
      normal: priorityRank('normal'),
      medium: priorityRank('medium'),
      low: priorityRank('low'),
      background: priorityRank('background'),
      defer: priorityRank('defer'),
      empty: priorityRank(''),
    };
  });
  expect(results.high).toBe(0);
  expect(results.critical).toBe(0);
  expect(results.urgent).toBe(0);
  expect(results.normal).toBe(1);
  expect(results.medium).toBe(1);
  expect(results.low).toBe(2);
  expect(results.background).toBe(2);
  expect(results.defer).toBe(2);
  expect(results.empty).toBe(1); // default
});

/* ---------- countByStatus ---------- */

test('countByStatus aggregates task objects by canonical status', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { countByStatus } = await import('/js/templates/mesh/helpers.js');
    const tasks = [
      { status: 'done' },
      { status: 'done' },
      { status: 'running' },
      { status: 'pending' },
      { status: 'failed' },
      { status: 'cancelled' },
    ];
    return countByStatus(tasks);
  });
  expect(result.done).toBe(2);
  expect(result.running).toBe(1);
  expect(result.pending).toBe(1);
  expect(result.failed).toBe(1);
  expect(result.cancelled).toBe(1);
});

test('countByStatus returns zeros for all statuses when tasks is empty', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { countByStatus } = await import('/js/templates/mesh/helpers.js');
    return countByStatus([]);
  });
  expect(result.done).toBe(0);
  expect(result.running).toBe(0);
  expect(result.pending).toBe(0);
  expect(result.failed).toBe(0);
  expect(result.cancelled).toBe(0);
});

/* ---------- sortByPriority ---------- */

test('sortByPriority places high-priority tasks first', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { sortByPriority } = await import('/js/templates/mesh/helpers.js');
    const tasks = [
      { priority: 'low',  status: 'pending', created: '2026-01-01' },
      { priority: 'high', status: 'pending', created: '2026-01-02' },
      { priority: 'normal', status: 'pending', created: '2026-01-03' },
    ];
    return sortByPriority(tasks).map(t => t.priority);
  });
  expect(result[0]).toBe('high');
  expect(result[1]).toBe('normal');
  expect(result[2]).toBe('low');
});

test('sortByPriority uses created time as tiebreaker', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { sortByPriority } = await import('/js/templates/mesh/helpers.js');
    const tasks = [
      { priority: 'normal', status: 'pending', created: '2026-03-26 10:03:00', id: 'B' },
      { priority: 'normal', status: 'pending', created: '2026-03-26 10:01:00', id: 'A' },
    ];
    return sortByPriority(tasks).map(t => t.id);
  });
  expect(result[0]).toBe('A');
  expect(result[1]).toBe('B');
});

test('sortByPriority does not mutate original array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { sortByPriority } = await import('/js/templates/mesh/helpers.js');
    const tasks = [
      { priority: 'low', created: '', id: 'X' },
      { priority: 'high', created: '', id: 'Y' },
    ];
    const orig = [...tasks];
    sortByPriority(tasks);
    return tasks[0].id === orig[0].id; // original unchanged
  });
  expect(result).toBe(true);
});

/* ---------- formatDuration ---------- */

test('formatDuration returns dash for missing start', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatDuration } = await import('/js/templates/mesh/helpers.js');
    return formatDuration('');
  });
  expect(result).toBe('—');
});

test('formatDuration formats milliseconds', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatDuration } = await import('/js/templates/mesh/helpers.js');
    const start = new Date(Date.now() - 500).toISOString();
    const end = new Date(Date.now()).toISOString();
    return formatDuration(start, end);
  });
  expect(result).toMatch(/ms$/);
});

test('formatDuration formats seconds', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatDuration } = await import('/js/templates/mesh/helpers.js');
    return formatDuration('2026-03-26 10:00:00', '2026-03-26 10:00:05');
  });
  expect(result).toMatch(/s$/);
});

test('formatDuration formats minutes and seconds', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatDuration } = await import('/js/templates/mesh/helpers.js');
    return formatDuration('2026-03-26 10:00:00', '2026-03-26 10:02:14');
  });
  expect(result).toMatch(/m \d+s/);
});

/* ---------- parseJSON ---------- */

test('parseJSON parses valid JSON strings', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseJSON } = await import('/js/templates/mesh/helpers.js');
    return {
      obj: parseJSON('{"key":"value"}'),
      arr: parseJSON('[1,2,3]'),
      num: parseJSON('42'),
    };
  });
  expect(results.obj).toEqual({ key: 'value' });
  expect(results.arr).toEqual([1, 2, 3]);
  expect(results.num).toBe(42);
});

test('parseJSON returns fallback for invalid/empty input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseJSON } = await import('/js/templates/mesh/helpers.js');
    return {
      empty: parseJSON('', {}),
      nullVal: parseJSON(null, []),
      bad: parseJSON('not json', null),
      undef: parseJSON(undefined, 'fallback'),
    };
  });
  expect(results.empty).toEqual({});
  expect(results.nullVal).toEqual([]);
  expect(results.bad).toBeNull();
  expect(results.undef).toBe('fallback');
});

/* ---------- formatJSON ---------- */

test('formatJSON pretty-prints objects', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatJSON } = await import('/js/templates/mesh/helpers.js');
    return formatJSON({ a: 1, b: 'two' });
  });
  expect(result).toContain('"a"');
  expect(result).toContain('"b"');
  expect(result).toContain('\n'); // pretty-printed
});

test('formatJSON returns empty string for null/undefined', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatJSON } = await import('/js/templates/mesh/helpers.js');
    return { nullVal: formatJSON(null), undefinedVal: formatJSON(undefined) };
  });
  expect(results.nullVal).toBe('');
  expect(results.undefinedVal).toBe('');
});

test('formatJSON converts primitives to string', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatJSON } = await import('/js/templates/mesh/helpers.js');
    return { num: formatJSON(42), str: formatJSON('hello') };
  });
  expect(results.num).toBe('42');
  expect(results.str).toBe('hello');
});
