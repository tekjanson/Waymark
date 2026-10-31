/* ============================================================
   social-session.js — Unified P2P Social Session Manager

   Single source of truth for:
   - WebRTC mesh lifecycle via WaymarkConnect
   - Real-time P2P chat messages + persistence
   - Audio/Video calling orchestration, hardware constraints,
     Web Audio DSP (high-pass, gate, volume-ducking echo suppression),
     and synthesized ringtone
   - Device permission & listen-only fallbacks
   - Shared across Social template and Wayboard (The Wayside)
   ============================================================ */

import { el, showToast } from './ui.js';
import { WaymarkConnect } from './webrtc.js';
import {
  buildAudioConstraints,
  buildAudioProcessing,
  avatarColor,
  timeAgo,
} from './templates/social/helpers.js';
import {
  getChatSoundEnabled,
  getEchoSuppression,
  getNoiseGateThreshold,
  getHighPassFreq,
} from './storage.js';

/* ---------- Ringtone via Web Audio API ---------- */

let _ringCtx = null;
let _ringOsc = null;
let _ringGain = null;
let _ringInterval = null;

export function startRingtone() {
  if (!getChatSoundEnabled()) return;
  stopRingtone();
  try {
    _ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    _ringGain = _ringCtx.createGain();
    _ringGain.gain.value = 0.15;
    _ringGain.connect(_ringCtx.destination);
    let on = true;
    const play = () => {
      if (!on || !_ringCtx) return;
      _ringOsc = _ringCtx.createOscillator();
      _ringOsc.type = 'sine';
      _ringOsc.frequency.value = 440;
      _ringOsc.connect(_ringGain);
      _ringOsc.start();
      _ringOsc.frequency.setValueAtTime(440, _ringCtx.currentTime);
      _ringOsc.frequency.setValueAtTime(480, _ringCtx.currentTime + 0.15);
      setTimeout(() => { try { _ringOsc?.stop(); } catch {} }, 300);
    };
    play();
    _ringInterval = setInterval(play, 1200);
    setTimeout(stopRingtone, 30000);
  } catch {}
}

export function stopRingtone() {
  try { _ringOsc?.stop(); } catch {}
  _ringOsc = null;
  if (_ringInterval) {
    clearInterval(_ringInterval);
    _ringInterval = null;
  }
  try { _ringCtx?.close(); } catch {}
  _ringCtx = null;
}

/* ---------- URL Linkifier ---------- */

export const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

export function appendLinkified(parent, text) {
  const str = String(text ?? '');
  let last = 0;
  for (const match of str.matchAll(URL_REGEX)) {
    let url = match[0];
    const trail = url.match(/[.,;:!?)\]}'"]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    if (!url) continue;

    if (match.index > last) {
      parent.append(document.createTextNode(str.slice(last, match.index)));
    }
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    a.className = 'chat-link';
    let sameOrigin = false;
    try {
      sameOrigin = new URL(url).origin === window.location.origin;
    } catch {}
    if (!sameOrigin) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    parent.append(a);
    last = match.index + url.length;
  }
  if (last < str.length) {
    parent.append(document.createTextNode(str.slice(last)));
  }
}

/* ---------- SocialSession Class ---------- */

export class SocialSession {
  /**
   * @param {Object} opts
   * @param {string} opts.sheetId
   * @param {string} [opts.displayName]
   * @param {string} [opts.password]
   * @param {Object} [opts.signal]
   * @param {Function} [opts.persistChat] — async (msg) => { ... }
   * @param {Function} [opts.onMessage] — (msg) => { ... }
   * @param {Function} [opts.onPeersChanged] — (peers) => { ... }
   * @param {Function} [opts.onStatusChanged] — (status) => { ... }
   * @param {Function} [opts.onTyping] — (name) => { ... }
   * @param {Function} [opts.onCallStateChanged] — (state, details) => { ... } state: 'idle'|'calling'|'ringing'|'in-call'
   * @param {Function} [opts.onRemoteStream] — (stream) => { ... }
   */
  constructor(opts = {}) {
    this.sheetId = opts.sheetId;
    this.displayName = opts.displayName || 'Waymarker';
    this.password = opts.password || null;
    this.signal = opts.signal || null;
    this.persistChat = opts.persistChat || null;

    this.onMessage = opts.onMessage || (() => {});
    this.onPeersChanged = opts.onPeersChanged || (() => {});
    this.onStatusChanged = opts.onStatusChanged || (() => {});
    this.onTyping = opts.onTyping || (() => {});
    this.onCallStateChanged = opts.onCallStateChanged || (() => {});
    this.onRemoteStream = opts.onRemoteStream || (() => {});

    this.connect = null;
    this.callState = 'idle'; // 'idle' | 'calling' | 'ringing' | 'in-call'
    this.callerInfo = null; // { peerId, name } when ringing
    this.listenOnly = false;
    this.deviceError = null;

    this._boundAudio = null;
    this._boundRemoteVideo = null;
    this._boundLocalVideo = null;

    this._remoteFilterCleanup = null;
    this._duckVolumeRAF = null;
    this._pipelineGen = 0;
    this._lastTypingBroadcast = 0;
    this._liveMessageIds = new Set();
    this._callStarting = false;
  }

