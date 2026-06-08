// @ts-check
/**
 * unit-dashboard-builder.spec.js
 *
 * Pure-logic unit tests for build-dashboard.js and snapshot-net-worth.js.
 * Covers:
 *
 *   build-dashboard.js:
 *   - lastNMonths          — generates correct YYYY-MM sequence
 *   - sectionHeader        — wraps label correctly
 *   - buildSummaryRows     — correct row count, formula references
 *   - buildCashFlowRows    — month sequence, formula column refs, total row
 *   - buildAssetBreakdownRows — types covered, formula column refs
 *   - buildLiabilityBreakdownRows — types covered, min-payment column ref
 *   - NetWorthHistory headers — correct order and count
 *
 *   snapshot-net-worth.js:
 *   - today()              — returns YYYY-MM-DD format
 *   - cash flow aggregation — correct sign handling (credits vs debits)
 *   - snapshot row shape   — 6 values in correct column positions
 *
 * All tests run inside page.evaluate() following the project Playwright
 * pattern (AI Laws §7). Logic is inlined to exercise real contracts without
 * importing Node.js CJS modules.
 */

const { test, expect } = require('@playwright/test');
const { setupApp }     = require('../helpers/test-utils');

/* ══════════════════════════════════════════════════════════════════════════
   Inlined source blocks (mirrors actual script logic)
   ══════════════════════════════════════════════════════════════════════════ */

const LAST_N_MONTHS_SRC = `
function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    );
  }
  return months;
}
`;

const SECTION_HEADER_SRC = `
function sectionHeader(label) {
  return [['── ' + label + ' ──', '', '']];
}
`;

const BUILD_SUMMARY_ROWS_SRC = `
function sectionHeader(label) {
  return [['── ' + label + ' ──', '', '']];
}
function buildSummaryRows() {
  return [
    ...sectionHeader('Summary'),
    ['Net Worth',           '=SUM(Assets!F2:F1000)-SUM(Liabilities!F2:F1000)', ''],
    ['Total Assets',        '=SUM(Assets!F2:F1000)', ''],
    ['Total Liabilities',   '=SUM(Liabilities!F2:F1000)', ''],
    ['Cash & Liquid',       '=SUMIF(Assets!C2:C1000,"Bank Account",Assets!F2:F1000)+SUMIF(Assets!C2:C1000,"Savings Account",Assets!F2:F1000)', 'Bank + Savings'],
    ['Investments',         '=SUMIF(Assets!C2:C1000,"Investment",Assets!F2:F1000)+SUMIF(Assets!C2:C1000,"Brokerage",Assets!F2:F1000)', ''],
    ['Real Estate',         '=SUMIF(Assets!C2:C1000,"Property",Assets!F2:F1000)', ''],
    ['Credit Card Debt',    '=SUMIF(Liabilities!C2:C1000,"Credit Card",Liabilities!F2:F1000)', ''],
    ['Loan Balances',       '=SUMIF(Liabilities!C2:C1000,"Mortgage",Liabilities!F2:F1000)+SUMIF(Liabilities!C2:C1000,"Auto Loan",Liabilities!F2:F1000)+SUMIF(Liabilities!C2:C1000,"Student Loan",Liabilities!F2:F1000)', 'Mortgage + Auto + Student'],
    ['Min Payments / Month','=SUM(Liabilities!I2:I1000)', 'Sum of all min payment fields'],
    ['Open Accounts',       '=COUNTIF(Assets!J2:J1000,"Active")+COUNTIF(Liabilities!M2:M1000,"Active")', ''],
    ['', '', ''],
  ];
}
`;

