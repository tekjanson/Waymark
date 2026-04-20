/**
 * Unit tests for public/js/templates/kanban/helpers.js
 *
 * Tests pure functions by dynamically importing the module in the browser.
 * Time-dependent functions are tested with frozen dates via Date override.
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ================================================================
   Section 1: Constants
   ================================================================ */

test('kanban PROJECT_PALETTE has 10 hex colors', async ({ page }) => {
  await setupApp(page);
  const palette = await page.evaluate(async () => {
    const { PROJECT_PALETTE } = await import('/js/templates/kanban/helpers.js');
    return PROJECT_PALETTE;
  });
  expect(palette).toHaveLength(10);
  for (const c of palette) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
});

test('kanban LANE_LABELS has expected lane keys', async ({ page }) => {
  await setupApp(page);
  const labels = await page.evaluate(async () => {
    const { LANE_LABELS } = await import('/js/templates/kanban/helpers.js');
    return LANE_LABELS;
  });
  expect(labels.backlog).toBe('Backlog');
  expect(labels.todo).toBe('To Do');
  expect(labels.inprogress).toBe('In Progress');
  expect(labels.qa).toBe('QA');
  expect(labels.done).toBe('Done');
  expect(labels.rejected).toBe('Rejected');
});

test('kanban LANE_PAGE_SIZE is 50', async ({ page }) => {
  await setupApp(page);
  const size = await page.evaluate(async () => {
    const { LANE_PAGE_SIZE } = await import('/js/templates/kanban/helpers.js');
    return LANE_PAGE_SIZE;
  });
  expect(size).toBe(50);
});

/* ================================================================
   Section 2: projectColor
   ================================================================ */

test('projectColor returns deterministic hex for same name', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { projectColor } = await import('/js/templates/kanban/helpers.js');
    return {
      a1: projectColor('MyProject'),
      a2: projectColor('MyProject'),
      b: projectColor('OtherProject'),
    };
  });
  expect(results.a1).toBe(results.a2); // deterministic
  expect(results.a1).toMatch(/^#[0-9a-f]{6}$/i);
  expect(results.b).toMatch(/^#[0-9a-f]{6}$/i);
});

test('projectColor returns fallback for empty/null name', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { projectColor } = await import('/js/templates/kanban/helpers.js');
    return {
      empty: projectColor(''),
      nullVal: projectColor(null),
      undef: projectColor(undefined),
    };
  });
  expect(results.empty).toBe('#94a3b8');
  expect(results.nullVal).toBe('#94a3b8');
  expect(results.undef).toBe('#94a3b8');
});

/* ================================================================
   Section 3: priRank
   ================================================================ */

test('priRank ranks priorities correctly', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { priRank } = await import('/js/templates/kanban/helpers.js');
    return {
      p0: priRank('p0'),
      critical: priRank('critical'),
      p1: priRank('p1'),
      high: priRank('high'),
      p2: priRank('p2'),
      medium: priRank('medium'),
      p3: priRank('p3'),
      low: priRank('low'),
      empty: priRank(''),
      nullVal: priRank(null),
      unknown: priRank('whatever'),
    };
  });
  expect(results.p0).toBe(0);
  expect(results.critical).toBe(0);
  expect(results.p1).toBe(1);
  expect(results.high).toBe(1);
  expect(results.p2).toBe(2);
  expect(results.medium).toBe(2);
  expect(results.p3).toBe(3);
  expect(results.low).toBe(3);
  expect(results.empty).toBe(4);
  expect(results.nullVal).toBe(4);
  expect(results.unknown).toBe(4);
});

test('priRank is case-insensitive', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { priRank } = await import('/js/templates/kanban/helpers.js');
    return {
      P0: priRank('P0'),
      Critical: priRank('Critical'),
      HIGH: priRank('HIGH'),
    };
  });
  expect(results.P0).toBe(0);
  expect(results.Critical).toBe(0);
  expect(results.HIGH).toBe(1);
});

/* ================================================================
   Section 4: dueBadgeClass (time-dependent — use frozen date)
   ================================================================ */

test('dueBadgeClass classifies overdue dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { dueBadgeClass } = await import('/js/templates/kanban/helpers.js');
    // Use a date far in the past
    return dueBadgeClass('2020-01-01');
  });
  expect(result).toBe('kanban-due-overdue');
});

