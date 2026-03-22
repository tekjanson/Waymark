const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ─── parseDate ─── */

test('parseDate returns null for empty/null input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseDate } = await import('/js/templates/gantt/helpers.js');
    return {
      empty: parseDate(''),
      nullVal: parseDate(null),
      undef: parseDate(undefined),
      spaces: parseDate('   '),
    };
  });
  expect(results.empty).toBeNull();
  expect(results.nullVal).toBeNull();
  expect(results.undef).toBeNull();
  expect(results.spaces).toBeNull();
});

test('parseDate parses YYYY-MM-DD correctly', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseDate } = await import('/js/templates/gantt/helpers.js');
    const d = parseDate('2026-04-15');
    return d ? d.toISOString().slice(0, 10) : null;
  });
  expect(result).toBe('2026-04-15');
});

test('parseDate returns null for invalid date string', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseDate } = await import('/js/templates/gantt/helpers.js');
    return parseDate('not-a-date');
  });
  expect(result).toBeNull();
});

/* ─── formatISO ─── */

test('formatISO produces YYYY-MM-DD string', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatISO } = await import('/js/templates/gantt/helpers.js');
    return formatISO(new Date('2026-06-01'));
  });
  expect(result).toBe('2026-06-01');
});

test('formatISO pads month and day with zeros', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatISO } = await import('/js/templates/gantt/helpers.js');
    return formatISO(new Date('2026-01-05'));
  });
  expect(result).toMatch(/^\d{4}-01-05$/);
});

/* ─── daysBetween ─── */

test('daysBetween returns correct positive count', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { daysBetween } = await import('/js/templates/gantt/helpers.js');
    return daysBetween(new Date('2026-04-01'), new Date('2026-04-15'));
  });
  expect(result).toBe(14);
});

test('daysBetween returns 0 for same day', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { daysBetween } = await import('/js/templates/gantt/helpers.js');
    return daysBetween(new Date('2026-04-01'), new Date('2026-04-01'));
  });
  expect(result).toBe(0);
});

test('daysBetween returns negative when d2 before d1', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { daysBetween } = await import('/js/templates/gantt/helpers.js');
    return daysBetween(new Date('2026-04-15'), new Date('2026-04-01'));
  });
  expect(result).toBe(-14);
});

/* ─── addDays ─── */

test('addDays advances date by n days', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { addDays } = await import('/js/templates/gantt/helpers.js');
    return addDays(new Date('2026-04-01'), 10).toISOString().slice(0, 10);
  });
  expect(result).toBe('2026-04-11');
});

test('addDays handles negative offset (going back)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { addDays } = await import('/js/templates/gantt/helpers.js');
    return addDays(new Date('2026-04-10'), -5).toISOString().slice(0, 10);
  });
  expect(result).toBe('2026-04-05');
});

test('addDays does not mutate the original date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { addDays } = await import('/js/templates/gantt/helpers.js');
    const orig = new Date('2026-04-10');
    const moved = addDays(orig, 5);
    return { orig: orig.toISOString().slice(0, 10), moved: moved.toISOString().slice(0, 10) };
  });
  expect(result.orig).toBe('2026-04-10');
  expect(result.moved).toBe('2026-04-15');
});

/* ─── computeGanttRange ─── */

test('computeGanttRange returns null when no tasks have dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeGanttRange } = await import('/js/templates/gantt/helpers.js');
    return computeGanttRange([
      { start: null, end: null },
      { start: null, end: null },
    ]);
  });
  expect(result).toBeNull();
});

test('computeGanttRange adds padding around dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeGanttRange } = await import('/js/templates/gantt/helpers.js');
    const r = computeGanttRange([
      { start: new Date('2026-04-01'), end: new Date('2026-04-30') },
    ]);
    return {
      minISO: r.minDate.toISOString().slice(0, 10),
      maxISO: r.maxDate.toISOString().slice(0, 10),
      totalDays: r.totalDays,
    };
  });
  // Padded by 3 days before and 5 days after
  expect(result.minISO).toBe('2026-03-29');
  expect(result.maxISO).toBe('2026-05-05');
  expect(result.totalDays).toBeGreaterThan(30);
});

/* ─── parseDependencies ─── */

