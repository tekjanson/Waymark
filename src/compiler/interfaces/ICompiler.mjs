/**
 * @typedef {Object} CompilationRequest
 * @property {string} jobId           - Unique identifier for this compilation job (alphanumeric + hyphens).
 * @property {string} systemRules     - Invariant rules the generated code must obey.
 * @property {string} targetPrompt    - Human-intent description of what the module should do.
 * @property {string} astContract     - JSON string describing the required public interface (from AstParser).
 * @property {string[]} [previousErrors] - Accumulated error logs from prior failed compile attempts.
 */

/**
 * Base adapter that all LLM compiler backends must extend.
 * Implementations are expected to be stateless — each call to `compile()` is
 * independent and must not mutate shared state between concurrent jobs.
 */
export class CompilerAdapter {
    /**
     * Submit a compilation request to an LLM backend and return the sanitized
     * JavaScript source string that should be written to the target file.
     *
     * @param {CompilationRequest} request
     * @returns {Promise<string>} The raw JavaScript source code of the compiled module.
     * @throws {Error} If the backend is unreachable or returns an unrecoverable error.
     */
    async compile(request) {
        throw new Error("Method 'compile()' must be implemented by a concrete adapter.");
    }
}
