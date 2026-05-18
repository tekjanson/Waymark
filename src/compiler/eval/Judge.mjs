/**
 * @module Judge
 * LLM-as-judge evaluator. Submits compiled output back to Gemini with a
 * structured scoring rubric and returns a numeric verdict plus improvement
 * directives that the EvalLoop feeds into the next compilation cycle.
 *
 * Scoring dimensions (each 0–10):
 *   correctness   — Does it satisfy all test cases?
 *   completeness  — Does it export everything in the AST contract?
 *   robustness    — Are error paths and edge cases handled?
 *   security      — No eval, no shell injection, safe I/O?
 *   idiomaticity  — Clean, modern, idiomatic ESM JavaScript?
 *
 * Overall score = weighted mean. Threshold for "good enough": 7.5 / 10.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PASS_THRESHOLD = 7.5;

/** Matches the first JSON code fence in LLM output. */
const JSON_FENCE_RE = /```(?:json)?\n([\s\S]*?)```/;

/**
 * @typedef {Object} JudgeInput
 * @property {string}   promptText      - Original human-intent description.
 * @property {string}   astContract     - JSON string of the required interface.
 * @property {string}   compiledSource  - The generated JS source to evaluate.
 * @property {string[]} testErrors      - Vitest failure messages (empty = passing).
 * @property {string[]} lspErrors       - LSP diagnostic messages (empty = clean).
 */

/**
 * @typedef {Object} JudgeVerdict
 * @property {number}   overall        - Weighted score 0–10.
 * @property {boolean}  passed         - True if overall >= PASS_THRESHOLD.
 * @property {Object}   scores         - Per-dimension scores.
 * @property {string[]} issues         - Specific problems identified.
 * @property {string[]} improvements   - Concrete suggestions for the next attempt.
 */

export class Judge {
    /**
     * Evaluate compiled output and return a structured verdict.
     *
     * @param {JudgeInput} input
     * @returns {Promise<JudgeVerdict>}
     */
    async score(input) {
        const prompt = this.#buildJudgingPrompt(input);

        let stdout;
        try {
            ({ stdout } = await execFileAsync(
                'gemini',
                ['--skip-trust', '--output-format', 'text', '-p', prompt],
                { timeout: 120_000, maxBuffer: 10_485_760 }
            ));
        } catch (err) {
            console.warn(`[Judge] Gemini invocation failed: ${err.message}. Returning neutral score.`);
            return this.#neutralVerdict();
        }

        return this.#parseVerdict(stdout);
    }

    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @param {JudgeInput} input
     * @returns {string}
     */
    #buildJudgingPrompt(input) {
        const testStatus = input.testErrors.length === 0
            ? '✅ All tests passing.'
            : `❌ ${input.testErrors.length} failure(s):\n${input.testErrors.join('\n')}`;

        const lspStatus = input.lspErrors.length === 0
            ? '✅ No LSP diagnostics.'
            : `⚠️  ${input.lspErrors.length} issue(s):\n${input.lspErrors.join('\n')}`;

        return `You are an expert JavaScript code reviewer acting as an automated quality judge.

Evaluate the compiled JavaScript module below against the task description, required interface contract, and test/lint results. Return ONLY a JSON code block — no prose before or after it.

---

TASK DESCRIPTION:
${input.promptText}

---

REQUIRED INTERFACE CONTRACT (AST-derived):
${input.astContract}

---

COMPILED SOURCE:
\`\`\`javascript
${input.compiledSource}
\`\`\`

---

TEST RESULTS:
${testStatus}

LSP DIAGNOSTICS:
${lspStatus}

---

Score each dimension from 0 to 10. Weights: correctness×3, completeness×2, robustness×2, security×2, idiomaticity×1.

Respond with ONLY this JSON structure inside a \`\`\`json fence:
\`\`\`json
{
  "scores": {
    "correctness": 0,
    "completeness": 0,
    "robustness": 0,
    "security": 0,
    "idiomaticity": 0
  },
  "overall": 0.0,
  "issues": ["specific problem 1", "specific problem 2"],
  "improvements": ["concrete fix 1", "concrete fix 2"]
}
\`\`\``;
    }

    /**
     * Parse the Gemini response into a JudgeVerdict.
     * Falls back to a neutral score if parsing fails so the loop can continue.
     *
     * @param {string} rawOutput
     * @returns {JudgeVerdict}
     */
    #parseVerdict(rawOutput) {
        const match = rawOutput.match(JSON_FENCE_RE);
        const jsonStr = match ? match[1] : rawOutput.trim();

        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch {
            // Try to pull any JSON object out of the text as a last resort.
            const objMatch = rawOutput.match(/\{[\s\S]*\}/);
            if (objMatch) {
                try { parsed = JSON.parse(objMatch[0]); } catch { /* give up */ }
            }
        }

        if (!parsed?.scores) {
            console.warn('[Judge] Could not parse verdict JSON — using neutral fallback.');
            return this.#neutralVerdict();
        }

        // Compute weighted overall if the model didn't calculate it correctly.
        const s = parsed.scores;
        const weighted = (
            (s.correctness   ?? 5) * 3 +
            (s.completeness  ?? 5) * 2 +
            (s.robustness    ?? 5) * 2 +
            (s.security      ?? 5) * 2 +
            (s.idiomaticity  ?? 5) * 1
        ) / 10;

        const overall = typeof parsed.overall === 'number' ? parsed.overall : +weighted.toFixed(1);

        return {
            overall,
            passed: overall >= PASS_THRESHOLD,
            scores: parsed.scores,
            issues: Array.isArray(parsed.issues) ? parsed.issues : [],
            improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
        };
    }

    /** @returns {JudgeVerdict} */
    #neutralVerdict() {
        return {
            overall: 5.0,
            passed: false,
            scores: { correctness: 5, completeness: 5, robustness: 5, security: 5, idiomaticity: 5 },
            issues: ['Judge evaluation unavailable — using neutral score.'],
            improvements: [],
        };
    }
}
