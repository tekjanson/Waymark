#!/usr/bin/env node
/* ============================================================
   recipe-audit.js — Scan a Google Drive folder and report
   recipe sheets that are not in the current Waymark format.

   Usage:
     node scripts/recipe-audit.js [--folder <folderId>] [--recursive]

   Authentication:
     Uses ~/.config/gcloud/waymark-oauth-token.json (refresh token)
     or falls back to the service account key.

   Output:
     Console report — no changes are made to any sheet.
     Run recipe-migrate.js to apply fixes.
   ============================================================ */

'use strict';

const path = require('path');
const fs   = require('fs');
const { analyseSheet, isRecipeSheet } = require('./recipe-format.js');

/* ---------- Config ---------- */

const DEFAULT_FOLDER_ID = '1eZu1YNxKZ1a5Ak6BvKy4DWTp-WPGYw7W';

const args = process.argv.slice(2);
const FOLDER_ID  = getArg(args, '--folder')    || DEFAULT_FOLDER_ID;
const RECURSIVE  = args.includes('--recursive');
const JSON_OUT   = args.includes('--json');

/* ---------- Auth ---------- */

const TOKEN_PATH   = path.join(process.env.HOME || '/home/tekjanson', '.config', 'gcloud', 'waymark-oauth-token.json');
const SA_KEY_PATH  = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(process.env.HOME || '/home/tekjanson', '.config', 'gcloud', 'waymark-service-account-key.json');
const CLIENT_SECRET_FILE = path.resolve(__dirname, '..',
  'client_secret_764742927885-fs0atq3ecenhndpdaaqkb0d0go1blt22.apps.googleusercontent.com_waymarkauth.json');

let _accessToken = null;

async function getAccessToken() {
  if (_accessToken) return _accessToken;

  // Try OAuth refresh token first (has user-level Drive access)
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
        if (data.access_token) {
          _accessToken = data.access_token;
          return _accessToken;
        }
      }
    } catch (err) {
      console.warn('OAuth token refresh failed, trying service account:', err.message);
    }
  }

  // Fall back to service account via google-auth-library
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    keyFile: SA_KEY_PATH,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
  const client = await auth.getClient();
  const tok = await client.getAccessToken();
  _accessToken = tok.token;
  return _accessToken;
}

/* ---------- API helpers ---------- */