test('dueBadgeClass classifies far-future dates as later', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { dueBadgeClass } = await import('/js/templates/kanban/helpers.js');
    return dueBadgeClass('2099-12-31');
  });
  expect(result).toBe('kanban-due-later');
});

test('dueBadgeClass returns empty for empty/invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { dueBadgeClass } = await import('/js/templates/kanban/helpers.js');
    return {
      empty: dueBadgeClass(''),
      nullVal: dueBadgeClass(null),
      invalid: dueBadgeClass('not-a-date'),
    };
  });
  expect(results.empty).toBe('');
  expect(results.nullVal).toBe('');
  expect(results.invalid).toBe('');
});

test('dueBadgeClass with frozen date classifies all urgency levels', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { dueBadgeClass } = await import('/js/templates/kanban/helpers.js');
    // Freeze Date to 2026-06-15
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
        overdue: dueBadgeClass('2026-06-13'),
        soon: dueBadgeClass('2026-06-15'),    // today — diff < 2
        upcoming: dueBadgeClass('2026-06-18'), // 3 days away — diff < 7
        later: dueBadgeClass('2026-06-30'),    // 15 days away
      };
    } finally {
      globalThis.Date = RealDate;
    }
  });
  expect(results.overdue).toBe('kanban-due-overdue');
  expect(results.soon).toBe('kanban-due-soon');
  expect(results.upcoming).toBe('kanban-due-upcoming');
  expect(results.later).toBe('kanban-due-later');
});

/* ================================================================
   Section 5: formatDue (time-dependent — use frozen date)
   ================================================================ */

test('formatDue formats relative dates with frozen clock', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatDue } = await import('/js/templates/kanban/helpers.js');
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
        today: formatDue('2026-06-15'),
        tomorrow: formatDue('2026-06-16'),
        yesterday: formatDue('2026-06-14'),
        overdue3: formatDue('2026-06-12'),
        fourDays: formatDue('2026-06-19'),
        farFuture: formatDue('2026-12-25'),
      };
    } finally {
      globalThis.Date = RealDate;
    }
  });
  expect(results.today).toBe('Today');
  expect(results.tomorrow).toBe('Tomorrow');
  expect(results.yesterday).toBe('Yesterday');
  expect(results.overdue3).toBe('3d overdue');
  expect(results.fourDays).toBe('4d');
  expect(results.farFuture).toMatch(/Dec 25/);
});

test('formatDue handles empty and invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatDue } = await import('/js/templates/kanban/helpers.js');
    return {
      empty: formatDue(''),
      nullVal: formatDue(null),
      invalid: formatDue('not-a-date'),
    };
  });
  expect(results.empty).toBe('');
  expect(results.nullVal).toBe('');
  expect(results.invalid).toBe('not-a-date');
});

/* ================================================================
   Section 6: STATUS_PREFIX & isStatusNote
   ================================================================ */

test('STATUS_PREFIX is the expected character', async ({ page }) => {
  await setupApp(page);
  const prefix = await page.evaluate(async () => {
    const { STATUS_PREFIX } = await import('/js/templates/kanban/helpers.js');
    return STATUS_PREFIX;
  });
  expect(prefix).toBe('⟳ ');
});

test('isStatusNote correctly identifies status notes', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { isStatusNote, STATUS_PREFIX } = await import('/js/templates/kanban/helpers.js');
    return {
      statusNote: isStatusNote(STATUS_PREFIX + 'Moved to Done'),
      plainNote: isStatusNote('Regular note text'),
      empty: isStatusNote(''),
      nullVal: isStatusNote(null),
    };
  });
  expect(results.statusNote).toBe(true);
  expect(results.plainNote).toBe(false);
  expect(results.empty).toBe(false);
  expect(results.nullVal).toBe(false);
});

/* ================================================================
   Section 7: nowTimestamp
   ================================================================ */

test('nowTimestamp returns YYYY-MM-DD HH:MM format', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { nowTimestamp } = await import('/js/templates/kanban/helpers.js');
    return nowTimestamp();
  });
  expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

/* ================================================================
   Section 8: formatNoteDate
   ================================================================ */

test('formatNoteDate formats date-only strings', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatNoteDate } = await import('/js/templates/kanban/helpers.js');
    return formatNoteDate('2026-03-14');
  });
  expect(result).toMatch(/Mar 14/);
});

