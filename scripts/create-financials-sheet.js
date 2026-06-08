#!/usr/bin/env node
/* ============================================================
   create-financials-sheet.js — Bootstrap a Waymark Financials
   Google Spreadsheet with all tabs, headers, and formatting.

   Usage:
     # With a user OAuth token (recommended — creates in your personal Drive):
     GOOGLE_TOKEN=ya29.xxx node scripts/create-financials-sheet.js

     # With a service account (only works if your domain has Drive delegation):
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json \
       node scripts/create-financials-sheet.js [--title "My Financials"]

   Flags:
     --title   Custom spreadsheet title (default: "Waymark Financials")
     --folder  Parent Drive folder ID to place the sheet inside (optional)

   Auth priority:
     1. GOOGLE_TOKEN env var (user OAuth — preferred for personal Drive)
     2. GOOGLE_APPLICATION_CREDENTIALS (service account — needs delegation for Drive)

   Output:
     Prints the new spreadsheet URL to stdout.
   ============================================================ */

'use strict';

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch {
  console.error('ERROR: google-auth-library not found. Run: npm install google-auth-library');
  process.exit(1);
}

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE  = 'https://www.googleapis.com/drive/v3/files';

/* ---------- CLI args ---------- */

const args = process.argv.slice(2);
let title  = 'Waymark Financials';
let parentFolderId = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--title'  && args[i + 1]) { title = args[++i]; }
  if (args[i] === '--folder' && args[i + 1]) { parentFolderId = args[++i]; }
}

/* ---------- Sheet definitions ---------- */

const SHEETS = [
  {
    title: 'Assets',
    headers: [
      'Asset ID', 'Name', 'Type', 'Institution', 'Account Number',
      'Current Balance', 'Opening Balance', 'Interest Rate',
      'Open Date', 'Status', 'Notes',
    ],
    columnWidths: [100, 200, 150, 180, 140, 130, 130, 110, 110, 90, 250],
  },
  {
    title: 'Liabilities',
    headers: [
      'Liability ID', 'Name', 'Type', 'Institution', 'Account Number',
      'Current Balance', 'Credit Limit / Original Amount', 'Interest Rate (APR)',
      'Minimum Payment', 'Payment Due Day', 'Linked Asset ID',
      'Open Date', 'Status', 'Notes',
    ],
    columnWidths: [110, 200, 150, 180, 140, 130, 220, 150, 130, 130, 130, 110, 90, 250],
  },
  {
    title: 'Transactions',
    headers: [
      'Date', 'Entity ID', 'Entity Name', 'Description',
      'Amount', 'Category', 'Type', 'Running Balance',
      'Statement ID', 'Reconciled', 'Notes',
    ],
    columnWidths: [110, 110, 200, 300, 110, 130, 100, 130, 110, 90, 250],
  },
  {
    title: 'Statements',
    headers: [
      'Statement ID', 'Entity ID', 'Entity Name', 'Statement Date',
      'Opening Balance', 'Closing Balance', 'Total Debits', 'Total Credits',
      'Minimum Payment Due', 'Payment Due Date',
      'Drive File ID', 'Drive File Name', 'Reconciled', 'Notes',
    ],
    columnWidths: [110, 110, 200, 120, 130, 130, 110, 110, 150, 130, 200, 250, 90, 250],
  },
  {
    title: 'Dashboard',
    headers: ['Metric', 'Value', 'Notes'],
    columnWidths: [250, 180, 400],
  },
];

/* ---------- Colour tokens ---------- */

const HEADER_BG = { red: 0.133, green: 0.267, blue: 0.612 }; // #223EA1 → brand blue
const HEADER_FG = { red: 1, green: 1, blue: 1 };              // white
const ALT_ROW   = { red: 0.945, green: 0.957, blue: 0.980 };  // #F1F5FA subtle stripe

/* ---------- Build Sheets API requests ---------- */

/**
 * Builds the spreadsheet create body with all sheets pre-defined.
 * @returns {Object} Sheets API v4 Spreadsheet resource
 */
function buildCreateBody() {
  return {
    properties: { title },
    sheets: SHEETS.map((def, i) => ({
      properties: {
        sheetId: i,
        title: def.title,
        index: i,
        gridProperties: { rowCount: 1000, columnCount: def.headers.length, frozenRowCount: 1 },
      },
    })),
  };
}

/**
 * Builds a batchUpdate body: header rows, formatting, column widths.
 * @param {Object} created — Spreadsheet create response
 * @returns {Object[]} Array of batchUpdate request objects
 */
