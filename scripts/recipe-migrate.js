#!/usr/bin/env node
/* ============================================================
   recipe-migrate.js — Convert Waymark recipe sheets in a
   Google Drive folder to the current canonical format.

   Usage:
     node scripts/recipe-migrate.js [options]

   Options:
     --folder <id>     Drive folder ID to scan (default: Mimi's Kitchen folder)
     --sheet  <id>     Migrate a single sheet by ID (skips folder scan)
     --apply           Actually write changes (default: dry-run only)
     --recursive       Also scan sub-folders
     --backup          Make a copy of each sheet before modifying (safe!)
     --force           Migrate even sheets that look canonical (re-applies all fixes)

   Examples:
     # Dry-run — see what would change, no writes
     node scripts/recipe-migrate.js --folder 1eZu1YNxKZ1a5Ak6BvKy4DWTp-WPGYw7W

     # Apply changes
     node scripts/recipe-migrate.js --folder 1eZu1YNxKZ1a5Ak6BvKy4DWTp-WPGYw7W --apply

     # Single sheet, apply + backup
     node scripts/recipe-migrate.js --sheet <sheetId> --apply --backup
   ============================================================ */

'use strict';

const path = require('path');
const fs   = require('fs');
const { analyseSheet, migrateSheet, CANONICAL_HEADERS } = require('./recipe-format.js');

/* ---------- CLI Args ---------- */

const args = process.argv.slice(2);
const DEFAULT_FOLDER_ID = '1eZu1YNxKZ1a5Ak6BvKy4DWTp-WPGYw7W';

const FOLDER_ID = getArg(args, '--folder') || DEFAULT_FOLDER_ID;
const SHEET_ID  = getArg(args, '--sheet');
const APPLY     = args.includes('--apply');
const RECURSIVE = args.includes('--recursive');
const BACKUP    = args.includes('--backup');
const FORCE     = args.includes('--force');

/* ---------- Auth ---------- */

const TOKEN_PATH  = path.join(process.env.HOME || '/home/tekjanson', '.config', 'gcloud', 'waymark-oauth-token.json');
const SA_KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(process.env.HOME || '/home/tekjanson', '.config', 'gcloud', 'waymark-service-account-key.json');
const CLIENT_SECRET_FILE = path.resolve(__dirname, '..',
  'client_secret_764742927885-fs0atq3ecenhndpdaaqkb0d0go1blt22.apps.googleusercontent.com_waymarkauth.json');

let _accessToken = null;

async function getAccessToken() {
  if (_accessToken) return _accessToken;

  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      if (token.refresh_token) {
        const creds = JSON.parse(fs.readFileSync(CLIENT_SECRET_FILE, 'utf8'));
        const { client_id, client_secret } = creds.web;
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: token.refresh_token,
            client_id,
            client_secret,
          }),
        });
        const data = await res.json();
        if (data.access_token) { _accessToken = data.access_token; return _accessToken; }
      }
    } catch (err) {
      console.warn('OAuth refresh failed, trying service account:', err.message);
    }
  }

  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    keyFile: SA_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const tok = await client.getAccessToken();
  _accessToken = tok.token;
  return _accessToken;
}

/* ---------- API helpers ---------- */

const DRIVE_BASE  = 'https://www.googleapis.com/drive/v3';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function apiRequest(method, url, body = null, retries = 6) {
  const tok = await getAccessToken();
  for (let attempt = 0; attempt <= retries; attempt++) {
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(60000, 2000 * Math.pow(2, attempt));
      console.log(`   ⏳ Rate limited — waiting ${wait / 1000}s (attempt ${attempt + 1}/${retries})…`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`${method} ${url.split('?')[0]} → ${res.status}: ${errBody.slice(0, 300)}`);
    }
    if (res.status === 204) return {};
    return res.json();
  }
  throw new Error(`Exceeded retry limit on ${method} ${url.split('?')[0]}`);
}

async function listFolderContents(folderId) {
  const files = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)',
      pageSize: '100',
      orderBy: 'name',
      ...(pageToken ? { pageToken } : {}),
    });
    const data = await apiRequest('GET', `${DRIVE_BASE}/files?${qs}`);
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function collectSheets(folderId, depth = 0) {
  const contents = await listFolderContents(folderId);
  const sheets   = contents.filter(f => f.mimeType === 'application/vnd.google-apps.spreadsheet');
  const folders  = contents.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  let all = [...sheets];
  if (RECURSIVE) {
    for (const folder of folders) {
      const sub = await collectSheets(folder.id, depth + 1);
      all = all.concat(sub.map(s => ({ ...s, _folder: folder.name })));
    }
  }
  return all;
}

async function readSheet(spreadsheetId) {
  const meta = await apiRequest('GET', `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`);
  const tabs  = (meta.sheets || []).map(s => s.properties?.title || 'Sheet1');
  const tabName = tabs[0] || 'Sheet1';
  const data = await apiRequest('GET',
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:Z2000')}`
  );
  return { values: data.values || [], tabName, allTabs: tabs };
}

/**
 * Clear an entire sheet tab and write brand-new data in one batchUpdate + values.update.
 * Strategy: clear, then write new values. This avoids off-by-one row issues.
 */
async function writeSheet(spreadsheetId, tabName, newValues) {
  // 1. Clear the range
  await apiRequest('POST',
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:Z2000')}:clear`,
    {}
  );

  // 2. Write new values
  await apiRequest('PUT',
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1')}?valueInputOption=RAW`,
    { values: newValues }
  );
}

/**
 * Make a backup copy of a spreadsheet in the same folder.
 * Returns the new file's ID.
 */
