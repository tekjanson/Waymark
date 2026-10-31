/* ============================================================
   social/chat.js — Live P2P chat module for Social template
   ============================================================ */

import {
  el,
  getChatSaveHistory, setChatSaveHistory,
  getChatSoundEnabled, setChatSoundEnabled,
  getEchoCancellation, setEchoCancellation,
  getNoiseSuppression, setNoiseSuppression,
  getAutoGainControl, setAutoGainControl,
  getNoiseGateThreshold, setNoiseGateThreshold,
  getHighPassFreq, setHighPassFreq,
  getEchoSuppression, setEchoSuppression,
} from '../shared.js';
import { avatarColor, timeAgo } from './helpers.js';
import { SocialSession, startRingtone, stopRingtone, appendLinkified } from '../../social-session.js';

/* ---------- Live Chat (P2P via SocialSession) ---------- */

let _activeSession = null;
let _activeSheetId = null;
let _chatPanel = null;
let _socialPassword = '';   // Optional session password for encrypted handshakes

/* --- Chat message log (for persistence) --- */
let _chatLog = [];
let _saveChatHistory = null; // set by openChat, called from destroyChat

function setSocialPassword(pw) {
  _socialPassword = pw;
  if (_activeSession) {
    _activeSession.setPassword(pw);
  }
}

/** Clean up active connection and chat panel. */
async function destroyChat() {
  stopRingtone();
  // Save chat history before teardown (must await to avoid aborted requests)
  if (_saveChatHistory) {
    try { await _saveChatHistory(); } catch {}
    _saveChatHistory = null;
  }
  if (_activeSession) {
    // When the connection was paused on navigation, skip clearing the signaling
    // block so a new WaymarkConnect with the same stable peerId can reclaim it
    // immediately, triggering nonce-change detection on remote peers for faster
    // reconnect instead of waiting for the old block to time out (ALIVE_TTL).
    _activeSession.destroy({ keepBlock: _activeSession.connect?._paused });
    _activeSession = null;
  }
  window.__WAYMARK_CONNECT = null;
  if (_chatPanel) { _chatPanel.remove(); _chatPanel = null; }
  _activeSheetId = null;
  _chatLog = [];
}

// When navigating away from a sheet, pause the connection (preserving the
// signaling block for fast reconnect) and remove the panel UI.
// Full teardown happens via destroyChat() when a different sheet is opened.
window.addEventListener('waymark:sheet-hidden', () => {
  stopRingtone();
  if (_saveChatHistory) {
    _saveChatHistory().catch(() => {}).finally(() => { _saveChatHistory = null; });
  }
  if (_chatPanel) { _chatPanel.remove(); _chatPanel = null; }
  if (_activeSession) _activeSession.pause();
});

/**
 * Build the floating chat panel and connect to peers.
 * @param {string} sheetId
 * @param {string} displayName
 * @param {Object} [signal] — Sheets signaling callbacks
 */
