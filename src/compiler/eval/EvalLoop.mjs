/**
 * @module EvalLoop
 * The outer LLM-judge improvement loop. Sits above the Orchestrator.
 *
 * Algorithm:
 *   1. Run Orchestrator (which itself retries up to 3× on test/LSP failures).
 *   2. If the Orchestrator succeeded (tests + LSP clean), invoke the Judge.
 *   3. If Judge score >= threshold → done, ship it.
 *   4. If Judge score < threshold → extract improvement directives, append them
 *      as `extraSystemContext` into the next Orchestrator job, repeat.
 *   5. After MAX_EVAL_ITERATIONS the best-scoring result wins regardless.
 *
 * This creates the "keep going and going" loop: even after a technically
 * passing result, we keep driving quality upward until the judge is satisfied.
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
        let bestScore = 0;
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

            // ── Phase 1: Compile ───────────────────────────────────────────
            const orchestrator = new Orchestrator(this.compiler, this.state);
            const job = { ...baseJob, extraSystemContext };
            const result = await orchestrator.run(job);

            const compiledSource = result.source || this.#readSourceFromDisk(baseJob.config.target);
            if (compiledSource) bestSource = compiledSource;

            // ── Phase 2: Judge ─────────────────────────────────────────────
            const astContract = await this.#readContractSummary(baseJob.config.test);

            console.log(`\n[EvalLoop] Running judge evaluation…`);
            const verdict = await this.judge.score({
                promptText:     baseJob.promptText,
                astContract,
                compiledSource,
                testErrors:     result.testErrors,
                lspErrors:      result.lspErrors,
            });

            this.#logVerdict(iteration, verdict);

            if (verdict.overall > bestScore) {
                bestScore = verdict.overall;
                bestSource = compiledSource;
            }

            // ── Phase 3: Decision ──────────────────────────────────────────
            if (verdict.passed) {
                console.log(`\n✅ EVAL LOOP PASSED on iteration ${iteration} (score: ${verdict.overall}/10)\n`);
                return { passed: true, finalScore: verdict.overall, iterations: iteration, source: bestSource };
            }

            if (iteration < this.maxIterations) {
                // Feed judge's improvement directives into the next cycle.
                extraSystemContext = this.#buildImprovementContext(verdict, iteration);
                console.log(`\n[EvalLoop] Score ${verdict.overall}/10 — below threshold. Looping with improvements…`);
            }
        }

        // Exhausted all iterations — report the best we got.
        console.log(`\n⚠️  EVAL LOOP EXHAUSTED after ${iteration - 1} iterations. Best score: ${bestScore}/10\n`);
        return {
            passed: bestScore >= 7.5,
            finalScore: bestScore,
            iterations: iteration - 1,
            source: bestSource,
        };
    }

    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Format judge improvements into a string that the Orchestrator can inject
     * as additional system context on the next compilation request.
     *
     * @param {import('./Judge.mjs').JudgeVerdict} verdict
     * @param {number} iteration
     * @returns {string}
     */
    #buildImprovementContext(verdict, iteration) {
        const parts = [
            `[Eval iteration ${iteration} — score ${verdict.overall}/10]`,
        ];

        if (verdict.issues.length > 0) {
            parts.push('IDENTIFIED PROBLEMS:');
            verdict.issues.forEach((issue, i) => parts.push(`  ${i + 1}. ${issue}`));
        }

        if (verdict.improvements.length > 0) {
            parts.push('REQUIRED IMPROVEMENTS FOR THIS ATTEMPT:');
            verdict.improvements.forEach((imp, i) => parts.push(`  ${i + 1}. ${imp}`));
        }

        // Low-scoring dimensions get explicit pressure.
        const s = verdict.scores;
        if ((s.robustness ?? 10) < 7) {
            parts.push('PRIORITY: Add thorough error handling and edge-case guards.');
        }
        if ((s.security ?? 10) < 7) {
            parts.push('PRIORITY: Eliminate any eval, dynamic require, or shell interpolation.');
        }
        if ((s.correctness ?? 10) < 7) {
            parts.push('PRIORITY: Ensure every exported function returns the correct value type for all inputs.');
        }

        return parts.join('\n');
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
