/* ============================================================
   webrtc.js — Peer-to-peer communication for Waymark

   Row-based signaling: each peer claims a block of 5 rows in
   column 20 of the spreadsheet for handshake data.

   Same-browser:  BroadcastChannel (instant, no network)
   Cross-device:  WebRTC DataChannel + MediaStream via Sheets signaling
   ============================================================ */

/* ---------- Constants ---------- */

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const SIG_COL      = 20;   // Column for all signaling data
const BLOCK_SIZE   = 5;    // Rows per peer
const BLOCK_START  = 1;    // First block at row 1 (row 0 = sheet header)
const MAX_PEERS    = 8;    // Up to 8 simultaneous peers (40 rows)

// Row offsets within a peer's block
const OFF_PRESENCE = 0;    // { peerId, name, ts }
const OFF_OFFER    = 1;    // { peerId, target, sdp, ts }
const OFF_ANSWER   = 2;    // { peerId, sdp, ts } — written by remote peer
const OFF_ICE      = 3;    // Reserved for trickle ICE
const OFF_CONTROL  = 4;    // Reserved for future call control

const POLL_MS      = 1500; // Signaling poll interval
const HEART_MS     = 8000; // Presence heartbeat interval
const ALIVE_TTL    = 25000;// Peer considered gone after 25s no heartbeat
const ICE_WAIT     = 2000; // ICE gathering timeout
const MAX_RETRIES  = 3;

/* ---------- WaymarkConnect ---------- */

