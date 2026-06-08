#!/usr/bin/env node
/* ============================================================
   build-dashboard.js — Populate / refresh the Dashboard tab and
   create the NetWorthHistory tab in a Waymark Financials sheet.

   Writes:
     Dashboard tab — comprehensive sections:
       § Summary          Net Worth, Assets, Liabilities, Cash & Liquid
       § Cash Flow        Monthly income/expense/net by last 12 months
       § Asset Breakdown  Balance by asset type (Bank, Savings, Investment, …)
       § Liability Breakdown  Balance by liability type + min payment totals
       § Equity           (placeholder — interlinking formulas added separately)

     NetWorthHistory tab — columns: Date | Net Worth | Total Assets |
       Total Liabilities | Monthly Cash Flow | Notes
       Created if it doesn't exist; existing rows are preserved.

   Usage:
     GOOGLE_TOKEN=ya29.xxx node scripts/build-dashboard.js \
       --sheet-id <spreadsheetId> [--dry-run]

   Flags:
     --sheet-id   Target spreadsheet ID (required unless --dry-run)
     --dry-run    Print formula rows to stdout; don't write

   Auth:
     GOOGLE_TOKEN=ya29.xxx
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
   ============================================================ */

'use strict';

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch { /* auth loaded only when writing */ }

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- CLI ---------- */

const args  = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, '');
  if (args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
  else flags[key] = true;
}

const sheetId = flags['sheet-id'];
const dryRun  = !!flags['dry-run'];

if (!sheetId && !dryRun) {
  console.error('ERROR: --sheet-id is required (or --dry-run to preview).');
  process.exit(1);
}

/* ---------- Auth ---------- */

