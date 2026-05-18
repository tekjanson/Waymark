/**
 * @module mqtt-bridge
 *
 * Thin wrapper around the existing Waymark MqttClient (public/js/mqtt-client.js)
 * specifically for the Code City 3D frontend.
 *
 * Connects to the Mosquitto WebSocket listener on ws://localhost:9001 and
 * emits typed events for the compiler pipeline topics.
 */

import { MqttClient } from '/js/mqtt-client.js';

const WS_URL        = 'ws://localhost:9001';
const STAGE_STATUS  = 'waymark/compiler/stage/status';
const STAGE_EXEC    = 'waymark/compiler/stage/execution';
const STAGE_APPROVE = 'waymark/compiler/stage/approve';

export class CityMqttBridge extends EventTarget {
  /** @type {MqttClient} */ #client = null;
  #connected = false;

  constructor() {
    super();
  }

  get connected() { return this.#connected; }

  async connect() {
    const client = new MqttClient(WS_URL, {
      clientId: `city_${Math.random().toString(36).slice(2, 10)}`,
      reconnect: true,
    });

    client.addEventListener('connect', () => {
      this.#connected = true;
      this.dispatchEvent(new CustomEvent('connected'));

      client.subscribe(STAGE_STATUS, { qos: 1 });
      client.subscribe(STAGE_EXEC,   { qos: 1 });
    });

    client.addEventListener('disconnect', () => {
      this.#connected = false;
      this.dispatchEvent(new CustomEvent('disconnected'));
    });

    client.addEventListener('message', (e) => {
      const { topic, payload } = e.detail;
      let data;
      try { data = JSON.parse(payload); } catch { return; }

      if (topic === STAGE_STATUS) {
        this.dispatchEvent(new CustomEvent('stage:status', { detail: data }));
      } else if (topic === STAGE_EXEC) {
        this.dispatchEvent(new CustomEvent('stage:execution', { detail: data }));
      }
    });

    this.#client = client;
    client.connect();
  }

  /**
   * Publish a human-approval event back to the daemon.
   * Triggers the SheetSyncDaemon's poll gate when COMPILER_SHEET_ID isn't set
   * or when running in a network-only mode.
   *
   * @param {string} jobId
   */
  approve(jobId) {
    if (!this.#client || !this.#connected) {
      console.warn('[CityMqttBridge] Cannot publish: not connected');
      return;
    }
    const payload = JSON.stringify({ jobId, approved: true });
    this.#client.publish(STAGE_APPROVE, payload, { qos: 1 });
  }

  disconnect() {
    this.#client?.disconnect();
    this.#connected = false;
  }
}
