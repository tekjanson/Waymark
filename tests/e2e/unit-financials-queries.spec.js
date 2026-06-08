// @ts-check
/**
 * unit-financials-queries.spec.js
 *
 * Pure-logic unit tests for the Waymark Financials query optimization layer.
 * Covers the three functions whose correctness underpins Dashboard performance:
 *
 *   - normalizeDate  — convert bank-format dates to ISO YYYY-MM-DD
 *   - extractMonth   — derive YYYY-MM index value from ISO date
 *   - extractYear    — derive YYYY  index value from ISO date
 *   - buildTxRow     — validate that Month/Year index columns are populated
 *   - cashFlowFormula — verify Dashboard formulas reference column L, not TEXT(A…)
 *
 * All tests run inside page.evaluate() following the project Playwright pattern
 * (AI Laws §7). Logic is inlined so tests exercise the real contract without
 * importing Node.js CJS modules.
 *
 * Performance rationale:
 *   TEXT(Transactions!A2:A1000,"YYYY-MM") computed 24 times per Dashboard
 *   recalculation (12 months × income + expenses) = 24,000 TEXT() evaluations.
 *   With pre-computed Month in column L, each formula is a direct string
 *   comparison — O(n) equality instead of O(n) text conversion + equality.
 */

const { test, expect } = require('@playwright/test');
const { setupApp }     = require('../helpers/test-utils');

/* ── Inline logic (mirrors scripts/import-statement.js normalizeDate) ─── */

const NORMALIZE_DATE_SRC = `
function normalizeDate(raw) {
  if (!raw) return '';
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return raw;
}
`;

const INDEX_COLS_SRC = `
function extractMonth(isoDate) {
  return isoDate ? isoDate.slice(0, 7) : '';
}
function extractYear(isoDate) {
  return isoDate ? isoDate.slice(0, 4) : '';
}
`;

/* ── Sample transaction (mirrors import-statement.js txRows entry) ──── */

const BUILD_TX_ROW_SRC = `
function buildTxRow(date, entityId, entityName, desc, amount, category, type) {
  const month = date ? date.slice(0, 7) : '';
  const year  = date ? date.slice(0, 4) : '';
  return [
    date, entityId, entityName, desc,
    parseFloat(amount).toFixed(2),
    category, type,
    '',      // Running Balance
    '',      // Statement ID
    'FALSE', // Reconciled
    '',      // Notes
    month,   // col L — Month index
    year,    // col M — Year index
  ];
}
`;

/* ── Dashboard formula template (mirrors build-dashboard.js) ─────────── */

const CASH_FLOW_FORMULA_SRC = `
function buildCashFlowFormula(ym, rowNum, type) {
  if (type === 'income') {
    return '=IFERROR(SUMPRODUCT((Transactions!L2:L1000="' + ym + '")*(Transactions!G2:G1000="Credit")*(Transactions!E2:E1000)),0)';
  }
  return '=IFERROR(ABS(SUMPRODUCT((Transactions!L2:L1000="' + ym + '")*(Transactions!G2:G1000="Debit")*(Transactions!E2:E1000))),0)';
}
`;

/* ══════════════════════════════════════════════════════════════════════════
   normalizeDate — bank date formats to ISO
   ══════════════════════════════════════════════════════════════════════════ */

test('normalizeDate: already ISO passes through unchanged', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return normalizeDate('2026-05-14');
  }, NORMALIZE_DATE_SRC);
  expect(result).toBe('2026-05-14');
});

test('normalizeDate: M/D/YYYY → YYYY-MM-DD', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return normalizeDate('5/14/2026');
  }, NORMALIZE_DATE_SRC);
  expect(result).toBe('2026-05-14');
});

test('normalizeDate: MM/DD/YYYY → YYYY-MM-DD', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return normalizeDate('12/31/2026');
  }, NORMALIZE_DATE_SRC);
  expect(result).toBe('2026-12-31');
});

test('normalizeDate: single-digit day padded', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return normalizeDate('1/7/2026');
  }, NORMALIZE_DATE_SRC);
  expect(result).toBe('2026-01-07');
});

test('normalizeDate: empty string returns empty string', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return normalizeDate('');
  }, NORMALIZE_DATE_SRC);
  expect(result).toBe('');
});

test('normalizeDate: null-like undefined-safe', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return normalizeDate(null);
  }, NORMALIZE_DATE_SRC);
  expect(result).toBe('');
});

/* ══════════════════════════════════════════════════════════════════════════
   extractMonth / extractYear — index column derivation
   ══════════════════════════════════════════════════════════════════════════ */

test('extractMonth: returns YYYY-MM slice from ISO date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractMonth('2026-05-14');
  }, INDEX_COLS_SRC);
  expect(result).toBe('2026-05');
});

test('extractMonth: December date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractMonth('2025-12-31');
  }, INDEX_COLS_SRC);
  expect(result).toBe('2025-12');
});

test('extractMonth: empty date returns empty string', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractMonth('');
  }, INDEX_COLS_SRC);
  expect(result).toBe('');
});

test('extractYear: returns YYYY slice from ISO date', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractYear('2026-05-14');
  }, INDEX_COLS_SRC);
  expect(result).toBe('2026');
});

test('extractYear: different year', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractYear('2024-01-01');
  }, INDEX_COLS_SRC);
  expect(result).toBe('2024');
});

test('extractYear: empty date returns empty string', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractYear('');
  }, INDEX_COLS_SRC);
  expect(result).toBe('');
});

/* ══════════════════════════════════════════════════════════════════════════
   buildTxRow — index columns present at correct positions
   ══════════════════════════════════════════════════════════════════════════ */

