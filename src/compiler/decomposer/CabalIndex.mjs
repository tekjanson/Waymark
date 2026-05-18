/**
 * @module CabalIndex
 *
 * The codebase context graph — "the AI that is aware of the structure".
 *
 * CabalIndex scans the workspace, builds an import graph of every .mjs/.js
 * file, and produces a compact "neighbourhood" snapshot for any given file.
 * This snapshot is injected into every LLM compilation prompt so the model
 * understands:
 *   - What the file is expected to do in the context of the larger system.
 *   - Which files import it (reverse deps — things that will break if the API
 *     changes).
 *   - Which files it imports (forward deps — things it is allowed to call).
 *   - Which other files in the same directory do similar things.
 *
 * The index is built once per decomposer run and cached in memory. It is also
 * serialised to `.waymark/cabal-index.json` for inspection and incremental
 * reuse across runs.
 *
 * Design constraints:
 *   - Pure static analysis — no runtime, no LLM.
 *   - Incremental: only re-scans files whose mtime changed since last run.
 *   - The serialised format is human-readable JSON (not binary) — it's a
 *     first-class artefact, not a cache.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const INDEX_PATH = '.waymark/cabal-index.json';

// File extensions we include in the graph.
const SCAN_EXTS = new Set(['.mjs', '.js', '.cjs']);

// Directories to skip entirely (node_modules, build artefacts, etc.)
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.waymark',
    'coverage', 'playwright-report', 'test-results', 'generated',
    'design-audit-screenshots', 'agent-logs',
]);

/**
 * @typedef {Object} FileNode
 * @property {string}   filePath    - Workspace-relative path (forward slashes).
 * @property {string[]} imports     - Relative paths of files this file imports.
 * @property {string[]} importedBy  - Relative paths of files that import this file.
 * @property {string[]} exports     - Exported symbol names.
 * @property {number}   mtime       - File modification time (ms since epoch).
 * @property {string}   summary     - One-line description (from JSDoc @fileoverview or
 *                                    first comment block, otherwise empty).
 */

/**
 * @typedef {Object} Neighbourhood
 * @property {FileNode}   self       - The node for the target file.
 * @property {FileNode[]} importedBy - Nodes that directly import the target.
 * @property {FileNode[]} imports    - Nodes the target directly imports.
 * @property {FileNode[]} siblings   - Other files in the same directory.
 * @property {string}     digest     - Compact text digest suitable for injecting
 *                                     into an LLM prompt.
 */

export class CabalIndex {
    /** @type {Map<string, FileNode>} rel path → node */
    #graph = new Map();
    #root;
    #dirty = false;

    /**
     * @param {string} [root] - Workspace root. Defaults to process.cwd().
     */
    constructor(root = process.cwd()) {
        this.#root = root;
    }

