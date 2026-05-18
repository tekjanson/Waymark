/**
 * @module index
 * CLI entry point for the Waymark Prompt-to-Test compiler engine.
 *
 * Usage:
 *   node src/compiler/index.mjs run <path/to/feature.prompt.md>
 *
 * The prompt file must have a YAML frontmatter block with:
 *   ---
 *   target: relative/path/to/output.mjs
 *   test:   relative/path/to/output.test.mjs
 *   status: active   # or 'static' to skip
 *   ---
 *   <plain-English description of what the module should do>
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { Orchestrator } from './core/Orchestrator.mjs';
import { GeminiCliAdapter } from './adapters/GeminiCliAdapter.mjs';
import { StateAdapter } from './adapters/StateAdapter.mjs';

// ── Bootstrap required workspace directories ────────────────────────────────
fs.mkdirSync('.waymark/temp',    { recursive: true });
fs.mkdirSync('.waymark/backups', { recursive: true });

// ── Parse argv ──────────────────────────────────────────────────────────────
const [,, command, promptFilePath] = process.argv;

if (command !== 'run' || !promptFilePath) {
    console.error(
        'Usage: node src/compiler/index.mjs run <path/to/feature.prompt.md>'
    );
    process.exit(1);
}

// Resolve immediately so all downstream modules get absolute paths.
const resolvedPromptPath = path.resolve(promptFilePath);

if (!fs.existsSync(resolvedPromptPath)) {
    console.error(`Error: prompt file not found: ${resolvedPromptPath}`);
    process.exit(1);
}

// ── Read & parse the prompt file ────────────────────────────────────────────
const rawContent = fs.readFileSync(resolvedPromptPath, 'utf-8');

const frontmatterMatch = rawContent.match(/^---([\s\S]+?)---/);
if (!frontmatterMatch) {
    console.error('Error: No YAML frontmatter block found in prompt file.');
    console.error('Expected the file to begin with:\n  ---\n  target: ...\n  test: ...\n  ---');
    process.exit(1);
}

/** @type {{ target: string, test: string, status?: string }} */
const config = yaml.load(frontmatterMatch[1]);

if (!config.target || !config.test) {
    console.error('Error: Frontmatter must include both "target" and "test" fields.');
    process.exit(1);
}

const promptText = rawContent.replace(/^---[\s\S]+?---/, '').trim();

// ── Wire dependencies & run ─────────────────────────────────────────────────
const compilerAdapter = new GeminiCliAdapter();
const stateAdapter    = new StateAdapter();
const orchestrator    = new Orchestrator(compilerAdapter, stateAdapter);

const jobId = path.basename(resolvedPromptPath, '.prompt.md');

try {
    await orchestrator.run({ jobId, config, promptText });
} finally {
    // Always flush the MQTT connection, even on uncaught errors.
    await stateAdapter.dispose();
}
