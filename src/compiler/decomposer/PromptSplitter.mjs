/**
 * @module PromptSplitter
 *
 * Takes a single broad prompt.md body (describing multiple exports) and a list
 * of UnitDescriptors, then produces one focused atomic prompt per unit.
 *
 * SHARED MANIFEST RULE: Every atomic prompt is prefixed with a SharedManifest
 * block that enforces structural alignment across all sub-prompts. This
 * prevents semantic drift where sibling units make incompatible architectural
 * assumptions (e.g. one assumes Postgres, another assumes Redis).
 *
 * The SharedManifest captures:
 *   - Global types and data shapes shared across units
 *   - Protocol/transport constraints (MQTT topics, REST endpoints, etc.)
 *   - DAG compilation order (which units must exist before this one)
 *   - Exact import contracts for sibling unit files
 *
 * Each atomic prompt:
 *   - Is prefixed with the SharedManifest (identical across all units).
 *   - Describes ONLY the single export being compiled.
 *   - States which siblings to import (not re-implement).
 *   - States the output file path explicitly.
 */

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * @typedef {Object} AtomicPrompt
 * @property {string}   jobId        - Unique identifier for this sub-job (parentJobId_unitName).
 * @property {string}   unitName     - The single export symbol this prompt targets.
 * @property {string}   unitKind     - 'function' | 'class' | 'const' | 'unknown'
 * @property {string}   targetPath   - Abs path to the output file for this unit.
 * @property {string}   testPath     - Abs path to the companion test file for this unit.
 * @property {string}   promptBody   - The focused prompt text for this unit (no frontmatter).
 *                                     Always prefixed with the SharedManifest.
 * @property {string}   sharedManifest - The manifest block prepended to promptBody.
 * @property {string[]} depNames     - Names of sibling units this unit imports.
 * @property {string[]} depPaths     - Abs paths to sibling unit files (for import resolution).
 * @property {number}   dagOrder     - 0-based compilation order index from topological sort.
 */

export class PromptSplitter {
    /**
     * @param {object} opts
     * @param {string} opts.parentJobId   - Base job id from the parent prompt.
     * @param {string} opts.parentPrompt  - Full prompt body of the parent prompt.md.
     * @param {string} opts.outDir        - Abs path to the output directory for unit files.
     * @param {string} opts.systemRules   - Invariant rules passed through to each unit job.
     */
    constructor({ parentJobId, parentPrompt, outDir, systemRules }) {
        this.parentJobId = parentJobId;
        this.parentPrompt = parentPrompt;
        this.outDir = outDir;
        this.systemRules = systemRules;
    }

    /**
     * Split the parent prompt into one AtomicPrompt per UnitDescriptor.
     * Builds a SharedManifest first, then focuses each unit prompt.
     * Units with no siblings skip the Gemini refinement call (fast path).
     *
     * @param {import('./UnitExtractor.mjs').UnitDescriptor[]} units
     * @returns {Promise<AtomicPrompt[]>}
     */
    async split(units) {
        // Build the dep-name → dep-path map first so every unit knows its siblings.
        const pathMap = this.#buildPathMap(units);

        // Topological sort so dep-free units come first (parallel-friendly).
        const ordered = this.#topoSort(units);

        // ── Build the SharedManifest ONCE — prepended to all atomic prompts ──
        // This is the structural alignment guarantee. Every unit sees the same
        // global constraints, preventing incompatible architectural assumptions.
        const sharedManifest = await this.#buildSharedManifest(ordered, pathMap);
        console.log(`[PromptSplitter] SharedManifest built (${sharedManifest.length} chars)`);

        const results = [];
        for (let i = 0; i < ordered.length; i++) {
            const unit = ordered[i];
            const atomic = await this.#buildAtomicPrompt(unit, pathMap, units, sharedManifest, i);
            results.push(atomic);
        }
        return results;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    /**
     * Map each unit name → its absolute output file path.
     * e.g.  { formatRelativeTime: '/…/src/utils/date/formatRelativeTime.mjs' }
     */
    #buildPathMap(units) {
        const map = new Map();
        for (const u of units) {
            map.set(u.name, path.join(this.outDir, `${u.name}.mjs`));
        }
        return map;
    }

