#!/usr/bin/env node
/* ============================================================
   watch-inbox.js — Automated Statement Attachment System

   Polls the "_Inbox" Google Drive folder for new statement
   files, then automatically:
     1. Parses the filename to identify the entity and period
     2. Matches against Assets/Liabilities in the Financials sheet
     3. Renames the file to canonical format:
          {STMT-NNN} {EntityName} {YYYY-MM}.{ext}
     4. Moves the file to the correct entity subfolder:
          Statements/{ENTITY-NNN} — {EntityName}/
     5. Creates a new Statement row in the Statements tab
     6. Links the Drive file ID + name to that row (cols K & L)

   Usage:
     node scripts/watch-inbox.js \
       --sheet-id <spreadsheetId> \
       --inbox-folder <driveInboxFolderId> \
       [--poll-interval 60]   (seconds, default: 60)
       [--dry-run]            (detect & rename plan only, no writes)
       [--once]               (process inbox once and exit)

   The inbox and entity folder IDs can also come from:
     generated/statement-folder-ids.json
   which is written by: make setup-drive-folders

   Auth:
     GOOGLE_TOKEN=ya29.xxx  (user OAuth)
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json

   Canonical filename format:
     STMT-042 Chase Sapphire 2026-05.pdf

   Filename detection heuristics (checked in order):
     1. Already canonical: "STMT-NNN Entity YYYY-MM.ext" → entity from sheet
     2. Contains entity ID: "LIAB-001-statement-2026-05.pdf" → exact match
     3. Contains YYYY-MM anywhere: "chase_2026-05.pdf" → fuzzy entity match
     4. Contains MM/YYYY: "chase_05-2026.pdf" → reformat then fuzzy match
     5. Contains YYYY only: falls back to current month
     6. No date at all: uses today's month as period
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');

let GoogleAuth;
try { ({ GoogleAuth } = require('google-auth-library')); } catch {}

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE  = 'https://www.googleapis.com/drive/v3/files';

/* ── CLI ─────────────────────────────────────────────────────────── */

const args  = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, '');
  if (args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
  else flags[key] = true;
}

const sheetId      = flags['sheet-id'];
const dryRun       = !!flags['dry-run'];
const runOnce      = !!flags['once'];
const pollInterval = parseInt(flags['poll-interval'] || '60', 10);

// Resolve inbox + entity folder IDs: CLI flags > generated JSON
let inboxFolderId   = flags['inbox-folder'] || null;
let entityFolderMap = {}; // { entityId: folderId }

const generatedPath = path.join(__dirname, '..', 'generated', 'statement-folder-ids.json');
if (fs.existsSync(generatedPath)) {
  try {
    const gen = JSON.parse(fs.readFileSync(generatedPath, 'utf-8'));
    if (!inboxFolderId && gen.inboxFolderId) inboxFolderId = gen.inboxFolderId;
    // entityFolders array: [{ entityId, folderId }]
    if (Array.isArray(gen.entityFolders)) {
      for (const ef of gen.entityFolders) {
        entityFolderMap[ef.entityId] = ef.folderId;
      }
    }
  } catch {}
}

if (!inboxFolderId && !dryRun) {
  console.error('ERROR: --inbox-folder <id> is required (or run: make setup-drive-folders first).');
  process.exit(1);
}
if (!sheetId && !dryRun) {
  console.error('ERROR: --sheet-id <spreadsheetId> is required.');
  process.exit(1);
}

/* ── Auth ────────────────────────────────────────────────────────── */

