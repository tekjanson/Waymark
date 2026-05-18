/**
 * @module LspClient
 * Manages a single out-of-process `typescript-language-server` instance via
 * JSON-RPC stdio pipes. Exposes `scanFile()` which opens a document into the
 * workspace and collects the diagnostics the language server publishes.
 *
 * The client is intentionally simple: one server instance per LspClient, lazy-
 * initialized on the first `scanFile()` call, and shut down via `dispose()`.
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createMessageConnection } from 'vscode-jsonrpc/node.js';

/** Debounce window (ms) — gives the server time to index before we collect. */
const DEBOUNCE_MS = 2000;

/** @typedef {import('vscode-languageserver-protocol').Diagnostic} Diagnostic */

export class LspClient {
    /** @type {import('node:child_process').ChildProcess|null} */
    #proc = null;

    /** @type {import('vscode-jsonrpc').MessageConnection|null} */
    #conn = null;

    /** @type {boolean} */
    #initialized = false;

    /**
     * @param {string} [rootPath] - Workspace root. Defaults to `process.cwd()`.
     */
    constructor(rootPath = process.cwd()) {
        this.rootPath = path.resolve(rootPath);
        this.rootUri = pathToFileURL(this.rootPath).toString();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Open `filePath` in the language server workspace and return all
     * diagnostics published within the debounce window.
     *
     * @param {string} filePath - Absolute path to the file to scan.
     * @returns {Promise<Diagnostic[]>}
     */
    async scanFile(filePath) {
        await this.#ensureInitialized();

        const absolutePath = path.resolve(filePath);
        const uri = pathToFileURL(absolutePath).toString();
        const text = fs.readFileSync(absolutePath, 'utf-8');

        // Derive languageId from extension.
        const ext = path.extname(absolutePath).toLowerCase();
        const languageId = (ext === '.mjs' || ext === '.js') ? 'javascript' : 'typescript';

        /** @type {Diagnostic[]} */
        const collected = [];

        // Register a one-shot listener *before* firing the notification so we
        // never miss a response that arrives synchronously.
        /** @type {() => void} */
        let resolveDebounce;
        let debounceTimer;

        const diagnosticsPromise = new Promise((resolve) => {
            resolveDebounce = resolve;

            const disposable = this.#conn.onNotification(
                'textDocument/publishDiagnostics',
                (params) => {
                    if (params.uri !== uri) return;

                    collected.push(...params.diagnostics);

                    // Reset debounce on every partial batch.
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        disposable.dispose();
                        resolve(collected);
                    }, DEBOUNCE_MS);
                }
            );

            // Safety net: resolve with whatever we have after 2× the debounce
            // window even if the server never fires for this URI.
            setTimeout(() => {
                clearTimeout(debounceTimer);
                disposable.dispose();
                resolve(collected);
            }, DEBOUNCE_MS * 2);
        });

        this.#conn.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text }
        });

        return diagnosticsPromise;
    }

    /**
     * Shut down the language server and release all resources.
     * Safe to call multiple times.
     *
     * @returns {Promise<void>}
     */
    async dispose() {
        if (!this.#conn) return;
        try {
            await this.#conn.sendRequest('shutdown');
            this.#conn.sendNotification('exit');
        } catch {
            // Server may already be gone.
        }
        this.#conn.dispose();
        this.#proc?.kill();
        this.#conn = null;
        this.#proc = null;
        this.#initialized = false;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Spawn the language server and perform the LSP `initialize` handshake on
     * first use. Idempotent — subsequent calls return immediately.
     *
     * @returns {Promise<void>}
     */
    async #ensureInitialized() {
        if (this.#initialized) return;

        this.#proc = spawn(
            'npx',
            ['typescript-language-server', '--stdio'],
            {
                stdio: ['pipe', 'pipe', 'inherit'],
                // Pass through the current env so tsconfig resolution works.
                env: process.env
            }
        );

        this.#proc.on('error', (err) => {
            console.error('[LspClient] Failed to spawn language server:', err.message);
        });

        this.#conn = createMessageConnection(
            this.#proc.stdout,
            this.#proc.stdin
        );
        this.#conn.listen();

        await this.#conn.sendRequest('initialize', {
            processId: process.pid,
            rootUri: this.rootUri,
            capabilities: {
                textDocument: {
                    publishDiagnostics: { relatedInformation: true }
                }
            },
            initializationOptions: {}
        });

        this.#conn.sendNotification('initialized', {});
        this.#initialized = true;
    }
}
