#!/usr/bin/env node
/* ============================================================
   generate-test-report.js — Convert Playwright results to
   testcase-template-compatible fixtures for dogfooding.
   ============================================================
   Parses Playwright JSON reporter output and generates:
   1. Fixture files per spec (testcase template format)
   2. A folder manifest for directory view
   3. HTML report for local/offline viewing
   4. Console summary
   5. (--upload) Google Drive folder with test summary in description

   Usage:
     # Run tests and generate report
     WAYMARK_LOCAL=true node scripts/generate-test-report.js

     # Parse existing JSON file
     node scripts/generate-test-report.js --input results.json

     # Specify output dir
     node scripts/generate-test-report.js --output generated/test-report

     # Upload to Google Drive (creates subfolder per branch)
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
       node scripts/generate-test-report.js --upload

     # Parse + upload
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
       node scripts/generate-test-report.js --input results.json --upload

   Output (generated/test-report/):
     report-meta.json     — branch, timestamp, totals
     report.html          — self-contained HTML test report
     fixtures/*.json      — one per spec file (testcase format)
     folders.json         — folder manifest for directory view

   Drive output (when --upload):
     Creates a subfolder named "{branch} — {date}" inside the
     Waymark test-results Drive folder, with one Google Sheet
     per spec file in testcase template format. Returns the
     folder URL for inclusion in workboard QA notes.

     Uses OAuth user credentials (from get-oauth-token.js) because
     service accounts have zero file-storage quota on consumer
     Google accounts. Run `node scripts/get-oauth-token.js` once
     to save the refresh token.
   ============================================================ */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');

/** Google Drive parent folder for all test reports */
const TEST_RESULTS_FOLDER_ID = '1Qh_keU8NHqevMJBAX7sAZkp2pr07s9-q';

/* ---------- CLI args ---------- */

function parseArgs(argv) {
  const args = { input: null, output: path.join(ROOT, 'generated', 'test-report'), upload: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) args.input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) args.output = argv[++i];
    else if (argv[i] === '--upload') args.upload = true;
  }
  return args;
}

/* ---------- Playwright JSON acquisition ---------- */

function getPlaywrightJSON(inputPath) {
  if (inputPath) {
    const raw = fs.readFileSync(path.resolve(inputPath), 'utf8');
    return JSON.parse(raw);
  }
  // Run Playwright with JSON reporter
  const cmd = 'WAYMARK_LOCAL=true npx playwright test --reporter=json';
  const raw = execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  return JSON.parse(raw);
}

/* ---------- Status mapping ---------- */

/** Map Playwright result status to testcase template status.
 * @param {string} status — Playwright status: passed, failed, skipped, timedOut, interrupted
 * @returns {string} Testcase template status: Pass, Fail, Skip, Blocked, Untested
 */
function mapStatus(status) {
  switch (status) {
    case 'passed':      return 'Pass';
    case 'failed':      return 'Fail';
    case 'timedOut':    return 'Fail';
    case 'skipped':     return 'Skip';
    case 'interrupted': return 'Blocked';
    default:            return 'Untested';
  }
}

/* ---------- Error extraction ---------- */

/** Extract a concise error message from Playwright error details.
 * @param {Array} errors — Playwright error array from results
 * @returns {string} Truncated error message
 */
function extractError(errors) {
  if (!errors || !errors.length) return '';
  const msg = errors[0].message || errors[0].stack || String(errors[0]);
  // Take first line, truncate to 200 chars
  const firstLine = msg.split('\n')[0].trim();
  return firstLine.length > 200 ? firstLine.slice(0, 197) + '...' : firstLine;
}

/* ---------- Duration formatting ---------- */

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ---------- Git branch detection ---------- */

