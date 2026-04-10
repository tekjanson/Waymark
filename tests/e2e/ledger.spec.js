// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ============================================================
   ledger.spec.js — E2E tests for the Ledger template
   ============================================================ */

/* ---------- Layer 1: Detection & Rendering ---------- */

test('ledger detected as Ledger template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-pnl', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Ledger');
});

test('ledger renders P&L summary bar with three panels', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-pnl', { timeout: 5_000 });

  const items = page.locator('.ledger-pnl-item');
  expect(await items.count()).toBe(3);
});

test('ledger P&L labels show Revenue, Expenses, and Net Profit/Loss', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-pnl', { timeout: 5_000 });

  const labels = await page.locator('.ledger-pnl-label').allTextContents();
  expect(labels.some(l => /revenue/i.test(l))).toBe(true);
  expect(labels.some(l => /expense/i.test(l))).toBe(true);
  expect(labels.some(l => /net/i.test(l))).toBe(true);
});

test('ledger P&L values are formatted as dollars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-pnl', { timeout: 5_000 });

  const values = await page.locator('.ledger-pnl-value').allTextContents();
  expect(values.every(v => v.includes('$'))).toBe(true);
});

test('ledger renders entry rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-row', { timeout: 5_000 });

  const rows = page.locator('.ledger-row');
  expect(await rows.count()).toBeGreaterThan(0);
});

test('ledger each row shows a type badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-row', { timeout: 5_000 });

  const badges = page.locator('.ledger-type-badge');
  expect(await badges.count()).toBeGreaterThan(0);
});

/* ---------- Layer 2: Category Grouping ---------- */

test('ledger renders category group headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-cat-label', { timeout: 5_000 });

  const headers = page.locator('.ledger-cat-label');
  expect(await headers.count()).toBeGreaterThan(0);
});

test('ledger category headers show category names', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-cat-label', { timeout: 5_000 });

  const names = await page.locator('.ledger-cat-name').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(names.some(n => n.trim().length > 0)).toBe(true);
});

test('ledger category headers show net amount', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-cat-net', { timeout: 5_000 });

  const nets = await page.locator('.ledger-cat-net').allTextContents();
  expect(nets.some(n => n.includes('$'))).toBe(true);
});

/* ---------- Layer 3: Filter Interaction ---------- */

test('ledger renders filter bar with all/income/expense buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-filter-bar', { timeout: 5_000 });

  const btns = page.locator('.ledger-filter-btn');
  expect(await btns.count()).toBe(3);
});

test('ledger filter defaults to all entries visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-row', { timeout: 5_000 });

  const allBtn = page.locator('.ledger-filter-btn[data-filter="all"]');
  expect(await allBtn.getAttribute('class')).toContain('ledger-filter-active');
});

test('ledger income filter shows only income rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-filter-bar', { timeout: 5_000 });

  const countBefore = await page.locator('.ledger-row').count();
  await page.locator('.ledger-filter-btn[data-filter="income"]').click();

  const badges = await page.locator('.ledger-type-badge').allTextContents();
  const hasExpense = badges.some(b => /expense/i.test(b));
  expect(hasExpense).toBe(false);
  expect(await page.locator('.ledger-row').count()).toBeLessThan(countBefore);
});

test('ledger expense filter shows only expense rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-filter-bar', { timeout: 5_000 });

  await page.locator('.ledger-filter-btn[data-filter="expense"]').click();
  const badges = await page.locator('.ledger-type-badge').allTextContents();
  const hasIncome = badges.some(b => /income/i.test(b));
  expect(hasIncome).toBe(false);
});

test('ledger clicking all filter restores all rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-filter-bar', { timeout: 5_000 });

  const totalRows = await page.locator('.ledger-row').count();
  await page.locator('.ledger-filter-btn[data-filter="income"]').click();
  await page.locator('.ledger-filter-btn[data-filter="all"]').click();
  expect(await page.locator('.ledger-row').count()).toBe(totalRows);
});

/* ---------- Layer 4: Visual Consistency ---------- */

test('ledger income type badges have income styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-type-badge', { timeout: 5_000 });

  const incomeBadges = page.locator('.ledger-type-income');
  expect(await incomeBadges.count()).toBeGreaterThan(0);
});

test('ledger expense type badges have expense styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-type-badge', { timeout: 5_000 });

  const expenseBadges = page.locator('.ledger-type-expense');
  expect(await expenseBadges.count()).toBeGreaterThan(0);
});

