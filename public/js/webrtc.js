/* ============================================================
   webrtc.js — Peer-to-peer communication for Waymark

   Provides the WaymarkConnect class for real-time messaging
   and audio/video calling between users viewing the same sheet.

   Same-browser:  BroadcastChannel for instant messaging (no network)
   Cross-device:  WebRTC DataChannel + MediaStream with Sheets signaling
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

/** Maximum age for a signaling offer/answer to be considered valid (ms) */
const SIG_OFFER_TTL = 30000;

/** ICE gathering timeout (ms) */
const ICE_TIMEOUT = 4000;

/** How many times to retry signaling after RTC failure before giving up */
const MAX_RTC_RETRIES = 3;

/* ---------- WaymarkConnect ---------- */

/**
 * Real-time peer-to-peer messaging + calling channel for a specific spreadsheet.
 *
 * @param {string} sheetId — spreadsheet ID this channel is bound to
 * @param {Object} opts
 * @param {string}   opts.displayName
 * @param {Object}   [opts.signal]         — Sheets signaling callbacks
 * @param {(msg: Object) => void}  opts.onMessage
 * @param {(peers: Map) => void}   opts.onPeersChanged
 * @param {(status: string) => void} opts.onStatusChanged — 'listening' | 'connected' | 'disconnected'
 * @param {(stream: MediaStream, peerId: string) => void} [opts.onRemoteStream] — remote media
 * @param {(peerId: string) => void} [opts.onCallEnded] — remote hung up
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
    this._sigPollTimer = null;
    this._isInitiator = false;
    this._destroyed = false;
    this._rtcRetries = 0;
    this._localStream = null;
    this._inCall = false;

    // Clean up signaling on page unload so stale data doesn't block reconnection
    this._onBeforeUnload = () => this._clearAllSignaling();
    window.addEventListener('beforeunload', this._onBeforeUnload);
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
   * @param {string} text
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

  /**
   * Start an audio/video call with the connected peer.
   * @param {Object} [constraints] — getUserMedia constraints
   * @param {boolean} [constraints.audio=true]
   * @param {boolean} [constraints.video=true]
   * @returns {Promise<MediaStream>} the local stream (for self-view)
   */
  async startCall(constraints = { audio: true, video: true }) {
    if (!this._pc || this._destroyed) throw new Error('Not connected');

    this._localStream = await navigator.mediaDevices.getUserMedia(constraints);
    for (const track of this._localStream.getTracks()) {
      this._pc.addTrack(track, this._localStream);
    }
    this._inCall = true;

    // Notify peers via DataChannel
    if (this._dc && this._dc.readyState === 'open') {
      this._dc.send(JSON.stringify({ type: 'call-start', peerId: this.peerId, name: this.displayName }));
    }
    // Notify local BroadcastChannel peers
    if (this._bc) {
      this._bc.postMessage({ type: 'call-start', peerId: this.peerId, name: this.displayName });
    }

    // If we're the initiator, we need to renegotiate so our tracks reach the peer
    if (this._isInitiator && this._pc.remoteDescription) {
      const offer = await this._pc.createOffer();
      await this._pc.setLocalDescription(offer);
      await this._waitForIce();
      // Send renegotiation offer via DataChannel
      if (this._dc && this._dc.readyState === 'open') {
        this._dc.send(JSON.stringify({
          type: 'renegotiate-offer',
          peerId: this.peerId,
          sdp: this._pc.localDescription.sdp,
        }));
      }
    }

    return this._localStream;
  }

  /** End an active call, stopping all local media tracks. */
  endCall() {
    if (this._localStream) {
      for (const track of this._localStream.getTracks()) track.stop();
      this._localStream = null;
    }
    // Remove senders from peer connection
    if (this._pc) {
      for (const sender of this._pc.getSenders()) {
        if (sender.track) this._pc.removeTrack(sender);
      }
    }
    this._inCall = false;

    // Notify peers
    if (this._dc && this._dc.readyState === 'open') {
      this._dc.send(JSON.stringify({ type: 'call-end', peerId: this.peerId }));
    }
    if (this._bc) {
      this._bc.postMessage({ type: 'call-end', peerId: this.peerId });
    }
  }

  /** Is there an active call? */
  get inCall() { return this._inCall; }

  /** Get the local media stream (if calling). */
  get localStream() { return this._localStream; }

  /** Tear down all connections and listeners. */
  destroy() {
    this._destroyed = true;
    window.removeEventListener('beforeunload', this._onBeforeUnload);

    if (this._inCall) this.endCall();

    if (this._bc) {
      this._bc.postMessage({ type: 'leave', peerId: this.peerId });
      this._bc.close();
      this._bc = null;
    }

    if (this._sigPollTimer) {
      clearInterval(this._sigPollTimer);
      this._sigPollTimer = null;
    }

    this._teardownRTC();
    this._clearAllSignaling();
    this._peers.clear();
    this.onStatusChanged('disconnected');
  }

  /* ---------- Internal: RTC lifecycle ---------- */

  _teardownRTC() {
    if (this._dc) { try { this._dc.close(); } catch {} this._dc = null; }
    if (this._pc) { try { this._pc.close(); } catch {} this._pc = null; }
  }

  /* ---------- BroadcastChannel (same-origin) ---------- */

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

      case 'call-start':
        // For BroadcastChannel (same browser), media sharing isn't meaningful
        // but we track that the peer started a call
        break;

      case 'call-end':
        this.onCallEnded(data.peerId);
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
      // Clear any stale data from a previous session by this peer
      await this._clearAllSignaling();

      const header = await this.signal.readHeader();
      const existingA = _parseJSON(header[SIG_COL_A]);

      // Only answer a FRESH offer from a DIFFERENT peer
      if (existingA && existingA.peerId !== this.peerId && Date.now() - existingA.ts < SIG_OFFER_TTL) {
        this._isInitiator = false;
        await this._createAnswer(existingA);
      } else {
        // Overwrite any stale/expired offer
        this._isInitiator = true;
        await this._createOffer();
      }

      this._sigPollTimer = setInterval(() => this._pollSignaling(), SIG_POLL_INTERVAL);
    } catch {
      // Signaling not available — local-only mode still works
    }
  }

  async _createOffer() {
    this._teardownRTC();
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
    this._teardownRTC();
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

      if (this._isInitiator) {
        // Initiator waits for an answer
        if (!this._pc?.remoteDescription) {
          const answerData = _parseJSON(header[SIG_COL_B]);
          if (answerData && answerData.peerId !== this.peerId && Date.now() - answerData.ts < SIG_OFFER_TTL) {
            await this._pc.setRemoteDescription({ type: 'answer', sdp: answerData.sdp });
          }
        }
      } else {
        // Non-initiator: if the offer we answered has been replaced with a new one
        // (e.g. the initiator refreshed), re-answer the new offer
        const offerData = _parseJSON(header[SIG_COL_A]);
        if (offerData && offerData.peerId !== this.peerId && !this._pc?.remoteDescription) {
          // Our original answer might not have been picked up — re-answer
        }
      }
    } catch { /* retry on next poll */ }
  }

  _setupPeerConnection() {
    // Handle remote media streams (for calls)
    this._pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        this.onRemoteStream(e.streams[0], e.track.id);
      }
    };

    this._pc.oniceconnectionstatechange = () => {
      if (this._destroyed) return;
      const state = this._pc.iceConnectionState;

      if (state === 'connected' || state === 'completed') {
        // ICE transport is up. Status update happens when DataChannel opens
        // and peer announces — NOT here. (Fixes "connected but 0 peers" bug.)
        if (this._sigPollTimer) { clearInterval(this._sigPollTimer); this._sigPollTimer = null; }
        this._clearAllSignaling();
        this._rtcRetries = 0;
      } else if (state === 'disconnected' || state === 'failed') {
        // Remove RTC peers
        for (const [id, peer] of this._peers) {
          if (peer.channel === 'rtc') this._peers.delete(id);
        }
        this.onPeersChanged(new Map(this._peers));
        if (this._peers.size === 0) this.onStatusChanged('listening');

        // Auto-retry signaling (tear down old RTC, start fresh)
        if (this.signal && this._rtcRetries < MAX_RTC_RETRIES) {
          this._rtcRetries++;
          this._teardownRTC();
          this._startSignaling();
        }
      }
    };

    // Handle renegotiation (needed for adding media tracks mid-session)
    this._pc.onnegotiationneeded = async () => {
      if (this._destroyed || !this._isInitiator) return;
      // Only renegotiate once the initial connection is established
      if (!this._pc.remoteDescription) return;
      try {
        const offer = await this._pc.createOffer();
        await this._pc.setLocalDescription(offer);
        await this._waitForIce();
        if (this._dc && this._dc.readyState === 'open') {
          this._dc.send(JSON.stringify({
            type: 'renegotiate-offer',
            peerId: this.peerId,
            sdp: this._pc.localDescription.sdp,
          }));
        }
      } catch { /* renegotiation failed — non-fatal */ }
    };
  }

  _setupDataChannel(dc) {
    dc.onopen = () => {
      dc.send(JSON.stringify({ type: 'announce', peerId: this.peerId, name: this.displayName }));
    };

    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'announce':
            this._peers.set(msg.peerId, { name: msg.name, channel: 'rtc', lastSeen: Date.now() });
            this.onPeersChanged(new Map(this._peers));
            this.onStatusChanged('connected');
            break;

          case 'message':
            if (!this._peers.has(msg.peerId)) {
              this._peers.set(msg.peerId, { name: msg.name, channel: 'rtc', lastSeen: Date.now() });
              this.onPeersChanged(new Map(this._peers));
            }
            this.onMessage({ peerId: msg.peerId, name: msg.name, text: msg.text, ts: msg.ts, channel: 'rtc' });
            break;

          case 'call-end':
            this.onCallEnded(msg.peerId);
            break;

          case 'renegotiate-offer':
            this._handleRenegotiateOffer(msg);
            break;

          case 'renegotiate-answer':
            this._handleRenegotiateAnswer(msg);
            break;
        }
      } catch { /* ignore malformed */ }
    };

    dc.onclose = () => {
      for (const [id, peer] of this._peers) {
        if (peer.channel === 'rtc') this._peers.delete(id);
      }
      this.onPeersChanged(new Map(this._peers));
      if (this._peers.size === 0) this.onStatusChanged('listening');
    };
  }

  /* ---------- Renegotiation (for adding media mid-call) ---------- */

  async _handleRenegotiateOffer(msg) {
    if (!this._pc || this._destroyed) return;
    try {
      await this._pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await this._pc.createAnswer();
      await this._pc.setLocalDescription(answer);
      await this._waitForIce();
      if (this._dc && this._dc.readyState === 'open') {
        this._dc.send(JSON.stringify({
          type: 'renegotiate-answer',
          peerId: this.peerId,
          sdp: this._pc.localDescription.sdp,
        }));
      }
    } catch { /* renegotiation failed — non-fatal */ }
  }

  async _handleRenegotiateAnswer(msg) {
    if (!this._pc || this._destroyed) return;
    try {
      await this._pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } catch { /* non-fatal */ }
  }

  /* ---------- ICE helpers ---------- */

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

  /** Clear BOTH signaling cells (best-effort). */
  async _clearAllSignaling() {
    if (!this.signal) return;
    try {
      await Promise.all([
        this.signal.writeCell(SIG_COL_A, ''),
        this.signal.writeCell(SIG_COL_B, ''),
      ]);
    } catch { /* best-effort */ }
  }
}

/* ---------- Helpers ---------- */

function _parseJSON(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