    /**
     * Simple dependency-aware topological sort (Kahn's algorithm).
     * Units whose deps are all satisfied come first.
     * Cycles are broken by insertion order (safe for this use-case).
     */
    #topoSort(units) {
        const nameToUnit = new Map(units.map(u => [u.name, u]));
        const inDegree = new Map(units.map(u => [u.name, 0]));

        for (const u of units) {
            for (const dep of u.deps) {
                if (inDegree.has(dep)) inDegree.set(dep, inDegree.get(dep) + 1);
            }
        }

        const queue = [...units].filter(u => inDegree.get(u.name) === 0);
        const sorted = [];

        while (queue.length > 0) {
            const node = queue.shift();
            sorted.push(node);
            for (const depName of node.deps) {
                if (!nameToUnit.has(depName)) continue;
                const newDeg = inDegree.get(depName) - 1;
                inDegree.set(depName, newDeg);
                if (newDeg <= 0) queue.push(nameToUnit.get(depName));
            }
        }

        // Any remaining (cycle members) appended in original order.
        for (const u of units) {
            if (!sorted.includes(u)) sorted.push(u);
        }

        return sorted;
    }

    /**
     * Build the SharedManifest — a structural alignment header prepended to
     * every atomic prompt. Prevents semantic drift across sub-prompts.
     *
     * The manifest enforces that all units share:
     *   1. The same module system (ESM .mjs)
     *   2. The same data shapes (inferred from parent prompt)
     *   3. The correct import paths for sibling units
     *   4. The DAG compilation order (what exists before each unit runs)
     *   5. Any protocol/transport constraints mentioned in the parent prompt
     *
     * @param {import('./UnitExtractor.mjs').UnitDescriptor[]} orderedUnits - toposorted
     * @param {Map<string, string>} pathMap - unitName → abs file path
     * @returns {Promise<string>}
     */
    async #buildSharedManifest(orderedUnits, pathMap) {
        // Extract protocol/transport constraints from the parent prompt via Gemini.
        // This is the one Gemini call that benefits the entire unit set.
        let architecturalConstraints = '';
        try {
            const constraintPrompt = [
                'You are a code architecture analyst.',
                '',
                'Read the module description below and extract ONLY:',
                '  1. Any specific data types or interfaces that multiple functions share',
                '  2. Any protocol or transport constraints (MQTT, REST, WebSocket, etc.)',
                '  3. Any global invariants (e.g. "always throws TypeError for null input")',
                '  4. Any specific libraries or APIs that must be used',
                '',
                'Format as a plain bulleted list. Be concise. Max 200 words.',
                'If none are present, reply with: (no shared constraints detected)',
                '',
                '--- MODULE DESCRIPTION ---',
                this.parentPrompt,
            ].join('\n');

            const { stdout } = await execFileAsync(
                'gemini',
                ['--skip-trust', '--output-format', 'text', '-p', constraintPrompt],
                { timeout: 45_000, maxBuffer: 1_048_576 }
            );
            architecturalConstraints = stdout.trim();
        } catch (err) {
            console.warn(`[PromptSplitter] Manifest constraint extraction failed: ${err.message}`);
            architecturalConstraints = '(constraint extraction unavailable)';
        }

        const dagLines = orderedUnits.map((u, i) =>
            `  ${i + 1}. ${u.name} (${u.kind})${u.deps.length > 0 ? ` — requires: ${u.deps.join(', ')}` : ' — no deps'}`
        );

        const siblingImports = orderedUnits.map(u =>
            `  import { ${u.name} } from './${u.name}.mjs'; // ${pathMap.get(u.name)}`
        );

        return [
            '╔══════════════════════════════════════════════════════════════╗',
            '║  SHARED MANIFEST — read before implementing any unit          ║',
            '║  All units in this decomposition share these constraints.     ║',
            '╚══════════════════════════════════════════════════════════════╝',
            '',
            '## Module System',
            '  - Pure ESM (.mjs). Use import/export. Never require().',
            '  - Each unit lives in its own file. One file = one export.',
            '  - Do NOT re-implement sibling units — import them.',
            '',
            '## DAG Compilation Order',
            '  Units are compiled in this sequence (earlier = available first):',
            ...dagLines,
            '',
            '## Sibling Import Reference',
            '  If your unit depends on a sibling, use exactly these import paths:',
            ...siblingImports,
            '',
            '## Architectural Constraints (extracted from parent description)',
            architecturalConstraints,
            '',
            '╔══════════════════════════════════════════════════════════════╗',
            '║  END SHARED MANIFEST — unit-specific spec follows below       ║',
            '╚══════════════════════════════════════════════════════════════╝',
        ].join('\n');
    }

    /**
     * Build one AtomicPrompt for `unit`. When the unit is part of a multi-unit
     * file, ask Gemini to extract and focus the relevant portion of the parent
     * prompt. When it's the only unit, use the parent prompt verbatim.
     */
    async #buildAtomicPrompt(unit, pathMap, allUnits, sharedManifest, dagOrder) {
        const targetPath = pathMap.get(unit.name);
        const testPath = path.join(this.outDir, `${unit.name}.test.mjs`);
        const jobId = `${this.parentJobId}_${unit.name}`;

        const depNames = unit.deps.filter(d => pathMap.has(d));
        const depPaths = depNames.map(d => pathMap.get(d));

        let unitSpec;

        if (allUnits.length === 1) {
            // Single-unit: no need for Gemini to focus — use parent prompt as-is.
            unitSpec = this.parentPrompt;
        } else {
            unitSpec = await this.#refineViaGemini(unit, depNames, targetPath);
        }

        // SharedManifest is ALWAYS prepended — this is the alignment guarantee.
        const promptBody = sharedManifest + '\n\n' + unitSpec;

        return {
            jobId,
            unitName: unit.name,
            unitKind: unit.kind,
            targetPath,
            testPath,
            promptBody,
            sharedManifest,
            depNames,
            depPaths,
            dagOrder,
        };
    }

    /**
     * Ask Gemini to extract and expand the single-unit description from the
     * broader parent prompt. This keeps each unit's prompt laser-focused so the
     * LLM sees only what it needs to generate.
     */
    async #refineViaGemini(unit, depNames, targetPath) {
        const depContext = depNames.length > 0
            ? `\nThis function may IMPORT (do not re-implement) the following sibling units:\n${depNames.map(d => `  - ${d}`).join('\n')}`
            : '';

        const prompt = [
            'You are a prompt engineer specialising in code generation tasks.',
            '',
            `From the MODULE DESCRIPTION below, extract and expand ONLY the parts`,
            `relevant to implementing a single exported symbol named "${unit.name}".`,
            '',
            `Unit kind  : ${unit.kind}`,
            `Parameters : ${unit.params.length > 0 ? unit.params.join(', ') : '(none)'}`,
            `Description: ${unit.description || '(see module description)'}`,
            `Output file: ${targetPath}`,
            depContext,
            '',
            'Produce a concise but complete implementation specification for',
            `"${unit.name}" ONLY. Cover: purpose, parameters, return value,`,
            'edge cases, error handling, and any relevant constraints.',
            'Do NOT describe any other symbols.',
            '',
            '--- FULL MODULE DESCRIPTION ---',
            this.parentPrompt,
            '',
            'OUTPUT CONSTRAINT: Return ONLY the focused specification as plain prose.',
            'No code. No JSON. No markdown headers. Just the specification text.',
        ].join('\n');

        try {
            const { stdout } = await execFileAsync(
                'gemini',
                ['--skip-trust', '--output-format', 'text', '-p', prompt],
                { timeout: 60_000, maxBuffer: 2_097_152 }
            );
            return stdout.trim();
        } catch (err) {
            console.warn(`[PromptSplitter] Gemini refinement failed for "${unit.name}": ${err.message}`);
            // Fall back to a minimal spec derived from what we already know.
            return [
                `Implement the exported ${unit.kind} named "${unit.name}".`,
                unit.description ? `\nDescription: ${unit.description}` : '',
                unit.params.length > 0
                    ? `\nParameters: ${unit.params.join(', ')}`
                    : '',
                depNames.length > 0
                    ? `\nImport (do not reimplement): ${depNames.join(', ')}`
                    : '',
                '\nSee overall module context:\n',
                this.parentPrompt,
            ].join('');
        }
    }
}
