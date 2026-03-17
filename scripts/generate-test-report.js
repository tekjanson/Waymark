#!/usr/bin/env node
/* ============================================================
   generate-test-report.js — Convert Playwright results to
   testcase-template-compatible fixtures for dogfooding.
   ============================================================
   Parses Playwright JSON reporter output and generates:
   1. Fixture files per spec (testcase template format)
   2. A folder manifest for directory view
   3. Console summary

   Usage:
     # Run tests and generate report
     WAYMARK_LOCAL=true node scripts/generate-test-report.js

     # Parse existing JSON file
     node scripts/generate-test-report.js --input results.json

     # Specify output dir
     node scripts/generate-test-report.js --output generated/test-report

   Output (generated/test-report/):
     report-meta.json     — branch, timestamp, totals
     fixtures/*.json      — one per spec file (testcase format)
     folders.json         — folder manifest for directory view
   ============================================================ */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ---------- CLI args ---------- */

function parseArgs(argv) {
  const args = { input: null, output: path.join(ROOT, 'generated', 'test-report') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) args.input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) args.output = argv[++i];
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
  console.log('');
})();
