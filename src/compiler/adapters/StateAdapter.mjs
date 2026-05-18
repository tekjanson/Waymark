/**
 * @module StateAdapter
 * Publishes structured job-status events to an MQTT broker so external
 * dashboards, the Waymark orchestrator, or any subscriber can track the
 * compiler pipeline in real time.
 *
 * Topic schema: `waymark/compiler/<jobId>/status`
 * QoS: 1 (at-least-once delivery)
 */

import mqtt from 'mqtt';

const BROKER_URL = 'mqtt://localhost:1883';
const TOPIC_PREFIX = 'waymark/compiler/';
const QOS = 1;

/**
 * @typedef {'STARTED'|'TESTS_FAILED'|'LSP_REJECTED'|'SUCCESS'|'ROLLED_BACK'} StatusEvent
 */

export class StateAdapter {
    /** @type {import('mqtt').MqttClient|null} */
    #client = null;

    /**
     * Lazily connect to the MQTT broker and return the client.
     * Idempotent — returns the same client on subsequent calls.
     *
     * @returns {Promise<import('mqtt').MqttClient>}
     */
    async #getClient() {
        if (this.#client?.connected) return this.#client;

        return new Promise((resolve, reject) => {
            const client = mqtt.connect(BROKER_URL, {
                clientId: `waymark-compiler-${process.pid}`,
                clean: true,
                connectTimeout: 5000,
                reconnectPeriod: 0, // No auto-reconnect — the orchestrator is short-lived.
            });

            client.once('connect', () => {
                this.#client = client;
                resolve(client);
            });

            client.once('error', (err) => {
                console.warn(`[StateAdapter] MQTT connection failed: ${err.message}. Status events will not be published.`);
                client.end(true);
                reject(err);
            });
        });
    }

    /**
     * Publish a status event for `jobId` over MQTT.
     * If the broker is unavailable, the error is swallowed and logged — the
     * compiler pipeline must continue regardless of telemetry failures.
     *
     * @param {string} jobId
     * @param {StatusEvent} status
     * @param {string[]} logs - Relevant log lines for this event (may be empty).
     * @returns {Promise<void>}
     */
    async emitStatus(jobId, status, logs) {
        const topic = `${TOPIC_PREFIX}${jobId}/status`;

        const payload = JSON.stringify({
            jobId,
            status,
            logs,
            timestamp: new Date().toISOString(),
        });

        try {
            const client = await this.#getClient();

            await new Promise((resolve, reject) => {
                client.publish(topic, payload, { qos: QOS }, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log(`[StateAdapter] → ${topic} : ${status}`);
        } catch (err) {
            // Non-fatal — telemetry loss must never abort a compilation job.
            console.warn(`[StateAdapter] Failed to publish status "${status}" for job "${jobId}": ${err.message}`);
        }
    }

    /**
     * Gracefully close the MQTT connection.
     * Safe to call even if the broker was never reachable.
     *
     * @returns {Promise<void>}
     */
    async dispose() {
        if (!this.#client) return;
        await new Promise((resolve) => this.#client.end(false, {}, resolve));
        this.#client = null;
    }
}