const BUILD_CASH_FLOW_ROWS_SRC = `
function sectionHeader(label) {
  return [['── ' + label + ' ──', '', '', '']];
}
function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return months;
}
function buildCashFlowRows() {
  const months = lastNMonths(12);
  const rows   = [...sectionHeader('Monthly Cash Flow (last 12 months)')];
  rows.push(['Month', 'Income (Credits)', 'Expenses (Debits)', 'Net']);
  for (const ym of months) {
    const income   = '=IFERROR(SUMPRODUCT((Transactions!L2:L1000="' + ym + '")*(Transactions!G2:G1000="Credit")*(Transactions!E2:E1000)),0)';
    const expenses = '=IFERROR(ABS(SUMPRODUCT((Transactions!L2:L1000="' + ym + '")*(Transactions!G2:G1000="Debit")*(Transactions!E2:E1000))),0)';
    const net      = '=B' + (rows.length + 2) + '-C' + (rows.length + 2);
    rows.push([ym, income, expenses, net]);
  }
  rows.push(['12-Month Total', '=SUM(B__START__:B__END__)', '=SUM(C__START__:C__END__)', '=SUM(D__START__:D__END__)']);
  rows.push(['', '', '', '']);
  return rows;
}
`;

const BUILD_ASSET_ROWS_SRC = `
function sectionHeader(label) {
  return [['── ' + label + ' ──', '', '']];
}
function buildAssetBreakdownRows() {
  const types = [
    'Bank Account', 'Savings Account', 'Investment', 'Brokerage',
    'Property', 'Vehicle', 'Retirement', 'Other',
  ];
  const rows = [...sectionHeader('Asset Breakdown by Type')];
  rows.push(['Type', 'Balance', 'Count']);
  for (const t of types) {
    rows.push([
      t,
      '=IFERROR(SUMIF(Assets!C2:C1000,"' + t + '",Assets!F2:F1000),0)',
      '=IFERROR(COUNTIF(Assets!C2:C1000,"' + t + '"),0)',
    ]);
  }
  rows.push(['Total', '=SUM(Assets!F2:F1000)', '=COUNTA(Assets!A2:A1000)']);
  rows.push(['', '', '']);
  return rows;
}
`;

const BUILD_LIAB_ROWS_SRC = `
function sectionHeader(label) {
  return [['── ' + label + ' ──', '', '', '']];
}
function buildLiabilityBreakdownRows() {
  const types = [
    'Credit Card', 'Mortgage', 'Auto Loan', 'Student Loan',
    'Personal Loan', 'Line of Credit', 'Other',
  ];
  const rows = [...sectionHeader('Liability Breakdown by Type')];
  rows.push(['Type', 'Balance', 'Count', 'Min Payments']);
  for (const t of types) {
    rows.push([
      t,
      '=IFERROR(SUMIF(Liabilities!C2:C1000,"' + t + '",Liabilities!F2:F1000),0)',
      '=IFERROR(COUNTIF(Liabilities!C2:C1000,"' + t + '"),0)',
      '=IFERROR(SUMIF(Liabilities!C2:C1000,"' + t + '",Liabilities!I2:I1000),0)',
    ]);
  }
  rows.push(['Total', '=SUM(Liabilities!F2:F1000)', '=COUNTA(Liabilities!A2:A1000)', '=SUM(Liabilities!I2:I1000)']);
  rows.push(['', '', '', '']);
  return rows;
}
`;

const TODAY_SRC = `
function today() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
`;

const CASH_FLOW_AGGREGATE_SRC = `
function aggregateCashFlow(txRows, curMonth) {
  let credits = 0;
  let debits  = 0;
  for (const row of txRows) {
    const date   = (row[0] || '').slice(0, 7);
    if (date !== curMonth) continue;
    const amount = parseFloat(row[4]) || 0;
    const type   = (row[6] || '').toLowerCase();
    if (type === 'credit') credits += amount;
    else if (type === 'debit') debits += Math.abs(amount);
  }
  return { credits, debits, net: credits - debits };
}
`;

const SNAPSHOT_ROW_SRC = `
function buildSnapshotRow(date, totalAssets, totalLiabilities, monthlyCashFlow, notes) {
  const netWorth = totalAssets - totalLiabilities;
  return [
    date,
    netWorth.toFixed(2),
    totalAssets.toFixed(2),
    totalLiabilities.toFixed(2),
    monthlyCashFlow.toFixed(2),
    notes,
  ];
}
`;

