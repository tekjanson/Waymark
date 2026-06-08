#!/usr/bin/env node
/* ============================================================
   setup-statement-folders.js — Create the Google Drive folder
   hierarchy for Waymark Financials statement attachments.

   Creates:
     {root}/
       Financials/           (or uses --parent-id directly)
         Statements/
           2026/
             01/ 02/ ... 12/
           2025/
             01/ 02/ ... 12/

   Usage:
     GOOGLE_TOKEN=ya29.xxx node scripts/setup-statement-folders.js
     GOOGLE_TOKEN=ya29.xxx node scripts/setup-statement-folders.js \
       --parent-id <folderId>   (put Statements under an existing folder)
       --years 2025,2026,2027   (which years to scaffold, default: prev+cur+next)
       --dry-run                (print plan, don't create)

   Auth:
     GOOGLE_TOKEN=ya29.xxx                          (user OAuth — preferred)
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json (service account)

   Output:
     JSON to stdout: { ok, folders: { root, statements, years: { YYYY: { root, months: { MM: id } } } } }
     Also writes folder IDs to ./generated/statement-folder-ids.json for
     use by attach-statement-file.js.
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch { /* auth loaded only if needed */ }

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';

/* ---------- CLI ---------- */

const args  = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, '');
  if (args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
  else flags[key] = true;
}

const parentId = flags['parent-id'] || null;
const dryRun   = !!flags['dry-run'];
const now      = new Date();
const curYear  = now.getFullYear();

const yearsArg = flags['years']
  ? flags['years'].split(',').map(y => parseInt(y.trim(), 10)).filter(Boolean)
  : [curYear - 1, curYear, curYear + 1];

const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12'];

/* ---------- Auth ---------- */

async function getToken() {
  if (process.env.GOOGLE_TOKEN) return process.env.GOOGLE_TOKEN;
  if (!GoogleAuth) {
    console.error('ERROR: google-auth-library not found. Run: npm install google-auth-library');
    process.exit(1);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('ERROR: Set GOOGLE_TOKEN (user OAuth) or GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const auth = new GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/* ---------- Drive helpers ---------- */

/**
 * Find a folder by name inside a parent (or root).
 * @param {string} name
 * @param {string|null} inParent
 * @param {string} token
 * @returns {Promise<string|null>} folder ID or null
 */
async function findFolder(name, inParent, token) {
  const parentClause = inParent
    ? `and '${inParent}' in parents`
    : `and 'root' in parents`;
  const q = encodeURIComponent(
    `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false ${parentClause}`,
  );
  const res = await fetch(`${DRIVE_BASE}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive list ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

/**
 * Create a folder. Returns the new folder ID.
 * @param {string} name
 * @param {string|null} inParent
 * @param {string} token
 * @returns {Promise<string>}
 */
async function createFolder(name, inParent, token) {
  const body = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(inParent ? { parents: [inParent] } : {}),
  };
  const res = await fetch(`${DRIVE_BASE}?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Drive create folder ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

/**
 * Find-or-create a folder. Idempotent.
 * @param {string} name
 * @param {string|null} inParent
 * @param {string} token
 * @param {boolean} dry
 * @returns {Promise<string>} folder ID (or "{dry}" placeholder)
 */
async function ensureFolder(name, inParent, token, dry) {
  if (dry) {
    process.stderr.write(`  [dry] would ensure folder: ${name} (parent: ${inParent || 'root'})\n`);
    return `dry:${name}`;
  }
  const existing = await findFolder(name, inParent, token);
  if (existing) {
    process.stderr.write(`  ✓ exists: ${name} (${existing})\n`);
    return existing;
  }
  const newId = await createFolder(name, inParent, token);
  process.stderr.write(`  + created: ${name} (${newId})\n`);
  return newId;
}

/* ---------- Main ---------- */

(async () => {
  let token;
  if (!dryRun) token = await getToken();

  const result = { ok: true, folders: { years: {} } };

  // 1. Financials root (or use --parent-id directly as the Statements parent)
  let financialsId;
  if (parentId) {
    financialsId = parentId;
    result.folders.root = parentId;
    process.stderr.write(`Using provided parent folder: ${parentId}\n`);
  } else {
    process.stderr.write('Ensuring Financials root folder...\n');
    financialsId = await ensureFolder('Financials', null, token, dryRun);
    result.folders.root = financialsId;
  }

  // 2. Statements folder inside Financials
  process.stderr.write('Ensuring Statements folder...\n');
  const statementsId = await ensureFolder('Statements', financialsId, token, dryRun);
  result.folders.statements = statementsId;

  // 3. Year folders
  for (const year of yearsArg) {
    const yearStr = String(year);
    process.stderr.write(`Ensuring year folder: ${yearStr}...\n`);
    const yearId = await ensureFolder(yearStr, statementsId, token, dryRun);
    result.folders.years[yearStr] = { root: yearId, months: {} };

    // 4. Month folders inside each year
    for (const month of MONTHS) {
      const monthId = await ensureFolder(month, yearId, token, dryRun);
      result.folders.years[yearStr].months[month] = monthId;
    }
  }

  // 5. Persist folder IDs for attach-statement-file.js
  if (!dryRun) {
    const outPath = path.join(__dirname, '..', 'generated', 'statement-folder-ids.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result.folders, null, 2));
    process.stderr.write(`\nFolder IDs saved to generated/statement-folder-ids.json\n`);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
