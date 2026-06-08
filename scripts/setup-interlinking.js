#!/usr/bin/env node
/* ============================================================
   setup-interlinking.js — Write asset-liability interlinking
   formulas to the Dashboard tab of the Waymark Financials sheet.

   Run once after create-financials-sheet.js to wire up dynamic
   equity calculations. The formulas auto-update whenever Assets
   or Liabilities data changes in the sheet.

   Usage:
     node scripts/setup-interlinking.js --sheet-id <spreadsheetId>
     node scripts/setup-interlinking.js --sheet-id <id> --dry-run

   Flags:
     --sheet-id   Target spreadsheet ID (required)
     --dry-run    Print formula rows without writing

   Auth:
     GOOGLE_TOKEN=ya29.xxx  (user OAuth — preferred)
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json

   What it writes:
     Dashboard tab rows:
       Section header: "── Asset-Liability Interlinking ──"
       For each linked pair (mortgage → property, loan → vehicle):
         Row: "{Asset Name} Gross Value"  | =VLOOKUP(ASSET-NNN, Assets, 6, 0)
         Row: "{Asset Name} Linked Debts" | =SUMIF(Liabilities!K:K, ASSET-NNN, Liabilities!F:F)
         Row: "{Asset Name} Net Equity"   | =VLOOKUP() - SUMIF()
       Section total: "Total Property Equity" | =SUM of all net equity rows
   ============================================================ */