const DRIVE_BASE  = 'https://www.googleapis.com/drive/v3';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function apiGet(url, retries = 6) {
  const tok = await getAccessToken();
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(60000, 2000 * Math.pow(2, attempt));
      if (!JSON_OUT) process.stdout.write(`   ⏳ Rate limited — waiting ${wait / 1000}s…\r`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
  throw new Error('Exceeded retry limit (429 rate limiting)');
}

async function driveGet(path, params = {}) {
  const qs  = new URLSearchParams(params);
  return apiGet(`${DRIVE_BASE}${path}?${qs}`);
}

/**
 * List all files (sheets + subfolders) in a given Drive folder.
 * Handles pagination automatically.
 */
async function listFolderContents(folderId) {
  const files = [];
  let pageToken = '';
  do {
    const params = {
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)',
      pageSize: '100',
      orderBy: 'name',
      ...(pageToken ? { pageToken } : {}),
    };
    const data = await driveGet('/files', params);
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

/**
 * Recursively collect all Google Sheets in a folder (and sub-folders if --recursive).
 */
async function collectSheets(folderId, depth = 0) {
  const indent = '  '.repeat(depth);
  if (!JSON_OUT) process.stdout.write(`${indent}Scanning folder…\r`);

  const contents = await listFolderContents(folderId);
  const sheets   = contents.filter(f => f.mimeType === 'application/vnd.google-apps.spreadsheet');
  const folders  = contents.filter(f => f.mimeType === 'application/vnd.google-apps.folder');

  let all = [...sheets];

  if (RECURSIVE) {
    for (const folder of folders) {
      if (!JSON_OUT) console.log(`${indent}  📁 ${folder.name}`);
      const sub = await collectSheets(folder.id, depth + 1);
      all = all.concat(sub.map(s => ({ ...s, _folder: folder.name })));
    }
  }

  return all;
}

/**
 * Read all values from a spreadsheet (first sheet tab).
 */
async function readSheetValues(spreadsheetId) {
  const meta = await apiGet(`${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`);
  const tabs  = (meta.sheets || []).map(s => s.properties?.title || 'Sheet1');
  const tabName = tabs[0] || 'Sheet1';
  const data = await apiGet(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:Z1000')}`
  );
  return { values: data.values || [], tabName, allTabs: tabs };
}

/* ---------- Main ---------- */

async function main() {
  if (!JSON_OUT) {
    console.log('\n🔍 Waymark Recipe Sheet Auditor');
    console.log('================================');
    console.log(`📁 Folder: ${FOLDER_ID}`);
    console.log(`🔁 Recursive: ${RECURSIVE}\n`);
  }

  // 1. Collect all sheets in the target folder
  const sheets = await collectSheets(FOLDER_ID);

  if (!JSON_OUT) {
    console.log(`\nFound ${sheets.length} Google Sheet(s). Analysing format…\n`);
    console.log('─'.repeat(70));
  }

  const results = [];

  // 2. Analyse each sheet
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const prefix = `[${i + 1}/${sheets.length}] "${sheet.name}"`;

    let analysis;
    try {
      const { values, tabName, allTabs } = await readSheetValues(sheet.id);
      analysis = analyseSheet(values);
      analysis.tabName  = tabName;
      analysis.allTabs  = allTabs;
      analysis.rowCount = Math.max(0, (values.length || 1) - 1);
      analysis.headers  = values[0] || [];
    } catch (err) {
      analysis = {
        isRecipe: null,
        issues: [{ code: 'READ_ERROR', description: err.message, autoFixable: false }],
      };
    }

    const result = {
      id:         sheet.id,
      name:       sheet.name,
      folder:     sheet._folder || '',
      modifiedTime: sheet.modifiedTime,
      url:        `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`,
      ...analysis,
    };
    results.push(result);

    if (!JSON_OUT) {
      const icon = !analysis.isRecipe ? '  ⬜' :
                   analysis.issues.length === 0 ? '  ✅' :
                   analysis.issues.some(i => !i.autoFixable) ? '  ⚠️ ' : '  🔧';

      console.log(`${icon} ${prefix}`);
      if (analysis.isRecipe === false) {
        console.log('     (not a recipe sheet — skipping)');
      } else if (analysis.issues && analysis.issues.length > 0) {
        for (const issue of analysis.issues) {
          const fix = issue.autoFixable ? '[auto-fixable]' : '[manual review needed]';
          console.log(`     • ${issue.code}: ${issue.description} ${fix}`);
        }
        if (analysis.tabName) {
          console.log(`     Headers: ${(analysis.headers || []).join(', ')}`);
        }
      } else if (analysis.isRecipe === true) {
        console.log(`     ✓ Already in canonical format (${analysis.rowCount} data rows)`);
      }
      console.log(`     🔗 ${result.url}`);
      console.log();
    }

    // Rate limit: give quota a chance to recover between sheets
    if (i < sheets.length - 1) await sleep(2500);
  }

  // 3. Summary
  const recipes        = results.filter(r => r.isRecipe === true);
  const needsFix       = recipes.filter(r => r.issues && r.issues.length > 0);
  const autoFixable    = needsFix.filter(r => r.issues.every(i => i.autoFixable));
  const needsManual    = needsFix.filter(r => r.issues.some(i => !i.autoFixable));
  const alreadyGood    = recipes.filter(r => !r.issues || r.issues.length === 0);
  const nonRecipe      = results.filter(r => r.isRecipe === false);
  const errors         = results.filter(r => r.isRecipe === null);

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({
      folderId:   FOLDER_ID,
      scannedAt:  new Date().toISOString(),
      summary: {
        total:      results.length,
        recipes:    recipes.length,
        needsFix:   needsFix.length,
        autoFixable: autoFixable.length,
        needsManual: needsManual.length,
        alreadyGood: alreadyGood.length,
        nonRecipe:  nonRecipe.length,
        errors:     errors.length,
      },
      results,
    }, null, 2));
    return;
  }

  console.log('─'.repeat(70));
  console.log('\n📊 Summary');
  console.log(`   Total sheets scanned : ${results.length}`);
  console.log(`   Recipe sheets found  : ${recipes.length}`);
  console.log(`   ✅ Already canonical  : ${alreadyGood.length}`);
  console.log(`   🔧 Auto-fixable      : ${autoFixable.length}`);
  console.log(`   ⚠️  Needs manual work  : ${needsManual.length}`);
  console.log(`   ⬜ Non-recipe sheets  : ${nonRecipe.length}`);
  if (errors.length) console.log(`   ❌ Read errors       : ${errors.length}`);

  if (needsFix.length > 0) {
    console.log(`\n💡 To fix auto-fixable sheets, run:`);
    console.log(`   node scripts/recipe-migrate.js --folder ${FOLDER_ID}`);
    console.log(`   node scripts/recipe-migrate.js --folder ${FOLDER_ID} --apply   (to write changes)`);
  } else if (recipes.length > 0) {
    console.log('\n🎉 All recipe sheets are already in canonical format!');
  }
  console.log();
}

/* ---------- Helpers ---------- */

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
