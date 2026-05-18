/**
 * @module GeminiCliAdapter
 * Drives the system-installed `gemini` binary in headless mode via execFile.
 * The full structured prompt is passed as the -p argument. execFile (not exec)
 * keeps args as separate argv entries — no shell, no injection surface.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { CompilerAdapter } from '../interfaces/ICompiler.mjs';

const execFileAsync = promisify(execFile);

/** Working directory for prompt scratch-files — created by index.mjs on boot. */
const TEMP_DIR = '.waymark/temp';

/**
 * Matches the FIRST ```javascript or ```js code fence in the LLM response.
 * Capture group 1 is the raw source between the fences.
 *
 *   ```javascript\n<code>\n```
 *   ```js\n<code>\n```
 */
const CODE_FENCE_RE = /```(?:javascript|js)?\n([\s\S]*?)```/;

/**
 * Matches any character that is not safe to embed in a filesystem segment.
 * Used to sanitize jobId before building the temp-file path, preventing
 * directory-traversal attacks (OWASP A01 — Broken Access Control).
 */
const UNSAFE_PATH_CHARS_RE = /[^a-zA-Z0-9_-]/g;

export class GeminiCliAdapter extends CompilerAdapter {
    /**
     * Compile a module by submitting a structured prompt to `gemini-cli`.
     *
     * @param {import('../interfaces/ICompiler.mjs').CompilationRequest} request
     * @returns {Promise<string>} Sanitized JavaScript source string.
     * @throws {Error} On CLI failure (non-zero exit / timeout / buffer overflow).
     */
    async compile(request) {
        // Sanitize jobId — prevent path traversal before touching the filesystem.
        const safeJobId = request.jobId.replace(UNSAFE_PATH_CHARS_RE, '_');
        const tempFilePath = path.join(TEMP_DIR, `prompt-${safeJobId}.txt`);

        const prompt = this.#buildPrompt(request);

        // Write prompt to disk for audit trail (mode 0o600 = owner-read-only).
        fs.writeFileSync(tempFilePath, prompt, { encoding: 'utf-8', mode: 0o600 });

        let stdout;
        try {
            ({ stdout } = await execFileAsync(
                'gemini',
                [
                    '--skip-trust',
                    '--output-format', 'text',
                    '-p', prompt,
                ],
                {
                    timeout: 120_000,     // 2 min — large codegen can be slow
                    maxBuffer: 10_485_760 // 10 MiB
                }
            ));
        } finally {
            try { fs.unlinkSync(tempFilePath); } catch { /* best-effort */ }
        }

        return this.#sanitize(stdout);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Assemble a deterministic, structured prompt from the compilation request.
     * Sections are separated by a horizontal rule so the LLM treats each as a
     * distinct context block rather than flowing prose.
     *
     * @param {import('../interfaces/ICompiler.mjs').CompilationRequest} request
     * @returns {string}
     */
    #buildPrompt(request) {
        const sections = [
            `SYSTEM RULES (invariants — never violate):\n${request.systemRules}`,
            `REQUIRED PUBLIC INTERFACE (AST contract — must be satisfied exactly):\n${request.astContract}`,
            `IMPLEMENTATION TASK:\n${request.targetPrompt}`,
        ];

        if (request.previousErrors?.length > 0) {
            const errorBlock = request.previousErrors.join('\n\n---error-boundary---\n\n');
            sections.push(
                `PREVIOUS COMPILATION ERRORS (these must be resolved — do not repeat them):\n${errorBlock}`
            );
        }

        // Explicit output constraint placed last to prime the model's completion
        // mode toward code rather than explanation.
        sections.push(
            'OUTPUT CONSTRAINT: Respond with ONLY the complete JavaScript module ' +
            'implementation inside a single ```javascript code fence. ' +
            'No preamble, no explanation, no prose outside the fence.'
        );

        return sections.join('\n\n---\n\n');
    }

    /**
     * Extract the first JavaScript code fence from raw LLM stdout.
     * All conversational text outside the fence is discarded.
     *
     * If no fence is found, the entire trimmed output is treated as code and a
     * warning is emitted so the caller can decide whether to trust or reject it.
     *
     * @param {string} rawOutput
     * @returns {string} Extracted (or fallback raw) JavaScript source.
     */
    #sanitize(rawOutput) {
        const match = rawOutput.match(CODE_FENCE_RE);

        if (!match) {
            console.warn(
                '[GeminiCliAdapter] WARNING: No ```javascript or ```js code fence found in ' +
                'model output. Treating raw stdout as code. Verify output before trusting it.'
            );
            return rawOutput.trim();
        }

        // trimEnd() only — preserve any intentional leading whitespace inside
        // the fence while stripping the trailing newline the LLM appends.
        return match[1].trimEnd();
    }
}
