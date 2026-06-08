#!/usr/bin/env node
/* ============================================================
   import-statement.js — Parse a bank/credit-card CSV statement
   and load transactions into the Waymark Financials Google Sheet.

   Usage:
     node scripts/import-statement.js \
       --file /path/to/chase-2026-05.csv \
       --entity LIAB-001 \
       --sheet-id <spreadsheetId> \
       [--statement-date 2026-05-31] \
       [--dry-run]

   Flags:
     --file           Path to the CSV file (required)
     --entity         Entity ID to tag transactions (ASSET-NNN or LIAB-NNN, required)
     --sheet-id       Google Spreadsheet ID to write into (required unless --dry-run)
     --statement-date ISO date for the statement record (default: last date in CSV)
     --dry-run        Parse only — print rows, do not write to the sheet
     --entity-name    Human name for the entity (default: auto-detected from sheet)

   Supported CSV formats (auto-detected from headers):
     - Chase Credit Card
     - Chase Checking / Savings
     - Ally Bank
     - Bank of America
     - Citi
     - American Express
     - Capital One
     - Wells Fargo
     - Generic (fallback — must have Date and Amount columns)

   Auth (for writing):
     GOOGLE_TOKEN=ya29.xxx  (user OAuth — preferred)
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json  (service account)

   Output:
     Prints summary of parsed transactions to stderr.
     If --dry-run, prints JSON rows to stdout.
     Otherwise writes to Transactions and Statements tabs, prints row count.
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch {
  // auth only needed when writing — handled below
}

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- CLI args ---------- */

const args  = process.argv.slice(2);
const flags = {};

for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, '');
  if (args[i + 1] && !args[i + 1].startsWith('--')) {
    flags[key] = args[++i];
  } else {
    flags[key] = true;
  }
}

const filePath     = flags['file'];
const entityId     = flags['entity'];
const sheetId      = flags['sheet-id'];
const dryRun       = !!flags['dry-run'];
const entityName   = flags['entity-name'] || '';
let stmtDate       = flags['statement-date'] || '';

if (!filePath) { console.error('ERROR: --file is required'); process.exit(1); }
if (!entityId) { console.error('ERROR: --entity is required (e.g. LIAB-001)'); process.exit(1); }
if (!dryRun && !sheetId) { console.error('ERROR: --sheet-id is required (or use --dry-run)'); process.exit(1); }

/* ---------- CSV parser ---------- */

/**
 * Parse a CSV string into an array of row arrays.
 * Handles quoted fields, commas inside quotes, escaped quotes.
 * @param {string} csv
 * @returns {string[][]}
 */
function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    const next = csv[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field.trim()); field = ''; }
      else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        if (ch === '\r') i++;
        row.push(field.trim());
        if (row.some(c => c !== '')) rows.push(row);
        row = []; field = '';
      } else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(c => c !== '')) rows.push(row); }

  return rows;
}

/* ---------- Format detection ---------- */

/**
 * Detect the bank format from lowercased header strings.
 * Returns a format key.
 * @param {string[]} headers — lowercased
 * @returns {string}
 */
function detectFormat(headers) {
  const h = headers.join('|');

  // Chase Credit Card: "transaction date,post date,description,category,type,amount,memo"
  if (/transaction date/.test(h) && /post date/.test(h) && /memo/.test(h)) return 'chase-credit';

  // Chase Checking: "details,posting date,description,amount,type,balance,check or slip"
  if (/posting date/.test(h) && /check or slip/.test(h)) return 'chase-checking';

  // Capital One: "transaction date,posted date,card no.,description,category,debit,credit"
  if (/card no/.test(h) && /posted date/.test(h)) return 'capital-one';

  // Citi: "date,description,debit,credit" (simple 4-col)
  if (/\bdebit\b/.test(h) && /\bcredit\b/.test(h) && !/card no/.test(h) && !/category/.test(h)) return 'citi';

  // Amex: "date,description,amount,extended details,appears on your statement"
  if (/extended details/.test(h) || /appears on your statement/.test(h)) return 'amex';

  // Ally: "date,time,amount,type,description"
  if (/\btime\b/.test(h) && /\btype\b/.test(h) && /\bdescription\b/.test(h) && headers.length <= 6) return 'ally';

  // Bank of America: "posted date,reference number,payee,address,amount"
  if (/reference number/.test(h) && /payee/.test(h)) return 'bofa';

  // Wells Fargo: typically 5 cols with date,amount,*,*,description
  if (headers.length === 5 && /date/.test(headers[0]) && /amount/.test(headers[1])) return 'wells-fargo';

  // Generic fallback — needs at least a date and amount
  return 'generic';
}

