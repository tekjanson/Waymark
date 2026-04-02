/* ============================================================
   webrtc.js — Multi-peer mesh networking for Waymark

   Row-based signaling: each peer claims a 5-row block in
   column 20 for presence + handshake. Peers discover each
   other continuously and establish SEPARATE WebRTC connections
   to every live peer (full mesh).

   Block layout (per peer):
     Row +0  PRESENCE  { peerId, name, ts }
     Row +1  OFFERS    { targetPeerId: { sdp, ts }, ... }
     Row +2  ANSWERS   { toPeerId: { sdp, ts }, ... }
     Row +3  (reserved)
     Row +4  (reserved)

   Each peer ONLY writes to its OWN block. Answers are written
   to the answerer's ANSWERS row (keyed by initiator peerId),
   so the initiator reads the answerer's block to find it.
   No cross-writing → no race conditions.

   Same-browser:  BroadcastChannel (instant, no network)
   Cross-device:  WebRTC DataChannel + MediaStream
   ============================================================ */

/* ---------- Constants ---------- */

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const SIG_COL     = 20;
const BLOCK_SIZE  = 5;
const BLOCK_START = 1;    // Row 0 = sheet header
const MAX_SLOTS   = 8;   // Up to 8 peers (rows 1–40)

const OFF_PRESENCE = 0;
const OFF_OFFERS   = 1;
const OFF_ANSWERS  = 2;

const POLL_MS   = 5000;  // Poll interval (5s to stay within Sheets rate limits)
const HEART_MS  = 15000; // Heartbeat interval (15s reduces write pressure)
const ALIVE_TTL = 50000; // Peer gone after 50s silence (>3× heartbeat)
const ICE_WAIT  = 2000;  // ICE gathering timeout

/* ---------- WaymarkConnect ---------- */

