/**
 * Unit tests for public/js/templates/shared.js
 *
 * Tests pure utility functions: cell, parseProgress, isImageUrl,
 * parseGroups, groupByColumn, getMissingMigrations.
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ================================================================
   Section 1: cell — safe array access
   ================================================================ */

test('shared cell returns value at valid index', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { cell } = await import('/js/templates/shared.js');
    return cell(['a', 'b', 'c'], 1);
  });
  expect(result).toBe('b');
});

test('shared cell returns empty string for out-of-bounds index', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { cell } = await import('/js/templates/shared.js');
    return {
      negative: cell(['a', 'b'], -1),
      tooHigh: cell(['a', 'b'], 5),
    };
  });
  expect(results.negative).toBe('');
  expect(results.tooHigh).toBe('');
});

test('shared cell returns empty string for falsy values', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { cell } = await import('/js/templates/shared.js');
    return {
      nullVal: cell([null, 'b'], 0),
      undef: cell([undefined, 'b'], 0),
      emptyStr: cell(['', 'b'], 0),
    };
  });
  expect(results.nullVal).toBe('');
  expect(results.undef).toBe('');
  expect(results.emptyStr).toBe('');
});

/* ================================================================
   Section 2: parseProgress
   ================================================================ */

test('shared parseProgress parses percentage strings', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/shared.js');
    return {
      p75: parseProgress('75%'),
      p100: parseProgress('100%'),
      p0: parseProgress('0%'),
      pDecimal: parseProgress('33.3%'),
    };
  });
  expect(results.p75).toBe(75);
  expect(results.p100).toBe(100);
  expect(results.p0).toBe(0);
  expect(results.pDecimal).toBeCloseTo(33.3);
});

test('shared parseProgress parses fraction strings', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/shared.js');
    return {
      threeOfFive: parseProgress('3/5'),
      oneOfTwo: parseProgress('1/2'),
      zeroOfTen: parseProgress('0/10'),
    };
  });
  expect(results.threeOfFive).toBe(60);
  expect(results.oneOfTwo).toBe(50);
  expect(results.zeroOfTen).toBe(0);
});

test('shared parseProgress uses rawTarget for plain numbers', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/shared.js');
    return {
      withTarget: parseProgress('3', '5'),
      noTarget: parseProgress('50'),
    };
  });
  expect(results.withTarget).toBe(60);
  expect(results.noTarget).toBe(50);
});

test('shared parseProgress returns 0 for empty/invalid', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseProgress } = await import('/js/templates/shared.js');
    return {
      empty: parseProgress(''),
      nullVal: parseProgress(null),
      text: parseProgress('hello'),
      divByZero: parseProgress('5/0'),
    };
  });
  expect(results.empty).toBe(0);
  expect(results.nullVal).toBe(0);
  expect(results.text).toBe(0);
  expect(results.divByZero).toBe(0);
});

/* ================================================================
   Section 3: isImageUrl
   ================================================================ */

test('shared isImageUrl detects image URLs', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { isImageUrl } = await import('/js/templates/shared.js');
    return {
      jpg: isImageUrl('https://example.com/photo.jpg'),
      jpeg: isImageUrl('https://example.com/photo.jpeg'),
      png: isImageUrl('https://example.com/photo.png'),
      gif: isImageUrl('https://example.com/photo.gif'),
      webp: isImageUrl('https://example.com/photo.webp'),
      svg: isImageUrl('https://example.com/photo.svg'),
      avif: isImageUrl('https://example.com/photo.avif'),
      bmp: isImageUrl('https://example.com/photo.bmp'),
      withQuery: isImageUrl('https://example.com/photo.png?w=400'),
    };
  });
  for (const [key, val] of Object.entries(results)) {
    expect(val, `isImageUrl for ${key}`).toBe(true);
  }
});

test('shared isImageUrl detects Google CDN URLs', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { isImageUrl } = await import('/js/templates/shared.js');
    return {
      googleusercontent: isImageUrl('https://lh3.googleusercontent.com/abc123'),
      drive: isImageUrl('https://drive.google.com/uc?id=123'),
      ggpht: isImageUrl('https://photos.ggpht.com/abc'),
    };
  });
  expect(results.googleusercontent).toBe(true);
  expect(results.drive).toBe(true);
  expect(results.ggpht).toBe(true);
});

