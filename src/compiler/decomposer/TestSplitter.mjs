/**
 * @module TestSplitter
 *
 * Splits a monolithic `.test.mjs` file into one focused test file per unit.
 *
 * Strategy:
 *   1. Parse the existing test file's AST and bucket every `describe` /
 *      `it` / `test` block by which unit name it references.
 *   2. For blocks that are ambiguous (no clear unit reference), ask Gemini
 *      to assign them to the closest unit.
 *   3. For units that have NO matching test blocks (greenfield), ask Gemini
 *      to generate a focused test file from scratch given the unit spec.
 *   4. Emit one `.test.mjs` file per unit into `outDir`.
 *
 * Output test files:
 *   - Import only from `./<unitName>.mjs` (relative, single import).
 *   - Use vitest (`describe`, `it`, `expect`).
 *   - Are runnable immediately by the Orchestrator.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const execFileAsync = promisify(execFile);

const UNSAFE_RE = /[^a-zA-Z0-9_-]/g;

export class TestSplitter {
    /**
     * @param {object} opts
     * @param {string}  opts.sourceTestPath  - Abs path to the existing monolithic test file
     *                                         (may not exist for greenfield targets).
     * @param {string}  opts.outDir          - Abs path to write per-unit test files into.
     */
    constructor({ sourceTestPath, outDir }) {
        this.sourceTestPath = sourceTestPath;
        this.outDir = outDir;
    }

    /**
     * Split (or generate) test files for each unit.
     *
     * @param {import('./UnitExtractor.mjs').UnitDescriptor[]} units
     * @param {import('./PromptSplitter.mjs').AtomicPrompt[]}  atomicPrompts
     * @returns {Promise<Map<string, string>>} unitName → abs path of written test file
     */
    async split(units, atomicPrompts) {
        const results = new Map(); // unitName → testFilePath

        if (!fs.existsSync(this.sourceTestPath)) {
            // Greenfield — generate test files from the unit specs via Gemini.
            for (const prompt of atomicPrompts) {
                const testPath = await this.#generateTest(prompt);
                results.set(prompt.unitName, testPath);
            }
            return results;
        }

        // ── Parse existing monolithic test file ─────────────────────────────
        const source = fs.readFileSync(this.sourceTestPath, 'utf-8');
        const sf = ts.createSourceFile(
            path.basename(this.sourceTestPath),
            source,
            ts.ScriptTarget.ESNext,
            /* setParentNodes */ true
        );

        // Bucket: unitName → string[] of code segments
        const buckets = new Map(units.map(u => [u.name, []]));
        const unitNames = new Set(units.map(u => u.name));

        // ── Pass 1: assign describe/it/test blocks by unit name reference ───
        const header = this.#extractImportHeader(sf, source);

        for (const stmt of sf.statements) {
            if (!this.#isTestBlock(stmt)) continue;

            const blockText = source.slice(stmt.getStart(sf), stmt.getEnd());
            const owner = this.#detectOwner(blockText, unitNames);

            if (owner) {
                buckets.get(owner).push(blockText);
            } else {
                // Ambiguous — Gemini assigns it.
                const assigned = await this.#assignBlockViaGemini(blockText, [...unitNames]);
                if (assigned && buckets.has(assigned)) {
                    buckets.get(assigned).push(blockText);
                }
            }
        }

        // ── Pass 2: write (or generate) per-unit test files ─────────────────
        for (const unit of units) {
            const blocks = buckets.get(unit.name) ?? [];
            const atomicPrompt = atomicPrompts.find(p => p.unitName === unit.name);
            const testPath = path.join(this.outDir, `${unit.name}.test.mjs`);

            if (blocks.length > 0) {
                // Rebuild a clean test file from extracted blocks.
                const content = this.#assembleTestFile(unit.name, blocks, header);
                fs.writeFileSync(testPath, content, 'utf-8');
            } else if (atomicPrompt) {
                // No blocks found — generate from the unit spec.
                await this.#generateTest(atomicPrompt, testPath);
            } else {
                console.warn(`[TestSplitter] No tests and no atomic prompt for "${unit.name}" — skipping.`);
                continue;
            }

            results.set(unit.name, testPath);
        }

        return results;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    /**
     * Extract the import/use-strict preamble from the test file so each split
     * file can start with a correct import pointing at the right unit.
     * We discard the original imports and replace them per unit.
     */
    #extractImportHeader(_sf, _source) {
        // We intentionally throw away the old import lines and generate a fresh
        // single-import per unit in #assembleTestFile. Return empty string here.
        return '';
    }

    /**
     * Is this AST node a vitest `describe(...)` or `it(...)` / `test(...)` call?
     */
    #isTestBlock(node) {
        if (!ts.isExpressionStatement(node)) return false;
        const expr = node.expression;
        if (!ts.isCallExpression(expr)) return false;
        const callee = expr.expression;
        if (ts.isIdentifier(callee)) {
            return ['describe', 'it', 'test'].includes(callee.text);
        }
        // describe.skip, it.only, etc.
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
            return ['describe', 'it', 'test'].includes(callee.expression.text);
        }
        return false;
    }

    /**
     * Try to identify which unit name a block belongs to by searching for the
     * name in the block's string literals and identifiers.
     */
    #detectOwner(blockText, unitNames) {
        for (const name of unitNames) {
            // Check for the name as a word boundary in the block.
            const re = new RegExp(`\\b${name}\\b`);
            if (re.test(blockText)) return name;
        }
        return null;
    }

    /**
     * Ask Gemini to decide which unit a test block belongs to.
     */
    async #assignBlockViaGemini(blockText, unitNames) {
        const prompt = [
            'You are a test file organiser.',
            '',
            'Given this vitest test block and a list of candidate unit names,',
            'reply with ONLY the single unit name that this block tests.',
            'If uncertain, pick the closest match.',
            '',
            `Unit names: ${unitNames.join(', ')}`,
            '',
            '--- TEST BLOCK ---',
            blockText,
            '',
            'OUTPUT CONSTRAINT: Reply with exactly one unit name from the list. Nothing else.',
        ].join('\n');

        try {
            const { stdout } = await execFileAsync(
                'gemini',
                ['--skip-trust', '--output-format', 'text', '-p', prompt],
                { timeout: 30_000, maxBuffer: 524_288 }
            );
            const candidate = stdout.trim().split(/\s/)[0];
            return unitNames.includes(candidate) ? candidate : null;
        } catch {
            return null;
        }
    }

    /**
     * Assemble a standalone test file from extracted describe/it/test blocks.
     * The import points at `./<unitName>.mjs` relative to the output directory.
     */
    #assembleTestFile(unitName, blocks, _header) {
        const importLine = `import { ${unitName} } from './${unitName}.mjs';\n`;
        const vitestImport = `import { describe, it, expect, beforeEach, afterEach } from 'vitest';\n`;

        return [
            vitestImport,
            importLine,
            '',
            ...blocks,
            '',
        ].join('\n');
    }

    /**
     * Ask Gemini to generate a focused test file for a unit from its spec.
     * Writes to `overridePath` when provided, otherwise to `atomicPrompt.testPath`.
     */
    async #generateTest(atomicPrompt, overridePath = null) {
        const testPath = overridePath ?? atomicPrompt.testPath;

        const prompt = [
            'You are a test engineer specialising in unit tests.',
            '',
            `Write a complete vitest test file for the function/export "${atomicPrompt.unitName}".`,
            '',
            `Implementation spec:`,
            atomicPrompt.promptBody,
            '',
            `Requirements:`,
            `  - Use vitest (import { describe, it, expect } from 'vitest')`,
            `  - Import ONLY "${atomicPrompt.unitName}" from './${atomicPrompt.unitName}.mjs'`,
            `  - Cover: happy path, edge cases, invalid input (expect TypeError)`,
            `  - At least 5 test cases`,
            `  - Do NOT import from any other file`,
            '',
            'OUTPUT CONSTRAINT: Respond with ONLY the complete test file inside a',
            'single ```javascript code fence. No preamble. No explanation.',
        ].join('\n');

        const { stdout } = await execFileAsync(
            'gemini',
            ['--skip-trust', '--output-format', 'text', '-p', prompt],
            { timeout: 90_000, maxBuffer: 4_194_304 }
        );

        const fence = /```(?:javascript|js)?\n([\s\S]*?)```/.exec(stdout);
        const content = fence ? fence[1] : stdout.trim();

        fs.mkdirSync(path.dirname(testPath), { recursive: true });
        fs.writeFileSync(testPath, content, 'utf-8');
        return testPath;
    }
}