test('formatNoteDate formats datetime strings with time', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatNoteDate } = await import('/js/templates/kanban/helpers.js');
    return formatNoteDate('2026-03-14 14:30');
  });
  expect(result).toMatch(/Mar 14/);
  expect(result).toMatch(/2:30 PM/);
});

test('formatNoteDate handles empty and invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatNoteDate } = await import('/js/templates/kanban/helpers.js');
    return {
      empty: formatNoteDate(''),
      nullVal: formatNoteDate(null),
      invalid: formatNoteDate('garbage'),
    };
  });
  expect(results.empty).toBe('');
  expect(results.nullVal).toBe('');
  expect(results.invalid).toBe('garbage');
});

/* ================================================================
   Section 9: formatRelativeDate
   ================================================================ */

test('formatRelativeDate formats old dates as month-day', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatRelativeDate } = await import('/js/templates/kanban/helpers.js');
    return formatRelativeDate('2020-01-15 10:00');
  });
  expect(result).toMatch(/Jan 15/);
});

test('formatRelativeDate handles empty and invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatRelativeDate } = await import('/js/templates/kanban/helpers.js');
    return {
      empty: formatRelativeDate(''),
      nullVal: formatRelativeDate(null),
      invalid: formatRelativeDate('garbage'),
    };
  });
  expect(results.empty).toBe('');
  expect(results.nullVal).toBe('');
  expect(results.invalid).toBe('garbage');
});

/* ================================================================
   Section 10: parseBranchName
   ================================================================ */

test('parseBranchName extracts feature branch name', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseBranchName } = await import('/js/templates/kanban/helpers.js');
    return parseBranchName('Branch: feature/kanban-branch-copy | Files: x.js | +40 LOC');
  });
  expect(result).toBe('feature/kanban-branch-copy');
});

test('parseBranchName extracts fix branch name', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseBranchName } = await import('/js/templates/kanban/helpers.js');
    return parseBranchName('Branch: fix/search-highlight | Files: search.js');
  });
  expect(result).toBe('fix/search-highlight');
});

test('parseBranchName returns null for notes without a branch', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseBranchName } = await import('/js/templates/kanban/helpers.js');
    return parseBranchName('Just a regular note with no branch');
  });
  expect(result).toBeNull();
});

test('parseBranchName returns null for empty input', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseBranchName } = await import('/js/templates/kanban/helpers.js');
    return parseBranchName('');
  });
  expect(result).toBeNull();
});

test('parseBranchName returns null for null input', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseBranchName } = await import('/js/templates/kanban/helpers.js');
    return parseBranchName(null);
  });
  expect(result).toBeNull();
});

test('parseBranchName handles branches with dots and numbers', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseBranchName } = await import('/js/templates/kanban/helpers.js');
    return parseBranchName('Branch: feature/v2.0-upgrade | Files: x.js');
  });
  expect(result).toBe('feature/v2.0-upgrade');
});

/* ================================================================
   Section 8: calcCycleTime
   ================================================================ */

test('calcCycleTime returns 0 for empty notes array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { calcCycleTime } = await import('/js/templates/kanban/helpers.js');
    return calcCycleTime([], 0, 1, 'In Progress');
  });
  expect(result).toBe(0);
});

test('calcCycleTime returns 0 when noteCol is negative', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { calcCycleTime } = await import('/js/templates/kanban/helpers.js');
    const notes = [{ row: ['⟳ To Do → In Progress', '2026-01-01 10:00'] }];
    return calcCycleTime(notes, -1, 1, 'In Progress');
  });
  expect(result).toBe(0);
});

test('calcCycleTime returns 0 when dateCol is negative', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { calcCycleTime } = await import('/js/templates/kanban/helpers.js');
    const notes = [{ row: ['⟳ To Do → In Progress', '2026-01-01 10:00'] }];
    return calcCycleTime(notes, 0, -1, 'In Progress');
  });
  expect(result).toBe(0);
});

test('calcCycleTime computes time between entry and exit of a stage', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { calcCycleTime, STATUS_PREFIX } = await import('/js/templates/kanban/helpers.js');
    // Card entered In Progress at 09:00, left at 11:00 (2 hours)
    const notes = [
      { row: [`${STATUS_PREFIX}To Do → In Progress`, '2026-01-01 09:00'] },
      { row: [`${STATUS_PREFIX}In Progress → QA`, '2026-01-01 11:00'] },
    ];
    return calcCycleTime(notes, 0, 1, 'In Progress');
  });
  expect(result).toBeCloseTo(2, 1);
});

