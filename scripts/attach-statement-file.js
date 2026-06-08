#!/usr/bin/env node
/* ============================================================
   attach-statement-file.js — Upload a statement file (PDF, image,
   CSV) to Google Drive under the correct month folder, rename it
   to the standard convention, and link it to the Statements tab.

   Usage:
     GOOGLE_TOKEN=ya29.xxx node scripts/attach-statement-file.js \
       --file   /path/to/chase-2026-05.pdf \
       --entity LIAB-001 \
       --sheet-id <spreadsheetId> \
       [--date 2026-05]         (statement year-month, default: from filename or today)
       [--stmt-id STMT-001]     (link to specific statement row; default: latest for entity)
       [--folder-config ./generated/statement-folder-ids.json]
       [--dry-run]              (print plan, don't upload)

   File naming convention:
     {entityId}_{YYYY-MM}_statement.{ext}
     e.g.  LIAB-001_2026-05_statement.pdf

   Folder selection:
     1. Loads generated/statement-folder-ids.json (from setup-statement-folders.js)
     2. Falls back to finding/creating the folder path on the fly if config missing.

   Auth:
     GOOGLE_TOKEN=ya29.xxx                          (user OAuth — preferred for Drive)
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json

   Output:
     JSON to stdout: { ok, driveFileId, driveFileName, folderId, stmtId, sheetUrl }
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch { /* auth loaded only if needed */ }

const DRIVE_BASE  = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- CLI ---------- */

const args  = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, '');
  if (args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
  else flags[key] = true;
}

const filePath     = flags['file'];
const entityId     = flags['entity'];
const sheetId      = flags['sheet-id'];
const dryRun       = !!flags['dry-run'];
const stmtIdArg    = flags['stmt-id']  || null;
const folderConfig = flags['folder-config']
  || path.join(__dirname, '..', 'generated', 'statement-folder-ids.json');

if (!filePath) { console.error('ERROR: --file is required'); process.exit(1); }
if (!entityId) { console.error('ERROR: --entity is required (e.g. LIAB-001)'); process.exit(1); }
if (!dryRun && !sheetId) { console.error('ERROR: --sheet-id is required (or --dry-run)'); process.exit(1); }

/* ---------- Date parsing ---------- */

/**
 * Infer YYYY-MM from a statement date flag, filename, or today.
 * @param {string|undefined} dateFlag
 * @param {string} fileName
 * @returns {string} e.g. "2026-05"
 */