    /**
     * Build (or incrementally refresh) the index.
     * Loads the persisted index first, then re-scans any file whose mtime changed.
     *
     * @returns {Promise<void>}
     */
    async build() {
        this.#loadPersisted();
        await this.#scan(this.#root);
        if (this.#dirty) this.#persist();
    }

    /**
     * Return the neighbourhood of a given file — everything the LLM needs to
     * know about where this file sits in the codebase.
     *
     * @param {string} absFilePath
     * @returns {Neighbourhood | null} null if the file is not in the index.
     */
    neighbourhood(absFilePath) {
        const rel = this.#rel(absFilePath);
        const self = this.#graph.get(rel);
        if (!self) return null;

        const importedBy = (self.importedBy ?? [])
            .map(p => this.#graph.get(p))
            .filter(Boolean);

        const imports = (self.imports ?? [])
            .map(p => this.#graph.get(p))
            .filter(Boolean);

        const dir = path.dirname(rel);
        const siblings = [...this.#graph.values()]
            .filter(n => path.dirname(n.filePath) === dir && n.filePath !== rel);

        const digest = this.#buildDigest(self, importedBy, imports, siblings);

        return { self, importedBy, imports, siblings, digest };
    }

    /**
     * Return a compact digest string for a file, ready to prepend to an LLM prompt.
     * Safe to call before `build()` — returns an empty string if not indexed.
     *
     * @param {string} absFilePath
     * @returns {string}
     */
    getDigest(absFilePath) {
        const n = this.neighbourhood(absFilePath);
        return n ? n.digest : '';
    }

    // ── Private ──────────────────────────────────────────────────────────────

    #rel(absPath) {
        return path.relative(this.#root, absPath).split(path.sep).join('/');
    }

    #abs(relPath) {
        return path.join(this.#root, relPath);
    }

    #loadPersisted() {
        const indexPath = path.join(this.#root, INDEX_PATH);
        if (!fs.existsSync(indexPath)) return;
        try {
            const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
            for (const node of raw) {
                this.#graph.set(node.filePath, node);
            }
        } catch {
            // Corrupt index — start fresh.
            this.#graph.clear();
        }
    }

    #persist() {
        const indexPath = path.join(this.#root, INDEX_PATH);
        fs.mkdirSync(path.dirname(indexPath), { recursive: true });
        fs.writeFileSync(
            indexPath,
            JSON.stringify([...this.#graph.values()], null, 2),
            'utf-8'
        );
    }

    async #scan(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (SKIP_DIRS.has(entry.name)) continue;

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                await this.#scan(fullPath);
                continue;
            }

            if (!SCAN_EXTS.has(path.extname(entry.name))) continue;

            const rel = this.#rel(fullPath);
            const stat = fs.statSync(fullPath);
            const mtime = stat.mtimeMs;

            const existing = this.#graph.get(rel);
            if (existing && existing.mtime === mtime) continue; // up to date

            const node = this.#parseFile(fullPath, rel, mtime);
            this.#graph.set(rel, node);
            this.#dirty = true;
        }

        // Second pass: build importedBy (reverse edges) from forward edges.
        // Only needed after the forward scan is complete — run once at top level.
        if (dir === this.#root) {
            this.#buildReverseEdges();
        }
    }

    #parseFile(absPath, rel, mtime) {
        const source = fs.readFileSync(absPath, 'utf-8');
        const sf = ts.createSourceFile(
            path.basename(absPath),
            source,
            ts.ScriptTarget.ESNext,
            true
        );

        const imports = [];
        const exports = [];
        let summary = '';

        for (const stmt of sf.statements) {
            // ── Imports ────────────────────────────────────────────────────
            if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
                const spec = stmt.moduleSpecifier.text;
                if (spec.startsWith('.')) {
                    const resolved = this.#resolveImport(absPath, spec);
                    if (resolved) imports.push(this.#rel(resolved));
                }
            }

            // ── Exports ────────────────────────────────────────────────────
            if (
                stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
            ) {
                if (ts.isFunctionDeclaration(stmt) && stmt.name) {
                    exports.push(stmt.name.text);
                } else if (ts.isClassDeclaration(stmt) && stmt.name) {
                    exports.push(stmt.name.text);
                } else if (ts.isVariableStatement(stmt)) {
                    for (const d of stmt.declarationList.declarations) {
                        if (ts.isIdentifier(d.name)) exports.push(d.name.text);
                    }
                }
            }
        }

        // ── Summary: first JSDoc @fileoverview or leading block comment ────
        summary = this.#extractSummary(sf, source);

        return { filePath: rel, imports, importedBy: [], exports, mtime, summary };
    }

    #resolveImport(fromAbs, specifier) {
        const candidates = [
            path.resolve(path.dirname(fromAbs), specifier),
            path.resolve(path.dirname(fromAbs), specifier + '.mjs'),
            path.resolve(path.dirname(fromAbs), specifier + '.js'),
            path.resolve(path.dirname(fromAbs), specifier, 'index.mjs'),
            path.resolve(path.dirname(fromAbs), specifier, 'index.js'),
        ];
        return candidates.find(c => fs.existsSync(c)) ?? null;
    }

    #buildReverseEdges() {
        // Reset all importedBy lists.
        for (const node of this.#graph.values()) {
            node.importedBy = [];
        }
        for (const node of this.#graph.values()) {
            for (const imp of node.imports) {
                const target = this.#graph.get(imp);
                if (target && !target.importedBy.includes(node.filePath)) {
                    target.importedBy.push(node.filePath);
                }
            }
        }
    }

    #extractSummary(sf, source) {
        // Look for @fileoverview in leading comment blocks.
        const firstStatement = sf.statements[0];
        if (!firstStatement) return '';

        const fullStart = firstStatement.getFullStart();
        const leading = source.slice(0, firstStatement.getStart(sf));

        const fileOverview = /@fileoverview\s+(.+)/.exec(leading);
        if (fileOverview) return fileOverview[1].trim();

        // Fall back to first line of first block comment.
        const blockComment = /\/\*\*?\s*\n?\s*\*?\s*(.+)/.exec(leading);
        if (blockComment) return blockComment[1].replace(/\*\/$/, '').trim();

        return '';
    }

    /**
     * Build the compact digest string for injection into an LLM prompt.
     */
    #buildDigest(self, importedBy, imports, siblings) {
        const lines = ['=== CODEBASE CONTEXT (from CabalIndex) ==='];

        lines.push(`\nFile: ${self.filePath}`);
        if (self.summary) lines.push(`Summary: ${self.summary}`);
        if (self.exports.length > 0) {
            lines.push(`Exports: ${self.exports.join(', ')}`);
        }

        if (importedBy.length > 0) {
            lines.push('\nThis file is imported by:');
            for (const n of importedBy) {
                lines.push(`  ← ${n.filePath}${n.summary ? ` (${n.summary})` : ''}`);
            }
            lines.push('(API CHANGES HERE WILL BREAK THESE CALLERS — preserve existing export names)');
        } else {
            lines.push('\nNo other files import this file (safe to change API).');
        }

        if (imports.length > 0) {
            lines.push('\nThis file imports:');
            for (const n of imports) {
                lines.push(`  → ${n.filePath}${n.exports.length > 0 ? ` [exports: ${n.exports.join(', ')}]` : ''}`);
            }
        }

        if (siblings.length > 0) {
            lines.push('\nSibling files in the same directory:');
            for (const n of siblings.slice(0, 8)) { // cap at 8 to keep prompt lean
                lines.push(`  ~ ${n.filePath}${n.summary ? ` — ${n.summary}` : ''}`);
            }
            if (siblings.length > 8) {
                lines.push(`  … and ${siblings.length - 8} more`);
            }
        }

        lines.push('\n=== END CODEBASE CONTEXT ===');
        return lines.join('\n');
    }
}
