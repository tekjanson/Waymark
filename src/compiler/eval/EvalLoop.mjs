/**
 * @module EvalLoop
 * The outer compile-retry loop. Sits above the Orchestrator.
 *
 * Gate hierarchy (deterministic first, heuristic second):
 *   1. Vitest (deterministic) — primary gate. Code must pass the test suite.
 *   2. LSP (deterministic)   — secondary gate. Code must be type-clean.
 *   3. Judge (heuristic)     — informational only. NEVER triggers a recompile.
 *
 * Algorithm:
 *   1. Run Orchestrator (which itself retries up to 3× on test/LSP failures).
 *   2a. If Orchestrator SUCCEEDED (tests + LSP clean):
 *       → Run Judge once as a quality report. Log score. EXIT — we are done.
 *         The Judge score cannot reject code that already passed deterministic gates.
 *   2b. If Orchestrator FAILED (tests still red after internal retries):
 *       → Extract test/LSP errors as `extraSystemContext` for next outer attempt.
 *       → Repeat up to MAX_EVAL_ITERATIONS.
 *   3. After MAX_EVAL_ITERATIONS the best result (by test-pass count) is reported.
 *
 * Rationale: letting the Judge loop on working code causes token burn, style
 * churn, and eventual regression. Functional correctness == test suite green.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Orchestrator } from '../core/Orchestrator.mjs';
import { Judge } from './Judge.mjs';

const MAX_EVAL_ITERATIONS = 5;

/**
 * @typedef {Object} EvalLoopOptions
 * @property {import('../interfaces/ICompiler.mjs').CompilerAdapter} compiler
 * @property {import('../adapters/StateAdapter.mjs').StateAdapter}   state
 * @property {number} [maxIterations]  - Override the default 5-iteration ceiling.
 */

/**
 * @typedef {Object} EvalLoopResult
 * @property {boolean}  passed         - Whether the judge threshold was met.
 * @property {number}   finalScore     - The judge score of the best output.
 * @property {number}   iterations     - How many outer eval cycles ran.
 * @property {string}   source         - The final compiled source on disk.
 */

export class EvalLoop {
    /**
     * @param {EvalLoopOptions} options
     */
    constructor({ compiler, state, maxIterations = MAX_EVAL_ITERATIONS }) {
        this.compiler = compiler;
        this.state = state;
        this.maxIterations = maxIterations;
        this.judge = new Judge();
    }

