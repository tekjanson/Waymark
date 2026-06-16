#!/usr/bin/env node
/* ============================================================
   setup-drive-folders.js — Create the Drive folder structure
   for the Waymark Financials statement attachment system.

   Usage:
     node scripts/setup-drive-folders.js --sheet-id <spreadsheetId>
     node scripts/setup-drive-folders.js --sheet-id <id> --parent-folder <folderId>
     node scripts/setup-drive-folders.js --sheet-id <id> --dry-run

   Flags:
     --sheet-id      Financials spreadsheet ID — reads entity names from it (required)
     --parent-folder Drive folder ID to create "Waymark Financials" inside (default: root)
     --dry-run       Print folder structure without creating it

   Auth:
     GOOGLE_TOKEN=ya29.xxx  (user OAuth — creates in your Drive)
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json  (SA — needs Drive scope)

   Creates:
     Waymark Financials/
       Statements/
         ASSET-001 — {Name}/
         ASSET-002 — {Name}/
         LIAB-001 — {Name}/
         ...
       _Inbox/   ← Drop any statement here; attach-statement.js links it

   Output:
     Prints folder IDs as JSON: { rootFolderId, statementsFolderId, entityFolders: [...] }
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

const sheetId      = flags['sheet-id'];
const parentFolder = flags['parent-folder'] || 'root';
const dryRun       = !!flags['dry-run'];

if (!sheetId && !dryRun) {
  console.error('ERROR: --sheet-id is required');
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

async function driveGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json();
}

async function drivePost(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sheetsGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------- Drive helpers ---------- */

/**
 * Find an existing folder by name inside a parent, or null.
 */
async function findFolder(name, parent, token) {
  const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`);
  const data = await driveGet(`${DRIVE_BASE}?q=${q}&fields=files(id,name)`, token);
  return (data.files || [])[0] || null;
}

/**
 * Create a folder (or return existing).
 */
async function ensureFolder(name, parent, token) {
  const existing = await findFolder(name, parent, token);
  if (existing) return existing;
  const created = await drivePost(DRIVE_BASE, token, {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parent],
  });
  return created;
}

/* ---------- Main ---------- */

(async () => {
  let entities = [];

  if (dryRun) {
    entities = [
      { id: 'ASSET-001', name: 'Chase Checking', tab: 'Assets' },
      { id: 'ASSET-002', name: 'Ally Savings', tab: 'Assets' },
      { id: 'LIAB-001', name: 'Chase Sapphire', tab: 'Liabilities' },
      { id: 'LIAB-002', name: 'Main St Mortgage', tab: 'Liabilities' },
    ];
  } else {
    const token = await getToken();
    process.stderr.write('Reading Assets and Liabilities from sheet...\n');

    const [assetsData, liabData] = await Promise.all([
      sheetsGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Assets!A:B')}`, token),
      sheetsGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Liabilities!A:B')}`, token),
    ]);

    for (const row of (assetsData.values || []).slice(1)) {
      const id = (row[0] || '').trim();
      const name = (row[1] || '').trim();
      if (id && name) entities.push({ id, name, tab: 'Assets' });
    }
    for (const row of (liabData.values || []).slice(1)) {
      const id = (row[0] || '').trim();
      const name = (row[1] || '').trim();
      if (id && name) entities.push({ id, name, tab: 'Liabilities' });
    }
  }

  if (entities.length === 0) {
    process.stderr.write('No entities found. Add rows to Assets/Liabilities tabs first.\n');
    if (!dryRun) process.exit(1);
  }

  const folderNames = entities.map(e => `${e.id} — ${e.name}`);
  const structure = {
    root: 'Waymark Financials',
    children: ['Statements/', ...folderNames.map(n => `Statements/${n}/`), '_Inbox/'],
  };

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, structure, entities }, null, 2));
    process.exit(0);
  }

  const token = await getToken();
  process.stderr.write('Creating folder structure in Google Drive...\n');

  // Root: "Waymark Financials"
  const rootFolder = await ensureFolder('Waymark Financials', parentFolder, token);
  process.stderr.write(`  ✓ Waymark Financials (${rootFolder.id})\n`);

  // Statements subfolder
  const stmtsFolder = await ensureFolder('Statements', rootFolder.id, token);
  process.stderr.write(`  ✓ Statements (${stmtsFolder.id})\n`);

  // _Inbox subfolder
  const inboxFolder = await ensureFolder('_Inbox', rootFolder.id, token);
  process.stderr.write(`  ✓ _Inbox (${inboxFolder.id})\n`);

  // Per-entity subfolders inside Statements/
  const entityFolders = [];
  for (const entity of entities) {
    const folderName = `${entity.id} — ${entity.name}`;
    const folder = await ensureFolder(folderName, stmtsFolder.id, token);
    entityFolders.push({ entityId: entity.id, entityName: entity.name, folderId: folder.id, folderName });
    process.stderr.write(`  ✓ Statements/${folderName} (${folder.id})\n`);
  }

  process.stderr.write('Done.\n');
  process.stdout.write(JSON.stringify({
    ok: true,
    rootFolderId: rootFolder.id,
    statementsFolderId: stmtsFolder.id,
    inboxFolderId: inboxFolder.id,
    entityFolders,
    tip: 'Upload PDFs to the entity sub-folder, then run: make attach-statement',
  }, null, 2) + '\n');
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