function openChat(sheetId, displayName, signal) {
  // Don't double-open for the same sheet
  if (_activeSession?.connect && !_activeSession.connect._destroyed && _activeSheetId === sheetId) {
    if (_chatPanel) { _chatPanel.classList.remove('hidden'); return; }
    // Panel was removed (user navigated away briefly), connection is paused.
    // Fall through to rebuild the panel. destroyChat() below cleans up the
    // paused connection with keepBlock:true so the fresh WaymarkConnect can
    // reclaim the same signaling slot for faster reconnect.
  }
  destroyChat();
  _activeSheetId = sheetId;

  // --- Build panel DOM ---
  _chatPanel = el('div', { className: 'social-chat-panel' });

  const header = el('div', { className: 'social-chat-header' });
  const statusDot = el('span', { className: 'social-chat-status social-chat-status-listening' });
  const statusLabel = el('span', {}, ['Listening…']);
  const peerCount = el('span', { className: 'social-chat-peer-count' }, ['0 peers']);
  const unreadBadge = el('span', { className: 'social-chat-unread hidden' }, ['0']);
  const settingsBtn = el('button', {
    className: 'social-chat-settings-btn',
    title: 'Chat settings',
  }, ['⚙️']);
  const minimizeBtn = el('button', {
    className: 'social-chat-minimize',
    title: 'Minimize',
    on: { click() {
      _chatPanel.classList.toggle('social-chat-minimized');
      if (!_chatPanel.classList.contains('social-chat-minimized')) {
        _unreadCount = 0;
        unreadBadge.classList.add('hidden');
      }
    } },
  }, ['—']);
  const closeBtn = el('button', {
    className: 'social-chat-close',
    title: 'Disconnect',
    on: { click: destroyChat },
  }, ['✕']);
  header.append(
    el('span', { className: 'social-chat-title' }, ['📡 Live Chat']),
    statusDot, statusLabel, peerCount, unreadBadge,
    settingsBtn, minimizeBtn, closeBtn,
  );

  /* --- Settings panel --- */
  const settingsPanel = el('div', { className: 'social-chat-settings-panel hidden' });
  const saveHistoryCheckbox = el('input', {
    type: 'checkbox',
    checked: getChatSaveHistory(),
    on: { change(e) { setChatSaveHistory(e.target.checked); } },
  });
  const soundCheckbox = el('input', {
    type: 'checkbox',
    checked: getChatSoundEnabled(),
    on: { change(e) { setChatSoundEnabled(e.target.checked); } },
  });
  const echoCheckbox = el('input', {
    type: 'checkbox',
    checked: getEchoCancellation(),
    on: { change(e) { setEchoCancellation(e.target.checked); } },
  });
  const noiseCheckbox = el('input', {
    type: 'checkbox',
    checked: getNoiseSuppression(),
    on: { change(e) { setNoiseSuppression(e.target.checked); } },
  });
  const gainCheckbox = el('input', {
    type: 'checkbox',
    checked: getAutoGainControl(),
    on: { change(e) { setAutoGainControl(e.target.checked); } },
  });
  const gateLabel = el('span', { className: 'social-settings-range-value' }, [`${getNoiseGateThreshold()} dB`]);
  const gateSlider = el('input', {
    type: 'range',
    className: 'social-settings-range',
    min: '-80', max: '-20', step: '5',
    value: String(getNoiseGateThreshold()),
    on: { input(e) {
      const v = Number(e.target.value);
      setNoiseGateThreshold(v);
      gateLabel.textContent = `${v} dB`;
    } },
  });
  const hpLabel = el('span', { className: 'social-settings-range-value' }, [`${getHighPassFreq()} Hz`]);
  const hpSlider = el('input', {
    type: 'range',
    className: 'social-settings-range',
    min: '40', max: '200', step: '10',
    value: String(getHighPassFreq()),
    on: { input(e) {
      const v = Number(e.target.value);
      setHighPassFreq(v);
      hpLabel.textContent = `${v} Hz`;
    } },
  });
  const suppressLabel = el('span', { className: 'social-settings-range-value' }, [`${Math.round(getEchoSuppression() * 100)}%`]);
  const suppressSlider = el('input', {
    type: 'range',
    className: 'social-settings-range',
    min: '0', max: '1', step: '0.05',
    value: String(getEchoSuppression()),
    on: { input(e) {
      const v = Number(e.target.value);
      setEchoSuppression(v);
      suppressLabel.textContent = `${Math.round(v * 100)}%`;
    } },
  });
  settingsPanel.append(
    el('div', { className: 'social-settings-title' }, ['Chat Settings']),
    el('label', { className: 'social-settings-row' }, [
      saveHistoryCheckbox,
      el('span', {}, ['Save chat history to sheet']),
    ]),
    el('label', { className: 'social-settings-row' }, [
      soundCheckbox,
      el('span', {}, ['Incoming call sound']),
    ]),
    el('div', { className: 'social-settings-title social-settings-divider' }, ['Audio Processing']),
    el('label', { className: 'social-settings-row' }, [
      echoCheckbox,
      el('span', {}, ['Echo cancellation']),
    ]),
    el('label', { className: 'social-settings-row' }, [
      noiseCheckbox,
      el('span', {}, ['Noise suppression']),
    ]),
    el('label', { className: 'social-settings-row' }, [
      gainCheckbox,
      el('span', {}, ['Auto gain control']),
    ]),
    el('div', { className: 'social-settings-title social-settings-divider' }, ['Advanced']),
    el('div', { className: 'social-settings-row social-settings-slider-row' }, [
      el('span', {}, ['Noise gate']),
      gateSlider,
      gateLabel,
    ]),
    el('div', { className: 'social-settings-row social-settings-slider-row' }, [
      el('span', {}, ['High-pass filter']),
      hpSlider,
      hpLabel,
    ]),
    el('div', { className: 'social-settings-row social-settings-slider-row' }, [
      el('span', {}, ['Echo suppression']),
      suppressSlider,
      suppressLabel,
    ]),
    el('div', { className: 'social-settings-hint' }, [
      'Echo suppression mutes remote audio while you speak to prevent '
      + 'hearing your own voice back. 100% = full mute. '
      + 'Settings apply on next call.',
    ]),
  );
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  const messages = el('div', { className: 'social-chat-messages' });

  /* --- Incoming call modal (hidden by default) --- */
  const incomingCallModal = el('div', { className: 'social-incoming-call hidden' });
  const incomingCallerName = el('span', { className: 'social-incoming-caller' }, ['']);
  const incomingLabel = el('span', { className: 'social-incoming-label' }, ['is calling…']);
  const acceptBtn = el('button', { className: 'social-incoming-accept' }, ['✅ Accept']);
  const acceptVideoBtn = el('button', { className: 'social-incoming-accept-video' }, ['📹 Accept w/ Video']);
  const declineBtn = el('button', { className: 'social-incoming-decline' }, ['❌ Decline']);
  incomingCallModal.append(
    el('div', { className: 'social-incoming-ring-icon' }, ['📞']),
    el('div', { className: 'social-incoming-info' }, [incomingCallerName, incomingLabel]),
    el('div', { className: 'social-incoming-actions' }, [acceptBtn, acceptVideoBtn, declineBtn]),
  );

  let _pendingCallPeerId = null;
  let _pendingCallName = null;

  function showIncomingCall(peerId, name) {
    _pendingCallPeerId = peerId;
    _pendingCallName = name;
    incomingCallerName.textContent = name || 'Peer';
    incomingCallModal.classList.remove('hidden');
    _chatPanel.classList.remove('social-chat-minimized');
    startRingtone();
  }

  function hideIncomingCall() {
    incomingCallModal.classList.add('hidden');
    _pendingCallPeerId = null;
    _pendingCallName = null;
    stopRingtone();
  }

  acceptBtn.addEventListener('click', () => {
    hideIncomingCall();
    _activeSession?.acceptCall(false).catch(() => {});
  });
  acceptVideoBtn.addEventListener('click', () => {
    hideIncomingCall();
    _activeSession?.acceptCall(true).catch(() => {});
  });
  declineBtn.addEventListener('click', () => {
    hideIncomingCall();
    _activeSession?.declineCall();
    appendMessage('System', 'You declined the call.', Date.now(), false);
  });

  // --- Call UI ---
  const callBar = el('div', { className: 'social-call-bar' });

  const callBtn = el('button', {
    className: 'social-call-btn',
    title: 'Start audio/video call',
  }, ['📞 Call']);
  const videoCallBtn = el('button', {
    className: 'social-call-btn social-call-btn-video',
    title: 'Start video call',
  }, ['📹 Video']);
  const hangupBtn = el('button', {
    className: 'social-call-btn social-call-btn-hangup hidden',
    title: 'End call',
  }, ['🔴 Hang Up']);
  const muteBtn = el('button', {
    className: 'social-call-btn social-call-btn-mute hidden',
    title: 'Toggle mute',
  }, ['🔇 Mute']);
  const camToggleBtn = el('button', {
    className: 'social-call-btn social-call-btn-cam hidden',
    title: 'Toggle camera',
  }, ['📷 Cam Off']);

  callBar.append(callBtn, videoCallBtn, hangupBtn, muteBtn, camToggleBtn);

  // --- Audio Debug Panel (toggled during calls) ---
  const debugPanel = el('div', { className: 'social-debug-panel hidden' });
  debugPanel.innerHTML = `
    <div class="social-debug-header">
      <span>🔊 Audio Debug</span>
      <button class="social-debug-close" title="Close">✕</button>
    </div>
    <div class="social-debug-section">
      <div class="social-debug-label">Mic Level</div>
      <div class="social-debug-meter"><div class="social-debug-meter-fill sd-mic-meter"></div><span class="social-debug-meter-val sd-mic-val">—</span></div>
      <div class="social-debug-label">Remote Level</div>
      <div class="social-debug-meter"><div class="social-debug-meter-fill sd-rem-meter" style="background:#5bf"></div><span class="social-debug-meter-val sd-rem-val">—</span></div>
      <div class="social-debug-label">Audio Out (speakers)</div>
      <div class="social-debug-meter"><div class="social-debug-meter-fill sd-out-meter" style="background:#f80"></div><span class="social-debug-meter-val sd-out-val">—</span></div>
    </div>
    <div class="social-debug-section">
      <div class="social-debug-label">Echo Gate</div>
      <div class="social-debug-grid">
        <span>State</span><span class="sd-gate-state">—</span>
        <span>Output</span><span class="sd-gate-gain">—</span>
        <span>Hold</span><span class="sd-gate-hold">—</span>
      </div>
    </div>
    <div class="social-debug-section">
      <div class="social-debug-label">Adaptive Floor</div>
      <div class="social-debug-grid">
        <span>Noise floor</span><span class="sd-noise-floor">—</span>
        <span>Threshold</span><span class="sd-eff-thresh">—</span>
        <span>Source</span><span class="sd-thresh-src">—</span>
      </div>
    </div>
    <div class="social-debug-section">
      <div class="social-debug-label">Browser AEC</div>
      <div class="social-debug-grid">
        <span>Echo cancel</span><span class="sd-aec">—</span>
        <span>Noise supp</span><span class="sd-ns">—</span>
        <span>Auto gain</span><span class="sd-agc">—</span>
      </div>
    </div>
    <div class="social-debug-section">
      <div class="social-debug-label">Pipeline</div>
      <div class="social-debug-grid">
        <span>AudioCtx</span><span class="sd-ctx-state">—</span>
        <span>Path</span><span class="sd-pipeline-type">—</span>
        <span>Sample rate</span><span class="sd-sample-rate">—</span>
      </div>
    </div>
    <div class="social-debug-section social-debug-log-section">
      <div class="social-debug-label">Event Log <button class="social-debug-clear-log" title="Clear">clear</button></div>
      <div class="social-debug-log sd-event-log"></div>
    </div>
    <div class="social-debug-section">
      <button class="social-debug-download">📥 Download Debug Snapshot</button>
    </div>`;

  // Wire close button
  debugPanel.querySelector('.social-debug-close').addEventListener('click', () => {
    debugPanel.classList.add('hidden');
    debugBtn.classList.remove('social-debug-btn-active');
  });
  debugPanel.querySelector('.social-debug-clear-log').addEventListener('click', () => {
    debugPanel.querySelector('.sd-event-log').textContent = '';
  });
  debugPanel.querySelector('.social-debug-download').addEventListener('click', () => {
    downloadDebugSnapshot();
  });

  // Debug toggle button — added to call bar when in a call
  const debugBtn = el('button', {
    className: 'social-call-btn social-debug-btn hidden',
    title: 'Audio debug panel',
  }, ['🐛 Debug']);
  debugBtn.addEventListener('click', () => {
    debugPanel.classList.toggle('hidden');
    debugBtn.classList.toggle('social-debug-btn-active');
    if (!debugPanel.classList.contains('hidden') && _activeSession?.connect && !_debugCleanup) {
      startDebug(_activeSession.connect);
    }
  });
  callBar.append(debugBtn);

  let _debugCleanup = null;
  let _debugLogLines = 0;

  function debugLog(msg) {
    const log = debugPanel.querySelector('.sd-event-log');
    if (!log) return;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = document.createElement('div');
    line.textContent = `[${ts}] ${msg}`;
    log.append(line);
    _debugLogLines++;
    if (_debugLogLines > 200) { log.firstChild?.remove(); _debugLogLines--; }
    log.scrollTop = log.scrollHeight;
  }

  /** Collect every piece of audio/WebRTC diagnostic state and download as JSON. */
  function downloadDebugSnapshot() {
    const connect = _activeSession?.connect;
    const ctx = connect?._audioCtx;
    const snap = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      url: location.href,
      secure: location.protocol === 'https:',

      // --- AudioContext state ---
      audioCtx: ctx ? {
        state: ctx.state,
        sampleRate: ctx.sampleRate,
        baseLatency: ctx.baseLatency,
        outputLatency: ctx.outputLatency,
        currentTime: ctx.currentTime,
        destination: {
          channelCount: ctx.destination.channelCount,
          maxChannelCount: ctx.destination.maxChannelCount,
          numberOfInputs: ctx.destination.numberOfInputs,
          numberOfOutputs: ctx.destination.numberOfOutputs,
        },
      } : null,
      // --- Pipeline state ---
      pipeline: {
        type: connect?._duckingRAF ? 'volume-ducking' : 'direct',
        hasDuckingRAF: !!connect?._duckingRAF,
        hasMicAnalyser: !!connect?._micAnalyser,
        hasProcessedStream: !!connect?._processedStream,
        duckState: connect?._duckState ? {
          volume: connect._duckState.volume,
          suppression: connect._duckState.suppression,
          gainWhenDucked: connect._duckState.gainWhenDucked,
          duckThreshold: connect._duckState.duckThreshold,
        } : null,
      },

      // --- Mic (outgoing) tracks ---
      rawStream: describeStream(connect?._rawStream, 'rawStream'),
      localStream: describeStream(connect?._localStream, 'localStream'),
      processedStream: describeStream(connect?._processedStream, 'processedStream'),

      // --- Remote audio element ---
      remoteAudioElement: {
        srcObject: remoteAudio.srcObject ? 'set' : 'null',
        srcObjectTracks: describeStream(remoteAudio.srcObject, 'remoteAudio.srcObject'),
        paused: remoteAudio.paused,
        ended: remoteAudio.ended,
        muted: remoteAudio.muted,
        volume: remoteAudio.volume,
        readyState: remoteAudio.readyState,
        networkState: remoteAudio.networkState,
        currentTime: remoteAudio.currentTime,
        autoplay: remoteAudio.autoplay,
        error: remoteAudio.error ? {
          code: remoteAudio.error.code,
          message: remoteAudio.error.message,
        } : null,
      },

      // --- Remote video element ---
      remoteVideoElement: {
        srcObject: remoteVideo.srcObject ? 'set' : 'null',
        srcObjectTracks: describeStream(remoteVideo.srcObject, 'remoteVideo.srcObject'),
        paused: remoteVideo.paused,
        readyState: remoteVideo.readyState,
      },

      // --- Local video element ---
      localVideoElement: {
        srcObject: localVideo.srcObject ? 'set' : 'null',
        srcObjectTracks: describeStream(localVideo.srcObject, 'localVideo.srcObject'),
        muted: localVideo.muted,
      },

      // --- User audio settings (localStorage) ---
      audioSettings: {
        echoCancellation: getEchoCancellation(),
        noiseSuppression: getNoiseSuppression(),
        autoGainControl: getAutoGainControl(),
        noiseGateThreshold: getNoiseGateThreshold(),
        highPassFreq: getHighPassFreq(),
        echoSuppression: getEchoSuppression(),
      },

      // --- WebRTC peer connections ---
      peerConnections: [],

      // --- Remote streams cache ---
      remoteStreamsCache: [],

      // --- Signaling state ---
      signaling: {
        hasSignal: !!connect?.signal,
        block: connect?._block ?? -1,
        polling: connect?._polling ?? false,
        destroyed: connect?._destroyed ?? false,
        hasBroadcastChannel: !!connect?._bc,
        inCall: connect?._inCall ?? false,
        peerId: connect?.peerId || null,
        peers: connect?._peers ? Array.from(connect._peers.entries()).map(([id, p]) => ({
          peerId: id,
          name: p.name,
          channel: p.channel,
        })) : [],
        rtcEntries: connect?._rtc ? Array.from(connect._rtc.entries()).map(([id, r]) => ({
          peerId: id,
          state: r?.state,
          pcState: r?.pc?.connectionState,
          iceState: r?.pc?.iceConnectionState,
          dcState: r?.dc?.readyState,
        })) : [],
      },

      // --- Event log (full text) ---
      eventLog: debugPanel.querySelector('.sd-event-log')?.textContent || '',

      // --- Console errors (if available) ---
      consoleErrors: _capturedErrors.slice(-50),
    };

    // Peer connections detail
    if (connect?._rtc) {
      for (const [peerId, r] of connect._rtc) {
        const pc = r?.pc;
        if (!pc) continue;
        const pcSnap = {
          peerId,
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          localDescription: pc.localDescription ? {
            type: pc.localDescription.type,
            sdpLength: pc.localDescription.sdp?.length,
            sdpAudioLines: extractSdpAudioInfo(pc.localDescription.sdp),
          } : null,
          remoteDescription: pc.remoteDescription ? {
            type: pc.remoteDescription.type,
            sdpLength: pc.remoteDescription.sdp?.length,
            sdpAudioLines: extractSdpAudioInfo(pc.remoteDescription.sdp),
          } : null,
          senders: [],
          receivers: [],
          dataChannel: r.dc ? {
            label: r.dc.label,
            readyState: r.dc.readyState,
          } : null,
        };

        // Senders
        for (const sender of pc.getSenders()) {
          const t = sender.track;
          pcSnap.senders.push({
            kind: t?.kind || 'none',
            id: t?.id?.slice(0, 12),
            readyState: t?.readyState,
            enabled: t?.enabled,
            muted: t?.muted,
            label: t?.label,
            settings: safeGetSettings(t),
          });
        }

        // Receivers
        for (const receiver of pc.getReceivers()) {
          const t = receiver.track;
          const contrib = receiver.getSynchronizationSources?.() || [];
          pcSnap.receivers.push({
            kind: t?.kind || 'none',
            id: t?.id?.slice(0, 12),
            readyState: t?.readyState,
            enabled: t?.enabled,
            muted: t?.muted,
            label: t?.label,
            synchronizationSources: contrib.map(s => ({
              source: s.source,
              audioLevel: s.audioLevel,
              timestamp: s.timestamp,
            })),
          });
        }

        // getStats (async — we'll add it after)
        snap.peerConnections.push(pcSnap);
      }
    }

    // Remote streams cache
    if (connect?._remoteStreams) {
      for (const [peerId, stream] of connect._remoteStreams) {
        snap.remoteStreamsCache.push({
          peerId,
          ...describeStream(stream, 'cached'),
        });
      }
    }

    // Gather async stats from all peer connections, then download
    const statsPromises = [];
    if (connect?._rtc) {
      for (const [peerId, r] of connect._rtc) {
        if (r?.pc?.getStats) {
          statsPromises.push(
            r.pc.getStats().then(stats => {
              const filtered = {};
              stats.forEach(report => {
                // Keep only audio-relevant and connection-relevant stats
                if (/inbound-rtp|outbound-rtp|remote-inbound|remote-outbound|candidate-pair|transport|codec/i.test(report.type)) {
                  if (report.kind === 'video' && !/candidate|transport|codec/.test(report.type)) return;
                  filtered[report.id] = Object.fromEntries(
                    Object.entries(report).filter(([k]) => typeof report[k] !== 'object')
                  );
                }
              });
              return { peerId, stats: filtered };
            }).catch(() => ({ peerId, stats: 'getStats failed' }))
          );
        }
      }
    }

    Promise.all(statsPromises).then(allStats => {
      snap.rtcStats = allStats;

      const json = JSON.stringify(snap, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `waymark-audio-debug-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      debugLog('Debug snapshot downloaded');
    });
  }

  /** Describe a MediaStream's tracks for the snapshot. */
  function describeStream(stream, label) {
    if (!stream) return { label, active: false, tracks: [] };
    return {
      label,
      id: stream.id?.slice(0, 12),
      active: stream.active,
      tracks: stream.getTracks().map(t => ({
        kind: t.kind,
        id: t.id?.slice(0, 12),
        readyState: t.readyState,
        enabled: t.enabled,
        muted: t.muted,
        label: t.label,
        settings: safeGetSettings(t),
        constraints: safeGetConstraints(t),
      })),
    };
  }

  /** Safely call track.getSettings(). */
  function safeGetSettings(track) {
    if (!track?.getSettings) return null;
    try {
      const s = track.getSettings();
      // Include all audio-relevant settings
      return {
        deviceId: s.deviceId?.slice(0, 16),
        groupId: s.groupId?.slice(0, 16),
        sampleRate: s.sampleRate,
        sampleSize: s.sampleSize,
        channelCount: s.channelCount,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGainControl,
        latency: s.latency,
        width: s.width,
        height: s.height,
        frameRate: s.frameRate,
      };
    } catch { return null; }
  }

  /** Safely call track.getConstraints(). */
  function safeGetConstraints(track) {
    if (!track?.getConstraints) return null;
    try { return track.getConstraints(); } catch { return null; }
  }

  /** Extract audio-relevant lines from SDP. */
  function extractSdpAudioInfo(sdp) {
    if (!sdp) return null;
    const lines = sdp.split('\\n');
    const audioLines = [];
    let inAudio = false;
    for (const line of lines) {
      if (line.startsWith('m=audio')) { inAudio = true; }
      else if (line.startsWith('m=')) { inAudio = false; }
      if (inAudio) audioLines.push(line.trim());
    }
    return audioLines.length > 0 ? audioLines : null;
  }

  // Capture console errors for the debug snapshot
  const _capturedErrors = [];
  const _origConsoleError = console.error;
  const _origConsoleWarn = console.warn;
  console.error = function(...args) {
    _capturedErrors.push({ level: 'error', ts: new Date().toISOString(), msg: args.map(String).join(' ') });
    if (_capturedErrors.length > 100) _capturedErrors.shift();
    _origConsoleError.apply(console, args);
  };
  console.warn = function(...args) {
    _capturedErrors.push({ level: 'warn', ts: new Date().toISOString(), msg: args.map(String).join(' ') });
    if (_capturedErrors.length > 100) _capturedErrors.shift();
    _origConsoleWarn.apply(console, args);
  };
  window.addEventListener('error', (e) => {
    _capturedErrors.push({ level: 'uncaught', ts: new Date().toISOString(), msg: `${e.message} at ${e.filename}:${e.lineno}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    _capturedErrors.push({ level: 'rejection', ts: new Date().toISOString(), msg: String(e.reason) });
  });

  function startDebug(connect) {
    stopDebug();
    if (!connect) return;

    const els = {
      micMeter: debugPanel.querySelector('.sd-mic-meter'),
      micVal: debugPanel.querySelector('.sd-mic-val'),
      remMeter: debugPanel.querySelector('.sd-rem-meter'),
      remVal: debugPanel.querySelector('.sd-rem-val'),
      outMeter: debugPanel.querySelector('.sd-out-meter'),
      outVal: debugPanel.querySelector('.sd-out-val'),
      gateState: debugPanel.querySelector('.sd-gate-state'),
      gateGain: debugPanel.querySelector('.sd-gate-gain'),
      gateHold: debugPanel.querySelector('.sd-gate-hold'),
      noiseFloor: debugPanel.querySelector('.sd-noise-floor'),
      effThresh: debugPanel.querySelector('.sd-eff-thresh'),
      threshSrc: debugPanel.querySelector('.sd-thresh-src'),
      aec: debugPanel.querySelector('.sd-aec'),
      ns: debugPanel.querySelector('.sd-ns'),
      agc: debugPanel.querySelector('.sd-agc'),
      ctxState: debugPanel.querySelector('.sd-ctx-state'),
      pipelineType: debugPanel.querySelector('.sd-pipeline-type'),
      sampleRate: debugPanel.querySelector('.sd-sample-rate'),
    };

    // Populate one-time info
    const ctx = connect._audioCtx;
    els.ctxState.textContent = ctx?.state || 'none';
    els.sampleRate.textContent = ctx?.sampleRate ? `${ctx.sampleRate} Hz` : '—';
    els.pipelineType.textContent = connect._duckingRAF ? 'Volume ducking' : 'direct';

    // Log ICE connection state for each peer
    for (const [peerId, r] of connect._rtc || []) {
      const ice = r?.pc?.iceConnectionState || '?';
      debugLog(`ICE[${peerId.slice(0, 6)}]: ${ice}`);
    }

    // Read browser constraints from the actual mic track
    const micTrack = connect._rawStream?.getAudioTracks()?.[0];
    if (micTrack) {
      try {
        const settings = micTrack.getSettings();
        els.aec.textContent = settings.echoCancellation ? '✅ on' : '❌ off';
        els.ns.textContent = settings.noiseSuppression ? '✅ on' : '❌ off';
        els.agc.textContent = settings.autoGainControl ? '✅ on' : '❌ off';
        debugLog(`Mic: ${micTrack.label}`);
        debugLog(`AEC=${settings.echoCancellation} NS=${settings.noiseSuppression} AGC=${settings.autoGainControl}`);
      } catch { /* some browsers don't support getSettings */ }
    }

    // Live mic level via AnalyserNode (independent of worklet)
    const analyser = connect._micAnalyser;
    let micRAF = 0;
    // Audio out level: show duck state volume (no Web Audio on remote stream!)

    if (analyser) {
      const buf = new Float32Array(analyser.fftSize);
      const updateMeters = () => {
        if (!connect._audioCtx) return;
        // Mic level
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rmsVal = Math.sqrt(sum / buf.length);
        const pct = Math.min(100, rmsVal * 500);
        els.micMeter.style.width = pct + '%';
        els.micMeter.style.background = rmsVal > 0.05 ? '#5f5' : rmsVal > 0.02 ? '#ff5' : '#555';
        els.micVal.textContent = rmsVal.toFixed(4);

        // Audio out level — show duck volume (no Web Audio on remote stream!)
        const ds = connect._duckState;
        if (ds) {
          const oPct = ds.volume * 100;
          els.outMeter.style.width = oPct + '%';
          els.outMeter.style.background = ds.volume < 0.5 ? '#f55' : ds.volume < 0.9 ? '#f80' : '#5f5';
          els.outVal.textContent = (ds.volume * 100).toFixed(0) + '%';
          // Show duck state in gate fields
          els.gateState.textContent = ds.volume < 0.5 ? '🔴 DUCKED' : '🟢 FULL';
          els.gateState.style.color = ds.volume < 0.5 ? '#f55' : '#5f5';
          els.gateGain.textContent = (ds.volume * 100).toFixed(0) + '%';
        }

        micRAF = requestAnimationFrame(updateMeters);
      };
      micRAF = requestAnimationFrame(updateMeters);
    }

    // Detect audio leak: warn if localVideo has audio tracks
    const lvTracks = localVideo.srcObject?.getAudioTracks?.() || [];
    if (lvTracks.length > 0) {
      debugLog('⚠️ LOCAL VIDEO HAS AUDIO TRACKS — possible feedback loop!');
    }
    // Also check remoteVideo
    const rvTracks = remoteVideo.srcObject?.getAudioTracks?.() || [];
    if (rvTracks.length > 0) {
      debugLog('⚠️ REMOTE VIDEO HAS AUDIO TRACKS — possible unprocessed audio leak!');
    }

    // Volume ducking diagnostic logging
    if (connect._duckingRAF) {
      debugLog('Volume ducking active (rAF + mic analyser)');
    } else {
      debugLog('Direct audio — no echo suppression');
    }

    // Update context state and pipeline info periodically
    const ctxInterval = setInterval(() => {
      if (connect._audioCtx) {
        els.ctxState.textContent = connect._audioCtx.state;
      }
      els.pipelineType.textContent = connect._duckingRAF ? 'Volume ducking' : 'direct';
    }, 2000);

    debugLog('Debug panel started');

    _debugCleanup = () => {
      if (micRAF) cancelAnimationFrame(micRAF);
      clearInterval(ctxInterval);
      debugLog('Debug panel stopped');
    };
  }

  function stopDebug() {
    if (_debugCleanup) { _debugCleanup(); _debugCleanup = null; }
  }

  // Media container for video streams
  const mediaContainer = el('div', { className: 'social-media-container hidden' });
  const localVideo = el('video', { className: 'social-local-video', muted: true, autoplay: true, playsInline: true });
  const remoteVideo = el('video', { className: 'social-remote-video', autoplay: true, playsInline: true });
  // remoteAudio lives OUTSIDE mediaContainer so it's never hidden by display:none
  const remoteAudio = el('audio', { className: 'social-remote-audio', autoplay: true });
  mediaContainer.append(remoteVideo, localVideo);

  /** Enter the "in call" visual state */
  function enterCallUI(hasVideo) {
    callBtn.classList.add('hidden');
    videoCallBtn.classList.add('hidden');
    hangupBtn.classList.remove('hidden');
    muteBtn.classList.remove('hidden');
    if (hasVideo) {
      camToggleBtn.classList.remove('hidden');
      mediaContainer.classList.remove('hidden');
    }
    debugBtn.classList.remove('hidden');
    _chatPanel.classList.add('social-chat-in-call');
    // Only start debug if not already running (prevents start/stop spam)
    if (_activeSession?.connect && !_debugCleanup) startDebug(_activeSession.connect);
  }

  /** Leave the "in call" visual state and release all media devices */
  function exitCallUI() {
    stopDebug();
    debugBtn.classList.add('hidden');
    debugPanel.classList.add('hidden');
    debugBtn.classList.remove('social-debug-btn-active');
    callBtn.classList.remove('hidden');
    videoCallBtn.classList.remove('hidden');
    hangupBtn.classList.add('hidden');
    muteBtn.classList.add('hidden');
    camToggleBtn.classList.add('hidden');
    mediaContainer.classList.add('hidden');
    _chatPanel.classList.remove('social-chat-in-call');
    muteBtn.textContent = '🔇 Mute';
    camToggleBtn.textContent = '📷 Cam Off';
  }

  callBtn.addEventListener('click', () => {
    _activeSession?.startCall({ audio: true, video: false }).catch(() => {});
  });
  videoCallBtn.addEventListener('click', () => {
    _activeSession?.startCall({ audio: true, video: true }).catch(() => {});
  });

  hangupBtn.addEventListener('click', () => {
    _activeSession?.endCall();
    exitCallUI();
  });

  muteBtn.addEventListener('click', () => {
    if (!_activeSession) return;
    const isMuted = _activeSession.toggleMute();
    muteBtn.textContent = isMuted ? '🔊 Unmute' : '🔇 Mute';
  });

  camToggleBtn.addEventListener('click', () => {
    if (!_activeSession) return;
    const isCamOff = _activeSession.toggleCamera();
    camToggleBtn.textContent = isCamOff ? '📷 Cam On' : '📷 Cam Off';
  });

  // --- Typing indicator ---
  const typingIndicator = el('div', { className: 'social-typing-indicator hidden' });
  let _typingTimer = null;

  function showTyping(name) {
    typingIndicator.textContent = `${name} is typing…`;
    typingIndicator.classList.remove('hidden');
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(() => typingIndicator.classList.add('hidden'), 3000);
  }

  // --- Unread count ---
  let _unreadCount = 0;

  // --- Input bar ---
  const inputBar = el('div', { className: 'social-chat-input-bar' });
  const input = el('input', {
    className: 'social-chat-input',
    type: 'text',
    placeholder: 'Type a message…',
    autocomplete: 'off',
  });
  const sendBtn = el('button', { className: 'social-chat-send' }, ['Send']);
  inputBar.append(input, sendBtn);

  // Broadcast typing indicator on keypress
  input.addEventListener('input', () => {
    _activeSession?.sendTyping();
  });

  _chatPanel.append(header, settingsPanel, incomingCallModal, mediaContainer, remoteAudio, messages, typingIndicator, callBar, debugPanel, inputBar);
  document.body.append(_chatPanel);

  // --- Render a chat message ---
  function appendMessage(name, text, ts, isSelf) {
    const bubble = el('div', { className: `social-chat-bubble ${isSelf ? 'social-chat-self' : 'social-chat-peer'}` });
    const initial = (name || '?')[0].toUpperCase();
    const textSpan = el('span', { className: 'social-chat-bubble-text' });
    appendLinkified(textSpan, text);
    bubble.append(
      el('div', { className: 'social-avatar social-avatar-sm', style: `background: ${avatarColor(name || 'Anonymous')}` }, [initial]),
      el('div', { className: 'social-chat-bubble-body' }, [
        el('span', { className: 'social-chat-bubble-name' }, [name]),
        textSpan,
        el('span', { className: 'social-chat-bubble-time' }, [timeAgo(new Date(ts).toISOString())]),
      ]),
    );
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;

    // Track for history persistence
    if (name !== 'System') {
      _chatLog.push({ name, text, ts, self: isSelf });
    }

    // Unread badge if minimized
    if (_chatPanel.classList.contains('social-chat-minimized') && !isSelf && name !== 'System') {
      _unreadCount++;
      unreadBadge.textContent = String(_unreadCount);
      unreadBadge.classList.remove('hidden');
    }
  }

  // --- Send handler ---
  function sendMessage() {
    const text = input.value.trim();
    if (!text || !_activeSession) return;
    _activeSession.sendMessage(text);
    input.value = '';
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });

  // --- Save chat history as proper post rows matching the sheet headers ---
  let _historySaved = false;
  async function saveChatHistory() {
    if (_historySaved) return;
    if (!getChatSaveHistory() || _chatLog.length === 0) return;
    if (!signal?.appendChatHistory) return;
    _historySaved = true;
    const { cols: c, totalCols: tc } = signal;
    const rows = _chatLog.map(m => {
      const row = new Array(tc || 7).fill('');
      if (c.text >= 0)     row[c.text]     = m.text;
      if (c.author >= 0)   row[c.author]   = m.name;
      if (c.date >= 0)     row[c.date]     = new Date(m.ts).toISOString();
      if (c.category >= 0) row[c.category] = 'chat';
      return row;
    });
    try {
      await signal.appendChatHistory(rows);
    } catch (err) {
      console.warn('[social] chat history save failed:', err);
      _historySaved = false;
    }
  }
  _saveChatHistory = saveChatHistory;

  // --- Restore previous chat messages from the sheet ---
  if (signal?.readAll && signal.cols) {
    const c = signal.cols;
    signal.readAll().then(allRows => {
      const dataRows = allRows.slice(1); // skip header
      for (const row of dataRows) {
        const cat = c.category >= 0 ? (row[c.category] || '').toLowerCase() : '';
        if (cat !== 'chat') continue;
        const text   = c.text >= 0 ? (row[c.text] || '') : '';
        const author = c.author >= 0 ? (row[c.author] || '') : '';
        const date   = c.date >= 0 ? (row[c.date] || '') : '';
        if (!text) continue;
        const ts = date ? new Date(date).getTime() : 0;
        // Render as a history bubble without adding to _chatLog
        const isSelf = author === displayName;
        const bubble = el('div', {
          className: `social-chat-bubble social-chat-history ${isSelf ? 'social-chat-self' : 'social-chat-peer'}`,
        });
        const initial = (author || '?')[0].toUpperCase();
        const textSpan = el('span', { className: 'social-chat-bubble-text' });
        appendLinkified(textSpan, text);
        bubble.append(
          el('div', { className: 'social-avatar social-avatar-sm', style: `background: ${avatarColor(author || 'Anonymous')}` }, [initial]),
          el('div', { className: 'social-chat-bubble-body' }, [
            el('span', { className: 'social-chat-bubble-name' }, [author]),
            textSpan,
            el('span', { className: 'social-chat-bubble-time' }, [timeAgo(date)]),
          ]),
        );
        messages.append(bubble);
      }
      if (messages.children.length > 0) {
        messages.scrollTop = messages.scrollHeight;
      }
    }).catch(() => {}); // silent — don't block chat if read fails
  }

  // --- Create session via SocialSession ---
  _activeSession = new SocialSession({
    sheetId,
    displayName,
    password: _socialPassword || null,
    signal,
    onMessage(msg) {
      appendMessage(msg.sender || msg.name, msg.text, msg.ts, msg.self);
    },
    onPeersChanged(peers) {
      peerCount.textContent = `${peers.size} peer${peers.size !== 1 ? 's' : ''}`;
    },
    onStatusChanged(status) {
      statusDot.className = `social-chat-status social-chat-status-${status}`;
      const labels = { connected: 'Connected', listening: 'Listening…', pairing: 'Pairing…', disconnected: 'Disconnected' };
      statusLabel.textContent = labels[status] || status;
      if (status === 'disconnected') saveChatHistory();
    },
    onTyping(name) {
      showTyping(name);
    },
    onCallStateChanged(state, details) {
      if (state === 'ringing') {
        showIncomingCall(details.peerId, details.name);
      } else if (state === 'calling' || state === 'in-call') {
        hideIncomingCall();
        if (details?.listenOnly) {
          enterCallUI(false);
          const reason = details.deviceError?.name || '';
          if (reason === 'NotFoundError' || reason === 'NotReadableError') {
            appendMessage('System',
              '🔇 Joined call in listen-only mode (no microphone detected).\n'
              + 'You can hear the other person but they cannot hear you.\n\n'
              + 'To fix: click the lock/tune 🔒 icon in your address bar → Site settings → Microphone → Allow, then reload.',
              Date.now(), false);
          } else {
            appendMessage('System',
              '🔇 Joined call in listen-only mode. You can hear the other person but they cannot hear you.',
              Date.now(), false);
          }
        } else {
          enterCallUI(details?.video);
        }
      } else if (state === 'idle') {
        hideIncomingCall();
        exitCallUI();
        if (details?.remoteEnded) {
          appendMessage('System', 'Peer ended the call.', Date.now(), false);
        } else if (details?.error) {
          const err = details.error;
          let msg = `Could not start call: ${err.message}`;
          if (err.name === 'InsecureContextError') {
            msg = 'Camera/microphone require HTTPS. Please access this site over a secure connection.';
          } else if (err.name === 'NotAllowedError') {
            msg = '🔒 Microphone access was blocked by your browser.\n\n'
                + 'To fix this in Chrome:\n'
                + '1. Click the lock/tune icon in the address bar\n'
                + '2. Click "Site settings"\n'
                + '3. Set Microphone to "Allow"\n'
                + '4. Close this tab and reopen the page';
          }
          appendMessage('System', msg, Date.now(), false);
        }
      }
    },
    onRemoteStream(stream) {
      const hasVideo = stream.getVideoTracks().length > 0;
      if (hasVideo) {
        mediaContainer.classList.remove('hidden');
      }
      if (_activeSession?.inCall) {
        enterCallUI(hasVideo);
      }
    },
  });

  _activeSession.bindRemoteAudio(remoteAudio);
  _activeSession.bindRemoteVideo(remoteVideo);
  _activeSession.bindLocalVideo(localVideo);
  _activeSession.start();
  window.__WAYMARK_CONNECT = _activeSession.connect;
}

export { openChat, destroyChat, setSocialPassword };
