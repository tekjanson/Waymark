/* ============================================================
   arcade/net.js — Game networking layer (dual DataChannel transport)
   ============================================================ */

/* ---------- Message Types ---------- */

export const MSG = {
  INPUT:       0x01,
  INPUT_ACK:   0x02,
  STATE_SNAP:  0x03,
  GAME_START:  0x04,
  GAME_END:    0x05,
  PING:        0x06,
  PONG:        0x07,
  MOVE:        0x10,
  MOVE_ACK:    0x11,
  INVITE:      0x20,
  ACCEPT:      0x21,
  DECLINE:     0x22,
};

/* ---------- Binary Encode / Decode ---------- */

/**
 * Encode an input packet with redundant un-acked history.
 * Format: [type:1][frame:4][count:1][inputs:count]
 * @param {number} frame — current frame
 * @param {Uint8Array} inputHistory — indexed by frame
 * @param {number} lastAckedFrame — last remotely acked frame
 * @returns {ArrayBuffer}
 */
export function encodeInput(frame, inputHistory, lastAckedFrame) {
  const unacked = frame - lastAckedFrame;
  const count = Math.min(Math.max(unacked, 1), 30);
  const buf = new ArrayBuffer(6 + count);
  const view = new DataView(buf);
  view.setUint8(0, MSG.INPUT);
  view.setUint32(1, frame, true);
  view.setUint8(5, count);
  for (let i = 0; i < count; i++) {
    const f = frame - count + 1 + i;
    view.setUint8(6 + i, f >= 0 && f < inputHistory.length ? inputHistory[f] : 0);
  }
  return buf;
}

/**
 * Decode an input packet.
 * @param {DataView} view
 * @returns {{ frame: number, count: number, inputs: number[] }}
 */
export function decodeInput(view) {
  const frame = view.getUint32(1, true);
  const count = view.getUint8(5);
  const inputs = [];
  for (let i = 0; i < count; i++) {
    inputs.push(view.getUint8(6 + i));
  }
  return { frame, count, inputs };
}

/**
 * Encode an input acknowledgement.
 * Format: [type:1][frame:4]
 * @param {number} frame — last received frame
 * @returns {ArrayBuffer}
 */
export function encodeInputAck(frame) {
  const buf = new ArrayBuffer(5);
  const view = new DataView(buf);
  view.setUint8(0, MSG.INPUT_ACK);
  view.setUint32(1, frame, true);
  return buf;
}

/**
 * Encode a turn-based move.
 * Format: [type:1][seq:2][...payload]
 * @param {number} seq — sequence number
 * @param {Uint8Array} payload — game-specific move data
 * @returns {ArrayBuffer}
 */
export function encodeMove(seq, payload) {
  const buf = new ArrayBuffer(3 + payload.length);
  const view = new DataView(buf);
  view.setUint8(0, MSG.MOVE);
  view.setUint16(1, seq, true);
  const bytes = new Uint8Array(buf);
  bytes.set(payload, 3);
  return buf;
}

/**
 * Decode a move packet.
 * @param {DataView} view
 * @param {number} byteLength
 * @returns {{ seq: number, payload: Uint8Array }}
 */
export function decodeMove(view, byteLength) {
  const seq = view.getUint16(1, true);
  const payload = new Uint8Array(view.buffer, view.byteOffset + 3, byteLength - 3);
  return { seq, payload };
}

/**
 * Encode a move acknowledgement.
 * Format: [type:1][seq:2]
 * @param {number} seq
 * @returns {ArrayBuffer}
 */
export function encodeMoveAck(seq) {
  const buf = new ArrayBuffer(3);
  const view = new DataView(buf);
  view.setUint8(0, MSG.MOVE_ACK);
  view.setUint16(1, seq, true);
  return buf;
}

/**
 * Encode a state snapshot.
 * Format: [type:1][frame:4][...data]
 * @param {number} frame
 * @param {Uint8Array} data
 * @returns {ArrayBuffer}
 */
export function encodeStateSnap(frame, data) {
  const buf = new ArrayBuffer(5 + data.length);
  const view = new DataView(buf);
  view.setUint8(0, MSG.STATE_SNAP);
  view.setUint32(1, frame, true);
  new Uint8Array(buf).set(data, 5);
  return buf;
}

