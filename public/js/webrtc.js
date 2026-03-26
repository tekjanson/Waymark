/* ============================================================
   webrtc.js — Peer-to-peer communication for Waymark

   Provides the WaymarkConnect class for real-time messaging
   between users viewing the same spreadsheet.

   Same-browser:  BroadcastChannel for instant messaging (no network)
   Cross-device:  WebRTC DataChannel with Sheets-based signaling
   ============================================================ */

/* ---------- Constants ---------- */

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Column indices in the header row used for signaling (far beyond template data) */
const SIG_COL_A = 20;
const SIG_COL_B = 21;

/** How often to poll Sheets for remote signaling data (ms) */
const SIG_POLL_INTERVAL = 2500;

/** Maximum age for a signaling offer to be considered valid (ms) */
const SIG_OFFER_TTL = 60000;

/** ICE gathering timeout (ms) */
const ICE_TIMEOUT = 3000;

/* ---------- WaymarkConnect ---------- */

/**
 * Real-time peer-to-peer messaging channel for a specific spreadsheet.
 *
 * Usage:
 *   const conn = new WaymarkConnect(sheetId, { displayName, signal, onMessage, ... });
 *   conn.start();
 *   conn.send('Hello!');
 *   conn.destroy();
 *
 * @param {string} sheetId — spreadsheet ID this channel is bound to
 * @param {Object} opts
 * @param {string}   opts.displayName — current user's display name
 * @param {Object}   [opts.signal]    — Sheets signaling callbacks (omit for local-only)
 * @param {() => Promise<string[]>} opts.signal.readHeader  — read header row cells
 * @param {(col: number, val: string) => Promise<void>} opts.signal.writeCell — write cell in header row
 * @param {(msg: Object) => void}  opts.onMessage       — called on incoming message
 * @param {(peers: Map) => void}   opts.onPeersChanged  — called when peer list changes
 * @param {(status: string) => void} opts.onStatusChanged — 'listening' | 'connected' | 'disconnected'
 */
export class WaymarkConnect {
  constructor(sheetId, opts = {}) {
    this.sheetId = sheetId;
    this.peerId = crypto.randomUUID().slice(0, 8);
    this.displayName = opts.displayName || 'Anonymous';
    this.signal = opts.signal || null;
    this.onMessage = opts.onMessage || (() => {});
    this.onPeersChanged = opts.onPeersChanged || (() => {});
    this.onStatusChanged = opts.onStatusChanged || (() => {});

    this._bc = null;
    this._pc = null;
    this._dc = null;
    this._peers = new Map();
    this._sigPollTimer = null;
    this._isInitiator = false;
    this._destroyed = false;
  }

  /* ---------- Public API ---------- */

  /** Begin listening for peers and optionally start remote signaling. */
  start() {
    this._bc = new BroadcastChannel(`waymark-connect-${this.sheetId}`);
    this._bc.onmessage = (e) => this._handleBroadcast(e.data);

    this._bc.postMessage({
      type: 'announce',
      peerId: this.peerId,
      name: this.displayName,
    });

    if (this.signal) {
      this._startSignaling();
    }

    this.onStatusChanged('listening');
  }

  /**
   * Send a chat message to all connected peers.
   * @param {string} text — message text
   * @returns {Object} the message object (for local display)
   */
  send(text) {
    const msg = {
      type: 'message',
      peerId: this.peerId,
      name: this.displayName,
      text,
      ts: Date.now(),
    };

    if (this._bc) this._bc.postMessage(msg);
    if (this._dc && this._dc.readyState === 'open') {
      this._dc.send(JSON.stringify(msg));
    }

    return msg;
  }

  /** Tear down all connections and listeners. */
  destroy() {
    this._destroyed = true;

    if (this._bc) {
      this._bc.postMessage({ type: 'leave', peerId: this.peerId });
      this._bc.close();
      this._bc = null;
    }

    if (this._sigPollTimer) {
      clearInterval(this._sigPollTimer);
      this._sigPollTimer = null;
    }

    if (this._dc) { this._dc.close(); this._dc = null; }
    if (this._pc) { this._pc.close(); this._pc = null; }

    this._cleanupSignaling();
    this._peers.clear();
    this.onStatusChanged('disconnected');
  }

  /* ---------- BroadcastChannel (same-origin) ---------- */

  /** @param {Object} data */
  _handleBroadcast(data) {
    if (this._destroyed || data.peerId === this.peerId) return;

    switch (data.type) {
      case 'announce':
        this._peers.set(data.peerId, { name: data.name, channel: 'local', lastSeen: Date.now() });
        this._bc.postMessage({ type: 'welcome', peerId: this.peerId, name: this.displayName, to: data.peerId });
        this.onPeersChanged(new Map(this._peers));
        this.onStatusChanged('connected');
        break;

      case 'welcome':
        if (data.to !== this.peerId) return;
        this._peers.set(data.peerId, { name: data.name, channel: 'local', lastSeen: Date.now() });
        this.onPeersChanged(new Map(this._peers));
        this.onStatusChanged('connected');
        break;

      case 'message':
        this.onMessage({ peerId: data.peerId, name: data.name, text: data.text, ts: data.ts, channel: 'local' });
        break;

      case 'leave':
        this._peers.delete(data.peerId);
        this.onPeersChanged(new Map(this._peers));
        if (this._peers.size === 0) this.onStatusChanged('listening');
        break;
    }
  }