/**
 * Real-time P2P messaging + calling channel for a specific spreadsheet.
 *
 * Signal interface (provided by checklist.js):
 *   signal.readAll()             → Promise<string[][]>  (all sheet values)
 *   signal.writeCell(row, col, v) → Promise<void>
 *
 * @param {string} sheetId
 * @param {Object} opts
 * @param {string}   opts.displayName
 * @param {Object}   [opts.signal]
 * @param {(msg: Object) => void}    opts.onMessage
 * @param {(peers: Map) => void}     opts.onPeersChanged
 * @param {(status: string) => void} opts.onStatusChanged — 'listening' | 'connected' | 'disconnected'
 * @param {(stream: MediaStream, id: string) => void} [opts.onRemoteStream]
 * @param {(peerId: string) => void} [opts.onCallEnded]
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
    this.onRemoteStream = opts.onRemoteStream || (() => {});
    this.onCallEnded = opts.onCallEnded || (() => {});

    this._bc = null;
    this._pc = null;
    this._dc = null;
    this._peers = new Map();
    this._destroyed = false;

    // Signaling state
    this._block = -1;           // Our block start row (-1 = not claimed)
    this._pollTimer = null;
    this._heartTimer = null;
    this._polling = false;      // Guard against overlapping polls
    this._isInitiator = false;
    this._retries = 0;
    this._rtcPeerId = null;     // Remote peer we're RTC-connected to

    // Call state
    this._localStream = null;
    this._inCall = false;

    this._onUnload = () => {
      // Best-effort: clear presence so peers detect our departure faster
      if (this.signal && this._block >= 0) {
        this.signal.writeCell(this._block + OFF_PRESENCE, SIG_COL, '');
      }
    };
    window.addEventListener('beforeunload', this._onUnload);
  }

  /* ---------- Public API ---------- */

  /** Begin listening for peers and optionally start remote signaling. */
  start() {
    this._bc = new BroadcastChannel(`waymark-connect-${this.sheetId}`);
    this._bc.onmessage = (e) => this._onBC(e.data);
    this._bc.postMessage({ type: 'announce', peerId: this.peerId, name: this.displayName });

    if (this.signal) this._join();
    this.onStatusChanged('listening');
  }

  /**
   * Send a chat message to all connected peers.
   * @param {string} text
   * @returns {Object} the sent message (for local display)
   */
  send(text) {
    const msg = { type: 'message', peerId: this.peerId, name: this.displayName, text, ts: Date.now() };
    if (this._bc) this._bc.postMessage(msg);
    if (this._dc?.readyState === 'open') this._dc.send(JSON.stringify(msg));
    return msg;
  }

  /**
   * Start an audio/video call with the connected peer.
   * @param {Object} [constraints]
   * @returns {Promise<MediaStream>} the local stream (for self-view)
   */
  async startCall(constraints = { audio: true, video: true }) {
    if (!this._pc || this._destroyed) throw new Error('Not connected');
    this._localStream = await navigator.mediaDevices.getUserMedia(constraints);
    for (const t of this._localStream.getTracks()) this._pc.addTrack(t, this._localStream);
    this._inCall = true;
    // onnegotiationneeded fires automatically → renegotiates via DataChannel
    const n = { type: 'call-start', peerId: this.peerId, name: this.displayName };
    if (this._dc?.readyState === 'open') this._dc.send(JSON.stringify(n));
    if (this._bc) this._bc.postMessage(n);
    return this._localStream;
  }

  /** End an active call, stopping all local media tracks. */
  endCall() {
    if (this._localStream) {
      for (const t of this._localStream.getTracks()) t.stop();
      this._localStream = null;
    }
    if (this._pc) {
      for (const s of this._pc.getSenders()) { if (s.track) this._pc.removeTrack(s); }
    }
    this._inCall = false;
    const n = { type: 'call-end', peerId: this.peerId };
    if (this._dc?.readyState === 'open') this._dc.send(JSON.stringify(n));
    if (this._bc) this._bc.postMessage(n);
  }

  /** Is there an active call? */
  get inCall() { return this._inCall; }

  /** Get the local media stream (if calling). */
  get localStream() { return this._localStream; }

  /** Tear down all connections and listeners. */
  destroy() {
    this._destroyed = true;
    window.removeEventListener('beforeunload', this._onUnload);
    if (this._inCall) this.endCall();
    if (this._bc) {
      this._bc.postMessage({ type: 'leave', peerId: this.peerId });
      this._bc.close();
      this._bc = null;
    }
    clearInterval(this._pollTimer);
    clearInterval(this._heartTimer);
    this._pollTimer = this._heartTimer = null;
    this._closeRTC();
    this._clearBlock();
    this._peers.clear();
    this.onStatusChanged('disconnected');
  }

  /* ---------- RTC teardown ---------- */

  _closeRTC() {
    if (this._dc) { try { this._dc.close(); } catch {} this._dc = null; }
    if (this._pc) { try { this._pc.close(); } catch {} this._pc = null; }
    this._rtcPeerId = null;
  }

  /* ---------- BroadcastChannel (same-origin) ---------- */

  _onBC(d) {
    if (this._destroyed || d.peerId === this.peerId) return;
    switch (d.type) {
      case 'announce':
        this._peers.set(d.peerId, { name: d.name, channel: 'local', lastSeen: Date.now() });
        this._bc.postMessage({ type: 'welcome', peerId: this.peerId, name: this.displayName, to: d.peerId });
        this.onPeersChanged(new Map(this._peers));
        this.onStatusChanged('connected');
        break;
      case 'welcome':
        if (d.to !== this.peerId) return;
        this._peers.set(d.peerId, { name: d.name, channel: 'local', lastSeen: Date.now() });
        this.onPeersChanged(new Map(this._peers));
        this.onStatusChanged('connected');
        break;
      case 'message':
        this.onMessage({ peerId: d.peerId, name: d.name, text: d.text, ts: d.ts, channel: 'local' });
        break;
      case 'call-start': break; // BC can't carry media — informational only
      case 'call-end':
        this.onCallEnded(d.peerId);
        break;
      case 'leave':
        this._peers.delete(d.peerId);
        this.onPeersChanged(new Map(this._peers));
        if (this._peers.size === 0) this.onStatusChanged('listening');
        break;
    }
  }

  /* ---------- Row-based Signaling ---------- */

  /** Claim a block and start polling + presence heartbeat. */
  async _join() {
    try {
      const vals = await this.signal.readAll();
      this._block = this._claimBlock(vals);
      if (this._block < 0) return; // all slots full
      await this._heartbeat();
      this._pollTimer  = setInterval(() => this._poll(), POLL_MS);
      this._heartTimer = setInterval(() => this._heartbeat(), HEART_MS);
    } catch { /* signaling unavailable — local-only */ }
  }

  /** Find first free block (empty or expired presence). */
  _claimBlock(vals) {
    for (let i = 0; i < MAX_PEERS; i++) {
      const row = BLOCK_START + i * BLOCK_SIZE;
      const p = _json(vals[row]?.[SIG_COL]);
      if (!p || Date.now() - p.ts > ALIVE_TTL) return row;
    }
    return -1;
  }

  /** Write/refresh presence in our block. */
  async _heartbeat() {
    if (this._destroyed || this._block < 0) return;
    try {
      await this.signal.writeCell(this._block + OFF_PRESENCE, SIG_COL,
        JSON.stringify({ peerId: this.peerId, name: this.displayName, ts: Date.now() }));
    } catch {}
  }

  /** Poll for remote peers and drive the signaling state machine. */
  async _poll() {
    if (this._destroyed || this._block < 0 || this._polling) return;
    this._polling = true;
    try {
      const vals = await this.signal.readAll();
      const alive = this._livePeers(vals);

      // Sync remote peer list
      this._syncPeers(alive);

      // Already RTC-connected — just verify peer is still alive
      if (this._dc?.readyState === 'open' && this._rtcPeerId) {
        if (!alive.some(p => p.peerId === this._rtcPeerId)) {
          this._closeRTC();
          if (this._peers.size === 0) this.onStatusChanged('listening');
        }
        return;
      }

      // Not connected — try to connect to first available peer
      const target = alive[0];
      if (target) await this._negotiate(target, vals);
    } catch {} finally {
      this._polling = false;
    }
  }

  /** Parse all live (non-expired) peer blocks except our own. */
  _livePeers(vals) {
    const out = [];
    for (let i = 0; i < MAX_PEERS; i++) {
      const row = BLOCK_START + i * BLOCK_SIZE;
      if (row === this._block) continue;
      const p = _json(vals[row]?.[SIG_COL]);
      if (p && Date.now() - p.ts < ALIVE_TTL) {
        out.push({ ...p, block: row });
      }
    }
    return out;
  }

  /** Update _peers map with remote signaling peers. */
  _syncPeers(alive) {
    let changed = false;
    const aliveIds = new Set(alive.map(p => p.peerId));

    for (const p of alive) {
      if (!this._peers.has(p.peerId)) {
        this._peers.set(p.peerId, { name: p.name, channel: 'sig', lastSeen: Date.now() });
        changed = true;
      }
    }
    for (const [id, peer] of this._peers) {
      if ((peer.channel === 'sig' || peer.channel === 'rtc') && !aliveIds.has(id)) {
        this._peers.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.onPeersChanged(new Map(this._peers));
      if (this._peers.size === 0) this.onStatusChanged('listening');
    }
  }

  /** Drive the offer/answer state machine for one target peer. */
  async _negotiate(target, vals) {
    // Tie-break: lower peerId is the initiator (deterministic, avoids dual-offer)
    const weInit = this.peerId < target.peerId;

    if (weInit) {
      const myOffer = _json(vals[this._block + OFF_OFFER]?.[SIG_COL]);
      if (!myOffer || myOffer.target !== target.peerId) {
        // Create and write a fresh offer
        await this._makeOffer(target);
      } else {
        // Check if the target wrote an answer into our ANSWER row
        const ans = _json(vals[this._block + OFF_ANSWER]?.[SIG_COL]);
        if (ans && ans.peerId === target.peerId) {
          try {
            await this._pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
            this._rtcPeerId = target.peerId;
            // Clear signaling rows now that connection is established
            await Promise.all([
              this.signal.writeCell(this._block + OFF_OFFER, SIG_COL, ''),
              this.signal.writeCell(this._block + OFF_ANSWER, SIG_COL, ''),
            ]);
          } catch { /* retry next poll */ }
        }
      }
    } else {
      // We're the answerer — look for an offer in the target's OFFER row
      const offer = _json(vals[target.block + OFF_OFFER]?.[SIG_COL]);
      if (offer && offer.target === this.peerId && !this._pc?.remoteDescription) {
        await this._makeAnswer(offer, target);
      }
    }
  }

  async _makeOffer(target) {
    this._closeRTC();
    this._isInitiator = true;
    this._pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this._wirePeerConnection();

    this._dc = this._pc.createDataChannel('waymark');
    this._wireDataChannel(this._dc);

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);
    await this._iceReady();

    await this.signal.writeCell(this._block + OFF_OFFER, SIG_COL, JSON.stringify({
      peerId: this.peerId,
      target: target.peerId,
      sdp: this._pc.localDescription.sdp,
      ts: Date.now(),
    }));
  }

  async _makeAnswer(offerData, target) {
    this._closeRTC();
    this._isInitiator = false;
    this._pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this._wirePeerConnection();

    this._pc.ondatachannel = (e) => {
      this._dc = e.channel;
      this._wireDataChannel(this._dc);
    };

    await this._pc.setRemoteDescription({ type: 'offer', sdp: offerData.sdp });
    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    await this._iceReady();

    // Write answer into the INITIATOR's answer row (their block)
    await this.signal.writeCell(target.block + OFF_ANSWER, SIG_COL, JSON.stringify({
      peerId: this.peerId,
      sdp: this._pc.localDescription.sdp,
      ts: Date.now(),
    }));
    this._rtcPeerId = target.peerId;
  }

  /* ---------- PeerConnection + DataChannel wiring ---------- */

  _wirePeerConnection() {
    this._pc.ontrack = (e) => {
      if (e.streams?.[0]) this.onRemoteStream(e.streams[0], e.track.id);
    };

    this._pc.oniceconnectionstatechange = () => {
      if (this._destroyed) return;
      const s = this._pc?.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        this._retries = 0;
      } else if (s === 'disconnected' || s === 'failed') {
        for (const [id, p] of this._peers) {
          if (p.channel === 'rtc') this._peers.delete(id);
        }
        this.onPeersChanged(new Map(this._peers));
        if (this._peers.size === 0) this.onStatusChanged('listening');

        // Auto-retry: tear down and clear our signaling rows so next poll re-negotiates
        if (this._retries < MAX_RETRIES && this._block >= 0) {
          this._retries++;
          this._closeRTC();
          try {
            this.signal.writeCell(this._block + OFF_OFFER, SIG_COL, '');
            this.signal.writeCell(this._block + OFF_ANSWER, SIG_COL, '');
          } catch {}
        }
      }
    };

    // Renegotiation (fires when media tracks are added mid-session)
    this._pc.onnegotiationneeded = async () => {
      if (this._destroyed || !this._isInitiator || !this._pc?.remoteDescription) return;
      try {
        const offer = await this._pc.createOffer();
        await this._pc.setLocalDescription(offer);
        await this._iceReady();
        if (this._dc?.readyState === 'open') {
          this._dc.send(JSON.stringify({
            type: 'renego-offer', peerId: this.peerId, sdp: this._pc.localDescription.sdp,
          }));
        }
      } catch {}
    };
  }

  _wireDataChannel(dc) {
    dc.onopen = () => {
      dc.send(JSON.stringify({ type: 'announce', peerId: this.peerId, name: this.displayName }));
    };

    dc.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        switch (m.type) {
          case 'announce':
            this._peers.set(m.peerId, { name: m.name, channel: 'rtc', lastSeen: Date.now() });
            this.onPeersChanged(new Map(this._peers));
            this.onStatusChanged('connected');
            break;
          case 'message':
            if (!this._peers.has(m.peerId)) {
              this._peers.set(m.peerId, { name: m.name, channel: 'rtc', lastSeen: Date.now() });
              this.onPeersChanged(new Map(this._peers));
            }
            this.onMessage({ peerId: m.peerId, name: m.name, text: m.text, ts: m.ts, channel: 'rtc' });
            break;
          case 'call-end':
            this.onCallEnded(m.peerId);
            break;
          case 'renego-offer':
            this._handleRenegoOffer(m);
            break;
          case 'renego-answer':
            this._handleRenegoAnswer(m);
            break;
        }
      } catch {}
    };

    dc.onclose = () => {
      for (const [id, p] of this._peers) {
        if (p.channel === 'rtc') this._peers.delete(id);
      }
      this.onPeersChanged(new Map(this._peers));
      if (this._peers.size === 0) this.onStatusChanged('listening');
    };
  }

  /* ---------- Renegotiation (via DataChannel, for adding media) ---------- */

  async _handleRenegoOffer(m) {
    if (!this._pc || this._destroyed) return;
    try {
      await this._pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      const a = await this._pc.createAnswer();
      await this._pc.setLocalDescription(a);
      await this._iceReady();
      if (this._dc?.readyState === 'open') {
        this._dc.send(JSON.stringify({
          type: 'renego-answer', peerId: this.peerId, sdp: this._pc.localDescription.sdp,
        }));
      }
    } catch {}
  }

  async _handleRenegoAnswer(m) {
    if (!this._pc || this._destroyed) return;
    try { await this._pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); } catch {}
  }

  /* ---------- ICE helpers ---------- */

  _iceReady() {
    return new Promise(resolve => {
      if (this._pc.iceGatheringState === 'complete') { resolve(); return; }
      const t = setTimeout(resolve, ICE_WAIT);
      this._pc.onicegatheringstatechange = () => {
        if (this._pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
      };
    });
  }

  /** Clear all 5 rows in our block (best-effort, called on destroy). */
  async _clearBlock() {
    if (!this.signal || this._block < 0) return;
    try {
      await Promise.all(Array.from({ length: BLOCK_SIZE }, (_, i) =>
        this.signal.writeCell(this._block + i, SIG_COL, '')));
    } catch {}
  }
}

/* ---------- Helpers ---------- */

function _json(v) {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