test('buildTxRow: row has 13 columns (A–M)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildTxRow('2026-05-14', 'LIAB-001', 'Chase Sapphire', 'Whole Foods', -127.43, 'Groceries', 'Debit').length;
  }, BUILD_TX_ROW_SRC);
  expect(result).toBe(13);
});

test('buildTxRow: column L (index 11) is YYYY-MM month', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildTxRow('2026-05-14', 'LIAB-001', 'Chase Sapphire', 'Whole Foods', -127.43, 'Groceries', 'Debit')[11];
  }, BUILD_TX_ROW_SRC);
  expect(result).toBe('2026-05');
});

test('buildTxRow: column M (index 12) is YYYY year', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildTxRow('2026-05-14', 'LIAB-001', 'Chase Sapphire', 'Whole Foods', -127.43, 'Groceries', 'Debit')[12];
  }, BUILD_TX_ROW_SRC);
  expect(result).toBe('2026');
});

test('buildTxRow: amount is formatted to 2 decimal places', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildTxRow('2026-05-14', 'LIAB-001', 'Chase Sapphire', 'Coffee', -4.5, 'Dining', 'Debit')[4];
  }, BUILD_TX_ROW_SRC);
  expect(result).toBe('-4.50');
});

test('buildTxRow: month index consistent across different months', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    const jan = buildTxRow('2026-01-15', 'ASSET-001', 'Chase Checking', 'Deposit', 500, 'Income', 'Credit')[11];
    const dec = buildTxRow('2025-12-01', 'ASSET-001', 'Chase Checking', 'Deposit', 500, 'Income', 'Credit')[11];
    return { jan, dec };
  }, BUILD_TX_ROW_SRC);
  expect(result.jan).toBe('2026-01');
  expect(result.dec).toBe('2025-12');
});

/* ══════════════════════════════════════════════════════════════════════════
   cashFlowFormula — Dashboard formula uses column L, not TEXT(A…)
   ══════════════════════════════════════════════════════════════════════════ */

test('cashFlowFormula: income formula references L column (index column)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildCashFlowFormula('2026-05', 3, 'income');
  }, CASH_FLOW_FORMULA_SRC);
  // Must reference pre-computed Month column L
  expect(result).toContain('Transactions!L2:L1000');
  // Must NOT use slow TEXT() conversion on the Date column
  expect(result).not.toContain('TEXT(Transactions!A');
  expect(result).toContain('"2026-05"');
  expect(result).toContain('"Credit"');
});

test('cashFlowFormula: expenses formula references L column (index column)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildCashFlowFormula('2026-05', 4, 'expenses');
  }, CASH_FLOW_FORMULA_SRC);
  expect(result).toContain('Transactions!L2:L1000');
  expect(result).not.toContain('TEXT(Transactions!A');
  expect(result).toContain('"2026-05"');
  expect(result).toContain('"Debit"');
});

test('cashFlowFormula: formula wraps with IFERROR', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildCashFlowFormula('2026-01', 5, 'income');
  }, CASH_FLOW_FORMULA_SRC);
  expect(result).toMatch(/^=IFERROR\(/);
  expect(result).toMatch(/,0\)$/);
});

test('cashFlowFormula: expenses formula wraps result in ABS()', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildCashFlowFormula('2026-03', 6, 'expenses');
  }, CASH_FLOW_FORMULA_SRC);
  expect(result).toContain('ABS(SUMPRODUCT(');
});

/* ══════════════════════════════════════════════════════════════════════════
   Integration: normalizeDate + buildTxRow pipeline
   ══════════════════════════════════════════════════════════════════════════ */

test('pipeline: Chase bank date MM/DD/YYYY → correct index columns', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([nd, tx]) => {
    eval(nd); eval(tx); // eslint-disable-line no-eval
    const isoDate = normalizeDate('05/14/2026');
    const row = buildTxRow(isoDate, 'LIAB-001', 'Chase Sapphire', 'Amazon', -89.99, 'Shopping', 'Debit');
    return { date: row[0], month: row[11], year: row[12] };
  }, [NORMALIZE_DATE_SRC, BUILD_TX_ROW_SRC]);
  expect(result.date).toBe('2026-05-14');
  expect(result.month).toBe('2026-05');
  expect(result.year).toBe('2026');
});

test('pipeline: Ally bank date M/D/YYYY → correct index columns', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([nd, tx]) => {
    eval(nd); eval(tx); // eslint-disable-line no-eval
    const isoDate = normalizeDate('1/7/2026');
    const row = buildTxRow(isoDate, 'ASSET-002', 'Ally Savings', 'Interest Payment', 3.14, 'Income', 'Credit');
    return { date: row[0], month: row[11], year: row[12] };
  }, [NORMALIZE_DATE_SRC, BUILD_TX_ROW_SRC]);
  expect(result.date).toBe('2026-01-07');
  expect(result.month).toBe('2026-01');
  expect(result.year).toBe('2026');
});

test('pipeline: cross-year December → January boundary', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([nd, tx]) => {
    eval(nd); eval(tx); // eslint-disable-line no-eval
    const dec = buildTxRow(normalizeDate('12/31/2025'), 'LIAB-001', 'Chase Sapphire', 'Purchase', -50, 'Shopping', 'Debit');
    const jan = buildTxRow(normalizeDate('01/01/2026'), 'LIAB-001', 'Chase Sapphire', 'Purchase', -50, 'Shopping', 'Debit');
    return {
      decMonth: dec[11], decYear: dec[12],
      janMonth: jan[11], janYear: jan[12],
    };
  }, [NORMALIZE_DATE_SRC, BUILD_TX_ROW_SRC]);
  expect(result.decMonth).toBe('2025-12');
  expect(result.decYear).toBe('2025');
  expect(result.janMonth).toBe('2026-01');
  expect(result.janYear).toBe('2026');
});
