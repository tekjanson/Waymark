/**
 * @module MockWriter
 *
 * Zero-LLM codegen. Converts UnitDescriptor contracts into vitest vi.mock()
 * stubs that can be injected into any test file that imports a sibling unit.
 *
 * Design rationale (the integration vs. mocking problem):
 *
 *   UNIT TEST TIME — Use contract-derived mocks.
 *     When compiling Unit B (which depends on Unit A), Unit A may not be
 *     compiled yet. Even if it is, using the real Unit A in Unit B's test
 *     makes it an integration test: slow, order-dependent, fragile.
 *     Instead: generate a vi.mock() stub from Unit A's AstParser contract.
 *     The stub matches the EXTRACTED SIGNATURE — not a guess, not hand-written.
 *     If Unit A's contract diverges from its compiled output, the integration
 *     smoke test (IntegrationSmokeWriter) will catch it, not the unit test.
 *
 *   POST-DAG TIME — Use real imports (IntegrationSmokeWriter).
 *     After all units in a stage succeed, a smoke test imports the real barrel
 *     and exercises every dep boundary with real compiled code. This is the
 *     safety net that catches "mock matched the contract but the implementation
 *     didn't."
 *
 * Stub behaviour:
 *   - Functions return `undefined` by default (vi.fn()).
 *   - Classes return a mock instance with all public methods as vi.fn().
 *   - The stub is deterministic — same contract always produces same stub.
 *   - Stubs are annotated with a comment showing the contract they were
 *     derived from, making audit trivial.
 */

/**
 * @typedef {import('./UnitExtractor.mjs').UnitDescriptor} UnitDescriptor
 */

export class MockWriter {
    /**
     * Generate a complete vi.mock() block for a single dep unit.
     * The block is ready to paste at the top of a test file (after imports).
     *
     * @param {UnitDescriptor} unit  - The unit to mock (the dependency).
     * @returns {string}  A vi.mock() call as a string.
     */
    generateMock(unit) {
        const mockPath = `./${unit.name}.mjs`;
        const mockImpl = this.#buildMockImpl(unit);

        return [
            `// Mock derived from AstParser contract for "${unit.name}" (${unit.kind})`,
            `vi.mock('${mockPath}', () => ({`,
            ...mockImpl.map(line => `  ${line}`),
            `}));`,
        ].join('\n');
    }

    /**
     * Generate vi.mock() blocks for multiple dep units at once.
     * Returns a single string block suitable for injecting after the import
     * section of a test file.
     *
     * @param {UnitDescriptor[]} depUnits - All units that need to be mocked.
     * @returns {string}
     */
    generateMockBlock(depUnits) {
        if (depUnits.length === 0) return '';
        return depUnits.map(u => this.generateMock(u)).join('\n\n');
    }

    /**
     * Generate the vitest import line required to use vi.mock().
     * Separate from generateMockBlock so callers can merge with existing imports.
     *
     * @returns {string}
     */
    vitestImportLine() {
        return `import { describe, it, expect, vi, beforeEach } from 'vitest';`;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    /**
     * Build the inner lines of the vi.mock() factory function body.
     *
     * @param {UnitDescriptor} unit
     * @returns {string[]}
     */
    #buildMockImpl(unit) {
        if (unit.kind === 'class') {
            return this.#buildClassMock(unit);
        }
        return this.#buildFunctionMock(unit);
    }

    /**
     * For function/const exports:
     *   formatRelativeTime: vi.fn((ms, now) => undefined),
     */
    #buildFunctionMock(unit) {
        const paramList = unit.params.length > 0
            ? unit.params.join(', ')
            : '_args';

        return [
            `${unit.name}: vi.fn((${paramList}) => undefined),`,
        ];
    }

    /**
     * For class exports — generate a mock constructor that returns an
     * instance where every method is a vi.fn().
     *
     * We don't know the class methods at extract time (UnitDescriptor only
     * tracks constructor params), so we produce a Proxy-based catch-all.
     *
     *   MyClass: vi.fn().mockImplementation((...args) => ({
     *     // All method calls are auto-mocked via Proxy
     *     ...new Proxy({}, { get: (_, k) => vi.fn() }),
     *   })),
     */
    #buildClassMock(unit) {
        const paramList = unit.params.length > 0
            ? unit.params.join(', ')
            : '...args';

        return [
            `${unit.name}: vi.fn().mockImplementation((${paramList}) => (`,
            `  new Proxy({}, { get: (_t, key) => vi.fn().mockReturnValue(undefined) })`,
            `)),`,
        ];
    }
}