function getBranch() {
  try {
    return execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/* ---------- Spec name normalization ---------- */

/** Convert spec filename to a clean key.
 *  "checklist.spec.js" → "checklist"
 *  "unit-habit-helpers.spec.js" → "unit-habit-helpers"
 */
function specKey(filename) {
  return filename.replace(/\.spec\.(js|ts|mjs)$/, '');
}

/** Convert spec filename to a human-readable title.
 * "checklist.spec.js" → "Checklist Tests"
 * "unit-habit-helpers.spec.js" → "Unit Habit Helpers Tests"
 */
function specTitle(filename) {
  const key = specKey(filename);
  return key
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    + ' Tests';
}

/* ---------- Suite parsing ---------- */

/** Recursively extract all specs from suites (handles nested describe blocks). */
function collectSpecs(suite) {
  const specs = [...(suite.specs || [])];
  for (const sub of (suite.suites || [])) {
    specs.push(...collectSpecs(sub));
  }
  return specs;
}

/** Parse a Playwright JSON report into testcase-compatible data.
 * @param {object} report — Playwright JSON reporter output
 * @returns {{ suites: Array, meta: object }}
 */
function parseReport(report) {
  const branch = getBranch();
  const timestamp = new Date().toISOString();
  const suites = [];

  let totalTests = 0;
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;

  for (const suite of (report.suites || [])) {
    const file = suite.file || suite.title || 'unknown';
    const key = specKey(file);
    const title = specTitle(file);
    const specs = collectSpecs(suite);

    const rows = [['Test Case', 'Result', 'Expected', 'Actual', 'Priority', 'Notes']];

    for (const spec of specs) {
      const testName = spec.title || 'Unnamed test';
      const test = spec.tests && spec.tests[0];
      const result = test && test.results && test.results[test.results.length - 1];

      const playwrightStatus = result ? result.status : 'skipped';
      const templateStatus = mapStatus(playwrightStatus);
      const duration = result ? result.duration : 0;
      const errorMsg = result ? extractError(result.errors) : '';

      const expected = templateStatus === 'Fail' ? 'Pass' : '';
      const actual = templateStatus === 'Fail' ? (errorMsg || 'Failed') : '';
      const notes = formatDuration(duration);

      rows.push([testName, templateStatus, expected, actual, '', notes]);

      totalTests++;
      if (templateStatus === 'Pass') totalPass++;
      else if (templateStatus === 'Fail') totalFail++;
      else if (templateStatus === 'Skip') totalSkip++;
    }

    if (specs.length > 0) {
      suites.push({ key, title, file, rows, testCount: specs.length });
    }
  }

  return {
    suites,
    meta: {
      branch,
      timestamp,
      totalTests,
      totalPass,
      totalFail,
      totalSkip,
      totalUntested: totalTests - totalPass - totalFail - totalSkip,
      passRate: totalTests > 0 ? Math.round((totalPass / totalTests) * 100) : 0,
      suiteCount: suites.length,
    },
  };
}

/* ---------- File generation ---------- */

/** Write fixture files and metadata to the output directory. */
function writeReport(outputDir, parsed) {
  const fixturesDir = path.join(outputDir, 'fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });

  // Write per-suite fixture files
  const folderEntries = [];
  let sheetCounter = 900; // Use high IDs to avoid collision with real fixtures

  for (const suite of parsed.suites) {
    const sheetId = `report-${String(sheetCounter++).padStart(3, '0')}`;
    const fixture = {
      id: sheetId,
      title: suite.title,
      sheetTitle: 'Sheet1',
      values: suite.rows,
    };

    const fixturePath = path.join(fixturesDir, `${suite.key}.json`);
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));

    folderEntries.push({
      id: sheetId,
      name: suite.title,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    });
  }

  // Write folder manifest
  const foldersManifest = {
    id: 'report-folder',
    name: `Test Report — ${parsed.meta.branch}`,
    files: folderEntries,
  };
  fs.writeFileSync(path.join(outputDir, 'folders.json'), JSON.stringify(foldersManifest, null, 2));

  // Write meta
  const metaWithSuites = {
    ...parsed.meta,
    suites: parsed.suites.map(s => ({
      key: s.key,
      title: s.title,
      file: s.file,
      testCount: s.testCount,
    })),
  };
  fs.writeFileSync(path.join(outputDir, 'report-meta.json'), JSON.stringify(metaWithSuites, null, 2));
}

/* ---------- Console output ---------- */

function printSummary(parsed) {
  const m = parsed.meta;
  const rateLabel = m.passRate >= 80 ? '✓' : m.passRate >= 50 ? '⚠' : '✗';

  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   Waymark Test Report                              ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`  Branch:     ${m.branch}`);
  console.log(`  Timestamp:  ${m.timestamp}`);
  console.log(`  Pass rate:  ${rateLabel} ${m.passRate}%`);
  console.log(`  Total:      ${m.totalTests} tests across ${m.suiteCount} suites`);
  console.log(`  Pass: ${m.totalPass}  Fail: ${m.totalFail}  Skip: ${m.totalSkip}`);
  console.log('');
  console.log('  Per-suite breakdown:');

  for (const s of parsed.suites) {
    const pass = s.rows.slice(1).filter(r => r[1] === 'Pass').length;
    const fail = s.rows.slice(1).filter(r => r[1] === 'Fail').length;
    const skip = s.rows.slice(1).filter(r => r[1] === 'Skip').length;
    const rate = s.testCount > 0 ? Math.round((pass / s.testCount) * 100) : 0;
    const icon = rate >= 80 ? '✓' : rate >= 50 ? '⚠' : '✗';
    console.log(`    ${icon} ${s.title.padEnd(40)} ${String(s.testCount).padStart(3)} tests  ${String(rate).padStart(3)}% pass`);
  }

  console.log('');
}

