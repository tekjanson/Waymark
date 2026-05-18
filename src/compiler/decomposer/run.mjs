/**
 * CLI entry for the decompose pipeline.
 *
 * Usage:
 *   node src/compiler/decomposer/run.mjs stage  <prompt.md> --out <dir>
 *   node src/compiler/decomposer/run.mjs execute <manifest.stage.json>
 *   node src/compiler/decomposer/run.mjs approve <manifest.stage.json>
 *
 * Commands:
 *   stage   — Decompose a prompt into unit tests + atomic prompts. No code
 *             is compiled. Outputs a .stage.json manifest for human review.
 *   execute — Compile all approved units in DAG order. Requires manifest to
 *             have "approved": true (set manually or via `approve` command).
 *   approve — Shorthand: set "approved": true in the manifest and print it.
 *             Use this to approve without a text editor.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { GeminiCliAdapter } from '../adapters/GeminiCliAdapter.mjs';
import { StateAdapter } from '../adapters/StateAdapter.mjs';
import { DecomposeOrchestrator } from './DecomposeOrchestrator.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const TEMP_DIR = '.waymark/temp';
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync('.waymark/stage', { recursive: true });

const args = process.argv.slice(2);
const command = args[0];

// ── Parse flags ───────────────────────────────────────────────────────────────

function flag(name, defaultVal = null) {
    const i = args.indexOf(name);
    if (i === -1) return defaultVal;
    return args[i + 1] ?? defaultVal;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

if (command === 'stage') {
    await runStage();
} else if (command === 'execute') {
    await runExecute();
} else if (command === 'approve') {
    await runApprove();
} else {
    console.error(`Unknown command: ${command ?? '(none)'}`);
    console.error('Usage:');
    console.error('  node src/compiler/decomposer/run.mjs stage   <prompt.md> --out <dir>');
    console.error('  node src/compiler/decomposer/run.mjs execute <manifest.stage.json>');
    console.error('  node src/compiler/decomposer/run.mjs approve <manifest.stage.json>');
    process.exit(1);
}

// ── Command implementations ───────────────────────────────────────────────────

async function runStage() {
    const promptFile = args[1];
    if (!promptFile) {
        console.error('stage requires a prompt file path.');
        process.exit(1);
    }

    const outDir = flag('--out');
    if (!outDir) {
        console.error('stage requires --out <directory>');
        process.exit(1);
    }

    const raw = fs.readFileSync(promptFile, 'utf-8');
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) {
        console.error('Prompt file must have YAML frontmatter (--- ... ---).');
        process.exit(1);
    }

    const config = yaml.load(fmMatch[1]);
    const promptText = fmMatch[2].trim();

    // jobId from filename, sanitised.
    const jobId = path.basename(promptFile, path.extname(promptFile)).replace(/[^a-zA-Z0-9_-]/g, '_');

    const targetPath = path.resolve(config.target ?? '');
    const testPath = path.resolve(config.test ?? '');
    const resolvedOutDir = path.resolve(outDir);

    const iterations = parseInt(flag('--iterations', '3'), 10);

    const compiler = new GeminiCliAdapter();
    const state = new StateAdapter();

    const orchestrator = new DecomposeOrchestrator({ compiler, state, maxIterations: iterations });

    try {
        const manifestPath = await orchestrator.stage({
            jobId,
            targetPath,
            testPath,
            outDir: resolvedOutDir,
            promptText,
            systemRules: config.systemRules ?? '',
        });
        console.log(`\nManifest written: ${manifestPath}`);
    } finally {
        await state.dispose().catch(() => {});
    }
}

async function runExecute() {
    const manifestPath = args[1];
    if (!manifestPath || !fs.existsSync(manifestPath)) {
        console.error(`execute requires a valid manifest path. Got: ${manifestPath}`);
        process.exit(1);
    }

    const iterations = parseInt(flag('--iterations', '3'), 10);

    const compiler = new GeminiCliAdapter();
    const state = new StateAdapter();
    const orchestrator = new DecomposeOrchestrator({ compiler, state, maxIterations: iterations });

    try {
        const statuses = await orchestrator.execute(manifestPath);
        const anyFailed = [...statuses.values()].some(s => s === 'failed');
        process.exit(anyFailed ? 1 : 0);
    } catch (err) {
        console.error(`Execute failed: ${err.message}`);
        process.exit(1);
    } finally {
        await state.dispose().catch(() => {});
    }
}

async function runApprove() {
    const manifestPath = args[1];
    if (!manifestPath || !fs.existsSync(manifestPath)) {
        console.error(`approve requires a valid manifest path. Got: ${manifestPath}`);
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.approved = true;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    console.log(`✅ Approved: ${manifestPath}`);
    console.log(`   ${manifest.units.length} unit(s) ready to execute.`);
    console.log(`\nRun:`);
    console.log(`  node src/compiler/decomposer/run.mjs execute ${manifestPath}`);
}