/**
 * Multi-peer mesh chat + calling channel for a spreadsheet.
 *
 * Signal interface (from checklist.js):
 *   signal.readAll()                → Promise<string[][]>
 *   signal.writeCell(row, col, val) → Promise<void>
 *
 * @param {string} sheetId
 * @param {Object} opts
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
    this.onCallActive = opts.onCallActive || (() => {});
    this.onArcadeMessage = opts.onArcadeMessage || null;

    this._bc = null;
    this._peers = new Map();        // peerId → { name, channel }
    this._rtc = new Map();          // peerId → { pc, dc, state }
    this._destroyed = false;

    this._block = -1;
    this._pollTimer = null;
    this._heartTimer = null;
    this._polling = false;

    // Web Audio processing state
    this._audioCtx = null;
    this._processedStream = null;   // MediaStream sent to peer connections
    this._rawStream = null;         // original getUserMedia stream
    this._micAnalyser = null;       // AnalyserNode for echo ducking
    this._duckingRAF = null;        // requestAnimationFrame ID (volume ducking)
    this._duckState = null;         // { volume, smooth, holdUntil, ... }

    this._localStream = null;
    this._inCall = false;
    this._remoteStreams = new Map(); // peerId → MediaStream (for pipeline rebuild)

    this._onUnload = () => {
      if (this.signal && this._block >= 0) {
        this.signal.writeCell(this._block + OFF_PRESENCE, SIG_COL, '');
      }
    };
    window.addEventListener('beforeunload', this._onUnload);
  }

  /* ---------- Public API ---------- */

  start() {
    if (typeof BroadcastChannel !== 'undefined') {
      this._bc = new BroadcastChannel(`waymark-connect-${this.sheetId}`);
      this._bc.onmessage = (e) => this._onBC(e.data);
      this._bc.postMessage({ type: 'announce', peerId: this.peerId, name: this.displayName });
    }
    if (this.signal) this._join();
    this.onStatusChanged('listening');
  }

  /** Send a chat message (or typing signal) to all connected peers (BC + all DataChannels). */
  send(text, msgType = 'message') {
    const msg = { type: msgType, peerId: this.peerId, name: this.displayName, text, ts: Date.now() };
    if (this._bc) this._bc.postMessage(msg);
    this._dcBroadcast(msg);
    return msg;
  }

  /** Send a JSON message to a specific peer's DataChannel (or BroadcastChannel fallback). */
  sendToPeer(peerId, msg) {
    const entry = this._rtc.get(peerId);
    if (entry?.dc?.readyState === 'open') {
      entry.dc.send(JSON.stringify(msg));
      return;
    }
    // Fallback: BroadcastChannel for same-browser peers without an open DC
    if (this._bc) {
      this._bc.postMessage({ ...msg, _to: peerId });
    }
  }

  /** Start an audio/video call — adds tracks to ALL peer connections. */
  async startCall(constraints = { audio: true, video: true }) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(
        new Error('Media devices unavailable — this site must be loaded over HTTPS.'),
        { name: 'InsecureContextError' },
      );
    }

    // If we already have a local stream (reconnection), stop old tracks first
    if (this._localStream) {
      for (const t of this._localStream.getTracks()) t.stop();
      for (const [, r] of this._rtc) {
        for (const s of r.pc.getSenders()) { if (s.track) r.pc.removeTrack(s); }
      }
      this._localStream = null;
    }
    // NOTE: _teardownAudio is deferred until AFTER getUserMedia resolves.
    // Calling it here would clear _micAnalyser, and during the await below
    // onRemoteStream can fire from ICE events — if _micAnalyser is null
    // the pipeline falls to the "direct" passthrough which may get stale
    // tracks from renegotiation. Keep the old analyser alive until the
    // new one is ready.

    // Try to get user media. If getUserMedia fails with a device error,
    // join in listen-only mode so the user can still hear the other side.
    let listenOnly = false;
    let deviceError = null;
    try {
      this._rawStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      // NotAllowedError = user explicitly denied or permission is blocked.
      // Re-throw so the UI can guide them to fix it.
      if (e.name === 'NotAllowedError') throw e;

      // OverconstrainedError with video — retry audio-only before giving up
      if (e.name === 'OverconstrainedError' && constraints.video) {
        try {
          this._rawStream = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio, video: false });
        } catch (e2) {
          if (e2.name === 'NotAllowedError') throw e2;
          listenOnly = true;
          deviceError = e2;
        }
      } else if (constraints.video && (e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
        // Camera failed — retry audio-only
        try {
          this._rawStream = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio, video: false });
        } catch (e2) {
          if (e2.name === 'NotAllowedError') throw e2;
          listenOnly = true;
          deviceError = e2;
        }
      } else {
        // Audio-only also failed (NotFoundError, NotReadableError, etc.)
        listenOnly = true;
        deviceError = e;
      }
    }

    // Process audio through Web Audio API pipeline, pass video through
    if (this._rawStream) {
      // NOW tear down old audio pipeline (after getUserMedia resolved)
      this._teardownAudio();
      const audioProcessing = constraints.audioProcessing || {};
      this._localStream = this._processAudio(this._rawStream, audioProcessing);

      // Resume AudioContext inside the user-gesture call stack so mobile
      // browsers (iOS Safari, mobile Chrome) allow it. Deferring resume
      // to onRemoteStream (which fires from an ICE callback, not a gesture)
      // silently fails on iOS.
      if (this._audioCtx?.state === 'suspended') {
        this._audioCtx.resume().catch(() => {});
      }
    }

    // Add local tracks to all peer connections
    if (this._localStream) {
      for (const [, r] of this._rtc) {
        for (const t of this._localStream.getTracks()) r.pc.addTrack(t, this._localStream);
      }
    }
    this._inCall = true;
    const n = { type: 'call-start', peerId: this.peerId, name: this.displayName };
    this._dcBroadcast(n);
    if (this._bc) this._bc.postMessage(n);

    // If remote streams arrived BEFORE mic processing was ready (answerer
    // scenario), re-emit onRemoteStream so the echo suppression pipeline
    // is rebuilt with the now-available _micAnalyser.
    if (this._micAnalyser) {
      for (const [peerId, stream] of this._remoteStreams) {
        if (stream.getAudioTracks().length > 0) {
          this.onRemoteStream(stream, peerId);
        }
      }
    }

    // Return stream with metadata for the UI
    if (listenOnly) {
      const s = this._localStream || new MediaStream();
      s._listenOnly = true;
      s._deviceError = deviceError;
      return s;
    }
    return this._localStream;
  }

  /** End an active call, stopping all local media tracks. */
  endCall() {
    if (this._rawStream) {
      for (const t of this._rawStream.getTracks()) t.stop();
      this._rawStream = null;
    }
    if (this._localStream) {
      for (const t of this._localStream.getTracks()) t.stop();
      this._localStream = null;
    }
    this._teardownAudio();
    for (const [, r] of this._rtc) {
      for (const s of r.pc.getSenders()) { if (s.track) r.pc.removeTrack(s); }
    }
    this._inCall = false;
    const n = { type: 'call-end', peerId: this.peerId };
    this._dcBroadcast(n);
    if (this._bc) this._bc.postMessage(n);
  }

  get inCall() { return this._inCall; }
  get localStream() { return this._localStream; }

  /* ---------- Web Audio processing pipeline ---------- */

  /**
   * Set up mic-level analysis for the echo gate sidechain and register
   * the AudioWorklet. The ORIGINAL getUserMedia audio tracks are returned
   * unchanged — the browser's built-in AEC/NS/AGC operate on those tracks
   * and routing them through Web Audio processing (MediaStreamSource →
   * nodes → MediaStreamDestination) would produce a NEW track that bypasses
   * Chrome's echo cancellation pipeline.
   *
   * The Web Audio graph here is read-only: we tap the mic signal through
   * an AnalyserNode so the echo gate worklet can sidechain local mic levels.
   *
   * @param {MediaStream} raw — getUserMedia stream
   * @param {Object} opts — (unused, kept for API compat)
   * @returns {MediaStream} raw stream (unmodified, browser AEC intact)
   */
  _processAudio(raw, opts = {}) {
    const audioTracks = raw.getAudioTracks();
    if (audioTracks.length === 0) return raw;

    try {
      const ctx = new AudioContext();
      this._audioCtx = ctx;

      // Create a read-only tap of the mic signal for level analysis.
      // This does NOT modify the audio sent to peers.
      const source = ctx.createMediaStreamSource(raw);

      // AnalyserNode reads mic levels for the echo gate sidechain.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      this._micAnalyser = analyser;

      // Wire: source → analyser (read-only tap, no output destination)
      // The analyser sits in the graph so it receives data, but nothing
      // downstream plays audio — the raw stream goes to peers untouched.
      source.connect(analyser);

      // Return the ORIGINAL stream — browser AEC/NS/AGC are preserved.
      this._processedStream = raw;
      return raw;
    } catch {
      return raw;
    }
  }

  /** Clean up outgoing audio context and processed stream. */
  _teardownAudio() {
    if (this._duckingRAF) {
      cancelAnimationFrame(this._duckingRAF);
      this._duckingRAF = null;
    }
    this._duckState = null;
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
    this._processedStream = null;
    this._micAnalyser = null;
  }

  /**
   * Create a remote audio playback pipeline with echo suppression.
   *
   * Preferred path: AudioWorklet (sample-accurate ~0.13ms gating on audio thread).
   * Fallback path: rAF + volume ducking on the <audio> element (~16ms on main thread).
   *
   * IMPORTANT: Remote WebRTC audio must NOT be routed through Web Audio API
   * (MediaStreamSource → nodes → destination). On Chrome/Linux, doing so
   * causes the WebRTC receiver to discard all packets (totalSamplesReceived=0)
   * resulting in total silence. Instead, the raw stream goes directly on the
   * <audio> element (proven working pattern from main branch), and echo
   * suppression is applied by controlling audioElement.volume via rAF.
   *
   * The mic AnalyserNode (_micAnalyser) is a read-only tap on the outgoing
   * stream and is safe to use for level detection without interfering with
   * the remote audio path.
   *
   * @param {MediaStream} remoteStream — the remote peer's MediaStream
   * @param {Object} [opts]
   * @param {number} [opts.echoSuppression=0.90] — 0 = off, 1 = full mute while speaking
   * @param {number} [opts.duckThreshold=0.012]  — mic RMS above this triggers ducking
   * @param {number} [opts.holdMs=800]            — hold after speech ends
   * @returns {Promise<{ cleanup: Function, outputStream: MediaStream }>}
   */
  async createRemoteAudioPipeline(remoteStream, opts = {}) {
    // Clean up previous pipeline
    if (this._duckingRAF) {
      cancelAnimationFrame(this._duckingRAF);
      this._duckingRAF = null;
    }
    this._duckState = null;

    const audioTracks = remoteStream.getAudioTracks();
    if (audioTracks.length === 0) return { cleanup() {}, outputStream: null };

    // Return the RAW remote stream for the <audio> element.
    // Echo suppression is applied by the caller manipulating audioElement.volume
    // via rAF + _micAnalyser level detection. No Web Audio routing of remote
    // audio — Chrome/Linux discards WebRTC packets routed through MediaStreamSource.
    const raw = new MediaStream(audioTracks);

    // Set up volume-based echo ducking if mic analyser is available
    if (this._micAnalyser && (opts.echoSuppression ?? 0.90) > 0) {
      const suppression = opts.echoSuppression ?? 0.90;
      const gainWhenDucked = Math.max(0, 1 - suppression);
      const duckThreshold = opts.duckThreshold ?? 0.012;
      const holdMs = opts.holdMs ?? 800;
      const analyser = this._micAnalyser;

      // Store ducking state on the instance so the caller (social.js) can
      // apply the computed volume to the <audio> element each frame.
      this._duckState = {
        volume: 1.0,
        smooth: 1.0,
        holdUntil: 0,
        suppression,
        gainWhenDucked,
        duckThreshold,
        holdMs,
      };

      const buf = new Float32Array(analyser.fftSize);
      const state = this._duckState;

      const duckLoop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms > duckThreshold) state.holdUntil = now + holdMs;
        const target = now < state.holdUntil ? gainWhenDucked : 1.0;
        // Instant attack, smooth release
        if (target < state.smooth) {
          state.smooth = target;
        } else {
          state.smooth += (target - state.smooth) * 0.04;
          if (Math.abs(state.smooth - target) < 0.005) state.smooth = target;
        }
        state.volume = state.smooth;
        this._duckingRAF = requestAnimationFrame(duckLoop);
      };
      this._duckingRAF = requestAnimationFrame(duckLoop);
    } else {
      this._duckState = { volume: 1.0 };
    }

    const self = this;
    return {
      outputStream: raw,
      cleanup() {
        if (self._duckingRAF) {
          cancelAnimationFrame(self._duckingRAF);
          self._duckingRAF = null;
        }
        self._duckState = null;
      },
    };
  }

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
    for (const [id] of this._rtc) this._closeOne(id);
    this._clearBlock();
    this._peers.clear();
    this._remoteStreams.clear();
    this.onStatusChanged('disconnected');
  }

  /* ---------- Internal helpers ---------- */

  _dcBroadcast(msg) {
    const s = JSON.stringify(msg);
    for (const [, r] of this._rtc) {
      if (r.dc?.readyState === 'open') r.dc.send(s);
    }
  }

  _closeOne(peerId) {
    const r = this._rtc.get(peerId);
    if (!r) return;
    try { r.dc?.close(); } catch {}
    try { r.pc?.close(); } catch {}
    this._rtc.delete(peerId);
    this._remoteStreams.delete(peerId);
  }

  _emitPeers() {
    this.onPeersChanged(new Map(this._peers));
    if (this._peers.size === 0) {
      this.onStatusChanged('listening');
    } else {
      const hasOpenDC = Array.from(this._rtc.values()).some(r => r.dc?.readyState === 'open');
      this.onStatusChanged(hasOpenDC ? 'connected' : 'pairing');
    }
  }

  /* ---------- BroadcastChannel ---------- */

  _onBC(d) {
    if (this._destroyed || d.peerId === this.peerId) return;
    switch (d.type) {
      case 'announce':
        this._peers.set(d.peerId, { name: d.name, channel: 'local' });
        this._bc.postMessage({ type: 'welcome', peerId: this.peerId, name: this.displayName, to: d.peerId });
        this._emitPeers();
        break;
      case 'welcome':
        if (d.to !== this.peerId) return;
        this._peers.set(d.peerId, { name: d.name, channel: 'local' });
        this._emitPeers();
        break;
      case 'message':
        this.onMessage({ peerId: d.peerId, name: d.name, text: d.text, ts: d.ts, channel: 'local' });
        break;
      case 'typing':
        this.onMessage({ peerId: d.peerId, name: d.name, text: null, type: 'typing', ts: d.ts, channel: 'local' });
        break;
      case 'call-start':
        this.onCallActive(d.peerId, d.name);
        break;
      case 'call-end':
        this.onCallEnded(d.peerId);
        break;
      case 'leave':
        this._peers.delete(d.peerId);
        this._emitPeers();
        break;
      default:
        // Forward targeted arcade messages (invite/accept/decline)
        if (d._to && d._to !== this.peerId) return;
        if (this.onArcadeMessage) this.onArcadeMessage(d.peerId, d);
        break;
    }
  }

  /* ---------- Row-based signaling ---------- */

  async _join() {
    try {
      const vals = await this.signal.readAll();
      this._block = this._findSlot(vals);
      if (this._block < 0) return;
      await this._heartbeat();
      this._pollTimer  = setInterval(() => this._poll(), POLL_MS);
      this._heartTimer = setInterval(() => this._heartbeat(), HEART_MS);
    } catch {}
  }

  _findSlot(vals) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const row = BLOCK_START + i * BLOCK_SIZE;
      const p = _json(vals[row]?.[SIG_COL]);
      if (!p || Date.now() - p.ts > ALIVE_TTL) return row;
    }
    return -1;
  }

  async _heartbeat() {
    if (this._destroyed || this._block < 0) return;
    try {
      await this.signal.writeCell(this._block + OFF_PRESENCE, SIG_COL,
        JSON.stringify({ peerId: this.peerId, name: this.displayName, ts: Date.now() }));
    } catch {}
  }

  /** Main signaling loop — runs every POLL_MS, discovers + negotiates with ALL live peers. */
  async _poll() {
    if (this._destroyed || this._block < 0 || this._polling) return;
    this._polling = true;
    try {
      const vals = await this.signal.readAll();
      const alive = this._scanAlive(vals);
      const aliveIds = new Set(alive.map(p => p.peerId));

      // Update peer list from presence
      let peerChanged = false;
      for (const p of alive) {
        const cur = this._peers.get(p.peerId);
        if (!cur || cur.channel === 'sig') {
          const ch = this._rtc.get(p.peerId)?.dc?.readyState === 'open' ? 'rtc' : 'sig';
          this._peers.set(p.peerId, { name: p.name, channel: ch });
          peerChanged = true;
        }
      }
      for (const [id, p] of this._peers) {
        if ((p.channel === 'sig' || p.channel === 'rtc') && !aliveIds.has(id)) {
          this._peers.delete(id);
          this._closeOne(id);
          peerChanged = true;
        }
      }
      if (peerChanged) this._emitPeers();

      // Read our current signal data from the cached vals
      let myOffers  = _json(vals[this._block + OFF_OFFERS]?.[SIG_COL]) || {};
      let myAnswers = _json(vals[this._block + OFF_ANSWERS]?.[SIG_COL]) || {};
      let offDirty = false;
      let ansDirty = false;

      // Clean stale entries for dead peers
      for (const key of Object.keys(myOffers)) {
        if (!aliveIds.has(key)) { delete myOffers[key]; offDirty = true; }
      }
      for (const key of Object.keys(myAnswers)) {
        if (!aliveIds.has(key)) { delete myAnswers[key]; ansDirty = true; }
      }

      // Drive per-pair negotiation for each alive peer
      for (const remote of alive) {
        const r = this._rtc.get(remote.peerId);

        // Clean up failed/closed connections — will rebuild next cycle
        if (r?.pc && (r.pc.iceConnectionState === 'failed' || r.pc.iceConnectionState === 'closed')) {
          this._closeOne(remote.peerId);
          continue;
        }

        // Already connected — clean signal entries
        if (r?.dc?.readyState === 'open') {
          if (myOffers[remote.peerId])  { delete myOffers[remote.peerId];  offDirty = true; }
          if (myAnswers[remote.peerId]) { delete myAnswers[remote.peerId]; ansDirty = true; }
          continue;
        }

        const weInit = this.peerId < remote.peerId;

        if (weInit) {
          // === INITIATOR: we create offer, wait for answer ===
          if (!r) {
            try {
              const entry = await this._buildOffer(remote.peerId);
              myOffers[remote.peerId] = { sdp: entry.pc.localDescription.sdp, ts: Date.now() };
              offDirty = true;
            } catch { this._closeOne(remote.peerId); }
          } else {
            // Check if remote wrote answer to their ANSWERS row keyed by our peerId
            const remoteAns = _json(vals[remote.block + OFF_ANSWERS]?.[SIG_COL]) || {};
            const ans = remoteAns[this.peerId];
            if (ans) {
              try {
                await r.pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
                r.state = 'connected';
                delete myOffers[remote.peerId];
                offDirty = true;
              } catch { this._closeOne(remote.peerId); }
            }
          }
        } else {
          // === ANSWERER: look for offer in remote's OFFERS row ===
          if (!r) {
            const remoteOff = _json(vals[remote.block + OFF_OFFERS]?.[SIG_COL]) || {};
            const offer = remoteOff[this.peerId];
            if (offer) {
              try {
                const entry = await this._buildAnswer(remote.peerId, offer.sdp);
                myAnswers[remote.peerId] = { sdp: entry.pc.localDescription.sdp, ts: Date.now() };
                ansDirty = true;
              } catch { this._closeOne(remote.peerId); }
            }
          }
        }
      }

      // Batch-write any changed signal rows
      if (offDirty) {
        const v = Object.keys(myOffers).length ? JSON.stringify(myOffers) : '';
        await this.signal.writeCell(this._block + OFF_OFFERS, SIG_COL, v);
      }
      if (ansDirty) {
        const v = Object.keys(myAnswers).length ? JSON.stringify(myAnswers) : '';
        await this.signal.writeCell(this._block + OFF_ANSWERS, SIG_COL, v);
      }
    } catch {} finally {
      this._polling = false;
    }
  }

  _scanAlive(vals) {
    const out = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const row = BLOCK_START + i * BLOCK_SIZE;
      if (row === this._block) continue;
      const p = _json(vals[row]?.[SIG_COL]);
      if (p && Date.now() - p.ts < ALIVE_TTL) out.push({ ...p, block: row });
    }
    return out;
  }

  /* ---------- RTC creation (per-peer) ---------- */

  async _buildOffer(remotePeerId) {
    this._closeOne(remotePeerId);
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    const dc = pc.createDataChannel('waymark');
    const entry = { pc, dc, state: 'offering' };
    this._rtc.set(remotePeerId, entry);

    this._wirePC(remotePeerId, pc);
    this._wireDC(remotePeerId, dc);
    if (this._localStream) {
      for (const t of this._localStream.getTracks()) pc.addTrack(t, this._localStream);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this._iceReady(pc);
    return entry;
  }

  async _buildAnswer(remotePeerId, sdp) {
    this._closeOne(remotePeerId);
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    const entry = { pc, dc: null, state: 'answering' };
    this._rtc.set(remotePeerId, entry);

    pc.ondatachannel = (e) => {
      entry.dc = e.channel;
      this._wireDC(remotePeerId, e.channel);
    };

    this._wirePC(remotePeerId, pc);
    if (this._localStream) {
      for (const t of this._localStream.getTracks()) pc.addTrack(t, this._localStream);
    }

    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this._iceReady(pc);
    return entry;
  }

  _wirePC(remotePeerId, pc) {
    pc.ontrack = (e) => {
      if (e.streams?.[0]) {
        this._remoteStreams.set(remotePeerId, e.streams[0]);
        this.onRemoteStream(e.streams[0], remotePeerId);

        // Listen for unmute — remote tracks start muted until media
        // packets arrive. When unmuted, re-emit so the pipeline can
        // rebuild with live data.
        for (const t of e.streams[0].getAudioTracks()) {
          if (t.muted) {
            t.addEventListener('unmute', () => {
              const stream = this._remoteStreams.get(remotePeerId);
              if (stream) this.onRemoteStream(stream, remotePeerId);
            }, { once: true });
          }
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (this._destroyed) return;
      const s = pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') {
        this._closeOne(remotePeerId);
        if (this._peers.get(remotePeerId)?.channel === 'rtc') {
          this._peers.set(remotePeerId, { name: this._peers.get(remotePeerId)?.name || 'Peer', channel: 'sig' });
          this._emitPeers();
        }
      }
    };

    // Renegotiation (fires when media tracks are added/removed)
    pc.onnegotiationneeded = async () => {
      if (this._destroyed) return;
      const r = this._rtc.get(remotePeerId);
      if (!r?.dc || r.dc.readyState !== 'open') return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this._iceReady(pc);
        r.dc.send(JSON.stringify({
          type: 'renego-offer', peerId: this.peerId, sdp: pc.localDescription.sdp,
        }));
      } catch {}
    };
  }

  _wireDC(remotePeerId, dc) {
    dc.onopen = () => {
      dc.send(JSON.stringify({ type: 'announce', peerId: this.peerId, name: this.displayName }));
      this._peers.set(remotePeerId, {
        name: this._peers.get(remotePeerId)?.name || 'Peer',
        channel: 'rtc',
      });
      this._emitPeers();
      // Let newly connected peer know we're in a call so they can auto-join
      if (this._inCall) {
        dc.send(JSON.stringify({ type: 'call-active', peerId: this.peerId, name: this.displayName }));
      }
    };

    dc.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        switch (m.type) {
          case 'announce':
            this._peers.set(m.peerId, { name: m.name, channel: 'rtc' });
            this._emitPeers();
            break;
          case 'message':
            this.onMessage({ peerId: m.peerId, name: m.name, text: m.text, ts: m.ts, channel: 'rtc' });
            break;
          case 'call-start':
          case 'call-active':
            this.onCallActive(m.peerId, m.name);
            break;
          case 'call-end':
            this.onCallEnded(m.peerId);
            break;
          case 'typing':
            this.onMessage({ peerId: m.peerId, name: m.name, text: null, type: 'typing', ts: m.ts, channel: 'rtc' });
            break;
          case 'renego-offer':
            this._onRenegoOffer(remotePeerId, m);
            break;
          case 'renego-answer':
            this._onRenegoAnswer(remotePeerId, m);
            break;
          default:
            if (this.onArcadeMessage) this.onArcadeMessage(remotePeerId, m);
            break;
        }
      } catch {}
    };

    dc.onclose = () => {
      const p = this._peers.get(remotePeerId);
      if (p?.channel === 'rtc') {
        this._peers.set(remotePeerId, { name: p.name, channel: 'sig' });
        this._emitPeers();
      }
    };
  }

  /* ---------- Renegotiation (via DataChannel — either side can initiate) ---------- */

  async _onRenegoOffer(remotePeerId, m) {
    const r = this._rtc.get(remotePeerId);
    if (!r?.pc || this._destroyed) return;
    try {
      await r.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      const answer = await r.pc.createAnswer();
      await r.pc.setLocalDescription(answer);
      await this._iceReady(r.pc);
      if (r.dc?.readyState === 'open') {
        r.dc.send(JSON.stringify({
          type: 'renego-answer', peerId: this.peerId, sdp: r.pc.localDescription.sdp,
        }));
      }
    } catch {}
  }

  async _onRenegoAnswer(remotePeerId, m) {
    const r = this._rtc.get(remotePeerId);
    if (!r?.pc || this._destroyed) return;
    try { await r.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); } catch {}
  }

  /* ---------- Helpers ---------- */

  _iceReady(pc) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const t = setTimeout(resolve, ICE_WAIT);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
      };
    });
  }

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
