/**
 * @module UnitExtractor
 *
 * Decomposes a source file (or a prompt body describing one) into an ordered
 * list of atomic "compilation units" — ideally one exported symbol per unit.
 *
 * Strategy:
 *   1. If a source file already exists at `targetPath`, walk its AST and
 *      extract every top-level export.
 *   2. If the file does not exist yet (greenfield), ask Gemini to enumerate
 *      the units from the prompt text alone.
 *
 * Output: Array<UnitDescriptor>
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const execFileAsync = promisify(execFile);

/**
 * @typedef {Object} UnitDescriptor
 * @property {string}   name        - Export symbol name (e.g. "formatRelativeTime").
 * @property {string}   kind        - 'function' | 'class' | 'const' | 'unknown'
 * @property {string[]} params      - Parameter names inferred from AST or Gemini.
 * @property {string[]} deps        - Other unit names this unit calls (intra-file deps).
 * @property {string}   description - One-sentence description (Gemini-generated for
 *                                    greenfield; JSDoc summary for existing files).
 */

const UNSAFE_RE = /[^a-zA-Z0-9_-]/g;
const JSON_FENCE_RE = /```json\n([\s\S]*?)```/;

export class UnitExtractor {
    /**
     * @param {object} opts
     * @param {string} opts.targetPath   - Abs path to the source file (may not exist yet).
     * @param {string} opts.promptText   - Raw prompt body describing what the file should do.
     * @param {string} opts.jobId        - Sanitised job identifier for temp files.
     */
    constructor({ targetPath, promptText, jobId }) {
        this.targetPath = targetPath;
        this.promptText = promptText;
        this.jobId = jobId.replace(UNSAFE_RE, '_');
    }

    /**
     * Extract units. Returns AST-derived results when the source exists, or
     * Gemini-enumerated results for greenfield files.
     *
     * @returns {Promise<UnitDescriptor[]>}
     */
    async extract() {
        if (fs.existsSync(this.targetPath)) {
            return this.#extractFromAst();
        }
        return this.#extractFromPrompt();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    /**
     * Walk the existing source file's AST and collect every top-level export.
     * Cross-reference call sites to build the intra-file dep graph.
     */
    #extractFromAst() {
        const source = fs.readFileSync(this.targetPath, 'utf-8');
        const sf = ts.createSourceFile(
            path.basename(this.targetPath),
            source,
            ts.ScriptTarget.ESNext,
            /* setParentNodes */ true
        );

        const units = new Map(); // name → UnitDescriptor

        // ── Pass 1: collect all exported declarations ─────────────────────────
        for (const stmt of sf.statements) {
            if (!this.#hasExportModifier(stmt)) continue;

            let name = null;
            let kind = 'unknown';
            let params = [];

            if (ts.isFunctionDeclaration(stmt) && stmt.name) {
                name = stmt.name.text;
                kind = 'function';
                params = stmt.parameters.map(p =>
                    ts.isIdentifier(p.name) ? p.name.text : '_'
                );
            } else if (ts.isClassDeclaration(stmt) && stmt.name) {
                name = stmt.name.text;
                kind = 'class';
            } else if (ts.isVariableStatement(stmt)) {
                for (const decl of stmt.declarationList.declarations) {
                    if (!ts.isIdentifier(decl.name)) continue;
                    name = decl.name.text;
                    kind = 'const';
                    if (
                        decl.initializer &&
                        (ts.isArrowFunction(decl.initializer) ||
                            ts.isFunctionExpression(decl.initializer))
                    ) {
                        kind = 'function';
                        params = decl.initializer.parameters.map(p =>
                            ts.isIdentifier(p.name) ? p.name.text : '_'
                        );
                    }
                }
            }

            if (!name) continue;

            // Extract leading JSDoc comment as description.
            const description = this.#extractJsDoc(stmt, source);

            units.set(name, { name, kind, params, deps: [], description });
        }

        // ── Pass 2: build intra-file dep graph ────────────────────────────────
        const allNames = new Set(units.keys());
        for (const [unitName, unit] of units) {
            unit.deps = this.#findCallsTo(sf, unitName, allNames);
        }

        return Promise.resolve([...units.values()]);
    }

    /**
     * Ask Gemini to enumerate units from the prompt text when no source exists.
     * Expects a JSON array of UnitDescriptor-shaped objects inside a ```json fence.
     */
    async #extractFromPrompt() {
        const prompt = [
            'You are a code architecture analyser.',
            '',
            'Given the following module description, enumerate every INDIVIDUAL exported',
            'symbol (function, class, or constant) that the implementation must provide.',
            'Return ONLY a JSON array inside a single ```json fence. Each element must have:',
            '  name        (string)  — camelCase export name',
            '  kind        (string)  — "function" | "class" | "const"',
            '  params      (array)   — parameter names (empty for non-functions)',
            '  deps        (array)   — other names in this list that this unit calls',
            '  description (string)  — one sentence describing what it does',
            '',
            '--- MODULE DESCRIPTION ---',
            this.promptText,
            '',
            'OUTPUT CONSTRAINT: JSON array only. No prose outside the ```json fence.',
        ].join('\n');

        const { stdout } = await execFileAsync(
            'gemini',
            ['--skip-trust', '--output-format', 'text', '-p', prompt],
            { timeout: 60_000, maxBuffer: 2_097_152 }
        );

        const match = JSON_FENCE_RE.exec(stdout);
        if (!match) {
            console.warn('[UnitExtractor] Gemini did not return a JSON fence — falling back to single-unit.');
            return [{
                name: path.basename(this.targetPath, path.extname(this.targetPath)),
                kind: 'unknown',
                params: [],
                deps: [],
                description: '(Could not enumerate — treat as single unit.)'
            }];
        }

        try {
            const parsed = JSON.parse(match[1]);
            if (!Array.isArray(parsed)) throw new Error('Not an array');
            return parsed;
        } catch (err) {
            console.warn(`[UnitExtractor] JSON parse failed: ${err.message}`);
            return [];
        }
    }