    /**
     * Run the full iterative eval loop for a given job.
     *
     * @param {import('../core/Orchestrator.mjs').OrchestratorJob} baseJob
     * @returns {Promise<EvalLoopResult>}
     */
    async run(baseJob) {
        let extraSystemContext = '';
        let bestSource = '';
        let iteration = 0;

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  EVAL LOOP — Job: ${baseJob.jobId}`);
        console.log(`  Max iterations: ${this.maxIterations}`);
        console.log(`${'═'.repeat(60)}\n`);

        for (iteration = 1; iteration <= this.maxIterations; iteration++) {
            console.log(`\n${'─'.repeat(60)}`);
            console.log(`  Eval Iteration ${iteration}/${this.maxIterations}`);
            console.log(`${'─'.repeat(60)}`);

            // ── Phase 1: Compile (deterministic gate) ─────────────────────
            const orchestrator = new Orchestrator(this.compiler, this.state);
            const job = { ...baseJob, extraSystemContext };
            const result = await orchestrator.run(job);

            const compiledSource = result.source || this.#readSourceFromDisk(baseJob.config.target);
            if (compiledSource) bestSource = compiledSource;

            // ── Phase 2: If tests passed → Judge runs ONCE as quality report ──
            if (result.succeeded) {
                const astContract = await this.#readContractSummary(baseJob.config.test);
                console.log(`\n[EvalLoop] Tests passed — running judge (informational only)…`);
                const verdict = await this.judge.score({
                    promptText:     baseJob.promptText,
                    astContract,
                    compiledSource,
                    testErrors:     [],   // clean — that's why we're here
                    lspErrors:      result.lspErrors,
                });
                this.#logVerdict(iteration, verdict);
                // NOTE: verdict.passed is logged but NEVER controls whether we loop.
                // The deterministic gate already cleared — we are done.
                console.log(`\n✅ EVAL LOOP PASSED on iteration ${iteration} (score: ${verdict.overall}/10)\n`);
                return {
                    passed: true,
                    finalScore: verdict.overall,
                    iterations: iteration,
                    source: bestSource,
                };
            }

            // ── Phase 3: Tests failed — build improvement context for next attempt ──
            if (iteration < this.maxIterations) {
                extraSystemContext = this.#buildFailureContext(result, iteration);
                console.log(`\n[EvalLoop] Tests failed — injecting error context for iteration ${iteration + 1}…`);
            }
        }

        // Exhausted all iterations without a green test run.
        console.log(`\n❌ EVAL LOOP FAILED after ${iteration - 1} iterations — tests never passed.\n`);
        return {
            passed: false,
            finalScore: 0,
            iterations: iteration - 1,
            source: bestSource,
        };
    }

    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Build improvement context from deterministic test/LSP failures only.
     * This is what drives the outer retry — not the Judge's style opinions.
     *
     * @param {import('../core/Orchestrator.mjs').OrchestratorResult} result
     * @param {number} iteration
     * @returns {string}
     */
    #buildFailureContext(result, iteration) {
        const parts = [`[Outer retry ${iteration} — tests failed]`];

        if (result.testErrors.length > 0) {
            parts.push('TEST FAILURES (must be fixed — these are deterministic):');
            result.testErrors.slice(0, 20).forEach((e, i) => parts.push(`  ${i + 1}. ${e}`));
        }

        if (result.lspErrors.length > 0) {
            parts.push('LSP DIAGNOSTICS (type errors):');
            result.lspErrors.slice(0, 10).forEach((e, i) => parts.push(`  ${i + 1}. ${e}`));
        }

        return parts.join('\n');
    }

    /**
     * @deprecated Use #buildFailureContext — Judge improvements no longer drive retries.
     */
    #buildImprovementContext(verdict, iteration) {
        return this.#buildFailureContext({ testErrors: verdict.issues, lspErrors: [] }, iteration);
    }

    /**
     * Read the compiled source from disk (fallback when Orchestrator rolled back
     * and we still want something for the judge to evaluate).
     *
     * @param {string} targetRelativePath
     * @returns {string}
     */
    #readSourceFromDisk(targetRelativePath) {
        try {
            return fs.readFileSync(path.resolve(targetRelativePath), 'utf-8');
        } catch {
            return '';
        }
    }

    /**
     * Get a compact contract description for the judge prompt.
     *
     * @param {string} testRelativePath
     * @returns {Promise<string>}
     */
    async #readContractSummary(testRelativePath) {
        try {
            const { AstParser } = await import('../analyzer/AstParser.mjs');
            const parser = new AstParser();
            const contract = parser.parse(path.resolve(testRelativePath));
            return JSON.stringify(contract, null, 2);
        } catch {
            return '(contract unavailable)';
        }
    }

    /**
     * Pretty-print the verdict to the console.
     *
     * @param {number} iteration
     * @param {import('./Judge.mjs').JudgeVerdict} verdict
     */
    #logVerdict(iteration, verdict) {
        const bar = (score) => '█'.repeat(Math.round(score)) + '░'.repeat(10 - Math.round(score));
        console.log(`\n  ┌─ Judge Verdict — Iteration ${iteration} ${'─'.repeat(30)}`);
        console.log(`  │  Overall: ${verdict.overall}/10  ${bar(verdict.overall)}  ${verdict.passed ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  │`);
        Object.entries(verdict.scores).forEach(([dim, score]) => {
            console.log(`  │  ${dim.padEnd(14)} ${String(score).padStart(2)}/10  ${bar(score)}`);
        });
        if (verdict.issues.length > 0) {
            console.log(`  │`);
            console.log(`  │  Issues:`);
            verdict.issues.forEach(i => console.log(`  │    • ${i}`));
        }
        console.log(`  └${'─'.repeat(50)}\n`);
    }
}