async function getToken() {
  if (process.env.GOOGLE_TOKEN) return process.env.GOOGLE_TOKEN;
  if (!GoogleAuth) { console.error('ERROR: google-auth-library not found.'); process.exit(1); }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) { console.error('ERROR: Set GOOGLE_TOKEN or GOOGLE_APPLICATION_CREDENTIALS.'); process.exit(1); }
  const auth = new GoogleAuth({
    keyFile: credPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/* ── API helpers ─────────────────────────────────────────────────── */

async function apiGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPatch(url, token, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ── Drive helpers ───────────────────────────────────────────────── */

/** List files in a folder (not folders, not trashed). */
async function listInboxFiles(folderId, token) {
  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const data = await apiGet(
    `${DRIVE_BASE}?q=${q}&fields=files(id,name,mimeType,createdTime)&orderBy=createdTime`,
    token,
  );
  return data.files || [];
}

/** Rename a Drive file. */
async function renameFile(fileId, newName, token) {
  return apiPatch(`${DRIVE_BASE}/${fileId}?fields=id,name`, token, { name: newName });
}

/** Move a file to a destination folder (removes from all current parents). */
async function moveFile(fileId, destFolderId, token) {
  // Get current parents first
  const meta = await apiGet(`${DRIVE_BASE}/${fileId}?fields=parents`, token);
  const currentParents = (meta.parents || []).join(',');
  const res = await fetch(
    `${DRIVE_BASE}/${fileId}?addParents=${destFolderId}&removeParents=${currentParents}&fields=id,parents`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    },
  );
  if (!res.ok) throw new Error(`Move ${fileId} → ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ── Sheets helpers ──────────────────────────────────────────────── */

/** Load all entities from Assets and Liabilities tabs. Returns [{ id, name, tab }]. */
async function loadEntities(token) {
  const [assetsData, liabData] = await Promise.all([
    apiGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Assets!A:B')}`, token),
    apiGet(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Liabilities!A:B')}`, token),
  ]);

  const entities = [];
  for (const row of (assetsData.values || []).slice(1)) {
    const id   = (row[0] || '').trim();
    const name = (row[1] || '').trim();
    if (id && name) entities.push({ id, name, tab: 'Assets' });
  }
  for (const row of (liabData.values || []).slice(1)) {
    const id   = (row[0] || '').trim();
    const name = (row[1] || '').trim();
    if (id && name) entities.push({ id, name, tab: 'Liabilities' });
  }
  return entities;
}

/** Get the next STMT-NNN sequence number. */
async function nextStatementId(token) {
  const data = await apiGet(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Statements!A:A')}`,
    token,
  );
  const ids  = (data.values || []).flat().filter(v => /^STMT-\d+$/.test(v));
  const max  = ids.reduce((m, id) => Math.max(m, parseInt(id.split('-')[1], 10)), 0);
  return `STMT-${String(max + 1).padStart(3, '0')}`;
}

/** Append a new row to the Statements tab and return the statement ID. */
async function createStatementRow(stmtId, entity, yearMonth, fileId, fileName, token) {
  const [year, month] = yearMonth.split('-');
  const stmtDate = `${year}-${month}-01`; // first of the month as placeholder

  const row = [
    stmtId,
    entity.id,
    entity.name,
    stmtDate,
    '', // Opening Balance
    '', // Closing Balance
    '', // Total Debits
    '', // Total Credits
    '', // Minimum Payment Due
    '', // Payment Due Date
    fileId,
    fileName,
    'FALSE',
    `Auto-attached from _Inbox on ${new Date().toISOString().slice(0, 10)}`,
  ];

  await apiPost(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent('Statements!A:N')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    { values: [row] },
  );

  return stmtId;
}

/* ── Filename intelligence ───────────────────────────────────────── */

/**
 * extractPeriod — pull a YYYY-MM from a filename string.
 *
 * Handles these patterns (case-insensitive, separators flexible):
 *   "chase_2026-05.pdf"     → "2026-05"
 *   "ally-05-2026.pdf"      → "2026-05"
 *   "statement_052026.pdf"  → "2026-05"
 *   "2026_05_ally.pdf"      → "2026-05"
 *
 * @param {string} filename
 * @returns {string|null} "YYYY-MM" or null
 */
function extractPeriod(filename) {
  const base = filename.replace(/\.\w+$/, '');

  // Already canonical: STMT-NNN Entity YYYY-MM
  const canonical = base.match(/(\d{4})-(\d{2})(?:\s*$|\s)/);
  if (canonical) return `${canonical[1]}-${canonical[2]}`;

  // YYYY-MM or YYYY_MM anywhere
  const isoLike = base.match(/(\d{4})[-_](\d{2})(?!\d)/);
  if (isoLike) {
    const [, y, m] = isoLike;
    if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12) return `${y}-${m}`;
  }

  // MM-YYYY or MM_YYYY anywhere
  const mdy = base.match(/(?<!\d)(\d{2})[-_](\d{4})(?!\d)/);
  if (mdy) {
    const [, m, y] = mdy;
    if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12) return `${y}-${m}`;
  }

  // MMYYYY (e.g. "052026")
  const compact = base.match(/(?<!\d)(\d{2})(\d{4})(?!\d)/);
  if (compact) {
    const [, m, y] = compact;
    if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12 && parseInt(y, 10) >= 2000) return `${y}-${m}`;
  }

  // YYYY only — use first month of that year
  const yearOnly = base.match(/(?<!\d)(20\d{2})(?!\d)/);
  if (yearOnly) return `${yearOnly[1]}-01`;

  return null;
}

