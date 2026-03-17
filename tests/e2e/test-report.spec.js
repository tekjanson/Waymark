// @ts-check
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'generate-test-report.js');
const SAMPLE = path.join(ROOT, 'tests', 'fixtures', 'playwright-sample-output.json');

/** Create a unique temp output directory for this test. */
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-test-report-'));
}

/** Run the script with given args and return { stdout, outputDir }. */
function runScript(outputDir) {
  const stdout = execSync(`node ${SCRIPT} --input ${SAMPLE} --output ${outputDir}`, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
  return stdout;
}

/** Clean up output directory. */
function cleanup(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('generate-test-report creates output directory and fixture files', async () => {
  const dir = makeTempDir();
  runScript(dir);

  expect(fs.existsSync(dir)).toBe(true);
  expect(fs.existsSync(path.join(dir, 'report-meta.json'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'folders.json'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'fixtures'))).toBe(true);

  cleanup(dir);
});

test('generate-test-report produces correct number of fixture files (skips empty suites)', async () => {
  const dir = makeTempDir();
  runScript(dir);

  const fixtures = fs.readdirSync(path.join(dir, 'fixtures'));
  // sample-passing + sample-mixed = 2 fixtures (sample-empty has 0 specs, skipped)
  expect(fixtures.length).toBe(2);
  expect(fixtures).toContain('sample-passing.json');
  expect(fixtures).toContain('sample-mixed.json');

  cleanup(dir);
});

test('generate-test-report fixture uses testcase template format with correct headers', async () => {
  const dir = makeTempDir();
  runScript(dir);

  const fixture = JSON.parse(
    fs.readFileSync(path.join(dir, 'fixtures', 'sample-passing.json'), 'utf8')
  );

  expect(fixture.id).toMatch(/^report-/);
  expect(fixture.title).toBe('Sample Passing Tests');
  expect(fixture.sheetTitle).toBe('Sheet1');
  expect(fixture.values).toBeInstanceOf(Array);
  expect(fixture.values[0]).toEqual([
    'Test Case', 'Result', 'Expected', 'Actual', 'Priority', 'Notes',
  ]);

  cleanup(dir);
});

test('generate-test-report maps passed status to Pass', async () => {
  const dir = makeTempDir();
  runScript(dir);

  const fixture = JSON.parse(
    fs.readFileSync(path.join(dir, 'fixtures', 'sample-passing.json'), 'utf8')
  );

  // 2 passing tests + header
  expect(fixture.values.length).toBe(3);
  expect(fixture.values[1][0]).toBe('renders the homepage correctly');
  expect(fixture.values[1][1]).toBe('Pass');
  expect(fixture.values[2][0]).toBe('navigates to detail page');
  expect(fixture.values[2][1]).toBe('Pass');

  cleanup(dir);
});

test('generate-test-report maps failed, skipped, timedOut, and interrupted statuses', async () => {
  const dir = makeTempDir();
  runScript(dir);

  const fixture = JSON.parse(
    fs.readFileSync(path.join(dir, 'fixtures', 'sample-mixed.json'), 'utf8')
  );

  // 5 tests + header = 6 rows
  expect(fixture.values.length).toBe(6);

  // Row 1: passed → Pass
  expect(fixture.values[1][1]).toBe('Pass');

  // Row 2: failed → Fail (with error in Actual column)
  expect(fixture.values[2][1]).toBe('Fail');
  expect(fixture.values[2][2]).toBe('Pass'); // Expected column
  expect(fixture.values[2][3]).toContain('toBeVisible'); // Actual has error excerpt

  // Row 3: skipped → Skip
  expect(fixture.values[3][1]).toBe('Skip');

  // Row 4: timedOut → Fail
  expect(fixture.values[4][1]).toBe('Fail');
  expect(fixture.values[4][3]).toContain('timeout'); // Error about timeout

  // Row 5: interrupted → Blocked
  expect(fixture.values[5][1]).toBe('Blocked');

  cleanup(dir);
});

test('generate-test-report includes duration in Notes column', async () => {
  const dir = makeTempDir();
  runScript(dir);

  const fixture = JSON.parse(
    fs.readFileSync(path.join(dir, 'fixtures', 'sample-passing.json'), 'utf8')
  );

  // First test: 1215ms → "1.2s"
  expect(fixture.values[1][5]).toBe('1.2s');
  // Second test: 2340ms → "2.3s"
  expect(fixture.values[2][5]).toBe('2.3s');

  cleanup(dir);
});

test('generate-test-report meta has correct aggregated stats', async () => {
  const dir = makeTempDir();
  runScript(dir);

  const meta = JSON.parse(
    fs.readFileSync(path.join(dir, 'report-meta.json'), 'utf8')
  );

  expect(meta.totalTests).toBe(7); // 2 passing + 5 mixed (empty suite excluded)
  expect(meta.totalPass).toBe(3);  // 2 from passing + 1 from mixed
  expect(meta.totalFail).toBe(2);  // failed + timedOut
  expect(meta.totalSkip).toBe(1);  // skipped
  expect(meta.suiteCount).toBe(2); // 2 non-empty suites
  expect(meta.passRate).toBe(43);  // 3/7 ≈ 43%
  expect(meta.branch).toBeTruthy();
  expect(meta.timestamp).toBeTruthy();

  cleanup(dir);
});

test('generate-test-report folders.json lists all suites with correct format', async () => {
  const dir = makeTempDir();
  runScript(dir);

  const folders = JSON.parse(
    fs.readFileSync(path.join(dir, 'folders.json'), 'utf8')
  );

  expect(folders.id).toBe('report-folder');
  expect(folders.name).toContain('Test Report');
  expect(folders.files).toBeInstanceOf(Array);
  expect(folders.files.length).toBe(2);

  for (const file of folders.files) {
    expect(file.id).toMatch(/^report-/);
    expect(file.name).toBeTruthy();
    expect(file.mimeType).toBe('application/vnd.google-apps.spreadsheet');
  }

  cleanup(dir);
});

test('generate-test-report meta suites list has correct structure', async () => {
  const dir = makeTempDir();
  runScript(dir);

  const meta = JSON.parse(
    fs.readFileSync(path.join(dir, 'report-meta.json'), 'utf8')
  );

  expect(meta.suites).toBeInstanceOf(Array);
  expect(meta.suites.length).toBe(2);

  const passing = meta.suites.find(s => s.key === 'sample-passing');
  expect(passing).toBeTruthy();
  expect(passing.title).toBe('Sample Passing Tests');
  expect(passing.testCount).toBe(2);
  expect(passing.file).toBe('sample-passing.spec.js');

  const mixed = meta.suites.find(s => s.key === 'sample-mixed');
  expect(mixed).toBeTruthy();
  expect(mixed.title).toBe('Sample Mixed Tests');
  expect(mixed.testCount).toBe(5);

  cleanup(dir);
});

test('generate-test-report console output contains summary lines', async () => {
  const dir = makeTempDir();
  const output = runScript(dir);

  expect(output).toContain('Waymark Test Report');
  expect(output).toContain('Branch:');
  expect(output).toContain('Pass rate:');
  expect(output).toContain('7 tests across 2 suites');
  expect(output).toContain('Report written to:');

  cleanup(dir);
});