test('ledger amount badges show positive/negative styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-amt', { timeout: 5_000 });

  const posAmts = page.locator('.ledger-amt-positive');
  const negAmts = page.locator('.ledger-amt-negative');
  expect(await posAmts.count()).toBeGreaterThan(0);
  expect(await negAmts.count()).toBeGreaterThan(0);
});

/* ---------- Layer 5: Monthly Chart ---------- */

test('ledger renders monthly trend chart when multiple months exist', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-067');
  await page.waitForSelector('.ledger-chart', { timeout: 5_000 });
  expect(await page.locator('.ledger-chart').count()).toBeGreaterThan(0);
});

/* ---------- Unit tests for helpers ---------- */

test('ledger helpers: parseAmt parses currency strings', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseAmt } = await import('/js/templates/ledger/helpers.js');
    return {
      plain:  parseAmt('1234'),
      dollar: parseAmt('$1,234.50'),
      neg:    parseAmt('-500'),
      empty:  parseAmt(''),
    };
  });
  expect(result.plain).toBe(1234);
  expect(result.dollar).toBeCloseTo(1234.50);
  expect(result.neg).toBe(-500); // preserves sign
  expect(result.empty).toBe(0);
});

test('ledger helpers: isIncome identifies income types', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { isIncome } = await import('/js/templates/ledger/helpers.js');
    return {
      income:   isIncome('Income'),
      revenue:  isIncome('Revenue'),
      credit:   isIncome('Credit'),
      cr:       isIncome('CR'),
      deposit:  isIncome('Deposit'),
      expense:  isIncome('Expense'),
      payment:  isIncome('Payment'),
      empty:    isIncome(''),
    };
  });
  expect(result.income).toBe(true);
  expect(result.revenue).toBe(true);
  expect(result.credit).toBe(true);
  expect(result.cr).toBe(true);
  expect(result.deposit).toBe(true);
  expect(result.expense).toBe(false);
  expect(result.payment).toBe(false);
  expect(result.empty).toBe(false);
});

test('ledger helpers: isExpense identifies expense types', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { isExpense } = await import('/js/templates/ledger/helpers.js');
    return {
      expense:  isExpense('Expense'),
      debit:    isExpense('Debit'),
      dr:       isExpense('DR'),
      payment:  isExpense('Payment'),
      fee:      isExpense('Fee'),
      income:   isExpense('Income'),
      revenue:  isExpense('Revenue'),
      empty:    isExpense(''),
    };
  });
  expect(result.expense).toBe(true);
  expect(result.debit).toBe(true);
  expect(result.dr).toBe(true);
  expect(result.payment).toBe(true);
  expect(result.fee).toBe(true);
  expect(result.income).toBe(false);
  expect(result.revenue).toBe(false);
  expect(result.empty).toBe(false);
});

test('ledger helpers: signedAmt returns positive for income, negative for expense', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { signedAmt } = await import('/js/templates/ledger/helpers.js');
    return {
      income:  signedAmt('Income', 500),
      expense: signedAmt('Expense', 300),
      unknown: signedAmt('', 100),
    };
  });
  expect(result.income).toBe(500);
  expect(result.expense).toBe(-300);
  expect(result.unknown).toBe(100);
});

test('ledger helpers: fmtDollars formats numbers correctly', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { fmtDollars } = await import('/js/templates/ledger/helpers.js');
    return {
      plain:    fmtDollars(1234.5),
      negative: fmtDollars(-500),
      zero:     fmtDollars(0),
      sign:     fmtDollars(100, { sign: true }),
    };
  });
  expect(result.plain).toBe('$1,234.50');
  expect(result.negative).toBe('$500.00');
  expect(result.zero).toBe('$0.00');
  expect(result.sign).toBe('+$100.00');
});

test('ledger helpers: computePnL calculates income, expenses, and netProfit', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computePnL } = await import('/js/templates/ledger/helpers.js');
    const rows = [
      ['2026-01-01', 'Income',  'Rev', 'Sale', '1000', ''],
      ['2026-01-02', 'Expense', 'Ops', 'Rent', '400',  ''],
      ['2026-01-03', 'Income',  'Rev', 'Srv',  '500',  ''],
    ];
    const cols = { date: 0, type: 1, category: 2, text: 3, amount: 4, reference: 5, balance: -1 };
    const cell = (row, i) => (i >= 0 ? row[i] : '');
    return computePnL(rows, cols, cell);
  });
  expect(result.totalIncome).toBe(1500);
  expect(result.totalExpenses).toBe(400);
  expect(result.netProfit).toBe(1100);
});
