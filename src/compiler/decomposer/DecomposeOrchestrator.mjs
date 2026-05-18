/**
 * @module DecomposeOrchestrator
 *
 * Wires the full decompose pipeline. Two operating modes:
 *
 * STAGE mode (default — safe):
 *   extract → toposort → write tests FIRST → write prompts → STOP
 *   Outputs a manifest to `.waymark/stage/<jobId>.stage.json` for human review.
 *   No source files are compiled or modified. Zero blast radius.
 *   Human reviews the stage file, approves or edits, then runs execute mode.
 *
 * EXECUTE mode (destructive — requires explicit flag):
 *   Reads an approved stage manifest → compiles each unit in DAG order →
 *   writes barrel → reports per-unit pass/fail with Judge quality scores.
 *
 * The separation enforces the rule Gemini identified:
 *   "You cannot write the sub-prompts until you know the compilation order."
 *   "Write the gatekeeper (test) before you build the black box (impl)."
 *
 * Blast radius management:
 *   - Each unit is an independent EvalLoop job.
 *   - A failing unit does NOT block sibling units with no dep on it.
 *   - Units that depend on a failed unit are skipped (marked BLOCKED).
 *   - The barrel only exports units that succeeded.
 *   - CabalIndex injects reverse-dep warnings so the LLM knows what it might break.
 */

import fs from 'node:fs';
import path from 'node:path';
import { UnitExtractor } from './UnitExtractor.mjs';
import { PromptSplitter } from './PromptSplitter.mjs';
import { TestSplitter } from './TestSplitter.mjs';
import { BarrelWriter } from './BarrelWriter.mjs';
import { CabalIndex } from './CabalIndex.mjs';
import { IntegrationSmokeWriter } from './IntegrationSmokeWriter.mjs';
import { EvalLoop } from '../eval/EvalLoop.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const STAGE_DIR = '.waymark/stage';

/**
 * @typedef {Object} DecomposeJob
 * @property {string} jobId           - Identifier for this decompose run.
 * @property {string} targetPath      - Abs path of the source file to decompose.
 * @property {string} testPath        - Abs path of the monolithic test file (may not exist).
 * @property {string} outDir          - Abs path of the output directory for unit files.
 * @property {string} promptText      - Raw prompt body from the parent .prompt.md.
 * @property {string} [systemRules]   - Invariant rules for all sub-prompts.
 */

/**
 * @typedef {'staged'|'succeeded'|'failed'|'blocked'} UnitStatus
 */

/**
 * @typedef {Object} UnitStageRecord
 * @property {string} unitName
 * @property {string} unitKind
 * @property {string} targetPath
 * @property {string} testPath
 * @property {string} promptBody      - Full atomic prompt including SharedManifest.
 * @property {string[]} depNames
 * @property {number} dagOrder
 * @property {UnitStatus} status
 * @property {number|null} judgeScore
 * @property {string[]} errors
 */

/**
 * @typedef {Object} StageManifest
 * @property {string}            jobId
 * @property {string}            createdAt
 * @property {string}            outDir
 * @property {string}            barrelPath
 * @property {UnitStageRecord[]} units
 * @property {boolean}           approved    - Set to true by human before execute.
 */

export class DecomposeOrchestrator {
    /**
     * @param {object} opts
     * @param {import('../interfaces/ICompiler.mjs').CompilerAdapter} opts.compiler
     * @param {import('../adapters/StateAdapter.mjs').StateAdapter}   opts.state
     * @param {number} [opts.maxIterations] - Per-unit EvalLoop max iterations.
     */
    constructor({ compiler, state, maxIterations = 3 }) {
        this.compiler = compiler;
        this.state = state;
        this.maxIterations = maxIterations;
    }