async function getToken() {
  if (process.env.GOOGLE_TOKEN) return process.env.GOOGLE_TOKEN;
  if (!GoogleAuth) {
    console.error('ERROR: google-auth-library not found. Run: npm install google-auth-library');
    process.exit(1);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('ERROR: Set GOOGLE_TOKEN or GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const auth = new GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/* ---------- Sheets helpers ---------- */

async function sheetsGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets GET ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sheetsPost(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheets POST ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------- Month helpers ---------- */

/**
 * Return the last N year-month strings in YYYY-MM order (most recent last).
 * @param {number} n
 * @returns {string[]}
 */
function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    );
  }
  return months;
}

/* ---------- Dashboard section builders ---------- */

/**
 * § 0 — Section header row.
 * @param {string} label
 * @returns {string[][]}
 */
function sectionHeader(label) {
  return [[`── ${label} ──`, '', '']];
}

/**
 * § 1 — Summary section (replaces basic rows from create-financials-sheet.js).
 * Writes static metric labels + live formulas.
 */
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

/**
 * § 2 — Monthly Cash Flow (last 12 months).
 * Uses SUMPRODUCT + TEXT() to filter Transactions by month string.
 */
function buildCashFlowRows() {
  const months = lastNMonths(12);
  const rows   = [...sectionHeader('Monthly Cash Flow (last 12 months)')];

  // Sub-header
  rows.push(['Month', 'Income (Credits)', 'Expenses (Debits)', 'Net']);

  for (const ym of months) {
    // Use pre-computed Month index column (L) instead of TEXT(A,"YYYY-MM").
    // TEXT() is evaluated on every cell per recalc; a stored string is a direct
    // lookup — equivalent to adding a database index on the date column.
    const income   = `=IFERROR(SUMPRODUCT((Transactions!L2:L1000="${ym}")*(Transactions!G2:G1000="Credit")*(Transactions!E2:E1000)),0)`;
    const expenses = `=IFERROR(ABS(SUMPRODUCT((Transactions!L2:L1000="${ym}")*(Transactions!G2:G1000="Debit")*(Transactions!E2:E1000))),0)`;
    const net      = `=B${rows.length + 2}-C${rows.length + 2}`;
    rows.push([ym, income, expenses, net]);
  }

  rows.push(['12-Month Total', '=SUM(B__START__:B__END__)', '=SUM(C__START__:C__END__)', '=SUM(D__START__:D__END__)']);
  rows.push(['', '', '', '']);
  return rows;
}

/**
 * § 3 — Asset Breakdown by type.
 */
function buildAssetBreakdownRows() {
  const types = [
    'Bank Account',
    'Savings Account',
    'Investment',
    'Brokerage',
    'Property',
    'Vehicle',
    'Retirement',
    'Other',
  ];
  const rows = [...sectionHeader('Asset Breakdown by Type')];
  rows.push(['Type', 'Balance', 'Count']);
  for (const t of types) {
    rows.push([
      t,
      `=IFERROR(SUMIF(Assets!C2:C1000,"${t}",Assets!F2:F1000),0)`,
      `=IFERROR(COUNTIF(Assets!C2:C1000,"${t}"),0)`,
    ]);
  }
  rows.push(['Total', '=SUM(Assets!F2:F1000)', '=COUNTA(Assets!A2:A1000)']);
  rows.push(['', '', '']);
  return rows;
}

/**
 * § 4 — Liability Breakdown by type.
 */
function buildLiabilityBreakdownRows() {
  const types = [
    'Credit Card',
    'Mortgage',
    'Auto Loan',
    'Student Loan',
    'Personal Loan',
    'Line of Credit',
    'Other',
  ];
  const rows = [...sectionHeader('Liability Breakdown by Type')];
  rows.push(['Type', 'Balance', 'Count', 'Min Payments']);
  for (const t of types) {
    rows.push([
      t,
      `=IFERROR(SUMIF(Liabilities!C2:C1000,"${t}",Liabilities!F2:F1000),0)`,
      `=IFERROR(COUNTIF(Liabilities!C2:C1000,"${t}"),0)`,
      `=IFERROR(SUMIF(Liabilities!C2:C1000,"${t}",Liabilities!I2:I1000),0)`,
    ]);
  }
  rows.push(['Total', '=SUM(Liabilities!F2:F1000)', '=COUNTA(Liabilities!A2:A1000)', '=SUM(Liabilities!I2:I1000)']);
  rows.push(['', '', '', '']);
  return rows;
}

/* ---------- NetWorthHistory tab ---------- */

const NWH_HEADERS = [
  'Date', 'Net Worth', 'Total Assets', 'Total Liabilities',
  'Monthly Cash Flow', 'Notes',
];

/**
 * Ensure the NetWorthHistory tab exists. Returns its sheetId.
 * @param {Object} spreadsheet — spreadsheet resource from get
 * @param {string} token
 * @returns {Promise<number>} internal sheetId integer
 */
async function ensureNetWorthHistoryTab(spreadsheet, token) {
  const existing = spreadsheet.sheets.find(
    s => s.properties.title === 'NetWorthHistory',
  );
  if (existing) {
    process.stderr.write('NetWorthHistory tab already exists.\n');
    return existing.properties.sheetId;
  }

  process.stderr.write('Creating NetWorthHistory tab...\n');
  const res = await sheetsPost(
    `${SHEETS_BASE}/${sheetId}:batchUpdate`,
    token,
    {
      requests: [{
        addSheet: {
          properties: {
            title: 'NetWorthHistory',
            gridProperties: { rowCount: 500, columnCount: 6, frozenRowCount: 1 },
          },
        },
      }],
    },
  );
  const newSheetId = res.replies[0].addSheet.properties.sheetId;

  // Write headers
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}/values:batchUpdate`,
    token,
    {
      valueInputOption: 'RAW',
      data: [{ range: 'NetWorthHistory!A1', values: [NWH_HEADERS] }],
    },
  );

  // Format header row
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}:batchUpdate`,
    token,
    {
      requests: [
        {
          repeatCell: {
            range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.133, green: 0.267, blue: 0.612 },
                textFormat: {
                  foregroundColor: { red: 1, green: 1, blue: 1 },
                  bold: true,
                  fontSize: 10,
                },
                horizontalAlignment: 'LEFT',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: newSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 36 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: newSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 120 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: newSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 4 },
            properties: { pixelSize: 150 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: newSheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 6 },
            properties: { pixelSize: 200 },
            fields: 'pixelSize',
          },
        },
      ],
    },
  );

  return newSheetId;
}

/* ---------- Dashboard write ---------- */

/**
 * Clear and rewrite the Dashboard tab with all sections.
 * @param {number} dashSheetId
 * @param {string} token
 */