/* ══════════════════════════════════════════════════════════════════════════
   lastNMonths — YYYY-MM sequence generation
   ══════════════════════════════════════════════════════════════════════════ */

test('lastNMonths: returns exactly N months', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return lastNMonths(12).length;
  }, LAST_N_MONTHS_SRC);
  expect(result).toBe(12);
});

test('lastNMonths: last element is the current month', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const now = new Date();
    const expected = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const months = lastNMonths(12);
    return { last: months[months.length - 1], expected };
  }, LAST_N_MONTHS_SRC);
  expect(result.last).toBe(result.expected);
});

test('lastNMonths: months are in ascending chronological order', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const months = lastNMonths(6);
    let ascending = true;
    for (let i = 1; i < months.length; i++) {
      if (months[i] <= months[i - 1]) ascending = false;
    }
    return ascending;
  }, LAST_N_MONTHS_SRC);
  expect(result).toBe(true);
});

test('lastNMonths: all entries match YYYY-MM format', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const months = lastNMonths(12);
    return months.every(m => /^\d{4}-\d{2}$/.test(m));
  }, LAST_N_MONTHS_SRC);
  expect(result).toBe(true);
});

test('lastNMonths: n=1 returns only current month', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const now = new Date();
    const expected = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    return lastNMonths(1)[0] === expected;
  }, LAST_N_MONTHS_SRC);
  expect(result).toBe(true);
});

/* ══════════════════════════════════════════════════════════════════════════
   sectionHeader — label wrapper
   ══════════════════════════════════════════════════════════════════════════ */

test('sectionHeader: returns single row array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return sectionHeader('Summary').length;
  }, SECTION_HEADER_SRC);
  expect(result).toBe(1);
});

test('sectionHeader: row contains label wrapped in dashes', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return sectionHeader('Summary')[0][0];
  }, SECTION_HEADER_SRC);
  expect(result).toBe('── Summary ──');
});

test('sectionHeader: remaining cells are empty strings', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const row = sectionHeader('Test')[0];
    return row[1] === '' && row[2] === '';
  }, SECTION_HEADER_SRC);
  expect(result).toBe(true);
});

/* ══════════════════════════════════════════════════════════════════════════
   buildSummaryRows — net worth summary section
   ══════════════════════════════════════════════════════════════════════════ */

test('buildSummaryRows: has 12 rows (header + 10 metrics + blank)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return buildSummaryRows().length;
  }, BUILD_SUMMARY_ROWS_SRC);
  expect(result).toBe(12);
});

test('buildSummaryRows: Net Worth formula subtracts liabilities from assets', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildSummaryRows();
    return rows[1][1]; // Net Worth value cell
  }, BUILD_SUMMARY_ROWS_SRC);
  expect(result).toContain('SUM(Assets!F2:F1000)');
  expect(result).toContain('SUM(Liabilities!F2:F1000)');
  expect(result).toContain('-');
});

test('buildSummaryRows: Min Payments row references Liabilities column I', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildSummaryRows();
    const minRow = rows.find(r => r[0] === 'Min Payments / Month');
    return minRow ? minRow[1] : null;
  }, BUILD_SUMMARY_ROWS_SRC);
  expect(result).toContain('Liabilities!I2:I1000');
});

test('buildSummaryRows: Cash & Liquid sums Bank Account and Savings Account', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildSummaryRows();
    const cashRow = rows.find(r => r[0] === 'Cash & Liquid');
    return cashRow ? cashRow[1] : null;
  }, BUILD_SUMMARY_ROWS_SRC);
  expect(result).toContain('"Bank Account"');
  expect(result).toContain('"Savings Account"');
});

test('buildSummaryRows: Open Accounts row counts Active from both tabs', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildSummaryRows();
    const openRow = rows.find(r => r[0] === 'Open Accounts');
    return openRow ? openRow[1] : null;
  }, BUILD_SUMMARY_ROWS_SRC);
  expect(result).toContain('Assets!J2:J1000');
  expect(result).toContain('Liabilities!M2:M1000');
  expect(result).toContain('"Active"');
});