/* ---------- Format normalizers ---------- */

/**
 * Find column index by regex from lowercased headers.
 * @param {string[]} headers
 * @param {RegExp} re
 * @returns {number}
 */
function col(headers, re) {
  return headers.findIndex(h => re.test(h));
}

/** Parse a dollar amount string to a signed float (debits negative). */
function parseAmount(str, isDebit = false) {
  if (!str) return 0;
  const n = parseFloat(str.replace(/[$, ]/g, '')) || 0;
  return isDebit ? -Math.abs(n) : n;
}

/** Infer transaction type from amount and format hints. */
function inferType(amount, raw = '') {
  const positive = amount > 0;
  const lower = raw.toLowerCase();
  if (/payment|thank you|credit|refund|return/.test(lower) && positive) return 'Credit';
  if (/interest|fee/.test(lower) && !positive) return /interest/.test(lower) ? 'Interest' : 'Fee';
  if (/transfer/.test(lower)) return 'Transfer';
  return positive ? 'Credit' : 'Debit';
}

/** Guess a spending category from a description string. */
function guessCategory(desc) {
  const d = desc.toLowerCase();
  if (/amazon|walmart|target|costco|best buy|ebay|etsy/.test(d)) return 'Shopping';
  if (/grocery|whole foods|trader joe|safeway|kroger|publix|aldi|sprouts/.test(d)) return 'Groceries';
  if (/restaurant|mcdonald|starbucks|chipotle|doordash|grubhub|uber eats|pizza/.test(d)) return 'Dining';
  if (/netflix|spotify|hulu|disney|apple|google play|youtube/.test(d)) return 'Entertainment';
  if (/shell|chevron|bp|exxon|gas|fuel|parking|toll|lyft|uber|transit/.test(d)) return 'Transportation';
  if (/cvs|walgreens|pharmacy|doctor|dentist|hospital|medical|health/.test(d)) return 'Healthcare';
  if (/insurance|geico|allstate|state farm/.test(d)) return 'Insurance';
  if (/airline|hotel|airbnb|vrbo|expedia|booking|travel/.test(d)) return 'Travel';
  if (/mortgage|rent|hoa|utilities|electric|gas bill|water|comcast|att|verizon/.test(d)) return 'Housing';
  if (/payment thank you|autopay|bill pay/.test(d)) return 'Payment';
  if (/direct deposit|payroll|zelle|venmo received/.test(d)) return 'Income';
  if (/transfer/.test(d)) return 'Transfer';
  return 'Other';
}

/**
 * Normalize a parsed CSV row array using a format-specific mapping.
 * Returns { date, description, amount, category, type } or null to skip.
 */
