/**
 * Unit tests for google-apps-script/lib/waymark-format.js
 *
 * Because GAS files use global function scope (no ES module exports),
 * the pure functions are exercised inline via page.evaluate().
 * Each test block mirrors the implementation exactly — changes to
 * waymark-format.js must be reflected here.
 *
 * Functions covered:
 *   cellValue          — safe indexed cell access
 *   parseGroups        — row-per-item group parsing
 *   mapColumnRoles     — header-to-index role mapping
 *   buildContinuationRow  — continuation row builder
 *   buildGroupHeaderRow   — group header row builder
 *   flattenGroups      — grouped data back to 2D array
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ============================================================
   Shared: inject pure GAS helpers into the page for testing.
   These mirror google-apps-script/lib/waymark-format.js exactly.
   ============================================================ */

async function injectGasHelpers(page) {
  await page.evaluate(() => {
    window.__gasHelpers = {
      cellValue(row, idx) {
        if (idx < 0 || idx >= row.length) return '';
        const v = row[idx];
        return v == null ? '' : String(v).trim();
      },

      parseGroups(rows, primaryColIdx) {
        const groups = [];
        let current = null;
        for (const row of rows) {
          const key = window.__gasHelpers.cellValue(row, primaryColIdx);
          if (key) {
            current = { key, rows: [row] };
            groups.push(current);
          } else if (current) {
            current.rows.push(row);
          }
        }
        return groups;
      },

      mapColumnRoles(headers, rolePatterns) {
        const lower = headers.map(h => (h || '').toLowerCase().trim());
        const result = {};
        const taken = {};
        for (const [role, pattern] of Object.entries(rolePatterns)) {
          let idx = -1;
          for (let j = 0; j < lower.length; j++) {
            if (!taken[j] && pattern.test(lower[j])) { idx = j; break; }
          }
          result[role] = idx;
          if (idx >= 0) taken[idx] = true;
        }
        return result;
      },

      buildContinuationRow(totalCols, colValues) {
        const row = new Array(totalCols).fill('');
        for (const [idx, val] of Object.entries(colValues)) row[Number(idx)] = val;
        return row;
      },

      buildGroupHeaderRow(primaryValue, primaryColIdx, totalCols, colValues) {
        const row = new Array(totalCols).fill('');
        row[primaryColIdx] = primaryValue;
        const extra = colValues || {};
        for (const [idx, val] of Object.entries(extra)) row[Number(idx)] = val;
        return row;
      },

      flattenGroups(groups, primaryColIdx) {
        const output = [];
        for (const group of groups) {
          group.rows.forEach((r, i) => {
            const row = r.slice();
            row[primaryColIdx] = i === 0 ? group.key : '';
            output.push(row);
          });
        }
        return output;
      },
    };
  });
}

/* ================================================================
   Section 1: cellValue — safe indexed cell access
   ================================================================ */

test('gas cellValue returns trimmed string at valid index', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => window.__gasHelpers.cellValue(['  hello  ', 'world'], 0));
  expect(result).toBe('hello');
});

test('gas cellValue returns empty string for negative index', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => window.__gasHelpers.cellValue(['a', 'b'], -1));
  expect(result).toBe('');
});

test('gas cellValue returns empty string for out-of-bounds index', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => window.__gasHelpers.cellValue(['a', 'b'], 10));
  expect(result).toBe('');
});

test('gas cellValue returns empty string for null cell value', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => window.__gasHelpers.cellValue([null, 'b'], 0));
  expect(result).toBe('');
});

test('gas cellValue returns empty string for undefined cell value', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => window.__gasHelpers.cellValue([undefined, 'b'], 0));
  expect(result).toBe('');
});

/* ================================================================
   Section 2: parseGroups — row-per-item group parsing
   ================================================================ */

test('gas parseGroups creates one group per non-empty primary cell', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    const rows = [
      ['Recipe A', '4', 'egg'],
      ['', '', 'flour'],
      ['Recipe B', '2', 'butter'],
    ];
    return window.__gasHelpers.parseGroups(rows, 0);
  });
  expect(result).toHaveLength(2);
  expect(result[0].key).toBe('Recipe A');
  expect(result[1].key).toBe('Recipe B');
});

