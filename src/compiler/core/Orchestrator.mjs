/**
 * @module Orchestrator
 * The self-correcting compile loop. Ties together AstParser → LLM adapter →
 * Vitest runner → LSP type-checker, with automatic rollback if all retries
 * are exhausted without a green result.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AstParser } from '../analyzer/AstParser.mjs';
import { LspClient } from '../analyzer/LspClient.mjs';

const execFileAsync = promisify(execFile);

const MAX_RETRIES   = 3;
const BACKUP_DIR    = '.waymark/backups';
const ARTIFACT_DIR  = '.waymark/artifacts';

/**
 * @typedef {Object} OrchestratorJob
 * @property {string} jobId            - Unique name for this run (used in MQTT topics & temp files).
 * @property {Object} config           - Parsed frontmatter from the `.prompt.md` file.
 * @property {string} config.target    - Relative path to the JS file to generate / overwrite.
 * @property {string} config.test      - Relative path to the companion `.test.mjs` file.
 * @property {string} [config.status]  - If `'static'`, the job is skipped immediately.
 * @property {string} promptText       - Raw prompt body (everything after the frontmatter block).
 * @property {string} [extraSystemContext] - Additional rules injected by the EvalLoop judge.
 */

/**
 * @typedef {Object} OrchestratorResult
 * @property {boolean}  succeeded
 * @property {string}   source       - The compiled source written to disk (empty string on rollback).
 * @property {string[]} testErrors   - Final vitest error messages from the last attempt.
 * @property {string[]} lspErrors    - Final LSP error messages from the last attempt.
 */

export class Orchestrator {
    /**
     * @param {import('../interfaces/ICompiler.mjs').CompilerAdapter} compiler
     * @param {import('../adapters/StateAdapter.mjs').StateAdapter} state
     */
    constructor(compiler, state) {
        this.compiler = compiler;
        this.state = state;
        this.astParser = new AstParser();
    }

    /**
     * Run the full compile → test → lint loop for a single job.
     *
     * @param {OrchestratorJob} job
     * @returns {Promise<OrchestratorResult>}
     */
    async run(job) {
        const { jobId, config, promptText, extraSystemContext } = job;

        // ── Gate: skip static files entirely ──────────────────────────────────
        if (config.status === 'static') {
            console.log(`[Orchestrator] Job "${jobId}" is marked static — skipping.`);
            return { succeeded: false, source: '', testErrors: [], lspErrors: [] };
        }

        const targetPath = path.resolve(config.target);
        const testPath   = path.resolve(config.test);

        await this.state.emitStatus(jobId, 'STARTED', []);
        console.log(`[Orchestrator] Job "${jobId}" started.`);
        console.log(`  target : ${targetPath}`);
        console.log(`  test   : ${testPath}`);

        // ── Step 1: Parse the AST contract from the test file ─────────────────
        const astContract = this.astParser.parse(testPath, null);
        const astContractJson = JSON.stringify(astContract, null, 2);
        console.log(`[Orchestrator] AST contract extracted: ${astContract.exports.length} export(s).`);

        // ── Step 2: Backup the current target (if it exists) ──────────────────
        const backupPath = this.#backup(jobId, targetPath);

        // ── Step 3: Self-correcting loop ──────────────────────────────────────
        /** @type {string[]} */
        const previousErrors = [];
        let succeeded = false;
        let lastTestErrors = [];
        let lastLspErrors = [];
        let lastSource = '';

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            console.log(`[Orchestrator] Attempt ${attempt}/${MAX_RETRIES}…`);

            // 3a. Ask the LLM to generate code.
            const compiledSource = await this.compiler.compile({
                jobId: `${jobId}-attempt${attempt}`,
                systemRules: this.#buildSystemRules(extraSystemContext),
                targetPrompt: promptText,
                astContract: astContractJson,
                previousErrors: previousErrors.length > 0 ? [...previousErrors] : undefined
            });

            // 3b. Write the generated code to the target path.
            //     Prepend the @waymark-generated header so the file is clearly
            //     marked as managed — do not edit by hand, edit the prompt.
            const promptRef = job.config._promptFile ?? job.jobId;
            const stamped   = this.#stampGenerated(compiledSource, promptRef);
            lastSource = stamped;
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, stamped, 'utf-8');