async function writeDashboard(dashSheetId, token) {
  // Clear current Dashboard content (keep header row by clearing A2:Z500)
  process.stderr.write('Clearing existing Dashboard content...\n');
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Dashboard!A1:Z500')}:clear`,
    token,
    {},
  );

  // Build all rows
  const summaryRows  = buildSummaryRows();
  const cfRows       = buildCashFlowRows();
  const assetRows    = buildAssetBreakdownRows();
  const liabRows     = buildLiabilityBreakdownRows();

  // Fix up cash flow total row's relative row references
  // The total row uses placeholder __START__ / __END__
  const cfDataStart = summaryRows.length + 2 + 1; // 1-based: after summary + header row + 1
  const cfDataEnd   = cfDataStart + 11;            // 12 month rows
  const totalRowIdx = cfRows.length - 2;           // second-to-last (before blank)
  cfRows[totalRowIdx][1] = cfRows[totalRowIdx][1].replace('__START__', cfDataStart).replace('__END__', cfDataEnd);
  cfRows[totalRowIdx][2] = cfRows[totalRowIdx][2].replace('__START__', cfDataStart).replace('__END__', cfDataEnd);
  cfRows[totalRowIdx][3] = cfRows[totalRowIdx][3].replace('__START__', cfDataStart).replace('__END__', cfDataEnd);

  const allRows = [...summaryRows, ...cfRows, ...assetRows, ...liabRows];

  process.stderr.write(`Writing ${allRows.length} rows to Dashboard...\n`);
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}/values:batchUpdate`,
    token,
    {
      valueInputOption: 'USER_ENTERED',
      data: [{ range: 'Dashboard!A1', values: allRows }],
    },
  );

  // Format section header rows (bold, background)
  const SECTION_BG = { red: 0.22, green: 0.22, blue: 0.22 };
  const SECTION_FG = { red: 1, green: 1, blue: 1 };

  const sectionRowOffsets = [
    0,                                         // Summary header
    summaryRows.length,                        // Cash Flow header
    summaryRows.length + cfRows.length,        // Asset Breakdown header
    summaryRows.length + cfRows.length + assetRows.length, // Liability header
  ];

  const formatRequests = sectionRowOffsets.map(offset => ({
    repeatCell: {
      range: { sheetId: dashSheetId, startRowIndex: offset, endRowIndex: offset + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: SECTION_BG,
          textFormat: { foregroundColor: SECTION_FG, bold: true, fontSize: 10 },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  }));

  await sheetsPost(`${SHEETS_BASE}/${sheetId}:batchUpdate`, token, { requests: formatRequests });
}

/* ---------- Main ---------- */

(async () => {
  if (dryRun) {
    const summaryRows = buildSummaryRows();
    const cfRows      = buildCashFlowRows();
    const assetRows   = buildAssetBreakdownRows();
    const liabRows    = buildLiabilityBreakdownRows();
    console.log(JSON.stringify({
      dryRun: true,
      sections: {
        summary:           { rows: summaryRows.length },
        cashFlow:          { rows: cfRows.length },
        assetBreakdown:    { rows: assetRows.length },
        liabilityBreakdown:{ rows: liabRows.length },
      },
      netWorthHistoryHeaders: NWH_HEADERS,
      preview: {
        dashboard: [...summaryRows, ...cfRows, ...assetRows, ...liabRows].slice(0, 20),
      },
    }, null, 2));
    process.exit(0);
  }

  const token = await getToken();

  // 1. Fetch spreadsheet metadata
  process.stderr.write('Fetching spreadsheet metadata...\n');
  const spreadsheet = await sheetsGet(
    `${SHEETS_BASE}/${sheetId}?fields=sheets.properties`,
    token,
  );

  // 2. Find Dashboard tab's sheetId
  const dashSheet = spreadsheet.sheets.find(s => s.properties.title === 'Dashboard');
  if (!dashSheet) {
    console.error('ERROR: Dashboard tab not found. Run make create-financials-sheet first.');
    process.exit(1);
  }
  const dashSheetId = dashSheet.properties.sheetId;

  // 3. Ensure NetWorthHistory tab exists
  await ensureNetWorthHistoryTab(spreadsheet, token);

  // 4. Write the full Dashboard
  process.stderr.write('\nBuilding Dashboard...\n');
  await writeDashboard(dashSheetId, token);

  process.stderr.write('\nDone.\n');
  process.stdout.write(JSON.stringify({
    ok: true,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    dashboardTab: 'Dashboard',
    netWorthHistoryTab: 'NetWorthHistory',
  }, null, 2) + '\n');
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