/**
 * matchEntity — find the best entity match for a filename.
 *
 * Strategy (tried in order):
 *   1. Exact entity ID in filename (e.g. "LIAB-001")
 *   2. Exact entity name word match (e.g. "chase" → "Chase Sapphire")
 *   3. Partial entity name match (longest common word sequence)
 *
 * @param {string} filename
 * @param {Array<{id:string,name:string,tab:string}>} entities
 * @returns {{ entity: object, confidence: 'exact'|'name'|'fuzzy' }|null}
 */
function matchEntity(filename, entities) {
  const base  = filename.replace(/\.\w+$/, '').toLowerCase();
  const words = base.split(/[\s_\-\.]+/).filter(Boolean);

  // 1. Exact entity ID
  for (const e of entities) {
    if (base.includes(e.id.toLowerCase())) {
      return { entity: e, confidence: 'exact' };
    }
  }

  // 2. All words of entity name appear in filename
  for (const e of entities) {
    const nameWords = e.name.toLowerCase().split(/\s+/);
    if (nameWords.every(w => words.includes(w))) {
      return { entity: e, confidence: 'name' };
    }
  }

  // 3. Fuzzy: most words of entity name appear in filename
  let best = null;
  let bestScore = 0;
  for (const e of entities) {
    const nameWords = e.name.toLowerCase().split(/\s+/);
    const score = nameWords.filter(w => words.some(fw => fw.includes(w) || w.includes(fw))).length;
    if (score > bestScore && score > 0) {
      bestScore = score;
      best = e;
    }
  }
  if (best) return { entity: best, confidence: 'fuzzy' };

  return null;
}

/**
 * buildCanonicalName — build the standard filename.
 *   "{STMT-NNN} {EntityName} {YYYY-MM}.{ext}"
 * @param {string} stmtId
 * @param {string} entityName
 * @param {string} yearMonth  — "YYYY-MM"
 * @param {string} origName   — original filename (for extension)
 * @returns {string}
 */
function buildCanonicalName(stmtId, entityName, yearMonth, origName) {
  const ext = origName.includes('.') ? origName.split('.').pop().toLowerCase() : 'pdf';
  return `${stmtId} ${entityName} ${yearMonth}.${ext}`;
}

/* ── Core: process one file ──────────────────────────────────────── */

/**
 * Process a single inbox file end-to-end.
 *
 * @param {object} file     — Drive file metadata { id, name }
 * @param {Array}  entities — from loadEntities()
 * @param {string} token
 * @returns {object} result summary
 */
async function processFile(file, entities, token) {
  const log = (...a) => process.stderr.write(`  ${a.join(' ')}\n`);
  log(`Processing: "${file.name}"`);

  // 1. Extract period
  const period = extractPeriod(file.name) || new Date().toISOString().slice(0, 7);
  log(`  Period:  ${period}`);

  // 2. Match entity
  const match = matchEntity(file.name, entities);
  if (!match) {
    log(`  SKIP: could not match entity for "${file.name}" — move to a named entity folder manually.`);
    return { file: file.name, status: 'skipped', reason: 'no-entity-match' };
  }

  const { entity, confidence } = match;
  log(`  Entity:  ${entity.id} — ${entity.name} (${confidence} match)`);

  // 3. Build canonical name (need a stmt ID first)
  if (dryRun) {
    const preview = buildCanonicalName(`STMT-???`, entity.name, period, file.name);
    log(`  [dry] would rename → "${preview}"`);
    log(`  [dry] would move to entity folder for ${entity.id}`);
    log(`  [dry] would create Statements row and link file`);
    return { file: file.name, status: 'dry-run', entity: entity.id, period, confidence };
  }

  // 4. Allocate a new STMT-NNN
  const stmtId = await nextStatementId(token);
  const canonicalName = buildCanonicalName(stmtId, entity.name, period, file.name);
  log(`  StmtID:  ${stmtId}`);
  log(`  Rename → "${canonicalName}"`);

  // 5. Rename the Drive file
  await renameFile(file.id, canonicalName, token);

  // 6. Move to entity subfolder (if we have a folder ID for it)
  const destFolderId = entityFolderMap[entity.id];
  if (destFolderId) {
    log(`  Moving to entity folder (${destFolderId})...`);
    await moveFile(file.id, destFolderId, token);
  } else {
    log(`  WARN: no folder ID for ${entity.id} — file stays in _Inbox (run: make setup-drive-folders).`);
  }

  // 7. Create Statement row + link file
  log(`  Writing Statements row...`);
  await createStatementRow(stmtId, entity, period, file.id, canonicalName, token);

  log(`  ✓ Done`);
  return {
    file:          file.name,
    status:        'attached',
    stmtId,
    canonicalName,
    entityId:      entity.id,
    entityName:    entity.name,
    period,
    confidence,
    driveUrl:      `https://drive.google.com/file/d/${file.id}/view`,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
  };
}