/**
 * Encode a PING message.
 * Format: [type:1][timestamp:8]
 * @returns {ArrayBuffer}
 */
export function encodePing() {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint8(0, MSG.PING);
  view.setFloat64(1, performance.now(), true);
  return buf;
}

/**
 * Encode a PONG message (echo back the timestamp).
 * Format: [type:1][timestamp:8]
 * @param {number} sentTime — original ping timestamp
 * @returns {ArrayBuffer}
 */
export function encodePong(sentTime) {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint8(0, MSG.PONG);
  view.setFloat64(1, sentTime, true);
  return buf;
}

/**
 * Encode a game control message (GAME_START, GAME_END, INVITE, ACCEPT, DECLINE).
 * Format: [type:1][...json]
 * @param {number} type — message type constant
 * @param {Object} data — JSON-serialisable payload
 * @returns {ArrayBuffer}
 */
export function encodeControl(type, data) {
  const json = JSON.stringify(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);
  const buf = new ArrayBuffer(1 + bytes.length);
  new Uint8Array(buf)[0] = type;
  new Uint8Array(buf).set(bytes, 1);
  return buf;
}

/**
 * Decode any binary message. Returns { type, ...payload }.
 * @param {ArrayBuffer} buffer
 * @returns {Object}
 */
export function decodeMessage(buffer) {
  const view = new DataView(buffer);
  const type = view.getUint8(0);

  switch (type) {
    case MSG.INPUT:
      return { type, ...decodeInput(view) };

    case MSG.INPUT_ACK:
      return { type, frame: view.getUint32(1, true) };

    case MSG.STATE_SNAP: {
      const frame = view.getUint32(1, true);
      const data = new Uint8Array(buffer, 5);
      return { type, frame, data };
    }

    case MSG.PING:
    case MSG.PONG:
      return { type, timestamp: view.getFloat64(1, true) };

    case MSG.MOVE:
      return { type, ...decodeMove(view, buffer.byteLength) };

    case MSG.MOVE_ACK:
      return { type, seq: view.getUint16(1, true) };

    case MSG.GAME_START:
    case MSG.GAME_END:
    case MSG.INVITE:
    case MSG.ACCEPT:
    case MSG.DECLINE: {
      const decoder = new TextDecoder();
      const json = decoder.decode(new Uint8Array(buffer, 1));
      return { type, ...JSON.parse(json) };
    }

    default:
      return { type };
  }
}

/* ---------- ArcadeNet — Transport Layer ---------- */

/**
 * Manages dual DataChannels for game traffic on an existing RTCPeerConnection.
 */
export class ArcadeNet {
  /**
   * @param {RTCPeerConnection} pc — existing peer connection
   * @param {boolean} isInitiator — true if we created the offer (create channels)
   */
  constructor(pc, isInitiator) {
    /** @type {RTCPeerConnection} */
    this.pc = pc;
    /** @type {RTCDataChannel|null} */
    this.reliable = null;
    /** @type {RTCDataChannel|null} */
    this.fast = null;
    /** @type {function|null} */
    this.onReliableMessage = null;
    /** @type {function|null} */
    this.onFastMessage = null;
    /** @type {function|null} */
    this.onOpen = null;
    /** @type {function|null} */
    this.onClose = null;
    /** @type {number} */
    this.rtt = 100;
    /** @type {number} */
    this.jitter = 0;

    this._pingTimer = null;
    this._openCount = 0;
    this._destroyed = false;

    if (isInitiator) {
      this._createChannels();
    } else {
      this._listenForChannels();
    }
  }

  /* ---------- Channel Setup ---------- */

  _createChannels() {
    this.reliable = this.pc.createDataChannel('arcade', {
      ordered: true,
    });
    this.fast = this.pc.createDataChannel('arcade-fast', {
      ordered: false,
      maxRetransmits: 0,
    });
    this._wireChannel(this.reliable, 'reliable');
    this._wireChannel(this.fast, 'fast');
  }

