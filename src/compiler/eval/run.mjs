/**
 * @module eval/run
 * CLI entry point for the iterative LLM-judge eval loop.
 *
 * Usage:
 *   node src/compiler/eval/run.mjs run <path/to/feature.prompt.md>
 *
 * Options:
 *   --iterations <n>   Override max eval iterations (default: 5)
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { EvalLoop } from './EvalLoop.mjs';
import { GeminiCliAdapter } from '../adapters/GeminiCliAdapter.mjs';
import { StateAdapter } from '../adapters/StateAdapter.mjs';

fs.mkdirSync('.waymark/temp',    { recursive: true });
fs.mkdirSync('.waymark/backups', { recursive: true });

const args = process.argv.slice(2);
const command       = args[0];
const promptFilePath = args[1];
const iterFlag      = args.indexOf('--iterations');
const maxIterations = iterFlag !== -1 ? parseInt(args[iterFlag + 1], 10) : 5;

if (command !== 'run' || !promptFilePath) {
    console.error('Usage: node src/compiler/eval/run.mjs run <prompt.md> [--iterations <n>]');
    process.exit(1);
}

const resolvedPromptPath = path.resolve(promptFilePath);
if (!fs.existsSync(resolvedPromptPath)) {
    console.error(`Error: prompt file not found: ${resolvedPromptPath}`);
    process.exit(1);
}

const rawContent = fs.readFileSync(resolvedPromptPath, 'utf-8');
const frontmatterMatch = rawContent.match(/^---([\s\S]+?)---/);
if (!frontmatterMatch) {
    console.error('Error: No YAML frontmatter found in prompt file.');
    process.exit(1);
}

const config = yaml.load(frontmatterMatch[1]);
if (!config.target || !config.test) {
    console.error('Error: Frontmatter must include "target" and "test" fields.');
    process.exit(1);
}

const promptText = rawContent.replace(/^---[\s\S]+?---/, '').trim();
const jobId      = path.basename(resolvedPromptPath, '.prompt.md');

const compiler = new GeminiCliAdapter();
const state    = new StateAdapter();
const loop     = new EvalLoop({ compiler, state, maxIterations });

let exitCode = 0;
try {
    const result = await loop.run({ jobId, config, promptText });

    console.log('\n' + '═'.repeat(60));
    console.log('  FINAL RESULT');
    console.log('═'.repeat(60));
    console.log(`  Status    : ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`  Score     : ${result.finalScore}/10`);
    console.log(`  Iterations: ${result.iterations}`);
    console.log('═'.repeat(60) + '\n');

    exitCode = result.passed ? 0 : 1;
} finally {
    await state.dispose();
}

process.exit(exitCode);
