// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ============================================================
   invoice.spec.js — E2E tests for the Invoice template
   ============================================================ */

/* ---------- Layer 1: Detection & Rendering ---------- */

test('invoice detected as Invoice template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-ar-summary', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Invoice');
});

test('invoice renders AR summary with four panels', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-ar-summary', { timeout: 5_000 });

  const items = page.locator('.invoice-ar-item');
  expect(await items.count()).toBe(4);
});

test('invoice AR summary labels show Total Invoiced, Paid, Outstanding, Overdue', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-ar-summary', { timeout: 5_000 });

  const labels = await page.locator('.invoice-ar-label').allTextContents();
  expect(labels.some(l => /invoiced/i.test(l))).toBe(true);
  expect(labels.some(l => /paid/i.test(l))).toBe(true);
  expect(labels.some(l => /outstanding/i.test(l))).toBe(true);
  expect(labels.some(l => /overdue/i.test(l))).toBe(true);
});

test('invoice AR summary values are formatted as dollars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-ar-summary', { timeout: 5_000 });

  const values = await page.locator('.invoice-ar-value').allTextContents();
  expect(values.every(v => v.includes('$'))).toBe(true);
});

test('invoice renders invoice cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-card', { timeout: 5_000 });

  const cards = page.locator('.invoice-card');
  expect(await cards.count()).toBeGreaterThan(0);
});

test('invoice cards show invoice numbers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-card', { timeout: 5_000 });

  const nums = await page.locator('.invoice-card-num').allTextContents();
  expect(nums.length).toBeGreaterThan(0);
  expect(nums.some(n => /INV-/.test(n))).toBe(true);
});

test('invoice cards show status badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-status', { timeout: 5_000 });

  const badges = page.locator('.invoice-status');
  expect(await badges.count()).toBeGreaterThan(0);
});

test('invoice cards show invoice totals', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-card-total', { timeout: 5_000 });

  const totals = await page.locator('.invoice-card-total').allTextContents();
  expect(totals.every(t => t.includes('$'))).toBe(true);
});

/* ---------- Layer 2: Card Expand / Line Items ---------- */

test('invoice card expands to show line items on toggle click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-card-toggle', { timeout: 5_000 });

  const firstToggle = page.locator('.invoice-card-toggle').first();
  const firstCard   = page.locator('.invoice-card').first();

  // Initially collapsed
  const detailsBefore = firstCard.locator('.invoice-card-details');
  expect(await detailsBefore.getAttribute('class')).toContain('hidden');

  await firstToggle.click();

  // Now expanded
  expect(await detailsBefore.getAttribute('class')).not.toContain('hidden');
});

test('invoice expanded card shows line item rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-card-toggle', { timeout: 5_000 });

  await page.locator('.invoice-card-toggle').first().click();
  const lineRows = page.locator('.invoice-line-row');
  expect(await lineRows.count()).toBeGreaterThan(0);
});

test('invoice expanded card shows line item table header', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-card-toggle', { timeout: 5_000 });

  await page.locator('.invoice-card-toggle').first().click();
  const header = page.locator('.invoice-line-header');
  expect(await header.count()).toBeGreaterThan(0);
});

test('invoice expanded card shows subtotal row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-card-toggle', { timeout: 5_000 });

  await page.locator('.invoice-card-toggle').first().click();
  const subtotal = page.locator('.invoice-line-subtotal-val');
  expect(await subtotal.count()).toBeGreaterThan(0);
  const subtotalText = await subtotal.first().textContent();
  expect(subtotalText).toContain('$');
});

test('invoice toggle button collapses card again', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-card-toggle', { timeout: 5_000 });

  const toggle  = page.locator('.invoice-card-toggle').first();
  const details = page.locator('.invoice-card-details').first();

  await toggle.click();
  expect(await details.getAttribute('class')).not.toContain('hidden');
  await toggle.click();
  expect(await details.getAttribute('class')).toContain('hidden');
});

