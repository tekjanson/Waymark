const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- classifyStatus ---------- */

test('classifyStatus: published variants', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/knowledge/helpers.js');
    return {
      published: classifyStatus('Published'),
      live: classifyStatus('Live'),
      active: classifyStatus('active'),
      final: classifyStatus('Final'),
      approved: classifyStatus('approved'),
    };
  });
  expect(results.published).toBe('published');
  expect(results.live).toBe('published');
  expect(results.active).toBe('published');
  expect(results.final).toBe('published');
  expect(results.approved).toBe('published');
});

test('classifyStatus: draft is default', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/knowledge/helpers.js');
    return {
      draft: classifyStatus('Draft'),
      empty: classifyStatus(''),
      undef: classifyStatus(undefined),
      nul: classifyStatus(null),
      random: classifyStatus('something random'),
    };
  });
  expect(results.draft).toBe('draft');
  expect(results.empty).toBe('draft');
  expect(results.undef).toBe('draft');
  expect(results.nul).toBe('draft');
  expect(results.random).toBe('draft');
});

test('classifyStatus: review variants', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/knowledge/helpers.js');
    return {
      review: classifyStatus('Review'),
      pending: classifyStatus('Pending'),
      inReview: classifyStatus('In Review'),
    };
  });
  expect(results.review).toBe('review');
  expect(results.pending).toBe('review');
  expect(results.inReview).toBe('review');
});

test('classifyStatus: archived variants', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/knowledge/helpers.js');
    return {
      archived: classifyStatus('Archived'),
      deprecated: classifyStatus('Deprecated'),
      obsolete: classifyStatus('obsolete'),
      retired: classifyStatus('retired'),
    };
  });
  expect(results.archived).toBe('archived');
  expect(results.deprecated).toBe('archived');
  expect(results.obsolete).toBe('archived');
  expect(results.retired).toBe('archived');
});

test('classifyStatus: case insensitive', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { classifyStatus } = await import('/js/templates/knowledge/helpers.js');
    return {
      upper: classifyStatus('PUBLISHED'),
      lower: classifyStatus('published'),
      mixed: classifyStatus('Published'),
    };
  });
  expect(results.upper).toBe('published');
  expect(results.lower).toBe('published');
  expect(results.mixed).toBe('published');
});

/* ---------- parseTags ---------- */

test('parseTags: splits comma-separated tags', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseTags } = await import('/js/templates/knowledge/helpers.js');
    return parseTags('git, branching, workflow');
  });
  expect(result).toEqual(['git', 'branching', 'workflow']);
});

test('parseTags: splits semicolon-separated tags', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseTags } = await import('/js/templates/knowledge/helpers.js');
    return parseTags('css; design; tokens');
  });
  expect(result).toEqual(['css', 'design', 'tokens']);
});

test('parseTags: handles empty/null/undefined', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseTags } = await import('/js/templates/knowledge/helpers.js');
    return {
      empty: parseTags(''),
      nul: parseTags(null),
      undef: parseTags(undefined),
      spaces: parseTags('  ,  ,  '),
    };
  });
  expect(results.empty).toEqual([]);
  expect(results.nul).toEqual([]);
  expect(results.undef).toEqual([]);
  expect(results.spaces).toEqual([]);
});

test('parseTags: trims whitespace from tags', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseTags } = await import('/js/templates/knowledge/helpers.js');
    return parseTags('  tag1  ,  tag2  ,  tag3  ');
  });
  expect(result).toEqual(['tag1', 'tag2', 'tag3']);
});

/* ---------- collectTags ---------- */

test('collectTags: collects unique sorted tags from groups', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { collectTags } = await import('/js/templates/knowledge/helpers.js');
    const groups = [
      { row: ['', '', '', 'git, branching'] },
      { row: ['', '', '', 'css, git'] },
      { row: ['', '', '', 'api'] },
    ];
    return collectTags(groups, 3);
  });
  expect(result).toEqual(['api', 'branching', 'css', 'git']);
});

test('collectTags: returns empty for invalid index', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { collectTags } = await import('/js/templates/knowledge/helpers.js');
    return collectTags([{ row: ['test'] }], -1);
  });
  expect(result).toEqual([]);
});

/* ---------- collectCategories ---------- */

test('collectCategories: collects unique sorted categories', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { collectCategories } = await import('/js/templates/knowledge/helpers.js');
    const groups = [
      { row: ['', 'DevOps'] },
      { row: ['', 'Frontend'] },
      { row: ['', 'DevOps'] },
      { row: ['', 'Backend'] },
    ];
    return collectCategories(groups, 1);
  });
  expect(result).toEqual(['Backend', 'DevOps', 'Frontend']);
});

