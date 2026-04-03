const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---- classifyJobStatus ---- */

test('classifyJobStatus returns done for done/complete/success values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyJobStatus } = await import('/js/templates/worker.js');
    return {
      done:     classifyJobStatus('done'),
      Done:     classifyJobStatus('Done'),
      complete: classifyJobStatus('complete'),
      success:  classifyJobStatus('success'),
      ok:       classifyJobStatus('ok'),
      finished: classifyJobStatus('finished'),
    };
  });
  expect(results.done).toBe('done');
  expect(results.Done).toBe('done');
  expect(results.complete).toBe('done');
  expect(results.success).toBe('done');
  expect(results.ok).toBe('done');
  expect(results.finished).toBe('done');
});

test('classifyJobStatus returns running for in-progress values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyJobStatus } = await import('/js/templates/worker.js');
    return {
      running:     classifyJobStatus('running'),
      active:      classifyJobStatus('active'),
      inProgress:  classifyJobStatus('in progress'),
      inprogress:  classifyJobStatus('in-progress'),
      working:     classifyJobStatus('working'),
      busy:        classifyJobStatus('busy'),
    };
  });
  expect(results.running).toBe('running');
  expect(results.active).toBe('running');
  expect(results.inProgress).toBe('running');
  expect(results.inprogress).toBe('running');
  expect(results.working).toBe('running');
  expect(results.busy).toBe('running');
});

test('classifyJobStatus returns failed for error values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyJobStatus } = await import('/js/templates/worker.js');
    return {
      failed:  classifyJobStatus('failed'),
      error:   classifyJobStatus('error'),
      crash:   classifyJobStatus('crash'),
      broken:  classifyJobStatus('broken'),
      except:  classifyJobStatus('exception'),
    };
  });
  expect(results.failed).toBe('failed');
  expect(results.error).toBe('failed');
  expect(results.crash).toBe('failed');
  expect(results.broken).toBe('failed');
  expect(results.except).toBe('failed');
});

test('classifyJobStatus returns scheduled for scheduled/queued values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyJobStatus } = await import('/js/templates/worker.js');
    return {
      scheduled: classifyJobStatus('scheduled'),
      queue:     classifyJobStatus('queue'),
      queued:    classifyJobStatus('queued'),
      wait:      classifyJobStatus('wait'),
      next:      classifyJobStatus('next'),
    };
  });
  expect(results.scheduled).toBe('scheduled');
  expect(results.queue).toBe('scheduled');
  expect(results.queued).toBe('scheduled');
  expect(results.wait).toBe('scheduled');
  expect(results.next).toBe('scheduled');
});

test('classifyJobStatus returns pending for unknown/empty values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyJobStatus } = await import('/js/templates/worker.js');
    return {
      empty:      classifyJobStatus(''),
      nullVal:    classifyJobStatus(null),
      undefVal:   classifyJobStatus(undefined),
      unknown:    classifyJobStatus('whatever'),
      pending:    classifyJobStatus('pending'),
    };
  });
  expect(results.empty).toBe('pending');
  expect(results.nullVal).toBe('pending');
  expect(results.undefVal).toBe('pending');
  expect(results.unknown).toBe('pending');
  expect(results.pending).toBe('pending');
});

/* ---- jobStatusLabel ---- */

test('jobStatusLabel returns human-readable label for each status', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { jobStatusLabel } = await import('/js/templates/worker.js');
    return {
      pending:   jobStatusLabel('pending'),
      running:   jobStatusLabel('running'),
      done:      jobStatusLabel('done'),
      failed:    jobStatusLabel('failed'),
      scheduled: jobStatusLabel('scheduled'),
      unknown:   jobStatusLabel('bogus'),
    };
  });
  expect(results.pending).toBe('Pending');
  expect(results.running).toBe('Running');
  expect(results.done).toBe('Done');
  expect(results.failed).toBe('Failed');
  expect(results.scheduled).toBe('Scheduled');
  expect(results.unknown).toBe('Pending');
});

/* ---- handlerColor ---- */

test('handlerColor returns distinct colors for known handler types', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { handlerColor } = await import('/js/templates/worker.js');
    return {
      poll:    handlerColor('poll'),
      sync:    handlerColor('sync'),
      notify:  handlerColor('notify'),
      webhook: handlerColor('webhook'),
      script:  handlerColor('script'),
      cron:    handlerColor('cron'),
      unknown: handlerColor('unknown'),
    };
  });
  expect(results.poll).toBe('#0369a1');
  expect(results.sync).toBe('#16a34a');
  expect(results.notify).toBe('#7c3aed');
  expect(results.webhook).toBe('#d97706');
  expect(results.script).toBe('#db2777');
  expect(results.cron).toBe('#0d9488');
  expect(results.unknown).toBe('#64748b');
});

test('handlerColor is case-insensitive', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { handlerColor } = await import('/js/templates/worker.js');
    return {
      POLL:   handlerColor('POLL'),
      Sync:   handlerColor('Sync'),
      Notify: handlerColor('Notify'),
    };
  });
  expect(results.POLL).toBe('#0369a1');
  expect(results.Sync).toBe('#16a34a');
  expect(results.Notify).toBe('#7c3aed');
});

test('handlerColor matches prefix (poll-sheets matches poll)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { handlerColor } = await import('/js/templates/worker.js');
    return handlerColor('poll-sheets');
  });
  expect(result).toBe('#0369a1');
});

test('handlerColor returns fallback gray for null/empty', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { handlerColor } = await import('/js/templates/worker.js');
    return { empty: handlerColor(''), nullVal: handlerColor(null) };
  });
  expect(results.empty).toBe('#64748b');
  expect(results.nullVal).toBe('#64748b');
});

/* ---- formatLastRun ---- */

test('formatLastRun returns empty string for empty/null input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatLastRun } = await import('/js/templates/worker.js');
    return { empty: formatLastRun(''), nullVal: formatLastRun(null) };
  });
  expect(results.empty).toBe('');
  expect(results.nullVal).toBe('');
});

test('formatLastRun returns relative time for valid ISO date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatLastRun } = await import('/js/templates/worker.js');
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    return formatLastRun(tenMinutesAgo);
  });
  expect(result).toMatch(/^\d+m ago$/);
});

test('formatLastRun returns hours-ago for old dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatLastRun } = await import('/js/templates/worker.js');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    return formatLastRun(twoHoursAgo);
  });
  expect(result).toMatch(/^\d+h ago$/);
});

test('formatLastRun returns days-ago for very old dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatLastRun } = await import('/js/templates/worker.js');
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    return formatLastRun(threeDaysAgo);
  });
  expect(result).toMatch(/^\d+d ago$/);
});

test('formatLastRun returns raw string for invalid/unparseable dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatLastRun } = await import('/js/templates/worker.js');
    return formatLastRun('not-a-date');
  });
  expect(result).toBe('not-a-date');
});

/* ---- JOB_STATUSES constant ---- */

test('JOB_STATUSES contains all expected status values', async ({ page }) => {
  await setupApp(page);
  const statuses = await page.evaluate(async () => {
    const { JOB_STATUSES } = await import('/js/templates/worker.js');
    return JOB_STATUSES;
  });
  expect(statuses).toContain('pending');
  expect(statuses).toContain('running');
  expect(statuses).toContain('done');
  expect(statuses).toContain('failed');
  expect(statuses).toContain('scheduled');
  expect(statuses.length).toBe(5);
});
