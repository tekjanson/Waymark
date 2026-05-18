/**
 * @module AstParser
 * Reads a `.test.mjs` file, builds its TypeScript AST, and derives the
 * required public interface of the module-under-test from its import
 * declarations and call-site expressions.
 *
 * The output contract JSON is fed directly into the Orchestrator's
 * CompilationRequest so the LLM knows exactly what it must export.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// TypeScript ships as CommonJS — bridge it into this ESM module safely.
const require = createRequire(import.meta.url);
const ts = require('typescript');

/**
 * @typedef {Object} ExportDescriptor
 * @property {string}   name       - Symbol name the test file imports.
 * @property {string[]} params     - Positional parameter names inferred from call sites.
 * @property {string}   returnType - Always "any" (runtime inference is out-of-scope).
 */

/**
 * @typedef {Object} AstContract
 * @property {ExportDescriptor[]} exports
 */

export class AstParser {
    /**
     * Analyse `testFilePath` and return the inferred public contract.
     *
     * @param {string} testFilePath - Absolute or cwd-relative path to a `.test.mjs` file.
     * @param {string} targetRelativePath - The import specifier the test uses to reach
     *   the module under test (e.g. `'../myModule.mjs'`). Pass `null` to auto-detect
     *   the first local relative import found.
     * @returns {AstContract}
     */
    parse(testFilePath, targetRelativePath = null) {
        const source = fs.readFileSync(testFilePath, 'utf-8');

        const sourceFile = ts.createSourceFile(
            path.basename(testFilePath),
            source,
            ts.ScriptTarget.ESNext,
            /* setParentNodes */ true
        );

        // ── Step 1: find import declarations that reference the target module ──
        const importedNames = this.#extractImportedNames(sourceFile, targetRelativePath);

        if (importedNames.size === 0) {
            console.warn(
                `[AstParser] No imports found from target path "${targetRelativePath}" ` +
                `in ${testFilePath}. Returning empty contract.`
            );
            return { exports: [] };
        }

        // ── Step 2: walk all call sites / property accesses to infer signatures ──
        const signatures = this.#inferSignatures(sourceFile, importedNames);

        return {
            exports: [...signatures.values()].map(sig => ({
                name: sig.name,
                params: sig.params,
                returnType: 'any'
            }))
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Walk top-level ImportDeclaration nodes and collect all binding names
     * imported from `targetRelativePath`. If `targetRelativePath` is null, the
     * first local (starts with `.`) import specifier is used.
     *
     * @param {import('typescript').SourceFile} sourceFile
     * @param {string|null} targetRelativePath
     * @returns {Set<string>} Set of local binding names.
     */
    #extractImportedNames(sourceFile, targetRelativePath) {
        const names = new Set();
        let resolvedTarget = targetRelativePath;

        for (const node of sourceFile.statements) {
            if (node.kind !== ts.SyntaxKind.ImportDeclaration) continue;

            /** @type {import('typescript').ImportDeclaration} */
            const decl = node;
            const specifier = decl.moduleSpecifier.text;

            // Auto-detect: latch onto the first relative import if no target given.
            if (!resolvedTarget && specifier.startsWith('.')) {
                resolvedTarget = specifier;
            }

            if (specifier !== resolvedTarget) continue;

            const clause = decl.importClause;
            if (!clause) continue;

            // `import defaultExport from '...'`
            if (clause.name) {
                names.add(clause.name.text);
            }

            // `import { foo, bar } from '...'`
            const bindings = clause.namedBindings;
            if (bindings && bindings.kind === ts.SyntaxKind.NamedImports) {
                for (const el of bindings.elements) {
                    names.add(el.name.text);
                }
            }

            // `import * as ns from '...'`
            if (bindings && bindings.kind === ts.SyntaxKind.NamespaceImport) {
                names.add(bindings.name.text);
            }
        }

        return names;
    }

    /**
     * Traverse the full AST and collect call-expression signatures for every
     * identifier that belongs to `importedNames`.
     *
     * @param {import('typescript').SourceFile} sourceFile
     * @param {Set<string>} importedNames
     * @returns {Map<string, {name: string, params: string[]}>}
     */
    #inferSignatures(sourceFile, importedNames) {
        /** @type {Map<string, {name: string, params: string[]}>} */
        const signatures = new Map();

        // Seed with every imported name so even uncalled exports appear in the contract.
        for (const name of importedNames) {
            signatures.set(name, { name, params: [] });
        }

        const visit = (node) => {
            if (node.kind === ts.SyntaxKind.CallExpression) {
                /** @type {import('typescript').CallExpression} */
                const call = node;
                const calleeName = this.#resolveCalleeName(call.expression, importedNames);

                if (calleeName) {
                    const existing = signatures.get(calleeName) ?? { name: calleeName, params: [] };

                    // Infer param names from argument expressions — best-effort.
                    const inferredParams = call.arguments.map((arg, idx) =>
                        this.#argToParamName(arg, idx)
                    );

                    // Merge: keep the longest param list seen across all call sites.
                    if (inferredParams.length > existing.params.length) {
                        existing.params = inferredParams;
                    }

                    signatures.set(calleeName, existing);
                }
            }

            ts.forEachChild(node, visit);
        };

        ts.forEachChild(sourceFile, visit);
        return signatures;
    }

    /**
     * Resolve a callee AST node back to one of the imported symbol names.
     * Handles: `foo(...)`, `obj.foo(...)`, `ns.foo(...)`.
     *
     * @param {import('typescript').Expression} expr
     * @param {Set<string>} importedNames
     * @returns {string|null}
     */
    #resolveCalleeName(expr, importedNames) {
        if (expr.kind === ts.SyntaxKind.Identifier) {
            const name = expr.text;
            return importedNames.has(name) ? name : null;
        }

        if (expr.kind === ts.SyntaxKind.PropertyAccessExpression) {
            /** @type {import('typescript').PropertyAccessExpression} */
            const pae = expr;
            // `ns.method` — if `ns` is the namespace import, track `method`.
            if (
                pae.expression.kind === ts.SyntaxKind.Identifier &&
                importedNames.has(pae.expression.text)
            ) {
                return pae.name.text;
            }
        }

        return null;
    }

    /**
     * Turn a call-site argument AST node into a human-readable parameter name.
     *
     * @param {import('typescript').Expression} arg
     * @param {number} index - Fallback index for unnamed args.
     * @returns {string}
     */
    #argToParamName(arg, index) {
        switch (arg.kind) {
            case ts.SyntaxKind.Identifier:
                return arg.text;
            case ts.SyntaxKind.StringLiteral:
                return 'str' + index;
            case ts.SyntaxKind.NumericLiteral:
                return 'num' + index;
            case ts.SyntaxKind.ObjectLiteralExpression:
                return 'options';
            case ts.SyntaxKind.ArrayLiteralExpression:
                return 'items';
            case ts.SyntaxKind.ArrowFunction:
            case ts.SyntaxKind.FunctionExpression:
                return 'callback';
            default:
                return `param${index}`;
        }
    }
}