function inferStatementMonth(dateFlag, fileName) {
  if (dateFlag) {
    const m = dateFlag.match(/^(\d{4})-(\d{2})$/);
    if (m) return dateFlag;
    const m2 = dateFlag.match(/^(\d{4})(\d{2})$/);
    if (m2) return `${m2[1]}-${m2[2]}`;
  }
  // Try to extract YYYY-MM or YYYY-MM-DD from the filename
  const base = path.basename(fileName);
  const m = base.match(/(\d{4})[.\-_](\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  // Fall back to current month
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const stmtMonth    = inferStatementMonth(flags['date'], filePath);
const [stmtYear, stmtMonthNum] = stmtMonth.split('-');

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
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/* ---------- Drive helpers ---------- */

async function driveGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive GET ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Find a folder by name inside a parent.
 * @param {string} name
 * @param {string} inParent
 * @param {string} token
 * @returns {Promise<string|null>}
 */
async function findFolder(name, inParent, token) {
  const q = encodeURIComponent(
    `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${inParent}' in parents and trashed = false`,
  );
  const data = await driveGet(`${DRIVE_BASE}?q=${q}&fields=files(id,name)`, token);
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

/**
 * Create a folder. Returns the new folder ID.
 */
async function createFolder(name, inParent, token) {
  const res = await fetch(`${DRIVE_BASE}?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [inParent] }),
  });
  if (!res.ok) throw new Error(`Drive create folder ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

/**
 * Find or create a folder.
 */
async function ensureFolder(name, inParent, token) {
  return (await findFolder(name, inParent, token)) || (await createFolder(name, inParent, token));
}

/**
 * Resolve the target month folder ID.
 * First tries the saved folder config; falls back to Drive API traversal.
 * @param {string} token
 * @returns {Promise<string>} folder ID
 */
async function resolveMonthFolder(token) {
  // Try saved config first
  if (fs.existsSync(folderConfig)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(folderConfig, 'utf-8'));
      const monthId = cfg?.years?.[stmtYear]?.months?.[stmtMonthNum];
      if (monthId) {
        process.stderr.write(`Using saved folder config: ${stmtYear}/${stmtMonthNum} → ${monthId}\n`);
        return monthId;
      }
    } catch {
      // Fall through to API resolution
    }
  }

  // Walk the Drive folder tree
  process.stderr.write(`Resolving Drive folder path (no config found)...\n`);
  let rootId = await findFolder('Financials', null, token);
  if (!rootId) {
    process.stderr.write(`'Financials' folder not found in root — run: make setup-statement-folders GOOGLE_TOKEN=...\n`);
    rootId = await ensureFolder('Financials', null, token);
  }
  const stmtsId = await ensureFolder('Statements', rootId, token);
  const yearId  = await ensureFolder(stmtYear, stmtsId, token);
  const monthId = await ensureFolder(stmtMonthNum, yearId, token);
  return monthId;
}

/* ---------- MIME detection ---------- */

const MIME_MAP = {
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.csv':  'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
};

function getMimeType(filePath) {
  return MIME_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/* ---------- Drive upload ---------- */

/**
 * Upload a file using the multipart upload API.
 * @param {string} localPath
 * @param {string} driveName  canonical name to use in Drive
 * @param {string} folderId
 * @param {string} token
 * @returns {Promise<{ id: string, name: string }>}
 */
async function uploadFile(localPath, driveName, folderId, token) {
  const mimeType = getMimeType(localPath);
  const fileData = fs.readFileSync(localPath);

  const metadata = JSON.stringify({ name: driveName, parents: [folderId] });

  // Build multipart body
  const boundary = `boundary_${Date.now()}`;
  const CRLF = '\r\n';
  const metaPart = `--${boundary}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}${metadata}${CRLF}`;
  const dataPart = `--${boundary}${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`;
  const ending   = `${CRLF}--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(metaPart),
    Buffer.from(dataPart),
    fileData,
    Buffer.from(ending),
  ]);

  const res = await fetch(`${UPLOAD_BASE}?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload ${res.status}: ${await res.text()}`);
  return res.json();
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

/**
 * Find the spreadsheet row of the target statement (last one for entity,
 * or the specific STMT-NNN if --stmt-id was given).
 *
 * Statements tab columns (1-based):
 *   A=Stmt ID, B=Entity ID, C=Entity Name, D=Stmt Date,
 *   K=Drive File ID, L=Drive File Name
 *
 * @param {string} token
 * @returns {Promise<{ sheetRowIndex: number, stmtId: string }>}
 */
async function resolveStatementRow(token) {
  const data = await sheetsGet(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Statements!A:L')}`,
    token,
  );
  const rows = (data.values || []);
  if (rows.length < 2) throw new Error('Statements tab is empty — import a statement first.');

  // rows[0] is the header
  const dataRows = rows.slice(1);

  if (stmtIdArg) {
    const idx = dataRows.findIndex(r => (r[0] || '').trim() === stmtIdArg);
    if (idx === -1) throw new Error(`Statement ID ${stmtIdArg} not found in Statements tab.`);
    return { sheetRowIndex: idx + 2, stmtId: stmtIdArg }; // +2: 1-based + header
  }

  // Find the latest statement for this entity
  const entityRows = dataRows
    .map((r, i) => ({ row: r, sheetRowIndex: i + 2 }))
    .filter(({ row }) => (row[1] || '').trim() === entityId);

  if (entityRows.length === 0) {
    throw new Error(`No statements found for entity ${entityId} in Statements tab.`);
  }

  // Last match (latest)
  const { row, sheetRowIndex } = entityRows[entityRows.length - 1];
  return { sheetRowIndex, stmtId: (row[0] || '').trim() };
}

/**
 * Write Drive File ID and Drive File Name into the Statements row.
 * Columns K (index 11) and L (index 12), 1-based.
 */
async function linkToStatementsTab(sheetRowIndex, driveFileId, driveFileName, token) {
  // Columns K and L = Drive File ID and Drive File Name
  await sheetsPost(
    `${SHEETS_BASE}/${sheetId}/values:batchUpdate`,
    token,
    {
      valueInputOption: 'RAW',
      data: [
        { range: `Statements!K${sheetRowIndex}`, values: [[driveFileId]] },
        { range: `Statements!L${sheetRowIndex}`, values: [[driveFileName]] },
      ],
    },
  );
}

/* ---------- Main ---------- */

(async () => {
  const ext          = path.extname(filePath);
  const canonicalName = `${entityId}_${stmtMonth}_statement${ext}`;

  process.stderr.write(`File:      ${filePath}\n`);
  process.stderr.write(`Entity:    ${entityId}\n`);
  process.stderr.write(`Month:     ${stmtMonth}\n`);
  process.stderr.write(`Drive name: ${canonicalName}\n`);

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      canonicalName,
      stmtMonth,
      entityId,
      sheetId: sheetId || '(not provided)',
      folderConfigUsed: fs.existsSync(folderConfig) ? folderConfig : null,
    }, null, 2));
    process.exit(0);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: File not found: ${filePath}`);
    process.exit(1);
  }

  const token = await getToken();

  // 1. Resolve the month folder
  process.stderr.write('\nResolving target Drive folder...\n');
  const folderId = await resolveMonthFolder(token);
  process.stderr.write(`Target folder: ${folderId}\n`);

  // 2. Upload the file
  process.stderr.write(`\nUploading ${canonicalName}...\n`);
  const { id: driveFileId, name: driveFileName } = await uploadFile(
    filePath, canonicalName, folderId, token,
  );
  process.stderr.write(`Uploaded: ${driveFileName} (${driveFileId})\n`);

  // 3. Link to Statements tab
  process.stderr.write('\nLinking to Statements tab...\n');
  const { sheetRowIndex, stmtId } = await resolveStatementRow(token);
  process.stderr.write(`Updating row ${sheetRowIndex} (${stmtId})...\n`);
  await linkToStatementsTab(sheetRowIndex, driveFileId, driveFileName, token);

  process.stderr.write('\nDone.\n');
  process.stdout.write(JSON.stringify({
    ok: true,
    driveFileId,
    driveFileName,
    folderId,
    stmtId,
    sheetRowIndex,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    driveUrl: `https://drive.google.com/file/d/${driveFileId}/view`,
  }, null, 2) + '\n');
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