/* ── Poll loop ───────────────────────────────────────────────────── */

async function runOnce_(token, entities) {
  process.stderr.write(`\n[${new Date().toISOString()}] Scanning _Inbox (${inboxFolderId || 'dry-run'})...\n`);

  let files;
  if (dryRun) {
    // In dry-run, use sample files so we can show the plan
    files = [
      { id: 'dry-file-001', name: 'Chase_Sapphire_2026-05.pdf',  createdTime: new Date().toISOString() },
      { id: 'dry-file-002', name: 'ally_checking_052026.pdf',     createdTime: new Date().toISOString() },
      { id: 'dry-file-003', name: 'LIAB-002_mortgage_2026_04.pdf',createdTime: new Date().toISOString() },
    ];
    if (!entities.length) {
      entities = [
        { id: 'ASSET-001', name: 'Chase Checking',   tab: 'Assets' },
        { id: 'ASSET-002', name: 'Ally Savings',      tab: 'Assets' },
        { id: 'LIAB-001',  name: 'Chase Sapphire',    tab: 'Liabilities' },
        { id: 'LIAB-002',  name: 'Main St Mortgage',  tab: 'Liabilities' },
      ];
    }
  } else {
    files = await listInboxFiles(inboxFolderId, token);
  }

  if (files.length === 0) {
    process.stderr.write('  _Inbox is empty.\n');
    return [];
  }

  process.stderr.write(`  Found ${files.length} file(s).\n`);
  const results = [];

  for (const file of files) {
    try {
      const result = await processFile(file, entities, token);
      results.push(result);
    } catch (err) {
      process.stderr.write(`  ERROR processing "${file.name}": ${err.message}\n`);
      results.push({ file: file.name, status: 'error', error: err.message });
    }
  }

  process.stdout.write(JSON.stringify({ ok: true, processed: results.length, results }, null, 2) + '\n');
  return results;
}

/* ── Entry point ─────────────────────────────────────────────────── */

(async () => {
  let token    = null;
  let entities = [];

  if (!dryRun) {
    token    = await getToken();
    entities = await loadEntities(token);
    process.stderr.write(`Loaded ${entities.length} entities from sheet.\n`);

    if (!inboxFolderId) {
      console.error('ERROR: No inbox folder ID. Run: make setup-drive-folders first.');
      process.exit(1);
    }
  }

  process.stderr.write(
    dryRun
      ? 'watch-inbox [dry-run] — no writes will happen\n'
      : `watch-inbox started — polling every ${pollInterval}s\n`,
  );

  if (runOnce || dryRun) {
    await runOnce_(token, entities);
    return;
  }

  // Poll loop
  await runOnce_(token, entities);
  const timer = setInterval(async () => {
    try {
      // Refresh token each cycle (tokens expire after 1 hour)
      token    = await getToken();
      entities = await loadEntities(token);
      await runOnce_(token, entities);
    } catch (err) {
      process.stderr.write(`ERROR in poll cycle: ${err.message}\n`);
    }
  }, pollInterval * 1000);

  // Graceful shutdown
  process.on('SIGINT',  () => { clearInterval(timer); process.exit(0); });
  process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
