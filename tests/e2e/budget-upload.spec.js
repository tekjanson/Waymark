// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');
const path = require('path');
const fs = require('fs');

/* ---------- Helpers ---------- */

/** Write a temp CSV file and return its path */
function writeTempCSV(name, content) {
  const dir = path.join(__dirname, '..', 'fixtures', 'statements');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

const SAMPLE_CSV = `Date,Description,Amount,Category
03/01/2026,Paycheck,2500,Income
03/02/2026,Grocery Store,-85.42,Food
03/03/2026,Electric Bill,-95.00,Utilities
03/05/2026,Restaurant,-32.50,Food
03/07/2026,Gas Station,-45.00,Transport`;

const SAMPLE_OFX = `OFXHEADER:100
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260301
<TRNAMT>1500.00
<NAME>Direct Deposit
<MEMO>Payroll
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260305
<TRNAMT>-42.50
<NAME>WHOLE FOODS
<MEMO>Groceries
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

/* ---------- Upload button rendering ---------- */

test('budget shows Upload Statement button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });
  await expect(page.locator('.budget-upload-btn')).toBeVisible();
  await expect(page.locator('.budget-upload-btn')).toContainText('Upload Statement');
});

test('budget upload button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });
  await expect(page.locator('.budget-upload-btn')).toHaveCSS('cursor', 'pointer');
});

/* ---------- Modal lifecycle ---------- */

test('budget upload modal opens on button click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });

  await expect(page.locator('#budget-upload-modal')).toBeVisible();
  await expect(page.locator('.budget-upload-drop-zone')).toBeVisible();
  await expect(page.locator('.budget-upload-browse-btn')).toBeVisible();
});

test('budget upload modal closes via X button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });
  await expect(page.locator('#budget-upload-modal')).toBeVisible();

  await page.click('#budget-upload-modal .modal-close');
  await expect(page.locator('#budget-upload-modal')).toHaveCount(0);
});

test('budget upload modal closes via Cancel button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });

  await page.click('#budget-upload-modal .modal-footer .btn-secondary');
  await expect(page.locator('#budget-upload-modal')).toHaveCount(0);
});

test('budget upload modal closes via overlay click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });

  await page.click('#budget-upload-modal', { position: { x: 5, y: 5 } });
  await expect(page.locator('#budget-upload-modal')).toHaveCount(0);
});

/* ---------- CSV parsing and preview ---------- */

test('budget upload parses CSV and shows transaction preview', async ({ page }) => {
  const csvPath = writeTempCSV('test-bank.csv', SAMPLE_CSV);

  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });

  // Upload the CSV via the hidden file input
  await page.setInputFiles('.budget-upload-file-input', csvPath);

  // Wait for preview to render
  await page.waitForSelector('.budget-upload-table-row', { timeout: 5000 });

  // Status should show success with transaction count
  await expect(page.locator('.budget-upload-status')).toContainText('5 transactions');
  await expect(page.locator('.budget-upload-status')).toContainText('CSV');

  // Preview table should show rows
  const rows = await page.locator('.budget-upload-table-row').count();
  expect(rows).toBe(5);

  // Import button should be enabled
  await expect(page.locator('.budget-upload-import-btn')).toBeEnabled();

  // Drop zone should be hidden
  await expect(page.locator('.budget-upload-drop-zone')).toBeHidden();
});

test('budget upload preview shows correct amounts with positive/negative styling', async ({ page }) => {
  const csvPath = writeTempCSV('test-amounts.csv', SAMPLE_CSV);

  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });
  await page.setInputFiles('.budget-upload-file-input', csvPath);
  await page.waitForSelector('.budget-upload-table-row', { timeout: 5000 });

  // First row (Paycheck +2500) should have positive styling
  const firstAmt = page.locator('.budget-upload-table-row').first().locator('.budget-upload-col-amt');
  await expect(firstAmt).toHaveClass(/budget-amt-positive/);

  // Second row (Grocery -85.42) should have negative styling
  const secondAmt = page.locator('.budget-upload-table-row').nth(1).locator('.budget-upload-col-amt');
  await expect(secondAmt).toHaveClass(/budget-amt-negative/);
});

/* ---------- OFX parsing ---------- */

test('budget upload parses OFX statement format', async ({ page }) => {
  const ofxPath = writeTempCSV('test-bank.ofx', SAMPLE_OFX);

  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });
  await page.setInputFiles('.budget-upload-file-input', ofxPath);
  await page.waitForSelector('.budget-upload-table-row', { timeout: 5000 });

  // Status should indicate OFX format
  await expect(page.locator('.budget-upload-status')).toContainText('2 transactions');
  await expect(page.locator('.budget-upload-status')).toContainText('OFX');

  // Should show 2 transactions from the OFX data
  const rows = await page.locator('.budget-upload-table-row').count();
  expect(rows).toBe(2);
});

/* ---------- Import action ---------- */

test('budget upload import appends transactions to sheet via records', async ({ page }) => {
  const csvPath = writeTempCSV('test-import.csv', SAMPLE_CSV);

  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });
  await page.setInputFiles('.budget-upload-file-input', csvPath);
  await page.waitForSelector('.budget-upload-table-row', { timeout: 5000 });

  // Click import
  await page.click('.budget-upload-import-btn');

  // Modal should close after import
  await page.waitForSelector('#budget-upload-modal', { state: 'detached', timeout: 5000 });

  // Toast should confirm import (shown by the add-row callback)
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast').first()).toContainText('added');

  // Records should contain the appended rows
  const records = await getCreatedRecords(page);
  const appendRecord = records.find(r => r.type === 'row-append');
  expect(appendRecord).toBeTruthy();
  expect(appendRecord.rows.length).toBe(5);
});

/* ---------- Mobile responsive ---------- */

test('budget upload modal renders correctly at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('#budget-upload-modal', { timeout: 3000 });

  // Modal should be visible and not overflow
  await expect(page.locator('.budget-upload-modal-content')).toBeVisible();
  const overflow = await page.evaluate(() => {
    const modal = document.querySelector('.budget-upload-modal-content');
    if (!modal) return true;
    const rect = modal.getBoundingClientRect();
    return rect.right > window.innerWidth + 2;
  });
  expect(overflow).toBe(false);
});

/* ---------- Drop zone visual states ---------- */

test('budget upload drop zone has correct visual structure', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-016');
  await page.waitForSelector('.budget-upload-btn', { timeout: 5000 });

  await page.click('.budget-upload-btn');
  await page.waitForSelector('.budget-upload-drop-zone', { timeout: 3000 });

  // Should have drop icon, text, hint, and browse button
  await expect(page.locator('.budget-upload-drop-icon')).toBeVisible();
  await expect(page.locator('.budget-upload-drop-text')).toContainText('Drop a statement');
  await expect(page.locator('.budget-upload-drop-hint')).toContainText('CSV');
  await expect(page.locator('.budget-upload-browse-btn')).toBeVisible();
});