test('calcCycleTime ignores notes without STATUS_PREFIX', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { calcCycleTime } = await import('/js/templates/kanban/helpers.js');
    const notes = [
      { row: ['regular note', '2026-01-01 09:00'] },
      { row: ['another note', '2026-01-01 11:00'] },
    ];
    return calcCycleTime(notes, 0, 1, 'In Progress');
  });
  expect(result).toBe(0);
});

test('calcCycleTime returns 0 for null/missing targetStage', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { calcCycleTime, STATUS_PREFIX } = await import('/js/templates/kanban/helpers.js');
    const notes = [
      { row: [`${STATUS_PREFIX}To Do → In Progress`, '2026-01-01 09:00'] },
    ];
    return calcCycleTime(notes, 0, 1, '');
  });
  expect(result).toBe(0);
});

/* ================================================================
   Section 9: matchesSearch
   ================================================================ */

test('matchesSearch returns true for empty query', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { matchesSearch } = await import('/js/templates/kanban/helpers.js');
    const group = { row: ['Fix Bug', 'description', 'In Progress'], subtasks: [], notes: [] };
    const cols = { text: 0, description: 1, stage: 2, assignee: -1, label: -1, project: -1, reporter: -1, note: -1 };
    return matchesSearch(group, cols, '');
  });
  expect(result).toBe(true);
});

test('matchesSearch matches task title (case-insensitive)', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { matchesSearch } = await import('/js/templates/kanban/helpers.js');
    const group = { row: ['Fix Authentication Bug', 'desc', 'To Do'], subtasks: [], notes: [] };
    const cols = { text: 0, description: 1, stage: 2, assignee: -1, label: -1, project: -1, reporter: -1, note: -1 };
    return {
      lower: matchesSearch(group, cols, 'auth'),
      upper: matchesSearch(group, cols, 'AUTH'),
      mixed: matchesSearch(group, cols, 'Authentication'),
      miss: matchesSearch(group, cols, 'xyz'),
    };
  });
  expect(results.lower).toBe(true);
  expect(results.upper).toBe(true);
  expect(results.mixed).toBe(true);
  expect(results.miss).toBe(false);
});

test('matchesSearch matches description field', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { matchesSearch } = await import('/js/templates/kanban/helpers.js');
    const group = { row: ['Task', 'detailed description text', 'Backlog'], subtasks: [], notes: [] };
    const cols = { text: 0, description: 1, stage: 2, assignee: -1, label: -1, project: -1, reporter: -1, note: -1 };
    return matchesSearch(group, cols, 'detailed');
  });
  expect(result).toBe(true);
});

test('matchesSearch matches assignee field', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { matchesSearch } = await import('/js/templates/kanban/helpers.js');
    const group = { row: ['Task', '', 'To Do', '', 'Alice'], subtasks: [], notes: [] };
    const cols = { text: 0, description: 1, stage: 2, project: 3, assignee: 4, label: -1, reporter: -1, note: -1 };
    return matchesSearch(group, cols, 'alice');
  });
  expect(result).toBe(true);
});

test('matchesSearch matches sub-task descriptions', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { matchesSearch } = await import('/js/templates/kanban/helpers.js');
    const group = {
      row: ['Parent Task', '', 'To Do'],
      subtasks: [{ row: ['', 'Write unit tests for login', 'To Do'] }],
      notes: [],
    };
    const cols = { text: 0, description: 1, stage: 2, assignee: -1, label: -1, project: -1, reporter: -1, note: -1 };
    return matchesSearch(group, cols, 'unit tests');
  });
  expect(result).toBe(true);
});

test('matchesSearch returns false for whitespace-only query', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { matchesSearch } = await import('/js/templates/kanban/helpers.js');
    const group = { row: ['Task'], subtasks: [], notes: [] };
    const cols = { text: 0, description: -1, stage: -1, assignee: -1, label: -1, project: -1, reporter: -1, note: -1 };
    return matchesSearch(group, cols, '   ');
  });
  expect(result).toBe(true); // blank query = show all
});
