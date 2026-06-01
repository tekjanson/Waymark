/* ============================================================
  check-generated-integrity.mjs - Guard generated artifacts in staged commits
  ============================================================ */

import { execFileSync } from 'node:child_process';

/* ---------- Matchers ---------- */

const GENERATED_PATTERNS = [
  (file) => file.startsWith('generated/'),
  (file) => file.startsWith('.github/agents/') && file.endsWith('.agent.md'),
];

const SOURCE_PATTERNS = [
  (file) => file.startsWith('agent-templates/'),
  (file) => file === 'template-registry.json',
  (file) => file === 'mcp/agent-compiler.mjs',
  (file) => file === 'scripts/compile-all-agents.mjs',
  (file) => file === 'scripts/generate-template.js',
];

/* ---------- Helpers ---------- */

function isMatch(file, matchers) {
  return matchers.some((matcher) => matcher(file));
}

function getStagedFiles() {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/* ---------- Main ---------- */

function main() {
  const allowGeneratedOnly = process.env.WAYMARK_ALLOW_GENERATED_ONLY === '1';

  let files = [];
  try {
    files = getStagedFiles();
  } catch (error) {
    console.warn('[check-generated-integrity] Skipping check: unable to read staged files.');
    console.warn(error instanceof Error ? error.message : String(error));
    process.exit(0);
  }

  const generatedFiles = files.filter((file) => isMatch(file, GENERATED_PATTERNS));

  if (generatedFiles.length === 0 || allowGeneratedOnly) {
    process.exit(0);
  }

  const hasSourceChange = files.some((file) => isMatch(file, SOURCE_PATTERNS));

  if (hasSourceChange) {
    process.exit(0);
  }

  console.error('[check-generated-integrity] Refusing commit: generated artifacts changed without source inputs.');
  console.error('Staged generated files:');
  for (const file of generatedFiles) {
    console.error(`  - ${file}`);
  }
  console.error('Stage related source changes (agent templates/registry/compiler) or set WAYMARK_ALLOW_GENERATED_ONLY=1 for intentional exceptions.');
  process.exit(1);
}

main();