async function backupSheet(spreadsheetId, name) {
  const data = await apiRequest('POST', `${DRIVE_BASE}/files/${spreadsheetId}/copy`, {
    name: `[BACKUP] ${name}`,
  });
  return data.id;
}

/* ---------- Migration logic ---------- */

async function migrateOneSheet(sheet) {
  const label = `"${sheet.name}"`;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📄 ${label}`);
  console.log(`   ID: ${sheet.id}`);
  console.log(`   🔗 https://docs.google.com/spreadsheets/d/${sheet.id}/edit`);

  let values, tabName;
  try {
    ({ values, tabName } = await readSheet(sheet.id));
  } catch (err) {
    console.log(`   ❌ Could not read sheet: ${err.message}`);
    return { status: 'error', error: err.message };
  }

  const { isRecipe, issues, unmapped } = analyseSheet(values);

  if (!isRecipe) {
    console.log('   ⬜ Not a recipe sheet — skipping');
    return { status: 'skipped', reason: 'not-recipe' };
  }

  const fixable = issues.filter(i => i.autoFixable);

  if (fixable.length === 0 && !FORCE) {
    console.log(`   ✅ Already in canonical format (${Math.max(0, values.length - 1)} data rows)`);
    return { status: 'ok' };
  }

  if (issues.length > 0) {
    console.log(`   Issues found (${issues.length}):`);
    for (const issue of issues) {
      const tag = issue.autoFixable ? '🔧' : '⚠️ ';
      console.log(`     ${tag} ${issue.code}: ${issue.description}`);
    }
  }

  if (unmapped.length > 0) {
    console.log(`   Unknown columns (will be preserved as-is): ${unmapped.join(', ')}`);
  }

  // Run migration
  const migration = migrateSheet(values);
  if (!migration) {
    console.log('   ℹ️  No auto-fixable issues (migration returned null)');
    return { status: 'ok' };
  }

  const { newValues, changeLog } = migration;
  console.log(`   Changes to apply (${changeLog.length}):`);
  for (const c of changeLog) {
    console.log(`     → ${c}`);
  }

  if (!APPLY) {
    console.log('   🚫 Dry-run mode — no changes written (add --apply to write)');
    return { status: 'dry-run', changeLog };
  }

  // Backup if requested
  if (BACKUP) {
    try {
      const backupId = await backupSheet(sheet.id, sheet.name);
      console.log(`   📋 Backup created: https://docs.google.com/spreadsheets/d/${backupId}/edit`);
    } catch (err) {
      console.log(`   ⚠️  Backup failed (proceeding anyway): ${err.message}`);
    }
  }

  // Write migrated data
  try {
    await writeSheet(sheet.id, tabName, newValues);
    console.log(`   ✅ Migration complete! ${newValues.length - 1} data rows written to "${tabName}"`);
    return { status: 'migrated', changeLog };
  } catch (err) {
    console.log(`   ❌ Write failed: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}

/* ---------- Main ---------- */

async function main() {
  console.log('\n🔧 Waymark Recipe Sheet Migrator');
  console.log('=================================');
  if (!APPLY) {
    console.log('⚠️  DRY-RUN MODE — no changes will be written');
    console.log('   Add --apply to write changes to Google Sheets\n');
  } else {
    console.log('✏️  APPLY MODE — changes WILL be written to Google Sheets');
    if (BACKUP) console.log('📋 BACKUP MODE — copies will be made before modifying\n');
    else         console.log('   (add --backup to make copies before modifying)\n');
  }

  let sheets;
  if (SHEET_ID) {
    // Single sheet mode
    sheets = [{ id: SHEET_ID, name: 'Target Sheet', mimeType: 'application/vnd.google-apps.spreadsheet' }];
    console.log(`Single sheet mode: ${SHEET_ID}`);
  } else {
    console.log(`📁 Scanning folder: ${FOLDER_ID}`);
    console.log(`🔁 Recursive: ${RECURSIVE}\n`);
    sheets = await collectSheets(FOLDER_ID);
    console.log(`Found ${sheets.length} Google Sheet(s) to analyse`);
  }

  const summary = { total: sheets.length, ok: 0, migrated: 0, dryRun: 0, skipped: 0, error: 0 };

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const result = await migrateOneSheet(sheet);
    summary[result.status === 'dry-run' ? 'dryRun' :
            result.status === 'migrated' ? 'migrated' :
            result.status === 'ok' ? 'ok' :
            result.status === 'skipped' ? 'skipped' : 'error']++;

    // Respect Sheets API quota: give headroom after each sheet (reads + writes)
    if (i < sheets.length - 1) await sleep(APPLY ? 3500 : 2500);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 Migration Summary');
  console.log(`   Total sheets       : ${summary.total}`);
  console.log(`   ✅ Already canonical: ${summary.ok}`);
  if (APPLY) {
    console.log(`   🔧 Migrated        : ${summary.migrated}`);
  } else {
    console.log(`   🔧 Would migrate   : ${summary.dryRun}`);
  }
  console.log(`   ⬜ Skipped (non-recipe): ${summary.skipped}`);
  if (summary.error) console.log(`   ❌ Errors          : ${summary.error}`);

  if (!APPLY && (summary.dryRun > 0)) {
    console.log(`\n💡 Run with --apply to write ${summary.dryRun} migration(s)`);
  }
  console.log();
}

/* ---------- Helpers ---------- */

function getArg(argsList, flag) {
  const idx = argsList.indexOf(flag);
  return idx >= 0 ? argsList[idx + 1] : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