  get inCall() {
    return this.callState === 'in-call' || (this.connect?.inCall === true);
  }

  bindRemoteAudio(audioEl) {
    this._boundAudio = audioEl;
    if (audioEl && this.connect?._duckState) {
      this._wireVolumeDucking(audioEl);
    }
  }

  bindRemoteVideo(videoEl) {
    this._boundRemoteVideo = videoEl;
  }

  bindLocalVideo(videoEl) {
    this._boundLocalVideo = videoEl;
  }

  start() {
    if (this.connect && !this.connect._destroyed) return this.connect;

    const wc = new WaymarkConnect(this.sheetId, {
      displayName: this.displayName,
      password: this.password,
      signal: this.signal,
      onMessage: (msg) => {
        if (!msg) return;
        if (msg.text === null && msg.type === 'typing') {
          this.onTyping(msg.name || 'Collaborator');
          return;
        }
        const key = msg.messageId || `${msg.peerId || ''}:${msg.ts || ''}:${msg.text}`;
        if (this._liveMessageIds.has(key)) return;
        this._liveMessageIds.add(key);
        if (this._liveMessageIds.size > 150) {
          this._liveMessageIds.delete(this._liveMessageIds.values().next().value);
        }
        this.onMessage({
          id: msg.messageId || key,
          sender: msg.name || 'Collaborator',
          text: msg.text || '',
          ts: msg.ts || Date.now(),
          self: false,
        });
      },
      onPeersChanged: (peers) => {
        this.onPeersChanged(peers);
      },
      onStatusChanged: (status) => {
        this.onStatusChanged(status);
      },
      onCallActive: (peerId, name) => {
        if (this.inCall) return;
        this.callState = 'ringing';
        this.callerInfo = { peerId, name };
        startRingtone();
        this.onCallStateChanged('ringing', { peerId, name });
      },
      onCallEnded: (peerId) => {
        stopRingtone();
        const wasInCall = this.inCall;
        this.callState = 'idle';
        this.callerInfo = null;
        this._callStarting = false;
        if (wasInCall) {
          this._teardownMedia();
          this.onCallStateChanged('idle', { peerId, remoteEnded: true });
        } else {
          this.onCallStateChanged('idle', { peerId });
        }
      },
      onRemoteStream: (stream) => {
        const hasVideo = stream.getVideoTracks().length > 0;
        if (this._boundRemoteVideo) {
          if (hasVideo) {
            this._boundRemoteVideo.srcObject = new MediaStream(stream.getVideoTracks());
            this._boundRemoteVideo.play().catch(() => {});
          } else {
            this._boundRemoteVideo.srcObject = null;
          }
        }

        const nAudioTracks = stream.getAudioTracks().length;
        if (nAudioTracks > 0 && this.connect) {
          const gen = ++this._pipelineGen;
          const oldCleanup = this._remoteFilterCleanup;
          this._remoteFilterCleanup = null;

          this.connect.createRemoteAudioPipeline(stream, {
            highPassFreq: getHighPassFreq(),
            echoSuppression: getEchoSuppression(),
            duckThreshold: Math.pow(10, getNoiseGateThreshold() / 20),
          }).then(result => {
            if (this._pipelineGen !== gen) {
              result.cleanup();
              if (oldCleanup) oldCleanup();
              return;
            }
            if (oldCleanup) oldCleanup();
            this._remoteFilterCleanup = result.cleanup;
            if (this._boundAudio) {
              this._boundAudio.srcObject = result.outputStream || null;
              if (result.outputStream) {
                this._boundAudio.play().catch(() => {});
              }
              this._wireVolumeDucking(this._boundAudio);
            }
          }).catch(() => {
            if (this._boundAudio) {
              this._boundAudio.srcObject = stream;
              this._boundAudio.play().catch(() => {});
            }
          });
        }

        this.onRemoteStream(stream);
      },
    });

    this.connect = wc;
    wc.start();
    return wc;
  }

  _wireVolumeDucking(audioEl) {
    if (!this.connect?._duckState || !audioEl) return;
    if (this._duckVolumeRAF) cancelAnimationFrame(this._duckVolumeRAF);
    const ds = this.connect._duckState;
    const applyVolume = () => {
      if (!this.connect?._duckState || this.connect._duckState !== ds) return;
      audioEl.volume = ds.volume;
      this._duckVolumeRAF = requestAnimationFrame(applyVolume);
    };
    this._duckVolumeRAF = requestAnimationFrame(applyVolume);
  }