const NORMALIZERS = {
  'chase-credit'(row, headers) {
    const date = row[col(headers, /transaction date/)];
    const desc = row[col(headers, /^description$/)];
    const rawAmt = row[col(headers, /^amount$/)];
    if (!date || !rawAmt) return null;
    const amount = parseFloat(rawAmt.replace(/[$, ]/g, '')) || 0;
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: inferType(amount, desc) };
  },
  'chase-checking'(row, headers) {
    const date = row[col(headers, /posting date/)];
    const desc = row[col(headers, /^description$/)];
    const rawAmt = row[col(headers, /^amount$/)];
    if (!date || !rawAmt) return null;
    const amount = parseFloat(rawAmt.replace(/[$, ]/g, '')) || 0;
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: inferType(amount, desc) };
  },
  'capital-one'(row, headers) {
    const date = row[col(headers, /transaction date/)];
    const desc = row[col(headers, /^description$/)];
    const debit  = row[col(headers, /^debit$/)];
    const credit = row[col(headers, /^credit$/)];
    if (!date) return null;
    const amount = credit ? parseAmount(credit) : parseAmount(debit, true);
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: credit ? 'Credit' : 'Debit' };
  },
  'citi'(row, headers) {
    const date = row[col(headers, /^date$/)];
    const desc  = row[col(headers, /^description$/)];
    const debit  = row[col(headers, /^debit$/)];
    const credit = row[col(headers, /^credit$/)];
    if (!date) return null;
    const amount = credit ? parseAmount(credit) : parseAmount(debit, true);
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: credit ? 'Credit' : 'Debit' };
  },
  'amex'(row, headers) {
    const date = row[col(headers, /^date$/)];
    const desc  = row[col(headers, /^description$/)];
    const rawAmt = row[col(headers, /^amount$/)];
    if (!date || !rawAmt) return null;
    // Amex: positive = charge, negative = credit/payment
    const amount = -parseFloat(rawAmt.replace(/[$, ]/g, '')) || 0;
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: inferType(amount, desc) };
  },
  'ally'(row, headers) {
    const date = row[col(headers, /^date$/)];
    const desc  = row[col(headers, /^description$/)];
    const rawAmt = row[col(headers, /^amount$/)];
    if (!date || !rawAmt) return null;
    const amount = parseFloat(rawAmt.replace(/[$, ]/g, '')) || 0;
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: inferType(amount, desc) };
  },
  'bofa'(row, headers) {
    const date = row[col(headers, /posted date/)];
    const desc  = row[col(headers, /payee/)];
    const rawAmt = row[col(headers, /^amount$/)];
    if (!date || !rawAmt) return null;
    const amount = parseFloat(rawAmt.replace(/[$, ]/g, '')) || 0;
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: inferType(amount, desc) };
  },
  'wells-fargo'(row) {
    // 5 cols: date, amount, *, *, description
    const [date, rawAmt, , , desc] = row;
    if (!date || !rawAmt) return null;
    const amount = parseFloat(rawAmt.replace(/[$, ]/g, '')) || 0;
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: inferType(amount, desc) };
  },
  'generic'(row, headers) {
    const date = row[col(headers, /date/)] || '';
    const desc  = row[col(headers, /description|memo|narrative|detail/)] || row[1] || '';
    const rawAmt = row[col(headers, /amount/)] || '';
    if (!date || !rawAmt) return null;
    const amount = parseFloat(rawAmt.replace(/[$, ]/g, '')) || 0;
    return { date: normalizeDate(date), description: desc, amount, category: guessCategory(desc), type: inferType(amount, desc) };
  },
};

/** Convert MM/DD/YYYY or M/D/YYYY to YYYY-MM-DD. */
function normalizeDate(raw) {
  if (!raw) return '';
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // M/D/YYYY or MM/DD/YYYY
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return raw;
}

/* ---------- Parse the CSV ---------- */

const raw     = fs.readFileSync(filePath, 'utf-8');
const allRows = parseCsv(raw);

if (allRows.length < 2) {
  console.error('ERROR: CSV has no data rows (need at least header + 1 row).');
  process.exit(1);
}

const rawHeaders = allRows[0];
const lower      = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9 .]/g, '').trim());
const format     = detectFormat(lower);
const normalizer = NORMALIZERS[format] || NORMALIZERS['generic'];

process.stderr.write(`Detected format: ${format}\n`);
process.stderr.write(`Rows to parse: ${allRows.length - 1}\n`);

const transactions = [];
let skipCount = 0;

