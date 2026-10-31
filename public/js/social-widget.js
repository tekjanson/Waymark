/* ============================================================
   social-widget.js — Unified Frontend Social Chat & Call Component

   Single, reusable frontend UI abstraction for both:
   1. Floating mode (Social template chat panel, sheet attachments)
   2. Embedded mode (The Wayside dock on the Wayboard home screen)
   ============================================================ */

import { el, showToast } from './ui.js';
import {
  getChatSaveHistory, setChatSaveHistory,
  getChatSoundEnabled, setChatSoundEnabled,
  getEchoCancellation, setEchoCancellation,
  getNoiseSuppression, setNoiseSuppression,
  getAutoGainControl, setAutoGainControl,
  getNoiseGateThreshold, setNoiseGateThreshold,
  getHighPassFreq, setHighPassFreq,
  getEchoSuppression, setEchoSuppression,
} from './storage.js';
import { avatarColor, timeAgo } from './templates/social/helpers.js';
import { SocialSession, appendLinkified } from './social-session.js';

// Global error capture for the audio/WebRTC diagnostic snapshot
const _capturedErrors = [];
if (typeof window !== 'undefined' && !window.__WAYMARK_ERRORS_HOOKED) {
  window.__WAYMARK_ERRORS_HOOKED = true;
  const origErr = console.error;
  const origWarn = console.warn;
  console.error = function (...args) {
    _capturedErrors.push({ level: 'error', ts: new Date().toISOString(), msg: args.map(String).join(' ') });
    if (_capturedErrors.length > 100) _capturedErrors.shift();
    origErr.apply(console, args);
  };
  console.warn = function (...args) {
    _capturedErrors.push({ level: 'warn', ts: new Date().toISOString(), msg: args.map(String).join(' ') });
    if (_capturedErrors.length > 100) _capturedErrors.shift();
    origWarn.apply(console, args);
  };
  window.addEventListener('error', (e) => {
    _capturedErrors.push({ level: 'uncaught', ts: new Date().toISOString(), msg: `${e.message} at ${e.filename}:${e.lineno}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    _capturedErrors.push({ level: 'rejection', ts: new Date().toISOString(), msg: String(e.reason) });
  });
}

export class SocialChatWidget {
  /**
   * @param {Object} opts
   * @param {'floating'|'embedded'} [opts.mode='floating']
   * @param {string} [opts.sheetId]
   * @param {string} [opts.displayName]
   * @param {string} [opts.password]
   * @param {string} [opts.title='Live Chat']
   * @param {string} [opts.subtitle='']
   * @param {Object} [opts.signal]
   * @param {Function} [opts.persistChat] — async (msg) => { ... }
   * @param {HTMLElement} [opts.mountTo]
   * @param {boolean} [opts.showClose=true]
   * @param {boolean} [opts.showMinimize] — default true in floating, false in embedded
   * @param {boolean} [opts.showSheetLink=false]
   * @param {boolean} [opts.showConnectDrive=false]
   * @param {Function} [opts.onClose]
   * @param {Function} [opts.onOpenSheet]
   * @param {Function} [opts.onConnectDrive]
   * @param {SocialSession} [opts.session]
   */
  constructor(opts = {}) {
    this.mode = opts.mode || 'floating';
    this.sheetId = opts.sheetId || '';
    this.displayName = opts.displayName || 'Waymarker';
    this.password = opts.password || null;
    this.titleText = opts.title || (this.mode === 'embedded' ? '💬 Wayside' : '📡 Live Chat');
    this.subtitleText = opts.subtitle || (this.mode === 'embedded' ? 'Pick a crew or Waymarker to trade Waymarks' : 'Listening…');
    this.signal = opts.signal || null;
    this.persistChat = opts.persistChat || null;

    this.userEmail = opts.userEmail || '';
    this.onClose = opts.onClose || (() => {});
    this.onOpenSheet = opts.onOpenSheet || (() => {});
    this.onConnectDrive = opts.onConnectDrive || (() => {});
    this.onBeforeStartCall = opts.onBeforeStartCall || null;

    this.showClose = opts.showClose !== false;
    this.showMinimize = opts.showMinimize !== undefined ? opts.showMinimize : (this.mode === 'floating');
    this.showSheetLink = opts.showSheetLink !== undefined ? !!opts.showSheetLink : (this.mode === 'embedded');
    this.showConnectDrive = opts.showConnectDrive !== undefined ? !!opts.showConnectDrive : (this.mode === 'embedded');

    this._chatLog = [];
    this._unreadCount = 0;
    this._typingTimer = null;
    this._debugCleanup = null;
    this._debugLogLines = 0;
    this._historySaved = false;

    // Use passed session or instantiate new one
    this.session = opts.session || new SocialSession({
      sheetId: this.sheetId,
      displayName: this.displayName,
      password: this.password,
      signal: this.signal,
      persistChat: this.persistChat,
      onMessage: (msg) => {
        this.appendMessage({
          id: msg.id,
          sender: msg.sender || msg.name || 'Collaborator',
          text: msg.text,
          ts: msg.ts,
          self: msg.self,
        });
      },
      onPeersChanged: (peers) => {
        const count = peers?.size ?? (Array.isArray(peers) ? peers.length : 0);
        if (this.peerCount) {
          this.peerCount.textContent = `${count} peer${count !== 1 ? 's' : ''}`;
        }
        if (this.mode === 'embedded' && this.subtitle && !this.session.inCall) {
          this.subtitle.textContent = `P2P · ${count} connected · Linked: ${this.sheetId}`;
        }
      },
      onStatusChanged: (status) => {
        if (this.statusDot) {
          this.statusDot.className = `social-chat-status social-chat-status-${status}`;
        }
        const labels = { connected: 'Connected', listening: 'Listening…', pairing: 'Pairing…', disconnected: 'Disconnected' };
        if (this.statusLabel) {
          this.statusLabel.textContent = labels[status] || status;
        }
        if (status === 'disconnected') {
          this.saveChatHistory();
        }
      },
      onTyping: (name) => {
        this.showTyping(name);
      },
      onCallStateChanged: (state, details) => {
        this._handleCallStateChanged(state, details);
      },
      onRemoteStream: (stream) => {
        const hasVideo = stream.getVideoTracks().length > 0;
        if (hasVideo && this.mediaContainer) {
          this.mediaContainer.classList.remove('hidden');
        }
        if (this.session.inCall) {
          this.enterCallUI(hasVideo);
        }
      },
    });

    this._buildDOM();

    // Bind media elements to session
    this.session.bindRemoteAudio(this.remoteAudio);
    this.session.bindRemoteVideo(this.remoteVideo);
    this.session.bindLocalVideo(this.localVideo);

    if (opts.mountTo) {
      this.mount(opts.mountTo);
    } else if (this.mode === 'floating' && typeof document !== 'undefined') {
      this.mount(document.body);
    }

    if (this.sheetId) {
      this.session.start();
      if (typeof window !== 'undefined') {
        window.__WAYMARK_CONNECT = this.session.connect;
      }
      this._restoreSheetHistory();
    }
  }

  mount(container) {
    if (!container || !this.root) return;
    container.append(this.root);
  }

  setTitle(title) {
    this.titleText = title;
    if (this.titleEl) this.titleEl.textContent = title;
  }

  setSubtitle(subtitle) {
    this.subtitleText = subtitle;
    if (this.subtitle) this.subtitle.textContent = subtitle;
  }

  _buildDOM() {
    const isFloating = this.mode === 'floating';
    const rootClasses = isFloating
      ? 'social-chat-panel'
      : 'social-chat-panel social-chat-embedded chat-box';

    this.root = el('div', { className: rootClasses });

    /* ---------- Header ---------- */
    const header = el('div', { className: 'social-chat-header chat-box-head' });

    this.titleEl = el('span', {
      className: 'social-chat-title',
      id: 'wayside-crew-title',
    }, [this.titleText]);

    this.statusDot = el('span', {
      className: 'social-chat-status social-chat-status-listening',
    });

    this.statusLabel = el('span', {
      className: 'social-chat-status-label',
    }, [this.subtitleText]);

    this.peerCount = el('span', {
      className: 'social-chat-peer-count',
    }, ['0 peers']);

    this.unreadBadge = el('span', {
      className: 'social-chat-unread hidden',
    }, ['0']);

    const headerActions = el('div', { className: 'chat-box-actions social-header-actions' });

    if (this.showSheetLink) {
      this.sheetBtn = el('button', {
        className: 'btn btn-muted',
        id: 'wayside-sheet-btn',
        title: 'Open the shared Waymark',
        on: { click: () => this.onOpenSheet() },
      }, ['🔗 Waymark']);
      headerActions.append(this.sheetBtn);
    }

    if (this.showConnectDrive) {
      this.connectBtn = el('button', {
        className: 'btn btn-muted',
        id: 'wayside-connect-btn',
        title: 'Connect a shared ledger from Drive',
        on: { click: () => this.onConnectDrive() },
      }, ['📥 Connect']);
      headerActions.append(this.connectBtn);
    }

    this.settingsBtn = el('button', {
      className: 'social-chat-settings-btn btn-icon',
      title: 'Chat settings',
      on: { click: () => this.settingsPanel.classList.toggle('hidden') },
    }, ['⚙️']);
    headerActions.append(this.settingsBtn);

    if (this.showMinimize) {
      this.minimizeBtn = el('button', {
        className: 'social-chat-minimize btn-icon',
        title: 'Minimize',
        on: { click: () => {
          this.root.classList.toggle('social-chat-minimized');
          if (!this.root.classList.contains('social-chat-minimized')) {
            this._unreadCount = 0;
            this.unreadBadge.classList.add('hidden');
          }
        } },
      }, ['—']);
      headerActions.append(this.minimizeBtn);
    }

    if (this.showClose) {
      this.closeBtn = el('button', {
        className: 'social-chat-close btn-icon',
        id: 'wayside-close-btn',
        title: isFloating ? 'Disconnect' : 'Close chat',
        on: { click: () => this.onClose() },
      }, ['✕']);
      headerActions.append(this.closeBtn);
    }

    header.append(
      this.titleEl,
      this.statusDot,
      isFloating ? this.statusLabel : null,
      this.peerCount,
      this.unreadBadge,
      headerActions,
    );

    /* ---------- Sheet Line (Wayside subtitle) ---------- */
    this.subtitle = el('div', {
      className: 'chat-sheet-line',
      id: 'wayside-sheet-line',
    }, [this.subtitleText]);

    /* ---------- Settings Panel ---------- */
    this.settingsPanel = el('div', { className: 'social-chat-settings-panel hidden' });
    this._buildSettingsPanel();

    /* ---------- Incoming Call Card ---------- */
    this.incomingCallModal = el('div', { className: 'social-incoming-call wayside-incoming-call hidden' });
    this.incomingCallerName = el('span', { className: 'social-incoming-caller' }, ['']);
    this.incomingLabel = el('span', { className: 'social-incoming-label' }, ['is calling…']);
    const acceptBtn = el('button', { className: 'social-incoming-accept' }, ['✅ Accept']);
    const acceptVideoBtn = el('button', { className: 'social-incoming-accept-video' }, ['📹 Accept w/ Video']);
    const declineBtn = el('button', { className: 'social-incoming-decline' }, ['❌ Decline']);

    acceptBtn.addEventListener('click', () => {
      this.hideIncomingCall();
      this.session.acceptCall(false).catch(() => {});
    });
    acceptVideoBtn.addEventListener('click', () => {
      this.hideIncomingCall();
      this.session.acceptCall(true).catch(() => {});
    });
    declineBtn.addEventListener('click', () => {
      this.hideIncomingCall();
      this.session.declineCall();
      this.appendMessage({ sender: 'System', text: 'You declined the call.', ts: Date.now(), self: false });
    });

    this.incomingCallModal.append(
      el('div', { className: 'social-incoming-ring-icon' }, ['📞']),
      el('div', { className: 'social-incoming-info' }, [this.incomingCallerName, this.incomingLabel]),
      el('div', { className: 'social-incoming-actions' }, [acceptBtn, acceptVideoBtn, declineBtn]),
    );

    /* ---------- Media Container (Remote & Local Video) ---------- */
    this.mediaContainer = el('div', {
      className: 'social-media-container wayside-media-container hidden',
      id: 'wayside-media-container',
    });
    this.localVideo = el('video', {
      className: 'social-local-video wayside-local-video',
      id: 'wayside-local-video',
      muted: true,
      autoplay: true,
      playsInline: true,
    });
    this.remoteVideo = el('video', {
      className: 'social-remote-video wayside-remote-video',
      id: 'wayside-remote-video',
      autoplay: true,
      playsInline: true,
    });
    // Remote audio lives outside mediaContainer so it is never muted by display:none
    this.remoteAudio = el('audio', {
      className: 'social-remote-audio',
      id: 'wayside-remote-audio',
      autoplay: true,
      playsInline: true,
    });
    this.mediaContainer.append(this.remoteVideo, this.localVideo);

    /* ---------- Call Bar ---------- */
    this.callBar = el('div', { className: 'social-call-bar chat-box-actions' });
    this.callBtn = el('button', {
      className: 'social-call-btn btn',
      id: 'wayside-call-btn',
      title: 'Start audio call',
    }, ['📹 Call']);

    this.videoCallBtn = el('button', {
      className: 'social-call-btn social-call-btn-video btn',
      title: 'Start video call',
    }, ['📹 Video']);

    this.hangupBtn = el('button', {
      className: 'social-call-btn social-call-btn-hangup btn hidden',
      title: 'End call',
    }, ['🔴 Hang Up']);

    this.muteBtn = el('button', {
      className: 'social-call-btn social-call-btn-mute btn hidden',
      id: 'wayside-mute-btn',
      title: 'Toggle mute',
    }, ['🔇 Mute']);

    this.camToggleBtn = el('button', {
      className: 'social-call-btn social-call-btn-cam btn hidden',
      id: 'wayside-cam-btn',
      title: 'Toggle camera',
    }, ['📷 Cam Off']);

    this.debugBtn = el('button', {
      className: 'social-call-btn social-debug-btn btn hidden',
      title: 'Audio debug panel',
    }, ['🐛 Debug']);

    this.callBtn.addEventListener('click', async () => {
      if (this.session.inCall || this.session.callState === 'calling') {
        await this.session.endCall();
        this.exitCallUI();
      } else if (this.session.callState === 'ringing') {
        await this.session.acceptCall(false).catch(() => {});
      } else {
        if (this.onBeforeStartCall) await this.onBeforeStartCall();
        await this.session.startCall({ audio: true, video: true }).catch(() => {});
      }
    });

    this.videoCallBtn.addEventListener('click', async () => {
      if (this.session.inCall || this.session.callState === 'calling') {
        await this.session.endCall();
        this.exitCallUI();
      } else if (this.session.callState === 'ringing') {
        await this.session.acceptCall(true).catch(() => {});
      } else {
        if (this.onBeforeStartCall) await this.onBeforeStartCall();
        await this.session.startCall({ audio: true, video: true }).catch(() => {});
      }
    });

    this.hangupBtn.addEventListener('click', () => {
      this.session.endCall();
      this.exitCallUI();
    });

    this.muteBtn.addEventListener('click', () => {
      const isMuted = this.session.toggleMute();
      this.muteBtn.textContent = isMuted ? '🔊 Unmute' : '🔇 Mute';
    });

    this.camToggleBtn.addEventListener('click', () => {
      const isCamOff = this.session.toggleCamera();
      this.camToggleBtn.textContent = isCamOff ? '📷 Cam On' : '📷 Cam Off';
    });

    this.debugBtn.addEventListener('click', () => {
      this.debugPanel.classList.toggle('hidden');
      this.debugBtn.classList.toggle('social-debug-btn-active');
      if (!this.debugPanel.classList.contains('hidden') && this.session?.connect && !this._debugCleanup) {
        this._startDebug(this.session.connect);
      }
    });

    this.callBar.append(
      this.callBtn,
      this.videoCallBtn,
      this.hangupBtn,
      this.muteBtn,
      this.camToggleBtn,
      this.debugBtn,
    );

    /* ---------- Audio Debug Panel ---------- */
    this.debugPanel = el('div', { className: 'social-debug-panel hidden' });
    this._buildDebugPanel();

    /* ---------- Messages Container ---------- */
    this.messages = el('div', {
      className: 'social-chat-messages chat-log',
      id: 'wayside-chat-log',
    });

    /* ---------- Typing Indicator ---------- */
    this.typingIndicator = el('div', { className: 'social-typing-indicator hidden' });

    /* ---------- Input Bar ---------- */
    const inputBar = el('div', { className: 'social-chat-input-bar' });
    this.input = el('input', {
      className: 'social-chat-input chat-input',
      id: 'wayside-chat-input',
      type: 'text',
      placeholder: isFloating ? 'Type a message…' : 'Send a wave…',
      autocomplete: 'off',
    });
    const sendBtn = el('button', { className: 'social-chat-send btn' }, ['Send']);

    this.input.addEventListener('input', () => {
      this.session.sendTyping();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendMessage();
      }
    });
    sendBtn.addEventListener('click', () => this.sendMessage());
    inputBar.append(this.input, sendBtn);

    /* ---------- Assemble Root ---------- */
    this.root.append(
      header,
      !isFloating ? this.subtitle : null,
      this.settingsPanel,
      this.incomingCallModal,
      this.mediaContainer,
      this.remoteAudio,
      this.messages,
      this.typingIndicator,
      this.callBar,
      this.debugPanel,
      inputBar,
    );
  }

  _buildSettingsPanel() {
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

    this.settingsPanel.append(
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
        + 'hearing your own voice back. 100% = full mute. Settings apply on next call.',
      ]),
    );
  }

  _buildDebugPanel() {
    this.debugPanel.innerHTML = `
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

    this.debugPanel.querySelector('.social-debug-close').addEventListener('click', () => {
      this.debugPanel.classList.add('hidden');
      this.debugBtn.classList.remove('social-debug-btn-active');
    });
    this.debugPanel.querySelector('.social-debug-clear-log').addEventListener('click', () => {
      this.debugPanel.querySelector('.sd-event-log').textContent = '';
    });
    this.debugPanel.querySelector('.social-debug-download').addEventListener('click', () => {
      this._downloadDebugSnapshot();
    });
  }

  showIncomingCall(peerId, name) {
    this.incomingCallerName.textContent = name || 'Peer';
    this.incomingCallModal.classList.remove('hidden');
    this.root.classList.remove('social-chat-minimized');
    if (this.callBtn) {
      this.callBtn.textContent = '📲 Join Call';
      this.callBtn.classList.add('call-active');
    }
    if (this.subtitle) {
      this.subtitle.textContent = `Incoming call from ${name || 'a Waymarker'} · Linked: ${this.sheetId}`;
    }
  }

  hideIncomingCall() {
    this.incomingCallModal.classList.add('hidden');
    if (this.callBtn && !this.session.inCall) {
      this.callBtn.textContent = '📹 Call';
      this.callBtn.classList.remove('call-active');
    }
  }

  enterCallUI(hasVideo) {
    this.callBtn.textContent = '📴 End Call';
    this.callBtn.classList.add('call-active');
    this.videoCallBtn.classList.add('hidden');
    this.hangupBtn.classList.remove('hidden');
    this.muteBtn.classList.remove('hidden');
    if (hasVideo) {
      this.camToggleBtn.classList.remove('hidden');
      this.mediaContainer.classList.remove('hidden');
    }
    this.debugBtn.classList.remove('hidden');
    this.root.classList.add('social-chat-in-call');
    if (this.subtitle) {
      this.subtitle.textContent = `📹 In call · Linked: ${this.sheetId}`;
    }
    if (this.session?.connect && !this._debugCleanup) {
      this._startDebug(this.session.connect);
    }
  }

  exitCallUI() {
    this._stopDebug();
    this.debugBtn.classList.add('hidden');
    this.debugPanel.classList.add('hidden');
    this.debugBtn.classList.remove('social-debug-btn-active');
    this.callBtn.textContent = '📹 Call';
    this.callBtn.classList.remove('call-active');
    this.videoCallBtn.classList.remove('hidden');
    this.hangupBtn.classList.add('hidden');
    this.muteBtn.classList.add('hidden');
    this.camToggleBtn.classList.add('hidden');
    this.mediaContainer.classList.add('hidden');
    this.root.classList.remove('social-chat-in-call');
    this.muteBtn.textContent = '🔇 Mute';
    this.camToggleBtn.textContent = '📷 Cam Off';
    if (this.subtitle) {
      this.subtitle.textContent = this.sheetId ? `Linked: ${this.sheetId}` : 'Linked on first share';
    }
  }

  _handleCallStateChanged(state, details) {
    if (state === 'ringing') {
      this.showIncomingCall(details.peerId, details.name);
    } else if (state === 'calling') {
      this.hideIncomingCall();
      this.callBtn.textContent = '⏳ Starting…';
      this.callBtn.classList.add('call-active');
      this.callBtn.title = 'Cancel the call setup';
      this.hangupBtn.classList.remove('hidden');
    } else if (state === 'in-call') {
      this.hideIncomingCall();
      if (details?.listenOnly) {
        this.enterCallUI(false);
        const reason = details.deviceError?.name || '';
        if (reason === 'NotFoundError' || reason === 'NotReadableError') {
          this.appendMessage({
            sender: 'System',
            text: '🔇 Joined call in listen-only mode (no microphone detected).\n'
              + 'You can hear the other person but they cannot hear you.\n\n'
              + 'To fix: click the lock/tune 🔒 icon in your address bar → Site settings → Microphone → Allow, then reload.',
            ts: Date.now(),
            self: false,
          });
        } else {
          this.appendMessage({
            sender: 'System',
            text: '🔇 Joined call in listen-only mode. You can hear the other person but they cannot hear you.',
            ts: Date.now(),
            self: false,
          });
        }
      } else {
        this.enterCallUI(details?.video);
      }
    } else if (state === 'idle') {
      this.hideIncomingCall();
      this.exitCallUI();
      if (details?.remoteEnded) {
        this.appendMessage({ sender: 'System', text: 'Peer ended the call.', ts: Date.now(), self: false });
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
        this.appendMessage({ sender: 'System', text: msg, ts: Date.now(), self: false });
      }
    }
  }

  appendMessage({ id, sender, text, ts, self = false, failed = false, history = false }) {
    const isSelf = self || (sender === this.displayName) || (this.userEmail && (sender || '').toLowerCase() === this.userEmail.toLowerCase());
    const key = id || `${sender}:${ts}:${text}`;

    let existingNode = this.messages.querySelector(`[data-message-key="${CSS.escape(key)}"]`);
    if (existingNode) {
      if (failed) existingNode.classList.add('chat-failed');
      else existingNode.classList.remove('chat-failed');
      return;
    }

    const bubble = el('div', {
      className: `social-chat-bubble ${history ? 'social-chat-history' : ''} ${isSelf ? 'social-chat-self chat-self' : 'social-chat-peer chat-peer'} ${failed ? 'chat-failed' : ''}`,
      dataset: { messageKey: key },
    });

    const initial = (sender || '?')[0].toUpperCase();
    const textSpan = el('span', { className: 'social-chat-bubble-text' });
    appendLinkified(textSpan, text);

    const safeIso = (ts && !isNaN(new Date(ts).getTime())) ? new Date(ts).toISOString() : new Date().toISOString();
    const who = isSelf ? 'You' : (sender || '').split('@')[0];

    bubble.append(
      el('div', { className: 'social-avatar social-avatar-sm', style: `background: ${avatarColor(sender || 'Anonymous')}` }, [initial]),
      el('div', { className: 'social-chat-bubble-body' }, [
        el('span', { className: 'social-chat-bubble-name' }, [who]),
        textSpan,
        el('span', { className: 'social-chat-bubble-time' }, [timeAgo(safeIso)]),
      ]),
    );

    this.messages.append(bubble);
    this.messages.scrollTop = this.messages.scrollHeight;

    if (!history && sender !== 'System') {
      this._chatLog.push({ name: sender, text, ts, self: isSelf });
    }

    if (this.root.classList.contains('social-chat-minimized') && !isSelf && sender !== 'System') {
      this._unreadCount++;
      this.unreadBadge.textContent = String(this._unreadCount);
      this.unreadBadge.classList.remove('hidden');
    }
  }

  sendMessage() {
    const text = this.input.value.trim();
    if (!text || !this.session) return;
    this.session.sendMessage(text);
    this.input.value = '';
  }

  showTyping(name) {
    this.typingIndicator.textContent = `${name} is typing…`;
    this.typingIndicator.classList.remove('hidden');
    clearTimeout(this._typingTimer);
    this._typingTimer = setTimeout(() => this.typingIndicator.classList.add('hidden'), 3000);
  }

  setPassword(pw) {
    this.password = pw || null;
    if (this.session) {
      this.session.setPassword(pw);
    }
  }

  async saveChatHistory() {
    if (this._historySaved || !getChatSaveHistory() || this._chatLog.length === 0) return;
    if (!this.signal?.appendChatHistory) return;
    this._historySaved = true;
    const { cols: c, totalCols: tc } = this.signal;
    const rows = this._chatLog.map(m => {
      const row = new Array(tc || 7).fill('');
      if (c.text >= 0)     row[c.text]     = m.text;
      if (c.author >= 0)   row[c.author]   = m.name;
      if (c.date >= 0)     row[c.date]     = new Date(m.ts).toISOString();
      if (c.category >= 0) row[c.category] = 'chat';
      return row;
    });
    try {
      await this.signal.appendChatHistory(rows);
    } catch (err) {
      console.warn('[social] chat history save failed:', err);
      this._historySaved = false;
    }
  }

  _restoreSheetHistory() {
    if (!this.signal?.readAll || !this.signal.cols) return;
    const c = this.signal.cols;
    this.signal.readAll().then(allRows => {
      const dataRows = allRows.slice(1);
      for (const row of dataRows) {
        const cat = c.category >= 0 ? (row[c.category] || '').toLowerCase() : '';
        if (cat !== 'chat') continue;
        const text = c.text >= 0 ? (row[c.text] || '') : '';
        const author = c.author >= 0 ? (row[c.author] || '') : '';
        const date = c.date >= 0 ? (row[c.date] || '') : '';
        if (!text) continue;
        const ts = date ? new Date(date).getTime() : 0;
        this.appendMessage({
          sender: author,
          text,
          ts,
          self: author === this.displayName,
          history: true,
        });
      }
    }).catch(() => {});
  }

  _startDebug(connect) {
    this._stopDebug();
    if (!connect) return;

    const els = {
      micMeter: this.debugPanel.querySelector('.sd-mic-meter'),
      micVal: this.debugPanel.querySelector('.sd-mic-val'),
      remMeter: this.debugPanel.querySelector('.sd-rem-meter'),
      remVal: this.debugPanel.querySelector('.sd-rem-val'),
      outMeter: this.debugPanel.querySelector('.sd-out-meter'),
      outVal: this.debugPanel.querySelector('.sd-out-val'),
      gateState: this.debugPanel.querySelector('.sd-gate-state'),
      gateGain: this.debugPanel.querySelector('.sd-gate-gain'),
      gateHold: this.debugPanel.querySelector('.sd-gate-hold'),
      noiseFloor: this.debugPanel.querySelector('.sd-noise-floor'),
      effThresh: this.debugPanel.querySelector('.sd-eff-thresh'),
      threshSrc: this.debugPanel.querySelector('.sd-thresh-src'),
      aec: this.debugPanel.querySelector('.sd-aec'),
      ns: this.debugPanel.querySelector('.sd-ns'),
      agc: this.debugPanel.querySelector('.sd-agc'),
      ctxState: this.debugPanel.querySelector('.sd-ctx-state'),
      pipelineType: this.debugPanel.querySelector('.sd-pipeline-type'),
      sampleRate: this.debugPanel.querySelector('.sd-sample-rate'),
    };

    const ctx = connect._audioCtx;
    els.ctxState.textContent = ctx?.state || 'none';
    els.sampleRate.textContent = ctx?.sampleRate ? `${ctx.sampleRate} Hz` : '—';
    els.pipelineType.textContent = connect._duckingRAF ? 'Volume ducking' : 'direct';

    let micRAF = null;
    if (connect._micAnalyser) {
      const data = new Float32Array(connect._micAnalyser.fftSize);
      const updateMeters = () => {
        if (!connect._micAnalyser) return;
        connect._micAnalyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const db = rms > 0.00001 ? Math.max(-80, 20 * Math.log10(rms)) : -80;
        const pct = Math.max(0, Math.min(100, (db + 80) / 80 * 100));

        els.micMeter.style.width = `${pct}%`;
        els.micVal.textContent = `${db.toFixed(1)} dB`;

        const ds = connect._duckState;
        if (ds) {
          els.gateState.textContent = ds.volume < 1 ? 'DUCKING' : 'OPEN';
          els.gateGain.textContent = `${(ds.volume * 100).toFixed(0)}%`;
        }
        micRAF = requestAnimationFrame(updateMeters);
      };
      micRAF = requestAnimationFrame(updateMeters);
    }

    const ctxInterval = setInterval(() => {
      if (connect._audioCtx) {
        els.ctxState.textContent = connect._audioCtx.state;
      }
      els.pipelineType.textContent = connect._duckingRAF ? 'Volume ducking' : 'direct';
    }, 2000);

    this._debugCleanup = () => {
      if (micRAF) cancelAnimationFrame(micRAF);
      clearInterval(ctxInterval);
    };
  }

  _stopDebug() {
    if (this._debugCleanup) {
      this._debugCleanup();
      this._debugCleanup = null;
    }
  }

  _downloadDebugSnapshot() {
    const connect = this.session?.connect;
    const ctx = connect?._audioCtx;
    const snap = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: location.href,
      audioCtx: ctx ? { state: ctx.state, sampleRate: ctx.sampleRate } : null,
      pipeline: { type: connect?._duckingRAF ? 'volume-ducking' : 'direct' },
      signaling: {
        inCall: connect?._inCall ?? false,
        peerId: connect?.peerId || null,
      },
      consoleErrors: _capturedErrors.slice(-50),
    };
    const json = JSON.stringify(snap, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waymark-audio-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  destroy({ keepBlock = false } = {}) {
    this._stopDebug();
    if (this.session) {
      this.session.destroy({ keepBlock: keepBlock || this.session.connect?._paused });
    }
    if (this.root) {
      this.root.remove();
    }
    if (typeof window !== 'undefined' && window.__WAYMARK_CONNECT === this.session?.connect) {
      window.__WAYMARK_CONNECT = null;
    }
  }
}