/* ---------- Layer 3: Status Filter ---------- */

test('invoice renders status filter bar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-filter-bar', { timeout: 5_000 });

  const btns = page.locator('.invoice-filter-btn');
  expect(await btns.count()).toBeGreaterThan(3);
});

test('invoice filter bar has all button active by default', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-filter-bar', { timeout: 5_000 });

  const allBtn = page.locator('.invoice-filter-btn[data-filter="all"]');
  expect(await allBtn.getAttribute('class')).toContain('invoice-filter-active');
});

test('invoice paid filter shows only paid invoices', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-filter-bar', { timeout: 5_000 });

  await page.locator('.invoice-filter-btn[data-filter="paid"]').click();

  const statuses = await page.locator('.invoice-status').allTextContents();
  // All visible should be Paid (or none shown)
  const nonPaid = statuses.filter(s => !/^paid$/i.test(s.trim()));
  expect(nonPaid.length).toBe(0);
});

test('invoice draft filter shows only draft invoices', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-filter-bar', { timeout: 5_000 });

  await page.locator('.invoice-filter-btn[data-filter="draft"]').click();
  const cards = page.locator('.invoice-card');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  // All shown should have draft status
  const statuses = await page.locator('.invoice-status').allTextContents();
  statuses.forEach(s => expect(s.toLowerCase().trim()).toBe('draft'));
});

test('invoice all filter restores all invoice cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-filter-bar', { timeout: 5_000 });

  const total = await page.locator('.invoice-card').count();
  await page.locator('.invoice-filter-btn[data-filter="paid"]').click();
  await page.locator('.invoice-filter-btn[data-filter="all"]').click();
  expect(await page.locator('.invoice-card').count()).toBe(total);
});

/* ---------- Layer 4: Status Badge Cycling ---------- */

test('invoice status badge is clickable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-status', { timeout: 5_000 });

  const badge = page.locator('.invoice-status').first();
  const cursor = await badge.evaluate(el => window.getComputedStyle(el).cursor);
  expect(cursor).toBe('pointer');
});

test('invoice clicking a draft status badge advances it to sent', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-status', { timeout: 5_000 });

  // Count draft badges before interaction
  const draftsBefore = await page.locator('.invoice-status-draft').count();
  if (draftsBefore === 0) return; // No draft badges in fixture — skip

  // Count sent badges before click
  const sentBefore = await page.locator('.invoice-status-sent').count();

  // Click the first draft badge
  await page.locator('.invoice-status-draft').first().click();

  // Draft count should decrease; sent count should increase
  const draftsAfter = await page.locator('.invoice-status-draft').count();
  const sentAfter   = await page.locator('.invoice-status-sent').count();
  expect(draftsAfter).toBe(draftsBefore - 1);
  expect(sentAfter).toBe(sentBefore + 1);
});

test('invoice status cycle emits edit for the correct row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-068');
  await page.waitForSelector('.invoice-status', { timeout: 5_000 });

  const draftBadge = page.locator('.invoice-status-draft').first();
  if (await draftBadge.count() === 0) return;

  await draftBadge.click();
  const records = await getCreatedRecords(page);
  expect(records.length).toBeGreaterThan(0);
  const editRecord = records.find(r => r.type === 'cell-update' && r.value === 'Sent');
  expect(editRecord).toBeTruthy();
});

/* ---------- Unit tests for helpers ---------- */

test('invoice helpers: parseAmt parses currency strings', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseAmt } = await import('/js/templates/invoice/helpers.js');
    return {
      plain:  parseAmt('5000'),
      dollar: parseAmt('$1,234.99'),
      zero:   parseAmt(''),
    };
  });
  expect(result.plain).toBe(5000);
  expect(result.dollar).toBeCloseTo(1234.99);
  expect(result.zero).toBe(0);
});