    /**
     * STAGE mode: decompose, write tests + prompts, output manifest for review.
     * Does NOT compile any source. Safe to run on any file.
     *
     * @param {DecomposeJob} job
     * @returns {Promise<string>} Path to the written stage manifest.
     */
    async stage(job) {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  DECOMPOSE — STAGE MODE`);
        console.log(`  Job: ${job.jobId}`);
        console.log(`${'═'.repeat(60)}\n`);

        fs.mkdirSync(job.outDir, { recursive: true });
        fs.mkdirSync(STAGE_DIR, { recursive: true });

        // ── Step 1: Build CabalIndex — understand structural context ──────
        console.log('[DecomposeOrchestrator] Building CabalIndex…');
        const cabal = new CabalIndex(process.cwd());
        await cabal.build();
        const cabalDigest = cabal.getDigest(job.targetPath);
        if (cabalDigest) {
            console.log('[DecomposeOrchestrator] CabalIndex ready — structural context attached.');
        }

        // ── Step 2: Extract units (AST or Gemini) ────────────────────────
        console.log('[DecomposeOrchestrator] Extracting units…');
        const extractor = new UnitExtractor({
            targetPath: job.targetPath,
            promptText: job.promptText,
            jobId: job.jobId,
        });
        const units = await extractor.extract();
        console.log(`  → ${units.length} unit(s) found: ${units.map(u => u.name).join(', ')}`);

        if (units.length === 0) {
            throw new Error(`[DecomposeOrchestrator] UnitExtractor returned no units for job "${job.jobId}".`);
        }

        // ── Step 3: Split prompts (SharedManifest included) ──────────────
        console.log('[DecomposeOrchestrator] Splitting prompts (building SharedManifest)…');
        const systemRules = [
            job.systemRules ?? '',
            cabalDigest ? `\nCODEBASE CONTEXT:\n${cabalDigest}` : '',
        ].filter(Boolean).join('\n');

        const splitter = new PromptSplitter({
            parentJobId: job.jobId,
            parentPrompt: job.promptText,
            outDir: job.outDir,
            systemRules,
        });
        const atomicPrompts = await splitter.split(units);

        // ── Step 4: Write tests FIRST — contract before implementation ───
        console.log('[DecomposeOrchestrator] Writing test files (contracts first)…');
        const testSplitter = new TestSplitter({
            sourceTestPath: job.testPath,
            outDir: job.outDir,
        });
        const testPathMap = await testSplitter.split(units, atomicPrompts);

        // ── Step 5: Build stage manifest ─────────────────────────────────
        const unitRecords = atomicPrompts.map(p => ({
            unitName:   p.unitName,
            unitKind:   p.unitKind,
            targetPath: p.targetPath,
            testPath:   testPathMap.get(p.unitName) ?? p.testPath,
            promptBody: p.promptBody,
            depNames:   p.depNames,
            dagOrder:   p.dagOrder,
            status:     'staged',
            judgeScore: null,
            errors:     [],
        }));

        /** @type {StageManifest} */
        const manifest = {
            jobId: job.jobId,
            createdAt: new Date().toISOString(),
            outDir: job.outDir,
            barrelPath: path.join(job.outDir, 'index.mjs'),
            units: unitRecords,
            approved: false,
        };

        const manifestPath = path.join(STAGE_DIR, `${job.jobId}.stage.json`);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  STAGE COMPLETE`);
        console.log(`  ${units.length} unit(s) staged for review.`);
        console.log(`  Manifest: ${manifestPath}`);
        console.log(`\n  ⚠️  Human review required before execute.`);
        console.log(`  Set "approved": true in the manifest, then run:`);
        console.log(`  node src/compiler/decomposer/run.mjs execute ${manifestPath}`);
        console.log(`${'═'.repeat(60)}\n`);

