const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests', 'e2e');

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function listChangedFiles() {
  const groups = [
    ['diff', ['diff', '--name-only']],
    ['staged', ['diff', '--cached', '--name-only']],
    ['untracked', ['ls-files', '--others', '--exclude-standard']],
  ];
  const files = new Set();

  for (const [, args] of groups) {
    const output = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
    if (!output) continue;
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) files.add(toPosix(trimmed));
    }
  }

  return [...files].sort();
}

function listAllSpecs() {
  return fs.readdirSync(TESTS_DIR)
    .filter(name => name.endsWith('.spec.js') && name !== 'design-audit.spec.js')
    .map(name => `tests/e2e/${name}`)
    .sort();
}

function templateSpecPath(key) {
  return `tests/e2e/${key}.spec.js`;
}

function templateUnitPath(key) {
  return `tests/e2e/unit-${key}-helpers.spec.js`;
}

function addSpec(specs, relativePath) {
  if (fileExists(relativePath)) specs.add(relativePath);
}

function addMany(specs, relativePaths) {
  for (const relativePath of relativePaths) addSpec(specs, relativePath);
}

function inferFixtureTemplate(filePath) {
  const base = path.basename(filePath, '.json');
  const key = base.split('-')[0];
  return fileExists(templateSpecPath(key)) ? key : null;
}

function collectSpecsForFile(filePath, specs, reasons) {
  const normalized = toPosix(filePath);

  if (normalized.startsWith('tests/e2e/') && normalized.endsWith('.spec.js')) {
    addSpec(specs, normalized);
    reasons.push(`${normalized} -> direct spec`);
    return false;
  }

  let match = normalized.match(/^public\/js\/templates\/([^/]+)\/helpers\.js$/);
  if (match) {
    const key = match[1];
    addMany(specs, [templateSpecPath(key), templateUnitPath(key)]);
    reasons.push(`${normalized} -> ${key} template + helper unit tests`);
    return false;
  }

  match = normalized.match(/^public\/js\/templates\/([^/]+)\/(index|[^/]+)\.js$/);
  if (match) {
    const key = match[1];
    addSpec(specs, templateSpecPath(key));
    reasons.push(`${normalized} -> ${key} template spec`);
    return false;
  }

  match = normalized.match(/^public\/js\/templates\/([^/]+)\.js$/);
  if (match) {
    const key = match[1];
    addSpec(specs, templateSpecPath(key));
    reasons.push(`${normalized} -> ${key} template spec`);
    return false;
  }

  match = normalized.match(/^public\/css\/templates\/([^/]+)\.css$/);
  if (match) {
    const key = match[1];
    addSpec(specs, templateSpecPath(key));
    reasons.push(`${normalized} -> ${key} template spec`);
    return false;
  }

  if (normalized === 'public/js/agent.js' || normalized.startsWith('public/js/agent/')) {
    addSpec(specs, 'tests/e2e/agent.spec.js');
    reasons.push(`${normalized} -> agent spec`);
    return false;
  }

  if (normalized === 'public/js/storage.js') {
    addMany(specs, [
      'tests/e2e/unit-storage.spec.js',
      'tests/e2e/settings.spec.js',
      'tests/e2e/notifications.spec.js',
      'tests/e2e/tutorial.spec.js',
      'tests/e2e/agent.spec.js',
    ]);
    reasons.push(`${normalized} -> storage-focused specs`);
    return false;
  }

  if (normalized.startsWith('tests/fixtures/sheets/')) {
    const key = inferFixtureTemplate(normalized);
    if (key) {
      addSpec(specs, templateSpecPath(key));
      reasons.push(`${normalized} -> ${key} template spec`);
      return false;
    }
  }

  if (normalized === 'tests/fixtures/folders.json') {
    addMany(specs, [
      'tests/e2e/explorer.spec.js',
      'tests/e2e/general.spec.js',
      'tests/e2e/iot.spec.js',
      'tests/e2e/budget.spec.js',
      'tests/e2e/gradebook.spec.js',
      'tests/e2e/meal.spec.js',
      'tests/e2e/recipe.spec.js',
      'tests/e2e/testcases.spec.js',
    ]);
    reasons.push(`${normalized} -> folder and directory-view specs`);
    return false;
  }

  if (normalized === 'README.md' || normalized.startsWith('docs/')) {
    reasons.push(`${normalized} -> docs only`);
    return false;
  }

  if (
    normalized === 'package.json' ||
    normalized === 'public/js/checklist.js' ||
    normalized === 'public/js/api-client.js' ||
    normalized === 'public/js/app.js' ||
    normalized === 'public/js/ui.js' ||
    normalized === 'public/js/templates/shared.js' ||
    normalized.startsWith('tests/helpers/') ||
    normalized === 'tests/playwright.config.js' ||
    normalized === 'playwright.config.js' ||
    normalized.startsWith('server/')
  ) {
    reasons.push(`${normalized} -> broad/shared change, full suite required`);
    return true;
  }

  reasons.push(`${normalized} -> no mapping`);
  return false;
}

function parseArgs(argv) {
  const args = { dryRun: false, listOnly: false, changedFiles: [] };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--list') args.listOnly = true;
    else args.changedFiles.push(toPosix(arg));
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = args.changedFiles.length ? args.changedFiles : listChangedFiles();

  if (changedFiles.length === 0) {
    console.log('No changed files detected. Pass paths explicitly or run npm test.');
    process.exit(0);
  }

  const specs = new Set();
  const reasons = [];
  let requiresFullSuite = false;

  for (const filePath of changedFiles) {
    requiresFullSuite = collectSpecsForFile(filePath, specs, reasons) || requiresFullSuite;
  }

  const selectedSpecs = requiresFullSuite ? listAllSpecs() : [...specs].sort();

  console.log('Changed files:');
  for (const filePath of changedFiles) console.log(`  - ${filePath}`);
  console.log('Selection rationale:');
  for (const reason of reasons) console.log(`  - ${reason}`);

  if (selectedSpecs.length === 0) {
    console.log('No impacted Playwright specs were inferred.');
    console.log('Pass paths explicitly to test a target area, or run npm test for the full suite.');
    process.exit(0);
  }

  console.log(requiresFullSuite
    ? 'Broad/shared changes detected; running the full Playwright suite.'
    : 'Impacted Playwright specs:');
  for (const spec of selectedSpecs) console.log(`  - ${spec}`);

  if (args.listOnly || args.dryRun) process.exit(0);

  const commandArgs = ['playwright', 'test', '--config', 'tests/playwright.config.js', ...selectedSpecs];
  const result = spawnSync('npx', commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, WAYMARK_LOCAL: process.env.WAYMARK_LOCAL || 'true' },
  });

  process.exit(result.status || 0);
}

main();