test('shared isImageUrl returns false for non-image URLs and invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { isImageUrl } = await import('/js/templates/shared.js');
    return {
      html: isImageUrl('https://example.com/page.html'),
      pdf: isImageUrl('https://example.com/doc.pdf'),
      plainText: isImageUrl('just text'),
      empty: isImageUrl(''),
      nullVal: isImageUrl(null),
      undef: isImageUrl(undefined),
      number: isImageUrl(42),
    };
  });
  for (const [key, val] of Object.entries(results)) {
    expect(val, `isImageUrl for ${key}`).toBe(false);
  }
});

/* ================================================================
   Section 4: parseGroups — contiguous row grouping
   ================================================================ */

test('shared parseGroups groups rows by primary column', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseGroups } = await import('/js/templates/shared.js');
    const rows = [
      ['Group A', 'item 1'],
      ['',        'sub 1'],
      ['',        'sub 2'],
      ['Group B', 'item 2'],
      ['',        'sub 3'],
    ];
    const groups = parseGroups(rows, 0);
    return groups.map(g => ({
      primary: g.row[0],
      idx: g.idx,
      childCount: g.children.length,
    }));
  });
  expect(result).toHaveLength(2);
  expect(result[0].primary).toBe('Group A');
  expect(result[0].idx).toBe(0);
  expect(result[0].childCount).toBe(2);
  expect(result[1].primary).toBe('Group B');
  expect(result[1].idx).toBe(3);
  expect(result[1].childCount).toBe(1);
});

test('shared parseGroups skips orphan rows before first group', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseGroups } = await import('/js/templates/shared.js');
    const rows = [
      ['', 'orphan'],
      ['Group A', 'item'],
    ];
    return parseGroups(rows, 0).length;
  });
  expect(result).toBe(1); // orphan row is dropped
});

test('shared parseGroups returns empty for no data', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseGroups } = await import('/js/templates/shared.js');
    return parseGroups([], 0).length;
  });
  expect(result).toBe(0);
});

/* ================================================================
   Section 5: groupByColumn — value-based grouping
   ================================================================ */

test('shared groupByColumn groups by column value', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { groupByColumn } = await import('/js/templates/shared.js');
    const rows = [
      ['cat', 'whiskers'],
      ['dog', 'rex'],
      ['cat', 'mittens'],
      ['', 'unnamed'],
    ];
    const groups = groupByColumn(rows, 0, 'Unknown');
    const obj = {};
    for (const [k, v] of groups) obj[k] = v.length;
    return obj;
  });
  expect(result).toEqual({ cat: 2, dog: 1, Unknown: 1 });
});

test('shared groupByColumn uses fallback for missing column', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { groupByColumn } = await import('/js/templates/shared.js');
    const rows = [['a'], ['b']];
    const groups = groupByColumn(rows, -1, 'All');
    const obj = {};
    for (const [k, v] of groups) obj[k] = v.length;
    return obj;
  });
  expect(result).toEqual({ All: 2 });
});

/* ================================================================
   Section 6: getMissingMigrations
   ================================================================ */

test('shared getMissingMigrations returns missing migrations', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getMissingMigrations } = await import('/js/templates/shared.js');
    const template = {
      migrations: [
        { role: 'notes', header: 'Notes' },
        { role: 'status', header: 'Status' },
        { role: 'priority', header: 'Priority' },
      ],
    };
    const cols = { notes: 3, status: -1, priority: -1 };
    return getMissingMigrations(template, cols);
  });
  expect(result).toHaveLength(2);
  expect(result[0].role).toBe('status');
  expect(result[1].role).toBe('priority');
});

test('shared getMissingMigrations returns empty when no migrations', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { getMissingMigrations } = await import('/js/templates/shared.js');
    return {
      noField: getMissingMigrations({}, {}).length,
      nullMigrations: getMissingMigrations({ migrations: null }, {}).length,
      emptyArray: getMissingMigrations({ migrations: [] }, {}).length,
    };
  });
  expect(results.noField).toBe(0);
  expect(results.nullMigrations).toBe(0);
  expect(results.emptyArray).toBe(0);
});