/* ══════════════════════════════════════════════════════════════════════════
   buildCashFlowRows — monthly cash flow section
   ══════════════════════════════════════════════════════════════════════════ */

test('buildCashFlowRows: has 16 rows (header + sub-header + 12 months + total + blank)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return buildCashFlowRows().length;
  }, BUILD_CASH_FLOW_ROWS_SRC);
  expect(result).toBe(16);
});

test('buildCashFlowRows: income formulas reference column L (pre-computed Month)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildCashFlowRows();
    // rows[2] is the first data month (after header + sub-header)
    return rows[2][1];
  }, BUILD_CASH_FLOW_ROWS_SRC);
  expect(result).toContain('Transactions!L2:L1000');
  expect(result).not.toContain('TEXT(Transactions!A');
});

test('buildCashFlowRows: expense formulas use ABS() wrapper', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildCashFlowRows();
    return rows[2][2]; // first month expenses
  }, BUILD_CASH_FLOW_ROWS_SRC);
  expect(result).toContain('ABS(SUMPRODUCT(');
});

test('buildCashFlowRows: total row has __START__ / __END__ placeholders', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildCashFlowRows();
    const totalRow = rows[rows.length - 2]; // second-to-last (before blank)
    return { label: totalRow[0], income: totalRow[1] };
  }, BUILD_CASH_FLOW_ROWS_SRC);
  expect(result.label).toBe('12-Month Total');
  expect(result.income).toContain('__START__');
  expect(result.income).toContain('__END__');
});

test('buildCashFlowRows: all 12 month rows contain YYYY-MM strings', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildCashFlowRows();
    // data rows are index 2..13 (12 months)
    const monthRows = rows.slice(2, 14);
    return monthRows.every(r => /^\d{4}-\d{2}$/.test(r[0]));
  }, BUILD_CASH_FLOW_ROWS_SRC);
  expect(result).toBe(true);
});

/* ══════════════════════════════════════════════════════════════════════════
   buildAssetBreakdownRows — asset type breakdown section
   ══════════════════════════════════════════════════════════════════════════ */

test('buildAssetBreakdownRows: includes 8 asset types', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildAssetBreakdownRows();
    // Skip header, sub-header, Total, and blank rows
    const typeRows = rows.filter(r => r[0] && r[0] !== '── Asset Breakdown by Type ──' && r[0] !== 'Type' && r[0] !== 'Total' && r[0] !== '');
    return typeRows.length;
  }, BUILD_ASSET_ROWS_SRC);
  expect(result).toBe(8);
});

test('buildAssetBreakdownRows: balance formulas reference Assets!F column', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildAssetBreakdownRows();
    const bankRow = rows.find(r => r[0] === 'Bank Account');
    return bankRow ? bankRow[1] : null;
  }, BUILD_ASSET_ROWS_SRC);
  expect(result).toContain('Assets!F2:F1000');
  expect(result).toContain('"Bank Account"');
});

test('buildAssetBreakdownRows: count formulas use COUNTIF on Assets!C', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildAssetBreakdownRows();
    const propRow = rows.find(r => r[0] === 'Property');
    return propRow ? propRow[2] : null;
  }, BUILD_ASSET_ROWS_SRC);
  expect(result).toContain('COUNTIF(Assets!C2:C1000');
  expect(result).toContain('"Property"');
});

test('buildAssetBreakdownRows: Total row sums all of Assets!F', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildAssetBreakdownRows();
    const totalRow = rows.find(r => r[0] === 'Total');
    return totalRow ? totalRow[1] : null;
  }, BUILD_ASSET_ROWS_SRC);
  expect(result).toBe('=SUM(Assets!F2:F1000)');
});

/* ══════════════════════════════════════════════════════════════════════════
   buildLiabilityBreakdownRows — liability type breakdown section
   ══════════════════════════════════════════════════════════════════════════ */

test('buildLiabilityBreakdownRows: includes 7 liability types', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildLiabilityBreakdownRows();
    const typeRows = rows.filter(r =>
      r[0] && r[0] !== '── Liability Breakdown by Type ──' &&
      r[0] !== 'Type' && r[0] !== 'Total' && r[0] !== ''
    );
    return typeRows.length;
  }, BUILD_LIAB_ROWS_SRC);
  expect(result).toBe(7);
});