    // ── AST helpers ──────────────────────────────────────────────────────────

    #hasExportModifier(node) {
        return !!(
            node.modifiers &&
            node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
        );
    }

    /**
     * Extract the text of the first JSDoc block comment preceding `node`.
     * Falls back to empty string when none is present.
     */
    #extractJsDoc(node, sourceText) {
        const jsDocNodes = ts.getJSDocCommentsAndTags(node);
        if (jsDocNodes && jsDocNodes.length > 0) {
            const jsdoc = jsDocNodes[0];
            if (jsdoc.comment) {
                return typeof jsdoc.comment === 'string'
                    ? jsdoc.comment
                    : jsdoc.comment.map(p => p.text ?? '').join('');
            }
        }
        return '';
    }

    /**
     * Walk all call expressions in the file. For each function body named
     * `ownerName`, find calls to any of `allNames` (excluding self).
     *
     * This is a simple single-pass approximation — good enough for intra-file
     * flat dependency graphs; not designed for complex call-through patterns.
     */
    #findCallsTo(sf, ownerName, allNames) {
        const deps = new Set();

        const visit = (node) => {
            if (ts.isCallExpression(node)) {
                const expr = node.expression;
                if (ts.isIdentifier(expr) && allNames.has(expr.text) && expr.text !== ownerName) {
                    deps.add(expr.text);
                }
            }
            ts.forEachChild(node, visit);
        };

        // Find the owner's function body and walk only within it.
        const findOwner = (node) => {
            const name = ts.isFunctionDeclaration(node) && node.name
                ? node.name.text
                : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
                    ? node.name.text
                    : null;

            if (name === ownerName && node.body) {
                ts.forEachChild(node.body, visit);
                return;
            }
            ts.forEachChild(node, findOwner);
        };

        ts.forEachChild(sf, findOwner);
        return [...deps];
    }
}