test('invoice helpers: parseQty defaults to 1 for missing/invalid values', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseQty } = await import('/js/templates/invoice/helpers.js');
    return {
      three:  parseQty('3'),
      empty:  parseQty(''),
      text:   parseQty('abc'),
      neg:    parseQty('-1'),
    };
  });
  expect(result.three).toBe(3);
  expect(result.empty).toBe(1);
  expect(result.text).toBe(1);
  expect(result.neg).toBe(1);
});

test('invoice helpers: lineTotal multiplies qty and unit price', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { lineTotal } = await import('/js/templates/invoice/helpers.js');
    const cell = (row, i) => (i >= 0 ? row[i] : '');
    const row = ['Consulting', '4', '150', ''];
    const cols = { item: 0, qty: 1, unitPrice: 2, notes: 3 };
    return lineTotal(row, cols, cell);
  });
  expect(result).toBe(600);
});

test('invoice helpers: groupInvoices groups rows correctly', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { groupInvoices } = await import('/js/templates/invoice/helpers.js');
    const cell = (row, i) => (i >= 0 ? row[i] : '');
    const cols = { invoice: 0, client: 1, date: 2, due: 3, status: 4, item: 5, qty: 6, unitPrice: 7, notes: 8 };
    const rows = [
      ['INV-001', 'Acme', '2026-01-01', '2026-02-01', 'Draft', 'Item A', '1', '100', ''],
      ['',        '',     '',           '',            '',     'Item B', '2', '50',  ''],
      ['INV-002', 'Beta', '2026-02-01', '2026-03-01', 'Sent',  'Item C', '3', '200', ''],
    ];
    const invoices = groupInvoices(rows, cols, cell);
    return {
      count:     invoices.length,
      inv1Rows:  invoices[0].rows.length,
      inv1Num:   invoices[0].invNum,
      inv2Rows:  invoices[1].rows.length,
      inv2Client: invoices[1].client,
    };
  });
  expect(result.count).toBe(2);
  expect(result.inv1Rows).toBe(2);
  expect(result.inv1Num).toBe('INV-001');
  expect(result.inv2Rows).toBe(1);
  expect(result.inv2Client).toBe('Beta');
});

test('invoice helpers: computeARSummary calculates correctly', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { computeARSummary, groupInvoices } = await import('/js/templates/invoice/helpers.js');
    const cell = (row, i) => (i >= 0 ? row[i] : '');
    const cols = { invoice: 0, client: 1, date: 2, due: 3, status: 4, item: 5, qty: 6, unitPrice: 7, notes: 8 };
    const rows = [
      ['INV-001', 'A', '2026-01-01', '', 'Paid',  'Svc A', '1', '1000', ''],
      ['INV-002', 'B', '2026-02-01', '', 'Sent',  'Svc B', '2', '500',  ''],
      ['INV-003', 'C', '2026-03-01', '', 'Draft', 'Svc C', '1', '250',  ''],
    ];
    const invoices = groupInvoices(rows, cols, cell);
    return computeARSummary(invoices, cols, cell);
  });
  expect(result.totalInvoiced).toBe(2250);
  expect(result.totalPaid).toBe(1000);
  expect(result.totalOutstanding).toBe(1250);
});

test('invoice helpers: isOverdue returns true for past due dates', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { isOverdue } = await import('/js/templates/invoice/helpers.js');
    return {
      past:      isOverdue('2020-01-01', 'Sent'),
      paid:      isOverdue('2020-01-01', 'Paid'),
      cancelled: isOverdue('2020-01-01', 'Cancelled'),
      future:    isOverdue('2099-01-01', 'Sent'),
      empty:     isOverdue('', 'Sent'),
    };
  });
  expect(result.past).toBe(true);
  expect(result.paid).toBe(false);
  expect(result.cancelled).toBe(false);
  expect(result.future).toBe(false);
  expect(result.empty).toBe(false);
});