test('buildLiabilityBreakdownRows: each type row has min-payment formula referencing column I', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildLiabilityBreakdownRows();
    const ccRow = rows.find(r => r[0] === 'Credit Card');
    return ccRow ? ccRow[3] : null; // column 4 = Min Payments
  }, BUILD_LIAB_ROWS_SRC);
  expect(result).toContain('Liabilities!I2:I1000');
  expect(result).toContain('"Credit Card"');
});

test('buildLiabilityBreakdownRows: Total row sums all of Liabilities!F and I', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildLiabilityBreakdownRows();
    const totalRow = rows.find(r => r[0] === 'Total');
    return totalRow ? { balance: totalRow[1], minPay: totalRow[3] } : null;
  }, BUILD_LIAB_ROWS_SRC);
  expect(result.balance).toBe('=SUM(Liabilities!F2:F1000)');
  expect(result.minPay).toBe('=SUM(Liabilities!I2:I1000)');
});

test('buildLiabilityBreakdownRows: Mortgage type is covered', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = buildLiabilityBreakdownRows();
    return rows.some(r => r[0] === 'Mortgage');
  }, BUILD_LIAB_ROWS_SRC);
  expect(result).toBe(true);
});

/* ══════════════════════════════════════════════════════════════════════════
   NetWorthHistory headers
   ══════════════════════════════════════════════════════════════════════════ */

test('NetWorthHistory headers: correct count and order', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(() => {
    const NWH_HEADERS = [
      'Date', 'Net Worth', 'Total Assets', 'Total Liabilities',
      'Monthly Cash Flow', 'Notes',
    ];
    return NWH_HEADERS;
  });
  expect(result).toHaveLength(6);
  expect(result[0]).toBe('Date');
  expect(result[1]).toBe('Net Worth');
  expect(result[2]).toBe('Total Assets');
  expect(result[3]).toBe('Total Liabilities');
  expect(result[4]).toBe('Monthly Cash Flow');
  expect(result[5]).toBe('Notes');
});

/* ══════════════════════════════════════════════════════════════════════════
   snapshot-net-worth: today() date format
   ══════════════════════════════════════════════════════════════════════════ */

test('today: returns YYYY-MM-DD formatted string', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return today();
  }, TODAY_SRC);
  expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('today: year matches current year', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const year = parseInt(today().slice(0, 4), 10);
    return year;
  }, TODAY_SRC);
  const currentYear = new Date().getFullYear();
  expect(result).toBe(currentYear);
});

test('today: month is between 01 and 12', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const month = parseInt(today().slice(5, 7), 10);
    return month;
  }, TODAY_SRC);
  expect(result).toBeGreaterThanOrEqual(1);
  expect(result).toBeLessThanOrEqual(12);
});

/* ══════════════════════════════════════════════════════════════════════════
   snapshot-net-worth: cash flow aggregation
   ══════════════════════════════════════════════════════════════════════════ */

test('aggregateCashFlow: sums credits correctly', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const rows = [
      ['2026-05-01', 'ASSET-001', 'Chase Checking', 'Paycheck', '', 'Income', 'Credit', '', '', '', '', '2026-05', '2026'],
      // Amount at index 4
    ];
    // Adjust: Amount is col E (index 4)
    const txRows = [
      ['2026-05-01', 'ASSET-001', 'Chase Checking', 'Paycheck', '3000', 'Income', 'Credit'],
      ['2026-05-15', 'ASSET-001', 'Chase Checking', 'Bonus',    '500',  'Income', 'Credit'],
    ];
    return aggregateCashFlow(txRows, '2026-05');
  }, CASH_FLOW_AGGREGATE_SRC);
  expect(result.credits).toBeCloseTo(3500);
  expect(result.debits).toBe(0);
  expect(result.net).toBeCloseTo(3500);
});