function buildBatchRequests(created) {
  const requests = [];

  for (const [i, def] of SHEETS.entries()) {
    const sheetId = created.sheets[i].properties.sheetId;

    // 1. Bold + colour header row
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: HEADER_BG,
            textFormat: { foregroundColor: HEADER_FG, bold: true, fontSize: 10 },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    });

    // 2. Alternating row band (rows 1→999, every other pair)
    requests.push({
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 1000 },
          rowProperties: {
            secondBandColor: ALT_ROW,
            headerColor: HEADER_BG,
          },
        },
      },
    });

    // 3. Column widths
    for (const [col, px] of def.columnWidths.entries()) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: col,
            endIndex: col + 1,
          },
          properties: { pixelSize: px },
          fields: 'pixelSize',
        },
      });
    }

    // 4. Row height for the header row
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 },
        fields: 'pixelSize',
      },
    });
  }

  return requests;
}

/* ---------- API helpers ---------- */

/**
 * @param {string} url
 * @param {string} token
 * @param {string} method
 * @param {Object|null} body
 * @returns {Promise<Object>}
 */
async function sheetsRequest(url, token, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Write header rows via batchUpdate values.
 * @param {string} spreadsheetId
 * @param {string} token
 */
async function writeHeaders(spreadsheetId, token) {
  const data = SHEETS.map(def => ({
    range: `${def.title}!A1`,
    values: [def.headers],
  }));

  await sheetsRequest(
    `${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`,
    token,
    'POST',
    { valueInputOption: 'RAW', data },
  );
}

/**
 * Write Dashboard metric skeleton rows.
 * @param {string} spreadsheetId
 * @param {string} token
 */
async function writeDashboard(spreadsheetId, token) {
  const rows = [
    ['Net Worth',         `=SUM(Assets!F2:F1000)-SUM(Liabilities!F2:F1000)`, ''],
    ['Total Assets',      `=SUM(Assets!F2:F1000)`, ''],
    ['Total Liabilities', `=SUM(Liabilities!F2:F1000)`, ''],
    ['Cash & Liquid',     `=SUMIF(Assets!C2:C1000,"Bank Account",Assets!F2:F1000)+SUMIF(Assets!C2:C1000,"Savings Account",Assets!F2:F1000)`, ''],
    ['Monthly Income',    `=SUMIF(Transactions!G2:G1000,"Credit",Transactions!E2:E1000)`, 'Current month total credits'],
    ['Monthly Expenses',  `=ABS(SUMIF(Transactions!G2:G1000,"Debit",Transactions!E2:E1000))`, 'Current month total debits'],
    ['Open Liabilities',  `=COUNTIF(Liabilities!M2:M1000,"Active")`, ''],
  ];

  await sheetsRequest(
    `${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`,
    token,
    'POST',
    {
      valueInputOption: 'USER_ENTERED',
      data: [{ range: 'Dashboard!A2', values: rows }],
    },
  );
}

/**
 * If parentFolderId is given, move the sheet there via Drive API.
 * @param {string} fileId
 * @param {string} token
 */
async function moveToFolder(fileId, token) {
  const res = await fetch(
    `${DRIVE_BASE}/${fileId}?addParents=${parentFolderId}&removeParents=root&fields=id,parents`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    console.warn(`WARNING: Could not move to folder (${res.status}): ${text}`);
  }
}

/* ---------- Main ---------- */

(async () => {
  // Auth priority: user OAuth token → service account
  let token;

  if (process.env.GOOGLE_TOKEN) {
    token = process.env.GOOGLE_TOKEN;
    process.stderr.write('Using GOOGLE_TOKEN (user OAuth).\n');
  } else {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath) {
      console.error('ERROR: Set GOOGLE_TOKEN (user OAuth) or GOOGLE_APPLICATION_CREDENTIALS.');
      console.error('       Service accounts cannot create sheets in personal Drive without delegation.');
      process.exit(1);
    }
    process.stderr.write('Using service account (GOOGLE_APPLICATION_CREDENTIALS).\n');
    const auth = new GoogleAuth({
      keyFile: credPath,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
    const client = await auth.getClient();
    ({ token } = await client.getAccessToken());
  }

  // Step 1 — Create the spreadsheet
  process.stderr.write('Creating spreadsheet...\n');
  const created = await sheetsRequest(SHEETS_BASE, token, 'POST', buildCreateBody());
  const { spreadsheetId } = created;

  // Step 2 — Write headers to all tabs
  process.stderr.write('Writing headers...\n');
  await writeHeaders(spreadsheetId, token);

  // Step 3 — Apply formatting (bold header, banding, column widths)
  process.stderr.write('Applying formatting...\n');
  const batchRequests = buildBatchRequests(created);
  await sheetsRequest(
    `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`,
    token,
    'POST',
    { requests: batchRequests },
  );

  // Step 4 — Write Dashboard formula skeleton
  process.stderr.write('Writing dashboard formulas...\n');
  await writeDashboard(spreadsheetId, token);

  // Step 5 — Move to folder if specified
  if (parentFolderId) {
    process.stderr.write(`Moving to folder ${parentFolderId}...\n`);
    await moveToFolder(spreadsheetId, token);
  }

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  process.stderr.write('Done.\n');
  process.stdout.write(`${url}\n`);
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