test('collectCategories: skips empty categories', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { collectCategories } = await import('/js/templates/knowledge/helpers.js');
    const groups = [
      { row: ['', ''] },
      { row: ['', 'DevOps'] },
      { row: ['', '  '] },
    ];
    return collectCategories(groups, 1);
  });
  expect(result).toEqual(['DevOps']);
});

/* ---------- buildSnippet ---------- */

test('buildSnippet: joins content into snippet', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildSnippet } = await import('/js/templates/knowledge/helpers.js');
    const children = [
      { row: ['', '', 'First line'] },
      { row: ['', '', 'Second line'] },
    ];
    return buildSnippet(children, 2);
  });
  expect(result).toBe('First line Second line');
});

test('buildSnippet: truncates long content', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildSnippet } = await import('/js/templates/knowledge/helpers.js');
    const children = [
      { row: ['', '', 'A'.repeat(200)] },
    ];
    return buildSnippet(children, 2, 50);
  });
  expect(result.length).toBeLessThanOrEqual(55);
  expect(result).toMatch(/…$/);
});

test('buildSnippet: returns empty for invalid index', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildSnippet } = await import('/js/templates/knowledge/helpers.js');
    return buildSnippet([{ row: ['test'] }], -1);
  });
  expect(result).toBe('');
});

test('buildSnippet: returns empty for no children', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildSnippet } = await import('/js/templates/knowledge/helpers.js');
    return buildSnippet([], 0);
  });
  expect(result).toBe('');
});

/* ---------- formatDate ---------- */

test('formatDate: formats ISO date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatDate } = await import('/js/templates/knowledge/helpers.js');
    return formatDate('2026-02-15');
  });
  expect(result).toMatch(/Feb/);
  expect(result).toMatch(/2026/);
});

test('formatDate: returns empty for empty/null input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatDate } = await import('/js/templates/knowledge/helpers.js');
    return {
      empty: formatDate(''),
      nul: formatDate(null),
      undef: formatDate(undefined),
    };
  });
  expect(results.empty).toBe('');
  expect(results.nul).toBe('');
  expect(results.undef).toBe('');
});

test('formatDate: returns raw string for invalid date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatDate } = await import('/js/templates/knowledge/helpers.js');
    return formatDate('not-a-date');
  });
  expect(result).toBe('not-a-date');
});

/* ---------- STATUS_COLORS / STATUS_LABELS constants ---------- */

test('STATUS_COLORS has entries for all status keys', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { STATUS_COLORS } = await import('/js/templates/knowledge/helpers.js');
    return Object.keys(STATUS_COLORS).sort();
  });
  expect(result).toEqual(['archived', 'draft', 'published', 'review']);
});

test('STATUS_LABELS has entries for all status keys', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { STATUS_LABELS } = await import('/js/templates/knowledge/helpers.js');
    return Object.keys(STATUS_LABELS).sort();
  });
  expect(result).toEqual(['archived', 'draft', 'published', 'review']);
});

/* ---------- nowTimestamp ---------- */

test('nowTimestamp returns YYYY-MM-DD HH:mm format', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { nowTimestamp } = await import('/js/templates/knowledge/helpers.js');
    return nowTimestamp();
  });
  expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('nowTimestamp returns current date (within 5 seconds)', async ({ page }) => {
  await setupApp(page);
  const beforeMs = Date.now();
  const result = await page.evaluate(async () => {
    const { nowTimestamp } = await import('/js/templates/knowledge/helpers.js');
    return nowTimestamp();
  });
  const afterMs = Date.now();
  const parsed = new Date(result.replace(' ', 'T') + ':00').getTime();
  // Allow up to 1 minute difference (timestamp precision is minutes)
  expect(Math.abs(parsed - beforeMs)).toBeLessThan(60 * 1000 + 5000);
  expect(parsed).toBeLessThanOrEqual(afterMs + 60 * 1000);
});

/* ---------- REACTION_EMOJIS ---------- */

test('REACTION_EMOJIS contains exactly the 4 expected emojis', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { REACTION_EMOJIS } = await import('/js/templates/knowledge/helpers.js');
    return REACTION_EMOJIS;
  });
  expect(result).toHaveLength(4);
  expect(result).toContain('👍');
  expect(result).toContain('❤️');
  expect(result).toContain('💡');
  expect(result).toContain('✅');
});

test('REACTION_EMOJIS is an array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { REACTION_EMOJIS } = await import('/js/templates/knowledge/helpers.js');
    return Array.isArray(REACTION_EMOJIS);
  });
  expect(result).toBe(true);
});