  _listenForChannels() {
    const prev = this.pc.ondatachannel;
    this.pc.ondatachannel = (e) => {
      const ch = e.channel;
      if (ch.label === 'arcade') {
        this.reliable = ch;
        this._wireChannel(ch, 'reliable');
      } else if (ch.label === 'arcade-fast') {
        this.fast = ch;
        this._wireChannel(ch, 'fast');
      } else if (prev) {
        // Pass non-arcade channels to existing handler
        prev(e);
      }
    };
  }

  _wireChannel(ch, kind) {
    ch.binaryType = 'arraybuffer';
    // Reduce buffering for lower latency on the fast channel
    if (kind === 'fast' && ch.bufferedAmountLowThreshold !== undefined) {
      ch.bufferedAmountLowThreshold = 0;
    }
    ch.onopen = () => {
      this._openCount++;
      if (this._openCount >= 2 && this.onOpen) this.onOpen();
      if (kind === 'fast' && !this._pingTimer) {
        this._pingTimer = setInterval(() => this._sendPing(), 250);
      }
    };
    ch.onclose = () => {
      this._openCount--;
      if (this.onClose) this.onClose();
    };
    ch.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const view = new DataView(e.data);
      const type = view.getUint8(0);

      // Handle ping/pong internally
      if (type === MSG.PING) {
        const ts = view.getFloat64(1, true);
        this.sendFast(encodePong(ts));
        return;
      }
      if (type === MSG.PONG) {
        const ts = view.getFloat64(1, true);
        const sample = performance.now() - ts;
        // Exponential moving average + jitter tracking
        this.rtt = this.rtt * 0.7 + sample * 0.3;
        this.jitter = this.jitter * 0.7 + Math.abs(sample - this.rtt) * 0.3;
        return;
      }

      if (kind === 'reliable' && this.onReliableMessage) {
        this.onReliableMessage(e.data);
      } else if (kind === 'fast' && this.onFastMessage) {
        this.onFastMessage(e.data);
      }
    };
  }

  _sendPing() {
    if (this.fast && this.fast.readyState === 'open') {
      this.fast.send(encodePing());
    }
  }

  /* ---------- Public Send Methods ---------- */

  /**
   * Send on reliable channel (turn-based moves, game control).
   * @param {ArrayBuffer} buf
   */
  sendReliable(buf) {
    if (this.reliable && this.reliable.readyState === 'open') {
      this.reliable.send(buf);
    }
  }

  /**
   * Send on unreliable fast channel (real-time input/state).
   * Drops packets if the send buffer is backing up (prevents stale data).
   * @param {ArrayBuffer} buf
   */
  sendFast(buf) {
    if (this.fast && this.fast.readyState === 'open') {
      // Drop if buffer already has >16KB queued — data would arrive stale
      if (this.fast.bufferedAmount > 16384) return;
      this.fast.send(buf);
    }
  }

  /**
   * Check if both channels are open.
   * @returns {boolean}
   */
  get isOpen() {
    return this.reliable?.readyState === 'open' && this.fast?.readyState === 'open';
  }

  /**
   * Process incoming messages from network into the engine context.
   * Delegates to the appropriate game handler.
   * @param {Object} ctx — engine context
   */
  processIncoming(ctx) {
    // No-op: messages are handled via onReliableMessage/onFastMessage callbacks
    // which are wired up by the game scene when it starts.
  }

  /**
   * Tear down channels and timers.
   */
  destroy() {
    this._destroyed = true;
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    try { if (this.reliable) this.reliable.close(); } catch { /* ignore */ }
    try { if (this.fast) this.fast.close(); } catch { /* ignore */ }
    this.reliable = null;
    this.fast = null;
  }
}

/**
 * Create an ArcadeNet instance from a WaymarkConnect's internal RTC entry.
 * @param {Object} waymarkConnect — WaymarkConnect instance
 * @param {string} remotePeerId — the peer to create game channels with
 * @returns {ArcadeNet|null}
 */
export function createArcadeNet(waymarkConnect, remotePeerId) {
  const entry = waymarkConnect._rtc.get(remotePeerId);
  if (!entry || !entry.pc) return null;

  // Initiator = whichever peer has the lower peerId (same logic as WebRTC offer/answer)
  const isInitiator = waymarkConnect.peerId < remotePeerId;
  return new ArcadeNet(entry.pc, isInitiator);
}
