#!/usr/bin/env node
/* ============================================================
   attach-statement.js — Link a Google Drive file to a Statement
   row in the Waymark Financials sheet, and rename it to the
   canonical format: {STMT-NNN} {EntityName} {YYYY-MM}.pdf

   Usage:
     node scripts/attach-statement.js \
       --sheet-id <spreadsheetId> \
       --stmt-id STMT-001 \
       --file-id <driveFileId>
       [--rename]

   Flags:
     --sheet-id   Financials spreadsheet ID (required)
     --stmt-id    Statement row to attach to, e.g. STMT-001 (required)
     --file-id    Google Drive file ID of the statement PDF (required)
     --rename     Rename the Drive file to canonical format (optional)
     --dry-run    Show what would happen without writing

   Auth:
     GOOGLE_TOKEN=ya29.xxx  (user OAuth)
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json

   What it does:
     1. Finds the Statement row in the Statements tab matching --stmt-id
     2. Writes the Drive file ID and file name into columns K and L
     3. If --rename: renames the Drive file to "{STMT-NNN} {EntityName} {YYYY-MM}.pdf"

   Canonical filename format:
     STMT-001 Chase Sapphire 2026-05.pdf
   ============================================================ */

'use strict';

let GoogleAuth;
try { ({ GoogleAuth } = require('google-auth-library')); } catch {}

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE  = 'https://www.googleapis.com/drive/v3/files';

/* ---------- CLI ---------- */

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, '');
  if (args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
  else flags[key] = true;
}

const sheetId  = flags['sheet-id'];
const stmtId   = flags['stmt-id'];
const fileId   = flags['file-id'];
const doRename = !!flags['rename'];
const dryRun   = !!flags['dry-run'];

if (!sheetId || !stmtId || !fileId) {
  console.error('ERROR: --sheet-id, --stmt-id, and --file-id are all required.');
  process.exit(1);
}

/* ---------- Auth ---------- */

async function getToken() {
  if (process.env.GOOGLE_TOKEN) return process.env.GOOGLE_TOKEN;
  if (!GoogleAuth) { console.error('ERROR: google-auth-library not found.'); process.exit(1); }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) { console.error('ERROR: Set GOOGLE_TOKEN or GOOGLE_APPLICATION_CREDENTIALS.'); process.exit(1); }
  const auth = new GoogleAuth({ keyFile: credPath, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/* ---------- API helpers ---------- */

async function sheetsGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sheetsPatch(url, token, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return res.json();
}

async function driveGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json();
}

async function drivePatch(fileId, token, body) {
  const res = await fetch(`${DRIVE_BASE}/${fileId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------- Main ---------- */

(async () => {
  const token = await getToken();

  // 1. Find the statement row in Statements tab
  process.stderr.write(`Looking up ${stmtId} in Statements tab...\n`);
  const stmtsData = await sheetsGet(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Statements!A:N')}`,
    token,
  );
  const rows = stmtsData.values || [];

  // Row 0 = headers; find the matching row
  let matchRowIndex = -1; // 0-based in rows array (includes header)
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0] || '').trim() === stmtId) { matchRowIndex = i; break; }
  }

  if (matchRowIndex === -1) {
    console.error(`ERROR: Statement ${stmtId} not found in Statements tab.`);
    process.exit(1);
  }

  const stmtRow    = rows[matchRowIndex];
  const entityName = (stmtRow[2] || '').trim();
  const stmtDate   = (stmtRow[3] || '').trim(); // YYYY-MM-DD
  const yearMonth  = stmtDate ? stmtDate.slice(0, 7) : 'unknown';

  // 2. Get Drive file metadata
  process.stderr.write(`Fetching Drive file metadata for ${fileId}...\n`);
  const fileMeta = await driveGet(`${DRIVE_BASE}/${fileId}?fields=id,name,mimeType`, token);
  const origName = fileMeta.name;

  // 3. Compute canonical filename
  const ext = origName.includes('.') ? origName.split('.').pop() : 'pdf';
  const canonicalName = `${stmtId} ${entityName} ${yearMonth}.${ext}`;

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      stmtId,
      fileId,
      origName,
      canonicalName: doRename ? canonicalName : origName,
      wouldWriteToRow: matchRowIndex + 1, // 1-based sheet row
      columns: { K: fileId, L: doRename ? canonicalName : origName },
    }, null, 2));
    process.exit(0);
  }

  // 4. Rename the Drive file if requested
  let finalName = origName;
  if (doRename && origName !== canonicalName) {
    process.stderr.write(`Renaming "${origName}" → "${canonicalName}"...\n`);
    await drivePatch(fileId, token, { name: canonicalName });
    finalName = canonicalName;
  }

  // 5. Write Drive file ID (col K = index 10) and name (col L = index 11) to the statement row
  // Sheet row number = matchRowIndex + 1 (1-based, since rows[0] is header which is row 1)
  const sheetRow = matchRowIndex + 1;
  const range = `Statements!K${sheetRow}:L${sheetRow}`;

  process.stderr.write(`Writing Drive link to ${range}...\n`);
  await sheetsPatch(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    token,
    { values: [[fileId, finalName]] },
  );

  process.stderr.write('Done.\n');
  process.stdout.write(JSON.stringify({
    ok: true,
    stmtId,
    fileId,
    fileName: finalName,
    sheetRow,
    driveUrl: `https://drive.google.com/file/d/${fileId}/view`,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
  }, null, 2) + '\n');
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