            // 3c. Run Vitest against the companion test file.
            const testErrors = await this.#runTests(testPath);

            if (testErrors.length > 0) {
                console.warn(`[Orchestrator] Tests failed on attempt ${attempt}.`);
                lastTestErrors = testErrors;
                await this.state.emitStatus(jobId, 'TESTS_FAILED', testErrors);
                previousErrors.push(`=== Attempt ${attempt} — Vitest failures ===\n${testErrors.join('\n')}`);
                continue; // retry
            }

            // 3d. Run LSP diagnostics.
            const lspErrors = await this.#runLsp(targetPath);
            lastLspErrors = lspErrors;

            if (lspErrors.length > 0) {
                console.warn(`[Orchestrator] LSP rejected output on attempt ${attempt}.`);
                await this.state.emitStatus(jobId, 'LSP_REJECTED', lspErrors);
                previousErrors.push(`=== Attempt ${attempt} — LSP diagnostics ===\n${lspErrors.join('\n')}`);
                continue; // retry
            }

            // ✅ Both gates cleared.
            succeeded = true;
            break;
        }

        // ── Step 4: Finalise ──────────────────────────────────────────────────
        if (succeeded) {
            const artifactPath = this.#saveArtifact(jobId, targetPath, lastSource);
            await this.state.emitStatus(jobId, 'SUCCESS', []);
            console.log(`[Orchestrator] ✅ Job "${jobId}" succeeded.`);
            console.log(`[Orchestrator] 📦 Artifact → ${artifactPath}`);
            return { succeeded: true, source: lastSource, testErrors: [], lspErrors: [], artifactPath };
        } else {
            console.error(`[Orchestrator] ❌ All ${MAX_RETRIES} attempts failed — rolling back.`);
            this.#rollback(jobId, targetPath, backupPath);
            await this.state.emitStatus(jobId, 'ROLLED_BACK', previousErrors);
            return { succeeded: false, source: lastSource, testErrors: lastTestErrors, lspErrors: lastLspErrors };
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Copy the current target to the backup directory.
     * Returns the backup path (or null if the file didn't exist yet).
     *
     * @param {string} jobId
     * @param {string} targetPath
     * @returns {string|null}
     */
    #backup(jobId, targetPath) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });

        if (!fs.existsSync(targetPath)) {
            console.log(`[Orchestrator] No existing file at target — no backup needed.`);
            return null;
        }

        const backupFileName = `${jobId}-${Date.now()}${path.extname(targetPath)}`;
        const backupPath = path.join(BACKUP_DIR, backupFileName);
        fs.copyFileSync(targetPath, backupPath);
        console.log(`[Orchestrator] Backed up existing file → ${backupPath}`);
        return backupPath;
    }

    /**
     * Restore from backup, or delete the target if it was a brand-new file.
     *
     * @param {string} jobId
     * @param {string} targetPath
     * @param {string|null} backupPath
     */
    #rollback(jobId, targetPath, backupPath) {
        if (backupPath && fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, targetPath);
            console.log(`[Orchestrator] Restored ${targetPath} from backup.`);
        } else {
            // File was new — remove the broken generated version entirely.
            try {
                fs.unlinkSync(targetPath);
                console.log(`[Orchestrator] Removed unstable new file: ${targetPath}`);
            } catch {
                // Already gone or never written — not an error.
            }
        }
    }

    /**
     * Run Vitest against a single test file via the CLI (stable, no internal API).
     * Returns an array of human-readable error strings (empty = all pass).
     *
     * @param {string} testFilePath - Absolute path to the `.test.mjs` file.
     * @returns {Promise<string[]>}
     */
    async #runTests(testFilePath) {
        try {
            await execFileAsync(
                'npx',
                ['vitest', 'run', '--reporter=verbose', testFilePath],
                {
                    timeout: 60_000,
                    maxBuffer: 5_242_880, // 5 MiB
                    env: { ...process.env, CI: 'true' }
                }
            );
            // Zero exit = all tests passed.
            return [];
        } catch (err) {
            // Non-zero exit = test failures. Parse stdout/stderr for failure lines.
            const output = (err.stdout ?? '') + (err.stderr ?? '');
            const errors = output
                .split('\n')
                .filter(l => /FAIL|✗|×|Error|expected|AssertionError/i.test(l))
                .map(l => l.trim())
                .filter(Boolean)
                .slice(0, 30); // cap to avoid bloating the next prompt

            return errors.length > 0 ? errors : [`Tests failed (exit ${err.code}). Output:\n${output.slice(0, 1000)}`];
        }
    }

    /**
     * Run the LSP scanner against the compiled target and return an array of
     * error/warning messages (empty = clean). Non-fatal — LSP failures are
     * logged but never abort an otherwise passing run.
     *
     * @param {string} targetPath - Absolute path to the compiled module.
     * @returns {Promise<string[]>}
     */
    async #runLsp(targetPath) {
        const lsp = new LspClient(process.cwd());
        try {
            const diagnostics = await lsp.scanFile(targetPath);
            return diagnostics
                .filter(d => d.severity <= 2) // 1=Error, 2=Warning
                .map(d => `[LSP ${this.#severityLabel(d.severity)}] ${d.message} (${targetPath}:${d.range.start.line + 1})`);
        } catch (err) {
            console.warn(`[Orchestrator] LSP scan failed (non-fatal): ${err.message}`);
            return []; // Treat LSP unavailability as clean so the pipeline continues.
        } finally {
            await lsp.dispose().catch(() => {});
        }
    }

    /**
     * @param {number} severity
     * @returns {string}
     */
    #severityLabel(severity) {
        return ['', 'Error', 'Warning', 'Info', 'Hint'][severity] ?? 'Unknown';
    }

    /**
     * Invariant system rules injected into every compilation request.
     * These are the hard constraints the LLM must never violate.
     *
     * @param {string} [extra] - Additional context injected by the EvalLoop judge.
     * @returns {string}
     */
    #buildSystemRules(extra) {
        const base = [
            '- Output ONLY pure ESM JavaScript (.mjs). Use explicit import/export syntax.',
            '- Do NOT use TypeScript syntax, type annotations, or .ts-specific features.',
            '- Do NOT use CommonJS (require / module.exports).',
            '- The module must satisfy the exact exports listed in the AST contract.',
            '- Do not include any test code, describe/it blocks, or test fixtures.',
            '- Write production-grade, security-conscious code (no eval, no shell injection).',
        ].join('\n');

        if (extra?.trim()) {
            return `${base}\n\nADDITIONAL QUALITY REQUIREMENTS FROM PREVIOUS EVALUATION:\n${extra.trim()}`;
        }
        return base;
    }

    /**
     * Prepend a machine-readable @waymark-generated banner to compiled source.
     * Any reader immediately knows: (1) this file is managed, (2) which prompt
     * regenerates it, (3) when this snapshot was produced.
     *
     * @param {string} source
     * @param {string} promptRef  - Relative prompt file path or jobId.
     * @returns {string}
     */
    #stampGenerated(source, promptRef) {
        const banner = [
            `// @waymark-generated`,
            `// prompt : ${promptRef}`,
            `// built  : ${new Date().toISOString()}`,
            `// DO NOT edit this file directly — edit the prompt and re-run the compiler.`,
            `//`,
        ].join('\n');
        return `${banner}\n${source}`;
    }

    /**
     * Save an immutable snapshot of the successfully generated source to
     * .waymark/artifacts/<jobId>/<epoch>.<ext>
     *
     * Snapshots are the permanent record of what was generated.
     * They are NEVER overwritten or deleted automatically.
     *
     * @param {string} jobId
     * @param {string} targetPath
     * @param {string} source
     * @returns {string} absolute path of the artifact
     */
    #saveArtifact(jobId, targetPath, source) {
        const dir = path.resolve(ARTIFACT_DIR, jobId);
        fs.mkdirSync(dir, { recursive: true });
        const fname = `${Date.now()}${path.extname(targetPath)}`;
        const artifactPath = path.join(dir, fname);
        fs.writeFileSync(artifactPath, source, 'utf-8');
        return artifactPath;
    }
}