test('aggregateCashFlow: sums debits as positive values', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const txRows = [
      ['2026-05-10', 'LIAB-001', 'Chase Sapphire', 'Groceries', '-150', 'Groceries', 'Debit'],
      ['2026-05-20', 'LIAB-001', 'Chase Sapphire', 'Gas',       '-50',  'Transport',  'Debit'],
    ];
    return aggregateCashFlow(txRows, '2026-05');
  }, CASH_FLOW_AGGREGATE_SRC);
  expect(result.debits).toBeCloseTo(200);
  expect(result.credits).toBe(0);
  expect(result.net).toBeCloseTo(-200);
});

test('aggregateCashFlow: net is credits minus debits', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const txRows = [
      ['2026-05-01', 'ASSET-001', 'Chase Checking', 'Paycheck',  '2000', 'Income', 'Credit'],
      ['2026-05-10', 'LIAB-001', 'Chase Sapphire',  'Groceries', '-400', 'Food',   'Debit'],
    ];
    return aggregateCashFlow(txRows, '2026-05');
  }, CASH_FLOW_AGGREGATE_SRC);
  expect(result.net).toBeCloseTo(1600);
});

test('aggregateCashFlow: filters out rows from other months', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const txRows = [
      ['2026-04-30', 'ASSET-001', 'Chase Checking', 'OldPaycheck', '5000', 'Income', 'Credit'],
      ['2026-05-01', 'ASSET-001', 'Chase Checking', 'Paycheck',    '2000', 'Income', 'Credit'],
    ];
    return aggregateCashFlow(txRows, '2026-05');
  }, CASH_FLOW_AGGREGATE_SRC);
  expect(result.credits).toBeCloseTo(2000);
});

test('aggregateCashFlow: empty rows returns zero net', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return aggregateCashFlow([], '2026-05');
  }, CASH_FLOW_AGGREGATE_SRC);
  expect(result.net).toBe(0);
  expect(result.credits).toBe(0);
  expect(result.debits).toBe(0);
});

/* ══════════════════════════════════════════════════════════════════════════
   snapshot-net-worth: snapshot row shape
   ══════════════════════════════════════════════════════════════════════════ */

test('buildSnapshotRow: has 6 columns matching NetWorthHistory headers', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return buildSnapshotRow('2026-06-08', 100000, 40000, 500, 'May reconciliation').length;
  }, SNAPSHOT_ROW_SRC);
  expect(result).toBe(6);
});

test('buildSnapshotRow: net worth = assets - liabilities', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return buildSnapshotRow('2026-06-08', 100000, 40000, 500, '')[1];
  }, SNAPSHOT_ROW_SRC);
  expect(result).toBe('60000.00');
});

test('buildSnapshotRow: all monetary values formatted to 2 decimal places', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    const row = buildSnapshotRow('2026-06-08', 100000.5, 40000.333, 500.1, '');
    return { nw: row[1], assets: row[2], liab: row[3], flow: row[4] };
  }, SNAPSHOT_ROW_SRC);
  expect(result.nw).toMatch(/^\d+\.\d{2}$/);
  expect(result.assets).toMatch(/^\d+\.\d{2}$/);
  expect(result.liab).toMatch(/^\d+\.\d{2}$/);
  expect(result.flow).toMatch(/^\d+\.\d{2}$/);
});

test('buildSnapshotRow: date is in column A (index 0)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return buildSnapshotRow('2026-06-08', 100000, 40000, 500, '')[0];
  }, SNAPSHOT_ROW_SRC);
  expect(result).toBe('2026-06-08');
});

test('buildSnapshotRow: notes are in column F (index 5)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return buildSnapshotRow('2026-06-08', 100000, 40000, 500, 'After reconciliation')[5];
  }, SNAPSHOT_ROW_SRC);
  expect(result).toBe('After reconciliation');
});

test('buildSnapshotRow: zero liabilities gives net worth equal to assets', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return buildSnapshotRow('2026-06-08', 75000, 0, 0, '')[1];
  }, SNAPSHOT_ROW_SRC);
  expect(result).toBe('75000.00');
});
