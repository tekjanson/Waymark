/* ============================================================
   mqtt-client.js — Minimal MQTT v3.1.1 over WebSocket client
   Zero dependencies. Supports connect, publish (QoS 0),
   subscribe (QoS 0), ping keepalive, and disconnect.
   ============================================================ */

const CONNECT = 1, CONNACK = 2, PUBLISH = 3, SUBSCRIBE = 8,
      SUBACK = 9, PINGREQ = 12, PINGRESP = 13, DISCONNECT = 14;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class MqttClient extends EventTarget {
  /**
   * @param {string} url  WebSocket URL (ws:// or wss://)
   * @param {object} [opts]
   * @param {string} [opts.clientId]
   * @param {string} [opts.username]
   * @param {string} [opts.password]
   * @param {number} [opts.keepAlive=30]  seconds
   */
  constructor(url, opts = {}) {
    super();
    this._url = url;
    this._clientId = opts.clientId || 'wm_' + Math.random().toString(36).slice(2, 10);
    this._username = opts.username || null;
    this._password = opts.password || null;
    this._keepAlive = opts.keepAlive ?? 30;
    this._ws = null;
    this._pingTimer = null;
    this._packetId = 0;
    this._connected = false;
    this._buffer = new Uint8Array(0);
    this._reconnect = opts.reconnect !== false;
    this._reconnectDelay = 2000;
    this._closed = false;
  }

  get connected() { return this._connected; }

  /* -------- Public API -------- */

  connect() {
    this._closed = false;
    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(this._url, ['mqtt']);
      this._ws.binaryType = 'arraybuffer';

      this._ws.onopen = () => this._sendConnect();

      this._ws.onmessage = (e) => this._onData(new Uint8Array(e.data));

      this._ws.onerror = () => {
        // WebSocket error — onclose will fire next
      };

      this._ws.onclose = () => {
        const wasConnected = this._connected;
        this._connected = false;
        clearInterval(this._pingTimer);
        this.dispatchEvent(new Event('close'));
        if (!wasConnected) {
          reject(new Error('WebSocket closed before CONNACK'));
        }
        if (this._reconnect && !this._closed) {
          setTimeout(() => this._tryReconnect(), this._reconnectDelay);
        }
      };

      // Wait for CONNACK
      const handler = (e) => {
        this.removeEventListener('_connack', handler);
        if (e.detail.returnCode === 0) {
          this._connected = true;
          this._startPing();
          this.dispatchEvent(new Event('connect'));
          resolve();
        } else {
          reject(new Error(`MQTT CONNACK rc=${e.detail.returnCode}`));
        }
      };
      this.addEventListener('_connack', handler);
    });
  }

  publish(topic, message) {
    if (!this._connected) return;
    const topicBuf = this._encStr(topic);
    const msgBuf = typeof message === 'string' ? encoder.encode(message) : message;
    const payload = new Uint8Array(topicBuf.length + msgBuf.length);
    payload.set(topicBuf);
    payload.set(msgBuf, topicBuf.length);
    this._send(this._packet(PUBLISH << 4, payload));
  }

  subscribe(topic) {
    if (!this._connected) return;
    const id = this._nextId();
    const topicBuf = this._encStr(topic);
    const payload = new Uint8Array(2 + topicBuf.length + 1);
    payload[0] = (id >> 8) & 0xff;
    payload[1] = id & 0xff;
    payload.set(topicBuf, 2);
    payload[2 + topicBuf.length] = 0; // QoS 0
    this._send(this._packet((SUBSCRIBE << 4) | 0x02, payload));
  }

  disconnect() {
    this._closed = true;
    this._reconnect = false;
    if (!this._connected) return;
    clearInterval(this._pingTimer);
    this._send(new Uint8Array([(DISCONNECT << 4), 0]));
    this._ws.close();
    this._connected = false;
  }

  /* -------- Encoding helpers -------- */

  _encStr(str) {
    const buf = encoder.encode(str);
    const out = new Uint8Array(2 + buf.length);
    out[0] = (buf.length >> 8) & 0xff;
    out[1] = buf.length & 0xff;
    out.set(buf, 2);
    return out;
  }

  _encRemLen(len) {
    const bytes = [];
    do {
      let b = len & 0x7f;
      len >>= 7;
      if (len > 0) b |= 0x80;
      bytes.push(b);
    } while (len > 0);
    return bytes;
  }

  _packet(headerByte, payload) {
    const rl = this._encRemLen(payload.length);
    const pkt = new Uint8Array(1 + rl.length + payload.length);
    pkt[0] = headerByte;
    pkt.set(rl, 1);
    pkt.set(payload, 1 + rl.length);
    return pkt;
  }

  _nextId() {
    this._packetId = (this._packetId + 1) & 0xffff || 1;
    return this._packetId;
  }

  /* -------- CONNECT packet -------- */

  _sendConnect() {
    const proto = this._encStr('MQTT');
    let flags = 0x02; // Clean Session
    const payloadParts = [this._encStr(this._clientId)];

    if (this._username) {
      flags |= 0x80;
      payloadParts.push(this._encStr(this._username));
    }
    if (this._password) {
      flags |= 0x40;
      payloadParts.push(this._encStr(this._password));
    }

    const payloadLen = payloadParts.reduce((s, p) => s + p.length, 0);
    const varHeader = new Uint8Array(proto.length + 4);
    varHeader.set(proto);
    let i = proto.length;
    varHeader[i++] = 4; // Protocol Level (3.1.1)
    varHeader[i++] = flags;
    varHeader[i++] = (this._keepAlive >> 8) & 0xff;
    varHeader[i++] = this._keepAlive & 0xff;

    const body = new Uint8Array(varHeader.length + payloadLen);
    body.set(varHeader);
    let offset = varHeader.length;
    for (const part of payloadParts) {
      body.set(part, offset);
      offset += part.length;
    }

    this._send(this._packet(CONNECT << 4, body));
  }

  /* -------- Keepalive -------- */

  _startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (this._connected) {
        this._send(new Uint8Array([(PINGREQ << 4), 0]));
      }
    }, this._keepAlive * 800); // 80% of keepalive interval
  }

  /* -------- Transport -------- */

  _send(data) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(data);
    }
  }

  _tryReconnect() {
    if (this._closed || this._connected) return;
    this.connect().catch(() => {
      // Will retry via onclose handler
    });
  }

  /* -------- Inbound packet parsing -------- */

  _onData(data) {
    const combined = new Uint8Array(this._buffer.length + data.length);
    combined.set(this._buffer);
    combined.set(data, this._buffer.length);
    this._buffer = combined;

    while (this._buffer.length >= 2) {
      const rl = this._decRemLen(this._buffer, 1);
      if (rl.length < 0) break;

      const total = 1 + rl.bytes + rl.length;
      if (this._buffer.length < total) break;

      const pkt = this._buffer.slice(0, total);
      this._buffer = this._buffer.slice(total);
      this._handlePacket(pkt);
    }
  }

  _decRemLen(buf, off) {
    let val = 0, mul = 1, bytes = 0;
    for (let i = off; i < buf.length && i < off + 4; i++) {
      bytes++;
      val += (buf[i] & 0x7f) * mul;
      if ((buf[i] & 0x80) === 0) return { length: val, bytes };
      mul *= 128;
    }
    return { length: -1, bytes: 0 };
  }

  _handlePacket(pkt) {
    const type = (pkt[0] >> 4) & 0x0f;

    switch (type) {
      case CONNACK:
        this.dispatchEvent(new CustomEvent('_connack', {
          detail: { returnCode: pkt[3] },
        }));
        break;

      case PUBLISH: {
        const rl = this._decRemLen(pkt, 1);
        const off = 1 + rl.bytes;
        const topicLen = (pkt[off] << 8) | pkt[off + 1];
        const topic = decoder.decode(pkt.slice(off + 2, off + 2 + topicLen));
        const payload = decoder.decode(pkt.slice(off + 2 + topicLen));
        this.dispatchEvent(new CustomEvent('message', {
          detail: { topic, payload },
        }));
        break;
      }

      case SUBACK:
      case PINGRESP:
        break; // acknowledged
    }
  }
}
