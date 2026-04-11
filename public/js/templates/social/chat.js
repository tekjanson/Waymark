/* ============================================================
   social/chat.js — Live P2P chat module for Social template
   ============================================================ */

import {
  el,
  WaymarkConnect,
  getChatSaveHistory, setChatSaveHistory,
  getChatSoundEnabled, setChatSoundEnabled,
  getEchoCancellation, setEchoCancellation,
  getNoiseSuppression, setNoiseSuppression,
  getAutoGainControl, setAutoGainControl,
  getNoiseGateThreshold, setNoiseGateThreshold,
  getHighPassFreq, setHighPassFreq,
  getEchoSuppression, setEchoSuppression,
} from '../shared.js';
import { buildAudioConstraints, buildAudioProcessing, avatarColor, timeAgo } from './helpers.js';

/* ---------- Live Chat (P2P via WaymarkConnect) ---------- */

let _activeConnect = null;
let _activeSheetId = null;
let _chatPanel = null;
let _socialPassword = '';   // Optional session password for encrypted handshakes

/* --- Ringtone via Web Audio API --- */
let _ringCtx = null;
let _ringOsc = null;
let _ringGain = null;
let _ringInterval = null;

function startRingtone() {
  if (!getChatSoundEnabled()) return;
  stopRingtone();
  try {
    _ringCtx = new AudioContext();
    _ringGain = _ringCtx.createGain();
    _ringGain.gain.value = 0.15;
    _ringGain.connect(_ringCtx.destination);
    // Two-tone ring pattern
    let on = true;
    const play = () => {
      if (!on) return;
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
    // Auto-stop after 30s
    setTimeout(stopRingtone, 30000);
  } catch {}
}

function stopRingtone() {
  try { _ringOsc?.stop(); } catch {}
  _ringOsc = null;
  clearInterval(_ringInterval);
  _ringInterval = null;
  try { _ringCtx?.close(); } catch {}
  _ringCtx = null;
}

/* --- Chat message log (for persistence) --- */
let _chatLog = [];
let _saveChatHistory = null; // set by openChat, called from destroyChat

/** Clean up active connection and chat panel. */
async function destroyChat() {
  stopRingtone();
  // Save chat history before teardown (must await to avoid aborted requests)
  if (_saveChatHistory) {
    try { await _saveChatHistory(); } catch {}
    _saveChatHistory = null;
  }
  if (_activeConnect) {
    // When the connection was paused on navigation, skip clearing the signaling
    // block so a new WaymarkConnect with the same stable peerId can reclaim it
    // immediately, triggering nonce-change detection on remote peers for faster
    // reconnect instead of waiting for the old block to time out (ALIVE_TTL).
    _activeConnect.destroy({ keepBlock: _activeConnect._paused });
    _activeConnect = null;
  }
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
  if (_activeConnect) _activeConnect.pause();
});

/**
 * Build the floating chat panel and connect to peers.
 * @param {string} sheetId
 * @param {string} displayName
 * @param {Object} [signal] — Sheets signaling callbacks
 */