/* ---------- HTML report generation ---------- */

/** Generate a self-contained HTML test report for local+Drive viewing. */
function generateHtmlReport(parsed, outputDir) {
  const m = parsed.meta;
  const rateColor = m.passRate >= 80 ? '#22c55e' : m.passRate >= 50 ? '#f59e0b' : '#ef4444';

  const suiteRows = parsed.suites.map(s => {
    const pass = s.rows.slice(1).filter(r => r[1] === 'Pass').length;
    const fail = s.rows.slice(1).filter(r => r[1] === 'Fail').length;
    const skip = s.rows.slice(1).filter(r => r[1] === 'Skip').length;
    const rate = s.testCount > 0 ? Math.round((pass / s.testCount) * 100) : 0;
    const color = rate >= 80 ? '#22c55e' : rate >= 50 ? '#f59e0b' : '#ef4444';
    return { ...s, pass, fail, skip, rate, color };
  });

  const suiteHtml = suiteRows.map(s => {
    const testRows = s.rows.slice(1).map(r => {
      const statusColor = r[1] === 'Pass' ? '#22c55e' : r[1] === 'Fail' ? '#ef4444' : '#94a3b8';
      const statusIcon = r[1] === 'Pass' ? '✓' : r[1] === 'Fail' ? '✗' : '○';
      const errorCell = r[3] ? `<td class="error">${escapeHtml(r[3])}</td>` : '<td></td>';
      return `<tr><td>${statusIcon} <span style="color:${statusColor};font-weight:600">${escapeHtml(r[1])}</span></td><td>${escapeHtml(r[0])}</td>${errorCell}<td class="mono">${escapeHtml(r[5])}</td></tr>`;
    }).join('\n');

    return `<details ${s.fail > 0 ? 'open' : ''}>
      <summary style="cursor:pointer;padding:8px 0">
        <span style="color:${s.color};font-weight:600">${s.rate}%</span>
        <strong>${escapeHtml(s.title)}</strong>
        <span class="mono" style="color:#94a3b8"> — ${s.testCount} tests (${s.pass}✓ ${s.fail}✗ ${s.skip}○)</span>
      </summary>
      <table><thead><tr><th>Status</th><th>Test Case</th><th>Error</th><th>Duration</th></tr></thead>
      <tbody>${testRows}</tbody></table>
    </details>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Report — ${escapeHtml(m.branch)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;max-width:1200px;margin:0 auto}
  h1{font-size:1.5rem;margin-bottom:4px}
  .meta{color:#94a3b8;margin-bottom:16px;font-size:0.875rem}
  .stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}
  .stat{background:#1e293b;border-radius:8px;padding:12px 20px;min-width:120px}
  .stat-val{font-size:1.5rem;font-weight:700}
  .stat-label{color:#94a3b8;font-size:0.75rem;text-transform:uppercase}
  details{background:#1e293b;border-radius:8px;margin-bottom:8px;padding:4px 16px}
  summary{font-size:0.95rem;padding:10px 0}
  table{width:100%;border-collapse:collapse;margin:8px 0 12px}
  th{text-align:left;padding:6px 8px;border-bottom:1px solid #334155;color:#94a3b8;font-size:0.75rem;text-transform:uppercase}
  td{padding:6px 8px;border-bottom:1px solid #1e293b;font-size:0.875rem;vertical-align:top}
  .error{color:#fca5a5;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mono{font-family:'Fira Code',monospace;font-size:0.8rem}
</style></head><body>
<h1>Test Report — ${escapeHtml(m.branch)}</h1>
<p class="meta">${escapeHtml(m.timestamp)} · ${m.suiteCount} suites · ${m.totalTests} tests</p>
<div class="stats">
  <div class="stat"><div class="stat-val" style="color:${rateColor}">${m.passRate}%</div><div class="stat-label">Pass Rate</div></div>
  <div class="stat"><div class="stat-val" style="color:#22c55e">${m.totalPass}</div><div class="stat-label">Passed</div></div>
  <div class="stat"><div class="stat-val" style="color:#ef4444">${m.totalFail}</div><div class="stat-label">Failed</div></div>
  <div class="stat"><div class="stat-val" style="color:#94a3b8">${m.totalSkip}</div><div class="stat-label">Skipped</div></div>
  <div class="stat"><div class="stat-val">${m.totalTests}</div><div class="stat-label">Total</div></div>
</div>
${suiteHtml}
</body></html>`;

  const htmlPath = path.join(outputDir, 'report.html');
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- Google Drive upload ---------- */

/** OAuth token file saved by scripts/get-oauth-token.js */
const OAUTH_TOKEN_PATH = process.env.WAYMARK_OAUTH_TOKEN_PATH || path.join(
  process.env.HOME || '/home/tekjanson',
  '.config', 'gcloud', 'waymark-oauth-token.json'
);

/** OAuth client credentials (same file used by the Waymark server) */
const CLIENT_SECRET_FILE = path.join(
  ROOT,
  'client_secret_764742927885-fs0atq3ecenhndpdaaqkb0d0go1blt22.apps.googleusercontent.com_waymarkauth.json'
);

/** HTTPS request helper (same pattern as generate-examples.js) */
function httpsRequest(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/**
 * Get an OAuth user access token (from saved refresh token).
 * This allows creating files in the user's Drive (service accounts
 * have zero storage quota and cannot create files).
 */
async function getOAuthToken() {
  if (!fs.existsSync(OAUTH_TOKEN_PATH)) {
    throw new Error(
      `OAuth token not found at ${OAUTH_TOKEN_PATH}\n` +
      `  Run: node scripts/get-oauth-token.js`
    );
  }
  const tokenData = JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf8'));

  // If token is still valid (with 60s buffer), return it
  if (tokenData.access_token && tokenData.expiry_date > Date.now() + 60000) {
    return tokenData.access_token;
  }

  // Refresh the access token
  if (!tokenData.refresh_token) {
    throw new Error('No refresh token. Re-run: node scripts/get-oauth-token.js');
  }

  const res = await httpsRequest(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    new URLSearchParams({
      refresh_token: tokenData.refresh_token,
      client_id: tokenData.client_id,
      client_secret: tokenData.client_secret,
      grant_type: 'refresh_token',
    }).toString()
  );

  if (res.status !== 200) {
    throw new Error(`Token refresh failed ${res.status}: ${JSON.stringify(res.data)}`);
  }

  // Update saved token file
  tokenData.access_token = res.data.access_token;
  tokenData.expiry_date = Date.now() + (res.data.expires_in * 1000);
  fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(tokenData, null, 2));
  fs.chmodSync(OAUTH_TOKEN_PATH, 0o600);

  return tokenData.access_token;
}

/** Create a folder in Google Drive */
async function createDriveFolder(token, name, parents) {
  const res = await httpsRequest(
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents,
    })
  );
  if (res.status !== 200) {
    throw new Error(`Drive create folder ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

/** Create a Google Sheet with data and place it in a folder */
async function createDriveSheet(token, title, rows, parentId) {
  // Create spreadsheet via Sheets API (uses user OAuth token for quota)
  const body = {
    properties: { title },
    sheets: [{
      properties: { title: 'Sheet1' },
      data: rows.length ? [{
        startRow: 0,
        startColumn: 0,
        rowData: rows.map(row => ({
          values: row.map(cell => ({ userEnteredValue: { stringValue: String(cell) } })),
        })),
      }] : [],
    }],
  };
  const res = await httpsRequest(
    'https://sheets.googleapis.com/v4/spreadsheets',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify(body)
  );
  if (res.status !== 200) {
    throw new Error(`Sheets create ${res.status}: ${JSON.stringify(res.data)}`);
  }
  // Move to parent folder
  if (parentId) {
    await httpsRequest(
      `https://www.googleapis.com/drive/v3/files/${res.data.spreadsheetId}?addParents=${encodeURIComponent(parentId)}&fields=id`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  }
  return res.data;
}

/**
 * Upload test report to Google Drive.
 * Creates a subfolder per branch inside the test-results folder,
 * then creates one Google Sheet per spec file in testcase format.
 *
 * Uses OAuth user credentials (from get-oauth-token.js) because
 * service accounts have zero file-storage quota on consumer accounts.
 *
 * @param {object} parsed — output of parseReport()
 * @returns {string} URL of the created Drive folder
 */
async function uploadToDrive(parsed) {
  console.log('\n  Uploading to Google Drive...');

  const token = await getOAuthToken();
  const m = parsed.meta;
  const datePart = m.timestamp.slice(0, 10);
  const folderName = `${m.branch} — ${datePart}`;

  // Create subfolder for this branch+date inside the test-results folder
  const folder = await createDriveFolder(token, folderName, [TEST_RESULTS_FOLDER_ID]);
  console.log(`  Created folder: ${folderName} (${folder.id})`);

  // Create one sheet per spec suite — each has testcase-template headers
  // (Test Case | Result | Expected | Actual | Priority | Notes)
  // so the Waymark directory view renders the folder as a Test Suite Overview
  // with pass/fail/blocked/skip aggregation across all sheets.
  let created = 0;
  for (const suite of parsed.suites) {
    await createDriveSheet(token, suite.title, suite.rows, folder.id);
    created++;
    if (created % 10 === 0) {
      console.log(`  Created ${created}/${parsed.suites.length} sheets...`);
    }
  }
  console.log(`  Created ${created} test case sheets`);

  const folderUrl = `https://drive.google.com/drive/folders/${folder.id}`;
  return folderUrl;
}

/* ---------- Main ---------- */

(async () => {
  const args = parseArgs(process.argv);

  let report;
  try {
    report = getPlaywrightJSON(args.input);
  } catch (err) {
    console.error(`Failed to get Playwright results: ${err.message}`);
    process.exit(1);
  }

  const parsed = parseReport(report);

  writeReport(args.output, parsed);
  printSummary(parsed);

  console.log(`  Report written to: ${path.relative(ROOT, args.output)}/`);
  console.log(`  ${parsed.suites.length} fixture files generated.`);

  // Generate HTML report for local/offline viewing
  const htmlPath = generateHtmlReport(parsed, args.output);
  console.log(`  HTML report: ${path.relative(ROOT, htmlPath)}`);

  // Upload to Google Drive if --upload flag is set
  if (args.upload) {
    try {
      const folderUrl = await uploadToDrive(parsed);
      console.log(`  Drive folder: ${folderUrl}`);

      // Write the folder URL to a file so the agent can read it
      fs.writeFileSync(
        path.join(args.output, 'drive-url.txt'),
        folderUrl
      );
    } catch (err) {
      console.error(`  Drive upload failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('');
})();