test('gas parseGroups assigns continuation rows to the preceding group', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    const rows = [
      ['Task A', 'open', 'step 1'],
      ['',       '',     'step 2'],
      ['',       '',     'step 3'],
      ['Task B', 'done', 'step 1'],
    ];
    return window.__gasHelpers.parseGroups(rows, 0);
  });
  expect(result[0].rows).toHaveLength(3);
  expect(result[1].rows).toHaveLength(1);
});

test('gas parseGroups returns empty array for empty input', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => window.__gasHelpers.parseGroups([], 0));
  expect(result).toHaveLength(0);
});

test('gas parseGroups ignores leading continuation rows with no group', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    const rows = [
      ['', 'orphan row'],
      ['Group A', 'first row'],
    ];
    return window.__gasHelpers.parseGroups(rows, 0);
  });
  expect(result).toHaveLength(1);
  expect(result[0].key).toBe('Group A');
  expect(result[0].rows).toHaveLength(1);
});

/* ================================================================
   Section 3: mapColumnRoles — header-to-index role mapping
   ================================================================ */

test('gas mapColumnRoles maps headers to indices via regex', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    return window.__gasHelpers.mapColumnRoles(
      ['Recipe', 'Servings', 'Status', 'Notes'],
      { name: /^(recipe|title)$/, status: /^status$/ }
    );
  });
  expect(result.name).toBe(0);
  expect(result.status).toBe(2);
});

test('gas mapColumnRoles returns -1 for unmatched roles', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    return window.__gasHelpers.mapColumnRoles(
      ['Title', 'Amount'],
      { missing: /^(priority|due)$/ }
    );
  });
  expect(result.missing).toBe(-1);
});

test('gas mapColumnRoles is case-insensitive', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    return window.__gasHelpers.mapColumnRoles(
      ['STATUS', 'NAME'],
      { status: /^status$/, name: /^name$/ }
    );
  });
  expect(result.status).toBe(0);
  expect(result.name).toBe(1);
});

test('gas mapColumnRoles does not assign one column to two roles', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    return window.__gasHelpers.mapColumnRoles(
      ['Status'],
      { first: /^status$/, second: /^status$/ }
    );
  });
  // first wins; second gets -1
  expect(result.first).toBe(0);
  expect(result.second).toBe(-1);
});

/* ================================================================
   Section 4: buildContinuationRow / buildGroupHeaderRow
   ================================================================ */

test('gas buildContinuationRow creates row with all empty cells by default', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => window.__gasHelpers.buildContinuationRow(4, {}));
  expect(result).toEqual(['', '', '', '']);
});

test('gas buildContinuationRow fills specified column values', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => window.__gasHelpers.buildContinuationRow(4, { 1: 'egg', 3: 'flour' }));
  expect(result).toEqual(['', 'egg', '', 'flour']);
});

test('gas buildGroupHeaderRow sets primary column and extra values', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() =>
    window.__gasHelpers.buildGroupHeaderRow('Pasta', 0, 4, { 1: '4', 2: '15 min' })
  );
  expect(result[0]).toBe('Pasta');
  expect(result[1]).toBe('4');
  expect(result[2]).toBe('15 min');
  expect(result[3]).toBe('');
});

/* ================================================================
   Section 5: flattenGroups — round-trip integrity
   ================================================================ */

test('gas flattenGroups restores primary column only on first row of group', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    const groups = [
      { key: 'Pasta', rows: [['Pasta', '4', 'egg'], ['', '', 'flour']] },
      { key: 'Salad', rows: [['Salad', '2', 'lettuce']] },
    ];
    return window.__gasHelpers.flattenGroups(groups, 0);
  });
  expect(result).toHaveLength(3);
  expect(result[0][0]).toBe('Pasta');
  expect(result[1][0]).toBe('');  // continuation
  expect(result[2][0]).toBe('Salad');
});

test('gas parseGroups → flattenGroups round-trips data without loss', async ({ page }) => {
  await setupApp(page);
  await injectGasHelpers(page);
  const result = await page.evaluate(() => {
    const original = [
      ['Recipe A', '4', 'egg'],
      ['', '', 'flour'],
      ['Recipe B', '2', 'butter'],
    ];
    const groups = window.__gasHelpers.parseGroups(original, 0);
    return window.__gasHelpers.flattenGroups(groups, 0);
  });
  expect(result).toEqual([
    ['Recipe A', '4', 'egg'],
    ['', '', 'flour'],
    ['Recipe B', '2', 'butter'],
  ]);
});