'use strict';

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch { /* auth loaded only if needed */ }

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
  console.error('ERROR: --sheet-id is required (or use --dry-run to preview).');
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
    console.error('ERROR: Set GOOGLE_TOKEN or GOOGLE_APPLICATION_CREDENTIALS for auth.');
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
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sheetsPost(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------- Formula builders ---------- */

/**
 * Build a VLOOKUP formula that pulls the Current Balance for an asset.
 * Assets tab: col A = Asset ID, col F (index 6) = Current Balance
 * @param {string} assetId e.g. "ASSET-004"
 * @returns {string} Google Sheets formula
 */
function grossValueFormula(assetId) {
  return `=IFERROR(VLOOKUP("${assetId}",Assets!A:F,6,FALSE),0)`;
}

/**
 * Build a SUMIF formula that sums all Liability balances linked to an asset.
 * Liabilities tab: col K = Linked Asset ID, col F = Current Balance
 * @param {string} assetId
 * @returns {string}
 */
function linkedDebtsFormula(assetId) {
  return `=IFERROR(SUMIF(Liabilities!K:K,"${assetId}",Liabilities!F:F),0)`;
}

/**
 * Net equity = gross value - linked debts.
 * References the two rows immediately above this one (relative).
 * @param {string} equityCell e.g. "B12"
 * @param {string} grossCell  e.g. "B10"
 * @param {string} debtsCell  e.g. "B11"
 * @returns {string}
 */
function netEquityFormula(grossCell, debtsCell) {
  return `=${grossCell}-${debtsCell}`;
}

/* ---------- Main ---------- */

(async () => {
  let token;
  let assetsData, liabData;

  if (dryRun) {
    // Use a sample dataset for preview
    assetsData = {
      values: [
        ['Asset ID', 'Name', 'Type', 'Institution', 'Account Number', 'Current Balance'],
        ['ASSET-004', '123 Main St', 'Property', 'N/A', 'N/A', '520000'],
        ['ASSET-005', 'Tesla Model Y', 'Vehicle', 'N/A', 'VIN', '38000'],
      ],
    };
    liabData = {
      values: [
        ['Liability ID', 'Name', 'Type', 'Institution', 'Account Number',
         'Current Balance', 'Credit Limit', 'APR', 'Min Payment', 'Due Day',
         'Linked Asset ID'],
        ['LIAB-002', 'Main St Mortgage', 'Mortgage', 'Wells Fargo', '••••8801',
         '387000', '420000', '6.875%', '2810', '1', 'ASSET-004'],
        ['LIAB-003', 'Auto Loan', 'Auto Loan', 'Capital One', '••••3312',
         '18400', '42000', '4.99%', '720', '22', 'ASSET-005'],
      ],
    };
  } else {
    token = await getToken();

    process.stderr.write('Reading Assets and Liabilities tabs...\n');
    [assetsData, liabData] = await Promise.all([
      sheetsGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Assets!A:F')}`, token),
      sheetsGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Liabilities!A:K')}`, token),
    ]);
  }

  // Parse Assets: id → { name, row index 1-based in sheet (data row = i+1) }
  const assetRows = (assetsData.values || []).slice(1);
  const assetMap  = new Map();
  for (const row of assetRows) {
    const id   = (row[0] || '').trim();
    const name = (row[1] || '').trim();
    if (id && name) assetMap.set(id, name);
  }

  // Parse Liabilities: find all rows with a Linked Asset ID (col K, index 10)
  const liabRows = (liabData.values || []).slice(1);
  const linkedAssets = new Set();
  for (const row of liabRows) {
    const linkedId = (row[10] || '').trim();
    if (linkedId) linkedAssets.add(linkedId);
  }

  if (linkedAssets.size === 0) {
    process.stderr.write('No linked assets found. Add a Linked Asset ID to Liabilities rows first.\n');
    if (!dryRun) process.exit(0);
  }

  // Build the Dashboard rows to append
  // Structure:
  //   ["── Asset-Liability Interlinking ──", "", "Auto-updated formulas"]
  //   For each linked asset:
  //     ["{Name} Gross Value",   formula]
  //     ["{Name} Linked Debts",  formula]
  //     ["{Name} Net Equity",    formula]
  //   ["Total Linked Equity", =SUM of all net equity cells]

  const dashRows = [
    ['── Asset-Liability Interlinking ──', '', 'Formulas auto-update when Assets/Liabilities change'],
  ];

  // We need to know where on the Dashboard sheet these rows will land.
  // Read existing Dashboard row count to compute absolute cell refs.
  let dashStartRow = 9; // default: after the initial 7 metric rows + header + 1 blank
  if (!dryRun) {
    const dashData = await sheetsGet(
      `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Dashboard!A:A')}`,
      token,
    );
    dashStartRow = (dashData.values || []).length + 1; // next empty row (1-based)
  }

  // Header row is at dashStartRow; asset rows follow
  let currentRow = dashStartRow + 1; // first asset row (1-based in sheet)
  const equityCells = [];

  for (const assetId of linkedAssets) {
    const name = assetMap.get(assetId) || assetId;
    const grossCell  = `B${currentRow}`;
    const debtsCell  = `B${currentRow + 1}`;
    const equityCell = `B${currentRow + 2}`;

    dashRows.push([`${name} — Gross Value`,   grossValueFormula(assetId),   `=IFERROR(VLOOKUP("${assetId}",Assets!A:B,2,FALSE),"")`]);
    dashRows.push([`${name} — Linked Debts`,  linkedDebtsFormula(assetId),  '']);
    dashRows.push([`${name} — Net Equity`,    netEquityFormula(grossCell, debtsCell), '']);

    equityCells.push(equityCell);
    currentRow += 3;
  }

  // Total row
  dashRows.push(['Total Linked Equity', `=SUM(${equityCells.join(',')})`, '']);

  if (dryRun) {
    console.log(JSON.stringify({ startRow: dashStartRow, linkedAssets: [...linkedAssets], rows: dashRows }, null, 2));
    process.exit(0);
  }

  // Append to Dashboard tab
  process.stderr.write(`Writing ${dashRows.length} interlinking rows to Dashboard (starting row ${dashStartRow})...\n`);
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Dashboard!A:C')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    { values: dashRows },
  );

  process.stderr.write('Done.\n');
  process.stdout.write(JSON.stringify({
    ok: true,
    linkedAssets: [...linkedAssets],
    rowsWritten: dashRows.length,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
  }) + '\n');
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