        return manifestPath;
    }

    /**
     * EXECUTE mode: read an approved stage manifest and compile each unit
     * in DAG order. Writes the barrel on completion.
     *
     * @param {string} manifestPath - Path to a `.stage.json` manifest.
     * @returns {Promise<Map<string, UnitStatus>>} unitName → final status
     */
    async execute(manifestPath) {
        const manifest = /** @type {StageManifest} */ (
            JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        );

        if (!manifest.approved) {
            throw new Error(
                `Stage manifest "${manifestPath}" has not been approved. ` +
                `Set "approved": true after reviewing the staged prompts and tests.`
            );
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  DECOMPOSE — EXECUTE MODE`);
        console.log(`  Job: ${manifest.jobId}`);
        console.log(`  Units: ${manifest.units.length}`);
        console.log(`${'═'.repeat(60)}\n`);

        // Sort by dagOrder to ensure dep-first compilation.
        const ordered = [...manifest.units].sort((a, b) => a.dagOrder - b.dagOrder);

        const statuses = new Map(); // unitName → UnitStatus
        const succeeded = new Set();

        for (const record of ordered) {
            // ── Check if any dep failed — block this unit if so ──────────
            const blockedBy = record.depNames.find(d => statuses.get(d) !== 'succeeded');
            if (blockedBy) {
                console.log(`\n⏭  ${record.unitName} BLOCKED — dep "${blockedBy}" did not succeed.`);
                statuses.set(record.unitName, 'blocked');
                this.#updateManifest(manifestPath, manifest, record.unitName, 'blocked', null, [
                    `Blocked because dependency "${blockedBy}" failed.`
                ]);
                continue;
            }

            console.log(`\n${'─'.repeat(60)}`);
            console.log(`  Compiling: ${record.unitName} (${record.dagOrder + 1}/${ordered.length})`);
            console.log(`${'─'.repeat(60)}`);

            try {
                const loop = new EvalLoop({
                    compiler: this.compiler,
                    state: this.state,
                    maxIterations: this.maxIterations,
                });

                const loopResult = await loop.run({
                    jobId: `${manifest.jobId}_${record.unitName}`,
                    config: {
                        target: path.relative(process.cwd(), record.targetPath),
                        test:   path.relative(process.cwd(), record.testPath),
                    },
                    promptText: record.promptBody,
                });

                const status = loopResult.passed ? 'succeeded' : 'failed';
                statuses.set(record.unitName, status);
                if (loopResult.passed) succeeded.add(record.unitName);

                this.#updateManifest(manifestPath, manifest, record.unitName,
                    status, loopResult.finalScore, []);

                console.log(`  ${loopResult.passed ? '✅' : '❌'} ${record.unitName} — ${status} (score: ${loopResult.finalScore}/10)`);
            } catch (err) {
                statuses.set(record.unitName, 'failed');
                this.#updateManifest(manifestPath, manifest, record.unitName,
                    'failed', null, [err.message]);
                console.error(`  ❌ ${record.unitName} — threw: ${err.message}`);
            }
        }

        // ── Write barrel for everything that succeeded ───────────────────
        const allUnits = ordered.map(r => ({
            name: r.unitName,
            kind: r.unitKind,
            params: [],
            deps: r.depNames,
            description: '',
        }));

        const barrel = new BarrelWriter({ outDir: manifest.outDir });
        barrel.write(allUnits, succeeded);

        // ── Integration smoke test (real imports, no mocks) ───────────────
        // Only runs when at least 2 units succeeded — single-unit stages have
        // no boundaries to validate.
        if (succeeded.size >= 2) {
            console.log(`\n[DecomposeOrchestrator] Generating integration smoke test…`);
            const smokeWriter = new IntegrationSmokeWriter({ outDir: manifest.outDir });
            const smokePath = await smokeWriter.write(allUnits, succeeded);

            // Run the smoke test immediately.
            console.log(`[DecomposeOrchestrator] Running integration smoke…`);
            try {
                const { stdout: smokeOut } = await execFileAsync(
                    'npx',
                    ['vitest', 'run', '--reporter=verbose', smokePath],
                    { env: { ...process.env, CI: 'true' }, timeout: 120_000, maxBuffer: 10_485_760 }
                );
                console.log(`[IntegrationSmoke] ✅ Passed\n${smokeOut.slice(-500)}`);
                manifest.smokeStatus = 'passed';
            } catch (err) {
                const out = (err.stdout ?? '') + (err.stderr ?? '');
                console.error(`[IntegrationSmoke] ❌ Failed — real-import boundaries have issues.`);
                console.error(out.slice(-1000));
                manifest.smokeStatus = 'failed';
                manifest.smokeErrors = out.slice(-2000);
            }

            // Persist smoke result to manifest.
            try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8'); } catch { /* nonfatal */ }
        }

        // ── Final summary ────────────────────────────────────────────────
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  EXECUTE COMPLETE — ${manifest.jobId}`);
        for (const [name, status] of statuses) {
            const icon = { succeeded: '✅', failed: '❌', blocked: '⏭' }[status] ?? '?';
            console.log(`  ${icon} ${name} — ${status}`);
        }
        if (manifest.smokeStatus) {
            const smokeIcon = manifest.smokeStatus === 'passed' ? '✅' : '❌';
            console.log(`  ${smokeIcon} integration smoke — ${manifest.smokeStatus}`);
        }
        console.log(`  Barrel: ${manifest.barrelPath}`);
        console.log(`${'═'.repeat(60)}\n`);

        return statuses;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    /**
     * Update a unit's status in the persisted manifest after compilation.
     * This lets humans inspect partial results mid-run.
     */
    #updateManifest(manifestPath, manifest, unitName, status, judgeScore, errors) {
        const unit = manifest.units.find(u => u.unitName === unitName);
        if (!unit) return;
        unit.status = status;
        unit.judgeScore = judgeScore;
        unit.errors = errors;
        try {
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
        } catch { /* non-fatal */ }
    }
}