  _teardownMedia() {
    if (this._duckVolumeRAF) {
      cancelAnimationFrame(this._duckVolumeRAF);
      this._duckVolumeRAF = null;
    }
    if (this._remoteFilterCleanup) {
      try { this._remoteFilterCleanup(); } catch {}
      this._remoteFilterCleanup = null;
    }
    if (this.connect?.localStream) {
      for (const t of this.connect.localStream.getTracks()) {
        try { t.stop(); } catch {}
      }
    }
    if (this._boundAudio) this._boundAudio.srcObject = null;
    if (this._boundRemoteVideo) this._boundRemoteVideo.srcObject = null;
    if (this._boundLocalVideo) this._boundLocalVideo.srcObject = null;
  }

  sendMessage(text, extra = {}) {
    if (!text) return null;
    const messageId = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const msg = {
      id: messageId,
      sender: this.displayName,
      text,
      ts: new Date().toISOString(),
      self: true,
      ...extra,
    };

    // 1. Send via WebRTC P2P DataChannel
    if (this.connect) {
      try {
        this.connect.send(text, 'message', { messageId });
      } catch {}
    }

    // 2. Deliver optimistically
    this._liveMessageIds.add(messageId);
    this.onMessage(msg);

    // 3. Persist asynchronously if handler provided
    if (typeof this.persistChat === 'function') {
      Promise.resolve(this.persistChat(msg)).catch((err) => {
        msg.failed = true;
        this.onMessage(msg);
        showToast(`Could not save message: ${err.message}`, 'error');
      });
    }

    return msg;
  }

  sendTyping() {
    if (!this.connect) return;
    const now = Date.now();
    if (now - this._lastTypingBroadcast > 2000) {
      this._lastTypingBroadcast = now;
      try { this.connect.send(null, 'typing'); } catch {}
    }
  }

  async startCall({ audio = true, video = false } = {}) {
    if (this._callStarting || this.inCall) {
      await this.endCall();
      return null;
    }

    this._callStarting = true;
    this.callState = 'calling';
    this.onCallStateChanged('calling', { video });

    try {
      if (!this.connect) this.start();
      const constraints = {
        audio: audio ? buildAudioConstraints() : false,
        video,
        audioProcessing: buildAudioProcessing(),
      };

      const stream = await this.connect.startCall(constraints);
      this._callStarting = false;
      this.callState = 'in-call';
      this.listenOnly = !!stream?._listenOnly;
      this.deviceError = stream?._deviceError || null;

      if (this._boundLocalVideo && stream) {
        const vTracks = stream.getVideoTracks();
        this._boundLocalVideo.srcObject = vTracks.length ? new MediaStream(vTracks) : null;
      }

      this.onCallStateChanged('in-call', {
        stream,
        video,
        listenOnly: this.listenOnly,
        deviceError: this.deviceError,
      });

      return stream;
    } catch (err) {
      this._callStarting = false;
      this.callState = 'idle';
      this._teardownMedia();
      this.onCallStateChanged('idle', { error: err });
      return null;
    }
  }

  async acceptCall(withVideo = false) {
    stopRingtone();
    return this.startCall({ audio: true, video: withVideo });
  }

  declineCall() {
    stopRingtone();
    this.callState = 'idle';
    this.callerInfo = null;
    this.onCallStateChanged('idle', { declined: true });
  }

  async endCall(opts = {}) {
    stopRingtone();
    this._callStarting = false;
    const wasInCall = this.inCall;
    this.callState = 'idle';
    this.callerInfo = null;

    if (this.connect) {
      try { await this.connect.endCall(); } catch {}
    }
    this._teardownMedia();

    this.onCallStateChanged('idle', { wasInCall });
    if (!opts.silent && wasInCall) {
      showToast('Call ended', 'info');
    }
  }

  toggleMute() {
    if (!this.connect?.localStream) return false;
    const audioTrack = this.connect.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // true = muted
    }
    return false;
  }

  toggleCamera() {
    if (!this.connect?.localStream) return false;
    const videoTrack = this.connect.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled; // true = cam off
    }
    return false;
  }

  setPassword(pw) {
    this.password = pw || null;
    if (this.connect) this.connect.setPassword(pw);
  }

  pause() {
    stopRingtone();
    if (this.connect) this.connect.pause();
  }

  resume() {
    if (this.connect) this.connect.resume();
  }

  destroy({ keepBlock = false } = {}) {
    stopRingtone();
    this._teardownMedia();
    if (this.connect) {
      this.connect.destroy({ keepBlock });
      this.connect = null;
    }
    this.callState = 'idle';
    this.callerInfo = null;
  }
}