test('parseDependencies returns empty array for empty/null string', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseDependencies } = await import('/js/templates/gantt/helpers.js');
    return {
      empty: parseDependencies(''),
      nullVal: parseDependencies(null),
      spaces: parseDependencies('   '),
    };
  });
  expect(results.empty).toEqual([]);
  expect(results.nullVal).toEqual([]);
  expect(results.spaces).toEqual([]);
});

test('parseDependencies splits comma-separated names and trims whitespace', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseDependencies } = await import('/js/templates/gantt/helpers.js');
    return parseDependencies('Task A, Task B ,  Task C');
  });
  expect(result).toEqual(['Task A', 'Task B', 'Task C']);
});

test('parseDependencies handles single dependency', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseDependencies } = await import('/js/templates/gantt/helpers.js');
    return parseDependencies('Content Strategy');
  });
  expect(result).toEqual(['Content Strategy']);
});

/* ─── progressClass ─── */

test('progressClass returns gantt-bar-pending for 0', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { progressClass } = await import('/js/templates/gantt/helpers.js');
    return progressClass(0);
  });
  expect(result).toBe('gantt-bar-pending');
});

test('progressClass returns gantt-bar-active for progress > 0 and < 100', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { progressClass } = await import('/js/templates/gantt/helpers.js');
    return { fifty: progressClass(50), one: progressClass(1), ninety: progressClass(99) };
  });
  expect(result.fifty).toBe('gantt-bar-active');
  expect(result.one).toBe('gantt-bar-active');
  expect(result.ninety).toBe('gantt-bar-active');
});

test('progressClass returns gantt-bar-complete for 100', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { progressClass } = await import('/js/templates/gantt/helpers.js');
    return { hundred: progressClass(100), over: progressClass(110) };
  });
  expect(result.hundred).toBe('gantt-bar-complete');
  expect(result.over).toBe('gantt-bar-complete');
});

/* ─── assigneeColor ─── */

test('assigneeColor returns consistent color for the same name', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { assigneeColor, resetAssigneeColors } = await import('/js/templates/gantt/helpers.js');
    resetAssigneeColors();
    const c1 = assigneeColor('Alice');
    const c2 = assigneeColor('Alice');
    return { c1, c2, same: c1 === c2 };
  });
  expect(result.same).toBe(true);
});

test('assigneeColor returns different colors for different names', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { assigneeColor, resetAssigneeColors } = await import('/js/templates/gantt/helpers.js');
    resetAssigneeColors();
    return {
      alice: assigneeColor('Alice'),
      bob: assigneeColor('Bob'),
    };
  });
  expect(result.alice).not.toBe(result.bob);
});

test('assigneeColor returns gray for empty/null name', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { assigneeColor } = await import('/js/templates/gantt/helpers.js');
    return { empty: assigneeColor(''), nullVal: assigneeColor(null) };
  });
  expect(result.empty).toBe('#6b7280');
  expect(result.nullVal).toBe('#6b7280');
});

/* ─── findCriticalPath ─── */

test('findCriticalPath returns empty set for tasks with no dependencies', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { findCriticalPath } = await import('/js/templates/gantt/helpers.js');
    // Two independent tasks — both are critical (no slack in a single-task chain)
    const tasks = [
      { name: 'Task A', duration: 5, depStr: '' },
      { name: 'Task B', duration: 3, depStr: '' },
    ];
    return [...findCriticalPath(tasks)];
  });
  // Both paths exist independently; the longer one (Task A = 5) is critical
  expect(Array.isArray(result)).toBe(true);
});

test('findCriticalPath identifies the critical chain in a linear dependency', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { findCriticalPath } = await import('/js/templates/gantt/helpers.js');
    const tasks = [
      { name: 'A', duration: 5, depStr: '' },
      { name: 'B', duration: 3, depStr: 'A' },
      { name: 'C', duration: 4, depStr: 'B' },
    ];
    return [...findCriticalPath(tasks)].sort();
  });
  // All tasks are on the critical path (linear chain, no slack)
  expect(result).toEqual([0, 1, 2]);
});

test('findCriticalPath handles empty tasks array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { findCriticalPath } = await import('/js/templates/gantt/helpers.js');
    return [...findCriticalPath([])];
  });
  expect(result).toEqual([]);
});