function openChat(sheetId, displayName, signal) {
  // Don't double-open for the same sheet
  if (_activeConnect && !_activeConnect._destroyed && _activeSheetId === sheetId) {
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
    doAcceptCall(false);
  });
  acceptVideoBtn.addEventListener('click', () => {
    hideIncomingCall();
    doAcceptCall(true);
  });
  declineBtn.addEventListener('click', () => {
    hideIncomingCall();
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
    if (!debugPanel.classList.contains('hidden') && _activeConnect && !_debugCleanup) {
      startDebug(_activeConnect);
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
    const connect = _activeConnect;
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

  // Cleanup handle for the Web Audio remote playback filter
  let _remoteFilterCleanup = null;
  let _pipelineGen = 0;
  let _duckVolumeRAF = null;

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
    if (_activeConnect && !_debugCleanup) startDebug(_activeConnect);
  }

  /** Leave the "in call" visual state and release all media devices */
  function exitCallUI() {
    // Stop local tracks to release camera/mic hardware
    if (_activeConnect?.localStream) {
      for (const t of _activeConnect.localStream.getTracks()) t.stop();
    }
    // Tear down remote audio filter and stop audio element
    if (_duckVolumeRAF) {
      cancelAnimationFrame(_duckVolumeRAF);
      _duckVolumeRAF = null;
    }
    if (_remoteFilterCleanup) {
      _remoteFilterCleanup();
      _remoteFilterCleanup = null;
    }
    remoteAudio.srcObject = null;
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
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    remoteAudio.srcObject = null;
    muteBtn.textContent = '🔇 Mute';
    camToggleBtn.textContent = '📷 Cam Off';
  }

  /** Start a call with the given constraints */
  async function startCall(constraints) {
    if (!_activeConnect) return;
    try {
      const stream = await _activeConnect.startCall(constraints);
      if (stream?._listenOnly) {
        // Joined but couldn't get mic/camera
        enterCallUI(false);
        const reason = stream._deviceError?.name || '';
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
        localVideo.srcObject = stream.getVideoTracks().length
          ? new MediaStream(stream.getVideoTracks()) : null;
        enterCallUI(constraints.video);
      }
    } catch (err) {
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

  /** Accept an incoming call — media permission is requested HERE, not before. */
  async function doAcceptCall(withVideo) {
    if (!_activeConnect || _activeConnect.inCall) return;
    appendMessage('System', 'Joining call…', Date.now(), false);
    try {
      const stream = await _activeConnect.startCall({ audio: buildAudioConstraints(), video: withVideo, audioProcessing: buildAudioProcessing() });
      if (stream?._listenOnly) {
        appendMessage('System', '🔇 Joined in listen-only mode. You can hear the caller but they cannot hear you.', Date.now(), false);
      } else {
        localVideo.srcObject = stream.getVideoTracks().length
          ? new MediaStream(stream.getVideoTracks()) : null;
      }
      enterCallUI(withVideo && !stream?._listenOnly);
    } catch (err) {
      let msg = `Could not join call: ${err.message}`;
      if (err.name === 'NotAllowedError') {
        msg = '🔒 Microphone blocked. Click the lock 🔒 icon → Site settings → Microphone → Allow, then reload.';
      }
      appendMessage('System', msg, Date.now(), false);
    }
  }

  callBtn.addEventListener('click', () => startCall({ audio: buildAudioConstraints(), video: false, audioProcessing: buildAudioProcessing() }));
  videoCallBtn.addEventListener('click', () => startCall({ audio: buildAudioConstraints(), video: true, audioProcessing: buildAudioProcessing() }));

  hangupBtn.addEventListener('click', () => {
    if (_activeConnect) _activeConnect.endCall();
    exitCallUI();
  });

  muteBtn.addEventListener('click', () => {
    if (!_activeConnect?.localStream) return;
    const audioTrack = _activeConnect.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      muteBtn.textContent = audioTrack.enabled ? '🔇 Mute' : '🔊 Unmute';
    }
  });

  camToggleBtn.addEventListener('click', () => {
    if (!_activeConnect?.localStream) return;
    const videoTrack = _activeConnect.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      camToggleBtn.textContent = videoTrack.enabled ? '📷 Cam Off' : '📷 Cam On';
    }
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
  let _lastTypingBroadcast = 0;
  input.addEventListener('input', () => {
    if (!_activeConnect) return;
    const now = Date.now();
    if (now - _lastTypingBroadcast > 2000) {
      _lastTypingBroadcast = now;
      _activeConnect.send(null, 'typing');
    }
  });

  _chatPanel.append(header, settingsPanel, incomingCallModal, mediaContainer, remoteAudio, messages, typingIndicator, callBar, debugPanel, inputBar);
  document.body.append(_chatPanel);

  // --- Render a chat message ---
  function appendMessage(name, text, ts, isSelf) {
    const bubble = el('div', { className: `social-chat-bubble ${isSelf ? 'social-chat-self' : 'social-chat-peer'}` });
    const initial = (name || '?')[0].toUpperCase();
    bubble.append(
      el('div', { className: 'social-avatar social-avatar-sm', style: `background: ${avatarColor(name || 'Anonymous')}` }, [initial]),
      el('div', { className: 'social-chat-bubble-body' }, [
        el('span', { className: 'social-chat-bubble-name' }, [name]),
        el('span', { className: 'social-chat-bubble-text' }, [text]),
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
    if (!text || !_activeConnect) return;
    const msg = _activeConnect.send(text);
    appendMessage(msg.name, msg.text, msg.ts, true);
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
        bubble.append(
          el('div', { className: 'social-avatar social-avatar-sm', style: `background: ${avatarColor(author || 'Anonymous')}` }, [initial]),
          el('div', { className: 'social-chat-bubble-body' }, [
            el('span', { className: 'social-chat-bubble-name' }, [author]),
            el('span', { className: 'social-chat-bubble-text' }, [text]),
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

  // --- Create connection ---
  _activeConnect = new WaymarkConnect(sheetId, {
    displayName,
    password: _socialPassword || null,
    signal,
    onMessage(msg) {
      if (msg.text === null && msg.type === 'typing') {
        showTyping(msg.name);
        return;
      }
      appendMessage(msg.name, msg.text, msg.ts, false);
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
    onRemoteStream(stream) {
      const hasVideo = stream.getVideoTracks().length > 0;
      if (hasVideo) {
        // Attach ONLY video tracks — audio goes exclusively through the echo
        // suppression pipeline. This prevents any unprocessed audio leaking
        // through the <video> element (muted attr is unreliable across platforms).
        const videoOnly = new MediaStream(stream.getVideoTracks());
        remoteVideo.srcObject = videoOnly;
        mediaContainer.classList.remove('hidden');
        remoteVideo.play().catch(() => {});
      } else {
        remoteVideo.srcObject = null;
      }
      // Route ALL remote audio through the echo suppression pipeline.
      // Use a generation counter so only the latest pipeline result is applied
      // (onRemoteStream may fire multiple times from ontrack / renegotiation).
      const nAudioTracks = stream.getAudioTracks().length;
      if (nAudioTracks > 0 && _activeConnect) {
        const tracks = stream.getAudioTracks();
        const t0 = tracks[0];
        // Show ICE state at time of track arrival for connectivity diagnostics
        let iceInfo = '';
        for (const [pid, r] of _activeConnect._rtc || []) {
          iceInfo += ` ICE[${pid.slice(0, 6)}]=${r?.pc?.iceConnectionState || '?'}`;
        }
        debugLog(`Remote stream: ${nAudioTracks} audio track(s), gen=${_pipelineGen + 1}, track=${t0?.readyState}/${t0?.enabled ? 'en' : 'dis'}/${t0?.muted ? 'muted' : 'live'}${iceInfo}`);
        const connect = _activeConnect;
        const gen = ++_pipelineGen;
        // Keep old pipeline running until new one is ready
        const oldCleanup = _remoteFilterCleanup;
        _remoteFilterCleanup = null;
        connect.createRemoteAudioPipeline(stream, {
          highPassFreq: getHighPassFreq(),
          echoSuppression: getEchoSuppression(),
          duckThreshold: Math.pow(10, getNoiseGateThreshold() / 20),
        }).then(result => {
          // Discard if superseded by a newer onRemoteStream call
          if (_activeConnect !== connect || _pipelineGen !== gen) {
            debugLog(`Pipeline gen=${gen} superseded by gen=${_pipelineGen} — discarded`);
            result.cleanup();
            if (oldCleanup) oldCleanup();
            return;
          }
          // Swap: tear down old, install new
          if (oldCleanup) oldCleanup();
          _remoteFilterCleanup = result.cleanup;
          // Raw remote stream goes directly on <audio> element — proven working
          // pattern. No Web Audio routing (Chrome/Linux discards packets).
          remoteAudio.srcObject = result.outputStream || null;
          if (result.outputStream) {
            remoteAudio.play().catch(() => {});
          }
          // Wire up volume-based echo ducking: rAF loop reads _duckState.volume
          // computed by webrtc.js and applies it to the <audio> element.
          if (connect._duckState) {
            const ds = connect._duckState;
            const applyVolume = () => {
              if (!connect._duckState || connect._duckState !== ds) return;
              remoteAudio.volume = ds.volume;
              _duckVolumeRAF = requestAnimationFrame(applyVolume);
            };
            if (_duckVolumeRAF) cancelAnimationFrame(_duckVolumeRAF);
            _duckVolumeRAF = requestAnimationFrame(applyVolume);
          }
          const ptype = connect._duckingRAF ? 'volume ducking' : 'direct';
          const outTracks = result.outputStream?.getAudioTracks() || [];
          const ot = outTracks[0];
          debugLog(`Pipeline ready: ${ptype}, output=${result.outputStream ? 'stream' : 'null'}, ctx=${connect._audioCtx?.state || 'none'}, outTrack=${ot?.readyState || 'none'}/${ot?.enabled ? 'en' : '-'}`);
        }).catch(err => {
          debugLog(`Pipeline error: ${err.message}`);
        });
      } else if (nAudioTracks === 0) {
        debugLog('Remote stream has no audio tracks');
      }
      // If we're already in a call (user initiated), just update UI
      if (_activeConnect?.inCall) {
        enterCallUI(hasVideo);
      }
    },
    onCallActive(peerId, name) {
      // Show incoming call prompt instead of auto-joining
      if (!_activeConnect?.inCall) {
        showIncomingCall(peerId, name);
      }
    },
    onCallEnded() {
      hideIncomingCall();
      // Deduplicate: call-end arrives via both BroadcastChannel and DataChannel
      if (!_activeConnect?.inCall) return;
      _activeConnect.endCall();
      exitCallUI();
      appendMessage('System', 'Peer ended the call.', Date.now(), false);
    },
  });
  _activeConnect.start();
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Social Feed',
  icon: '💬',
  color: '#6366f1',
  priority: 19,
  itemNoun: 'Post',
  defaultHeaders: ['Post', 'Author', 'Date', 'Category', 'Mood', 'Link', 'Comment', 'Likes', 'Image'],

  migrations: [
    { role: 'likes', header: 'Likes', description: 'Engagement count per post' },
    { role: 'image', header: 'Image', description: 'Image URL for photo posts' },
  ],

  detect(lower) {
    return lower.some(h => /^(post|message|status|update|wall|feed|content)/.test(h))
      && lower.some(h => /^(author|poster|user|posted.?by|from|name|who)/.test(h))
      && lower.some(h => /^(date|time|posted|timestamp|when|created)/.test(h));
  },

  columns(lower) {
    const cols = {
      text: -1, author: -1, date: -1, category: -1,
      mood: -1, link: -1, comment: -1, likes: -1, image: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.text     = lower.findIndex(h => /^(post|message|status|update|content|wall|feed)/.test(h));
    cols.author   = lower.findIndex((h, i) => !used().includes(i) && /^(author|poster|user|posted.?by|from|name|who)/.test(h));
    cols.date     = lower.findIndex((h, i) => !used().includes(i) && /^(date|time|posted|timestamp|when|created)/.test(h));
    cols.category = lower.findIndex((h, i) => !used().includes(i) && /^(category|type|kind|tag|topic)/.test(h));
    cols.mood     = lower.findIndex((h, i) => !used().includes(i) && /^(mood|feeling|emoji|vibe|status.?mood)/.test(h));
    cols.link     = lower.findIndex((h, i) => !used().includes(i) && /^(link|url|href|website|share)/.test(h));
    cols.comment  = lower.findIndex((h, i) => !used().includes(i) && /^(comment|reply|response|note|reaction)/.test(h));
    cols.likes    = lower.findIndex((h, i) => !used().includes(i) && /^(likes?|upvotes?|reactions?|engagement|hearts?)/.test(h));
    cols.image    = lower.findIndex((h, i) => !used().includes(i) && /^(image|photo|picture|img|media|attachment)/.test(h));

    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Post',      colIndex: cols.text,     type: 'textarea', placeholder: "What's on your mind?", required: true },
      { role: 'author',   label: 'Author',     colIndex: cols.author,   type: 'text',     placeholder: 'Your name' },
      { role: 'date',     label: 'Date',        colIndex: cols.date,     type: 'date' },
      { role: 'category', label: 'Category',    colIndex: cols.category, type: 'select',   options: ['update', 'photo', 'link', 'thought', 'milestone', 'question'] },
      { role: 'mood',     label: 'Mood',        colIndex: cols.mood,     type: 'select',   options: ['', ...Object.keys(MOOD_MAP)] },
      { role: 'link',     label: 'Link',        colIndex: cols.link,     type: 'text',     placeholder: 'https://...' },
      { role: 'image',    label: 'Image URL',   colIndex: cols.image,    type: 'text',     placeholder: 'https://...' },
    ];
  },

  /* ---------- Directory View (feed of shared profiles) ---------- */

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'social-directory' });

    const titleBar = el('div', { className: 'social-dir-title-bar' });
    titleBar.append(
      el('span', { className: 'social-dir-icon' }, ['💬']),
      el('span', { className: 'social-dir-title' }, ['Social Feed']),
      el('span', { className: 'social-dir-count' }, [
        `${sheets.length} profile${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    );
    wrapper.append(titleBar);

    // Collect all posts across all sheets for the combined feed
    const allPosts = [];
    for (const sheet of sheets) {
      const cols = sheet.cols;
      for (const row of (sheet.rows || [])) {
        const postText = cols.text >= 0 ? (row[cols.text] || '') : '';
        if (!postText) continue;
        // Chat rows belong in the chat panel, not the post feed
        const cat = cols.category >= 0 ? (row[cols.category] || '') : '';
        if (cat.toLowerCase() === 'chat') continue;
        allPosts.push({
          sheetId: sheet.id,
          sheetName: sheet.name,
          text: postText,
          author: cols.author >= 0 ? (row[cols.author] || sheet.name) : sheet.name,
          date: cols.date >= 0 ? (row[cols.date] || '') : '',
          category: cols.category >= 0 ? (row[cols.category] || '') : '',
          mood: cols.mood >= 0 ? (row[cols.mood] || '') : '',
          link: cols.link >= 0 ? (row[cols.link] || '') : '',
          likes: cols.likes >= 0 ? (row[cols.likes] || '') : '',
          image: cols.image >= 0 ? (row[cols.image] || '') : '',
        });
      }
    }

    // Sort by date descending
    allPosts.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    const feed = el('div', { className: 'social-feed' });

    const PAGE_SIZE = 20;
    let shown = 0;

    function renderBatch() {
      const batch = allPosts.slice(shown, shown + PAGE_SIZE);
      for (const post of batch) {
        feed.append(buildFeedCard(post));
      }
      shown += batch.length;

      // Remove old "more" button
      const oldMore = feed.querySelector('.social-feed-more');
      if (oldMore) oldMore.remove();

      if (shown < allPosts.length) {
        const moreBtn = el('button', { className: 'social-feed-more' }, [
          `Show ${Math.min(allPosts.length - shown, PAGE_SIZE)} more posts`,
        ]);
        moreBtn.addEventListener('click', renderBatch);
        feed.append(moreBtn);
      }
    }

    function buildFeedCard(post) {
      const card = el('div', {
        className: 'social-post',
        dataset: { entryId: post.sheetId, entryName: post.sheetName },
      });

      // Header: avatar + author + date + source
      const header = el('div', { className: 'social-post-header' });
      const initial = (post.author || '?')[0].toUpperCase();
      header.append(
        el('div', {
          className: 'social-avatar',
          style: `background: ${avatarColor(post.author)}`,
        }, [initial]),
        el('div', { className: 'social-post-meta' }, [
          el('span', { className: 'social-post-author' }, [post.author]),
          el('span', { className: 'social-post-time' }, [timeAgo(post.date)]),
        ]),
      );

      if (post.category) {
        const color = CATEGORY_COLORS[post.category.toLowerCase()] || '#6b7280';
        header.append(el('span', {
          className: 'social-post-category',
          style: `background: ${color}`,
        }, [post.category]));
      }

      card.append(header);

      // Body
      card.append(el('div', { className: 'social-post-body' }, [post.text]));

      // Mood
      if (post.mood) {
        const emoji = MOOD_MAP[post.mood.toLowerCase()] || post.mood;
        card.append(el('div', { className: 'social-post-mood' }, [
          `Feeling ${post.mood} ${emoji}`,
        ]));
      }

      // Link
      if (post.link) {
        const a = el('a', {
          className: 'social-post-link',
          href: post.link,
          target: '_blank',
          rel: 'noopener',
        }, [`🔗 ${post.link}`]);
        card.append(a);
      }

      // Image
      if (post.image) {
        card.append(el('img', {
          className: 'social-post-image',
          src: post.image,
          alt: 'Post image',
          loading: 'lazy',
        }));
      }

      // Likes
      if (post.likes) {
        card.append(el('div', { className: 'social-post-likes' }, [
          `❤️ ${post.likes}`,
        ]));
      }

      // Source badge
      card.append(el('div', { className: 'social-post-source' }, [
        `from `,
        el('span', { className: 'social-post-source-name' }, [post.sheetName]),
      ]));

      return card;
    }

    // Delegated click: click post card → navigate to that sheet
    delegateEvent(feed, 'click', '.social-post', (_e, card) => {
      const a = _e.target.closest('a');
      if (a) return; // Don't navigate when clicking links
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    renderBatch();
    wrapper.append(feed);

    if (allPosts.length === 0) {
      wrapper.append(el('p', { className: 'social-empty' }, ['No posts yet. Create a social sheet and start posting!']));
    }

    container.append(wrapper);
  },

  /* ---------- Main Render ---------- */

  render(container, rows, cols, template) {
    const groups = parseGroups(rows, cols.text, {
      initGroup: () => ({ comments: [] }),
      classifyChild: (child, parent) => {
        parent.comments.push(child);
      },
    });

    // Collect unique authors for add-row combo
    const allAuthors = cols.author >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.author)).filter(Boolean))].sort()
      : [];

    container.innerHTML = '';

    /* ---- Profile header ---- */
    const profileHeader = el('div', { className: 'social-profile-header' });

    // Determine dominant author (page owner)
    const authorCounts = {};
    for (const g of groups) {
      const a = cols.author >= 0 ? cell(g.row, cols.author) : '';
      if (a) authorCounts[a] = (authorCounts[a] || 0) + 1;
    }
    const pageOwner = Object.entries(authorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'My Feed';

    const ownerInitial = pageOwner[0].toUpperCase();
    const connectBtn = el('button', {
      className: 'social-connect-btn',
      title: 'Start live peer-to-peer chat with anyone viewing this sheet',
      on: { click() { openChat(template._rtcSheetId, template._rtcUserName, template._rtcSignal); } },
    }, ['📡 Connect']);

    // Session password for encrypted handshakes
    const { row: pwRow } = buildHandshakePasswordRow({
      prefix: 'social',
      initialValue: _socialPassword,
      onPasswordChange(newPw) {
        _socialPassword = newPw || '';
        if (_activeConnect) _activeConnect.setPassword(newPw);
      },
    });

    profileHeader.append(
      el('div', {
        className: 'social-avatar social-avatar-lg',
        style: `background: ${avatarColor(pageOwner)}`,
      }, [ownerInitial]),
      el('div', { className: 'social-profile-info' }, [
        el('h3', { className: 'social-profile-name' }, [pageOwner]),
        el('span', { className: 'social-profile-stats' }, [
          `${groups.length} post${groups.length !== 1 ? 's' : ''} · ${allAuthors.length} contributor${allAuthors.length !== 1 ? 's' : ''}`,
        ]),
      ]),
      connectBtn,
    );
    container.append(profileHeader);
    container.append(pwRow);

    /* ---- Add row form ---- */
    if (typeof template._onAddRow === 'function' && typeof template.addRowFields === 'function') {
      const addForm = buildAddRowForm(template, cols, template._totalColumns || 0, template._onAddRow, {
        dynamicOptions: {},
      });
      container.append(addForm);
    }

    /* ---- Posts feed ---- */
    const feed = el('div', { className: 'social-feed' });

    // Sort groups by date descending
    const sorted = [...groups].sort((a, b) => {
      const da = cols.date >= 0 ? cell(a.row, cols.date) : '';
      const db = cols.date >= 0 ? cell(b.row, cols.date) : '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    for (const group of sorted) {
      const postText = cell(group.row, cols.text);
      const author   = cols.author >= 0 ? cell(group.row, cols.author) : '';
      const date     = cols.date >= 0 ? cell(group.row, cols.date) : '';
      const category = cols.category >= 0 ? cell(group.row, cols.category) : '';
      // Chat rows belong in the chat panel, not the post feed
      if (category.toLowerCase() === 'chat') continue;
      const mood     = cols.mood >= 0 ? cell(group.row, cols.mood) : '';
      const link     = cols.link >= 0 ? cell(group.row, cols.link) : '';
      const likes    = cols.likes >= 0 ? cell(group.row, cols.likes) : '';
      const image    = cols.image >= 0 ? cell(group.row, cols.image) : '';

      const post = el('div', {
        className: 'social-post',
        dataset: { rowIdx: String(group.idx + 1) },
      });

      /* ---- Post header ---- */
      const header = el('div', { className: 'social-post-header' });
      const initial = (author || '?')[0].toUpperCase();
      header.append(
        el('div', {
          className: 'social-avatar',
          style: `background: ${avatarColor(author || 'Anonymous')}`,
        }, [initial]),
        el('div', { className: 'social-post-meta' }, [
          cols.author >= 0
            ? editableCell('span', { className: 'social-post-author' }, author, group.idx + 1, cols.author)
            : el('span', { className: 'social-post-author' }, [author || 'Anonymous']),
          el('span', { className: 'social-post-time' }, [timeAgo(date)]),
        ]),
      );

      if (category) {
        const color = CATEGORY_COLORS[category.toLowerCase()] || '#6b7280';
        header.append(el('span', {
          className: 'social-post-category',
          style: `background: ${color}`,
        }, [category]));
      }

      post.append(header);

      /* ---- Post body (editable) ---- */
      post.append(editableCell('div', { className: 'social-post-body' }, postText, group.idx + 1, cols.text, {
        multiline: true,
      }));

      /* ---- Mood ---- */
      if (mood) {
        const emoji = MOOD_MAP[mood.toLowerCase()] || mood;
        post.append(el('div', { className: 'social-post-mood' }, [
          `Feeling ${mood} ${emoji}`,
        ]));
      }

      /* ---- Link ---- */
      if (link) {
        const a = el('a', {
          className: 'social-post-link',
          href: link,
          target: '_blank',
          rel: 'noopener',
        }, [`🔗 ${link}`]);
        post.append(a);
      }

      /* ---- Image ---- */
      if (image) {
        post.append(el('img', {
          className: 'social-post-image',
          src: image,
          alt: 'Post image',
          loading: 'lazy',
        }));
      }

      /* ---- Likes ---- */
      if (likes) {
        post.append(el('div', { className: 'social-post-likes' }, [
          `❤️ ${likes}`,
        ]));
      }

      /* ---- Comments ---- */
      if (group.comments && group.comments.length > 0) {
        const commentsSection = el('div', { className: 'social-comments' });
        commentsSection.append(el('div', { className: 'social-comments-label' }, [
          `💬 ${group.comments.length} comment${group.comments.length !== 1 ? 's' : ''}`,
        ]));

        for (const cmt of group.comments) {
          const cmtAuthor = cols.author >= 0 ? cell(cmt.row, cols.author) : '';
          // Comment rows have empty text column (that's how parseGroups classifies them).
          // Try dedicated comment column first, then scan all columns for any content.
          let cmtText = '';
          if (cols.comment >= 0) {
            cmtText = cell(cmt.row, cols.comment);
          }
          if (!cmtText) {
            // Fallback: find the first non-empty cell that isn't the author or date
            // Skip SIG_COL (WebRTC signaling) so handshake JSON never leaks into the UX
            const skip = new Set([cols.text, cols.author, cols.date, cols.category, cols.mood, cols.link, cols.likes, cols.image, SIG_COL].filter(c => c >= 0));
            for (let ci = 0; ci < cmt.row.length; ci++) {
              if (!skip.has(ci) && cell(cmt.row, ci)) { cmtText = cell(cmt.row, ci); break; }
            }
          }
          // Skip rows with no visible content (e.g. signaling-only rows)
          if (!cmtText && !cmtAuthor) continue;
          const cmtDate   = cols.date >= 0 ? cell(cmt.row, cols.date) : '';

          const cmtEl = el('div', { className: 'social-comment' });
          const cmtInitial = (cmtAuthor || '?')[0].toUpperCase();
          cmtEl.append(
            el('div', {
              className: 'social-avatar social-avatar-sm',
              style: `background: ${avatarColor(cmtAuthor || 'Anonymous')}`,
            }, [cmtInitial]),
            el('div', { className: 'social-comment-content' }, [
              el('span', { className: 'social-comment-author' }, [cmtAuthor || 'Anonymous']),
              el('span', { className: 'social-comment-text' }, [cmtText]),
              cmtDate ? el('span', { className: 'social-comment-time' }, [timeAgo(cmtDate)]) : null,
            ].filter(Boolean)),
          );
          commentsSection.append(cmtEl);
        }
        post.append(commentsSection);
      }

      /* ---- Post footer (date + category) ---- */
      const footer = el('div', { className: 'social-post-footer' });
      if (date) {
        footer.append(el('span', { className: 'social-post-date' }, [
          new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ]));
      }
      post.append(footer);

      feed.append(post);
    }

    container.append(feed);

    if (groups.length === 0) {
      feed.append(el('p', { className: 'social-empty' }, ['No posts yet. Add your first post above!']));
    }
  },
};

export { openChat, destroyChat };