for (let i = 1; i < allRows.length; i++) {
  const row = allRows[i];
  const t = normalizer(row, lower);
  if (!t || !t.date) { skipCount++; continue; }
  transactions.push(t);
}

process.stderr.write(`Parsed: ${transactions.length} transactions, skipped: ${skipCount}\n`);

if (!stmtDate && transactions.length > 0) {
  // Use the last (most recent) date in the statement
  stmtDate = transactions.map(t => t.date).sort().pop();
}

const displayName = entityName || entityId;

/* ---------- Build sheet rows ---------- */

// Transactions tab columns (A–M):
// Date | Entity ID | Entity Name | Description | Amount | Category | Type |
// Running Balance | Statement ID | Reconciled | Notes | Month | Year
//
// Month (col L) and Year (col M) are pre-computed index values written as
// literals so Dashboard SUMPRODUCT formulas compare plain strings instead of
// computing TEXT(A,"YYYY-MM") on every cell per recalculation.
const txRows = transactions.map(t => [
  t.date,
  entityId,
  displayName,
  t.description,
  t.amount.toFixed(2),
  t.category,
  t.type,
  '', // Running Balance — computed later or left for formulas
  '', // Statement ID — filled after creating the statement row
  'FALSE',
  '',
  t.date.slice(0, 7), // Month index: YYYY-MM
  t.date.slice(0, 4), // Year  index: YYYY
]);

// Statements tab columns (A–N):
// Statement ID | Entity ID | Entity Name | Statement Date | Opening Balance | Closing Balance |
// Total Debits | Total Credits | Minimum Payment Due | Payment Due Date |
// Drive File ID | Drive File Name | Reconciled | Notes
const debits  = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
const credits = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
const csvFileName = path.basename(filePath);

// Statement ID assigned at write time (STMT-NNN auto-increment) — placeholder here
const stmtRow = [
  '',  // STMT-NNN — filled at write time
  entityId,
  displayName,
  stmtDate,
  '',  // Opening Balance — operator fills in
  '',  // Closing Balance — operator fills in
  debits.toFixed(2),
  credits.toFixed(2),
  '',  // Minimum Payment Due
  '',  // Payment Due Date
  '',  // Drive File ID
  csvFileName,
  'FALSE',
  `Imported from ${csvFileName}`,
];

/* ---------- Dry run output ---------- */

if (dryRun) {
  console.log(JSON.stringify({ format, stmtDate, transactionCount: transactions.length, transactions: txRows, statement: stmtRow }, null, 2));
  process.exit(0);
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

/* ---------- Sheets API helpers ---------- */

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

/* ---------- Write to Sheets ---------- */

(async () => {
  const token = await getToken();

  // 1. Get the next STMT-NNN from existing Statements rows
  process.stderr.write('Reading existing Statements tab to determine next ID...\n');
  const stmtsData = await sheetsGet(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Statements!A:A')}`,
    token,
  );
  const stmtIds  = (stmtsData.values || []).flat().filter(v => /^STMT-\d+$/.test(v));
  const maxStmt  = stmtIds.reduce((max, id) => Math.max(max, parseInt(id.split('-')[1], 10)), 0);
  const nextStmt = `STMT-${String(maxStmt + 1).padStart(3, '0')}`;

  stmtRow[0] = nextStmt;

  // Inject Statement ID into all transaction rows
  for (const row of txRows) row[8] = nextStmt;

  // 2. Append statement row to Statements tab
  process.stderr.write(`Writing statement row ${nextStmt} to Statements tab...\n`);
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Statements!A:N')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    { values: [stmtRow] },
  );

  // 3. Append transaction rows to Transactions tab
  process.stderr.write(`Writing ${txRows.length} transaction rows to Transactions tab...\n`);
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Transactions!A:M')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    { values: txRows },
  );

  process.stderr.write('Done.\n');
  process.stdout.write(JSON.stringify({
    ok: true,
    format,
    statementId: nextStmt,
    transactionsWritten: txRows.length,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
  }) + '\n');
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