  /* ---------- WebRTC Signaling (cross-device via Sheets) ---------- */

  async _startSignaling() {
    try {
      const header = await this.signal.readHeader();
      const existingA = _parseJSON(header[SIG_COL_A]);

      if (existingA && existingA.peerId !== this.peerId && Date.now() - existingA.ts < SIG_OFFER_TTL) {
        this._isInitiator = false;
        await this._createAnswer(existingA);
      } else {
        this._isInitiator = true;
        await this._createOffer();
      }

      this._sigPollTimer = setInterval(() => this._pollSignaling(), SIG_POLL_INTERVAL);
    } catch (err) {
      // Signaling not available — local-only mode still works
    }
  }

  async _createOffer() {
    this._pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this._setupPeerConnection();

    this._dc = this._pc.createDataChannel('waymark-chat');
    this._setupDataChannel(this._dc);

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);
    await this._waitForIce();

    await this.signal.writeCell(SIG_COL_A, JSON.stringify({
      peerId: this.peerId,
      name: this.displayName,
      sdp: this._pc.localDescription.sdp,
      ts: Date.now(),
    }));
  }

  async _createAnswer(offerData) {
    this._pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this._setupPeerConnection();

    this._pc.ondatachannel = (e) => {
      this._dc = e.channel;
      this._setupDataChannel(this._dc);
    };

    await this._pc.setRemoteDescription({ type: 'offer', sdp: offerData.sdp });
    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    await this._waitForIce();

    await this.signal.writeCell(SIG_COL_B, JSON.stringify({
      peerId: this.peerId,
      name: this.displayName,
      sdp: this._pc.localDescription.sdp,
      ts: Date.now(),
    }));
  }

  async _pollSignaling() {
    if (this._destroyed) return;
    try {
      const header = await this.signal.readHeader();

      if (this._isInitiator && !this._pc?.remoteDescription) {
        const answerData = _parseJSON(header[SIG_COL_B]);
        if (answerData && answerData.peerId !== this.peerId) {
          await this._pc.setRemoteDescription({ type: 'answer', sdp: answerData.sdp });
          clearInterval(this._sigPollTimer);
          this._sigPollTimer = null;
        }
      }
    } catch { /* retry on next poll */ }
  }

  _setupPeerConnection() {
    this._pc.oniceconnectionstatechange = () => {
      if (this._destroyed) return;
      const state = this._pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        this.onStatusChanged('connected');
        if (this._sigPollTimer) { clearInterval(this._sigPollTimer); this._sigPollTimer = null; }
        this._cleanupSignaling();
      } else if (state === 'disconnected' || state === 'failed') {
        // Remove RTC peers
        for (const [id, peer] of this._peers) {
          if (peer.channel === 'rtc') this._peers.delete(id);
        }
        this.onPeersChanged(new Map(this._peers));
        if (this._peers.size === 0) this.onStatusChanged('listening');
      }
    };
  }

  _setupDataChannel(dc) {
    dc.onopen = () => {
      dc.send(JSON.stringify({ type: 'announce', peerId: this.peerId, name: this.displayName }));
    };

    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'announce') {
          this._peers.set(msg.peerId, { name: msg.name, channel: 'rtc', lastSeen: Date.now() });
          this.onPeersChanged(new Map(this._peers));
          this.onStatusChanged('connected');
        } else if (msg.type === 'message') {
          if (!this._peers.has(msg.peerId)) {
            this._peers.set(msg.peerId, { name: msg.name, channel: 'rtc', lastSeen: Date.now() });
            this.onPeersChanged(new Map(this._peers));
          }
          this.onMessage({ peerId: msg.peerId, name: msg.name, text: msg.text, ts: msg.ts, channel: 'rtc' });
        }
      } catch { /* ignore malformed */ }
    };

    dc.onclose = () => {
      for (const [id, peer] of this._peers) {
        if (peer.channel === 'rtc') this._peers.delete(id);
      }
      this.onPeersChanged(new Map(this._peers));
    };
  }

  /** Wait for ICE gathering to complete (or timeout). */
  _waitForIce() {
    return new Promise((resolve) => {
      if (this._pc.iceGatheringState === 'complete') { resolve(); return; }
      const timer = setTimeout(resolve, ICE_TIMEOUT);
      this._pc.onicegatheringstatechange = () => {
        if (this._pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }

  /** Best-effort cleanup of signaling cells after connection. */
  async _cleanupSignaling() {
    if (!this.signal) return;
    try {
      const col = this._isInitiator ? SIG_COL_A : SIG_COL_B;
      await this.signal.writeCell(col, '');
    } catch { /* best-effort */ }
  }
}

/* ---------- Helpers ---------- */

function _parseJSON(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
