/**
 * @module MqttReporter
 *
 * Staging-aware MQTT publisher for the Waymark Zero-Trust compiler pipeline.
 *
 * Publishes two categories of events over QoS-1 topics so the Waymark UI
 * can render a live Neon-Map view of the pipeline state.
 *
 * Topics:
 *   waymark/compiler/stage/status    — manifest ready, awaiting human approval
 *   waymark/compiler/stage/execution — real-time compilation pass progress
 *
 * Design notes:
 *   - Lazy-connect, same pattern as StateAdapter — broker absence is non-fatal.
 *   - dispose() must be called when the pipeline finishes to release the socket.
 *   - `safetyScore` is always 100 at staging time because we only stage after
 *     contract tests pass against the current production implementation.
 *   - `criticalEdgeCases` is extracted from describe/it block names in the test
 *     file using a keyword heuristic (no AST needed — pattern match is enough).
 */

import fs from 'node:fs';
import mqtt from 'mqtt';

const BROKER_URL   = 'mqtt://localhost:1883';
const TOPIC_STATUS = 'waymark/compiler/stage/status';
const TOPIC_EXEC   = 'waymark/compiler/stage/execution';
const QOS          = 1;

/** Keywords that flag a test name as an edge-case worth surfacing. */
const EDGE_KEYWORDS = [
    'null', 'undefined', 'missing', 'invalid', 'error', 'empty',
    'fallback', 'cap', 'skip', 'malformed', 'negative', 'zero',
    'whitespace', 'lock', 'concurrent', 'enoent', 'overwrite',
];

/** Regex to extract the description string from it() / test() calls. */
const TEST_NAME_RE = /(?:it|test)\s*\(\s*['"`](.*?)['"`]/g;

/**
 * Extract a short list of edge-case labels from a test file on disk.
 * Returns at most 5 entries to keep the MQTT payload small.
 *
 * @param {string} testFilePath - Abs path to the test file.
 * @returns {string[]}
 */
function extractEdgeCases(testFilePath) {
    let source = '';
    try { source = fs.readFileSync(testFilePath, 'utf-8'); } catch { return []; }

    const cases = [];
    let m;
    TEST_NAME_RE.lastIndex = 0;
    while ((m = TEST_NAME_RE.exec(source)) !== null) {
        const name = m[1];
        if (EDGE_KEYWORDS.some(kw => name.toLowerCase().includes(kw))) {
            cases.push(name);
        }
        if (cases.length >= 5) break;
    }
    return cases;
}

/**
 * Count the total number of `it(` / `test(` calls in a test file.
 *
 * @param {string} testFilePath
 * @returns {number}
 */
function countTests(testFilePath) {
    let source = '';
    try { source = fs.readFileSync(testFilePath, 'utf-8'); } catch { return 0; }
    // Match it(...) and test(...) at any indent level.
    const re = /^\s*(?:it|test)\s*\(/gm;
    return (source.match(re) ?? []).length;
}

export class MqttReporter {
    /** @type {import('mqtt').MqttClient|null} */
    #client = null;

    // ── Connection ────────────────────────────────────────────────────────────

    async #getClient() {
        if (this.#client?.connected) return this.#client;

        return new Promise((resolve, reject) => {
            const client = mqtt.connect(BROKER_URL, {
                clientId: `waymark-reporter-${process.pid}`,
                clean: true,
                connectTimeout: 5000,
                reconnectPeriod: 0,
            });
            client.once('connect', () => { this.#client = client; resolve(client); });
            client.once('error', (err) => {
                console.warn(`[MqttReporter] MQTT unavailable: ${err.message}. Neon-Map events will not be published.`);
                client.end(true);
                reject(err);
            });
        });
    }

    /**
     * @param {string} topic
     * @param {object} payload
     */
    async #publish(topic, payload) {
        const msg = JSON.stringify({ ...payload, timestamp: new Date().toISOString() });
        try {
            const client = await this.#getClient();
            await new Promise((resolve, reject) => {
                client.publish(topic, msg, { qos: QOS }, (err) => {
                    if (err) reject(err); else resolve();
                });
            });
            console.log(`[MqttReporter] → ${topic} : ${payload.status ?? payload.visualState ?? JSON.stringify(payload).slice(0, 60)}`);
        } catch {
            // Non-fatal — telemetry must never abort a compilation job.
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Emit a `waymark/compiler/stage/status` event when a stage manifest has
     * been written and is awaiting human approval.
     *
     * One event is emitted per unit so the UI can render individual unit cards.
     *
     * @param {object} opts
     * @param {string} opts.jobId      - Stage job identifier.
     * @param {string} opts.targetFile - Basename of the original source file (e.g. "notification-store.mjs").
     * @param {string} opts.testPath   - Abs path to the contract test file (for introspection).
     * @param {number} opts.dagOrder   - Topological order of this unit (0 = leaf/no deps).
     * @param {boolean} opts.approved  - Always false at staging time.
     */
    async emitStageReady({ jobId, targetFile, testPath, dagOrder, approved = false }) {
        const totalTests    = countTests(testPath);
        const criticalEdgeCases = extractEdgeCases(testPath);

        await this.#publish(TOPIC_STATUS, {
            jobId,
            targetFile,
            totalTests,
            dagOrder,
            approved,
            safetyScore: 100,   // 100 = baseline contract tests all pass at staging time
            criticalEdgeCases,
            visualState: 'BRIGHT_NEON',
        });
    }

    /**
     * Emit a `waymark/compiler/stage/execution` event during the execute pass.
     *
     * @param {string} jobId
     * @param {'COMPILING'|'RETRYING'|'SUCCESS'|'FAILED'} status
     * @param {object} [opts]
     * @param {number} [opts.attempt]  - 1-based attempt number.
     * @param {string} [opts.error]    - Vitest/LSP failure snippet (RETRYING only).
     * @param {number} [opts.score]    - Judge score 0-10 (SUCCESS only).
     */
    async emitExecutionUpdate(jobId, status, { attempt, error, score } = {}) {
        const payload = { jobId, status };
        if (attempt !== undefined) payload.attempt = attempt;
        if (error    !== undefined) payload.error   = String(error).slice(0, 500);
        if (score    !== undefined) payload.score   = score;
        await this.#publish(TOPIC_EXEC, payload);
    }

    /**
     * Gracefully close the MQTT connection.
     * Safe to call even when the broker was never reachable.
     */
    async dispose() {
        if (!this.#client) return;
        await new Promise((resolve) => this.#client.end(false, {}, resolve));
        this.#client = null;
    }
}
