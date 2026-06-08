#!/usr/bin/env node
/* ============================================================
   snapshot-net-worth.js — Record a net worth snapshot to the
   NetWorthHistory tab of the Waymark Financials sheet.

   Reads current totals from the Dashboard tab and appends a
   timestamped row to NetWorthHistory. Run monthly (or manually
   after reconciling) to build a net-worth-over-time history.

   Usage:
     GOOGLE_TOKEN=ya29.xxx node scripts/snapshot-net-worth.js \
       --sheet-id <spreadsheetId> \
       [--notes "After May reconciliation"] \
       [--date 2026-05-31]   (default: today)
       [--dry-run]

   Output:
     JSON to stdout: { ok, date, netWorth, totalAssets, totalLiabilities }
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
const notes   = flags['notes'] || '';
const rawDate = flags['date'];

if (!sheetId && !dryRun) {
  console.error('ERROR: --sheet-id is required (or --dry-run).');
  process.exit(1);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const snapshotDate = rawDate || today();

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

/* ---------- Main ---------- */

(async () => {
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, snapshotDate, notes }, null, 2));
    process.exit(0);
  }

  const token = await getToken();

  // 1. Read current values from Assets and Liabilities tabs directly
  //    (more reliable than reading computed Dashboard values)
  process.stderr.write('Reading Assets and Liabilities totals...\n');
  const [assetsData, liabData, txData] = await Promise.all([
    sheetsGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Assets!F2:F1000')}`, token),
    sheetsGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Liabilities!F2:F1000')}`, token),
    sheetsGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Transactions!E2:G1000')}`, token),
  ]);

  const totalAssets = (assetsData.values || []).flat()
    .reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const totalLiabilities = (liabData.values || []).flat()
    .reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const netWorth = totalAssets - totalLiabilities;

  // Monthly cash flow: credits - abs(debits) for current month
  const curMonth = snapshotDate.slice(0, 7); // YYYY-MM
  const txRows = (txData.values || []);
  let monthCredits = 0;
  let monthDebits  = 0;
  // txData is E:G — Amount(0), Category(1), Type(2)
  // But we need date column A to filter by month.
  // Re-fetch with date column for accuracy.
  const txFull = await sheetsGet(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Transactions!A2:G1000')}`,
    token,
  );
  for (const row of (txFull.values || [])) {
    const date = (row[0] || '').slice(0, 7);
    if (date !== curMonth) continue;
    const amount = parseFloat(row[4]) || 0;
    const type   = (row[6] || '').toLowerCase();
    if (type === 'credit') monthCredits += amount;
    else if (type === 'debit') monthDebits += Math.abs(amount);
  }
  const monthlyCashFlow = monthCredits - monthDebits;

  process.stderr.write(`Net Worth:         ${netWorth.toFixed(2)}\n`);
  process.stderr.write(`Total Assets:      ${totalAssets.toFixed(2)}\n`);
  process.stderr.write(`Total Liabilities: ${totalLiabilities.toFixed(2)}\n`);
  process.stderr.write(`Monthly Cash Flow: ${monthlyCashFlow.toFixed(2)} (${curMonth})\n`);

  // 2. Append to NetWorthHistory tab
  process.stderr.write('\nAppending snapshot to NetWorthHistory...\n');
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('NetWorthHistory!A:F')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    {
      values: [[
        snapshotDate,
        netWorth.toFixed(2),
        totalAssets.toFixed(2),
        totalLiabilities.toFixed(2),
        monthlyCashFlow.toFixed(2),
        notes,
      ]],
    },
  );

  process.stderr.write('Done.\n');
  process.stdout.write(JSON.stringify({
    ok: true,
    date: snapshotDate,
    netWorth,
    totalAssets,
    totalLiabilities,
    monthlyCashFlow,
    notes,
  }, null, 2) + '\n');
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
