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
    this.subtitleText = opts.subtitle || (this.mode === 'embedded' ? 'Pick a crew or Waymarker to chat, call, or share' : 'Listening…');
    this.baseSubtitle = this.subtitleText;
    this.signal = opts.signal || null;
    this.persistChat = opts.persistChat || null;
    this.getMessageExtra = opts.getMessageExtra || null;

    this.userEmail = opts.userEmail || '';
    this.onClose = opts.onClose || (() => {});
    this.onOpenSheet = opts.onOpenSheet || (() => {});
    this.onConnectDrive = opts.onConnectDrive || (() => {});
    this.onShareAgent = opts.onShareAgent || (() => {});
    this.onSelectThread = opts.onSelectThread || (() => {});
    this.onNewThread = opts.onNewThread || (() => {});
    this.onClearThread = opts.onClearThread || (() => {});
    this.onBeforeStartCall = opts.onBeforeStartCall || null;
    this.onPeerMessage = opts.onPeerMessage || null;

    this.showClose = opts.showClose !== false;
    this.showMinimize = opts.showMinimize !== undefined ? opts.showMinimize : (this.mode === 'floating');
    this.showPopout = opts.showPopout !== undefined ? Boolean(opts.showPopout) : (this.mode === 'embedded');
    this.showBubble = opts.showBubble !== undefined ? Boolean(opts.showBubble) : true;
    this.showSheetLink = opts.showSheetLink !== undefined ? !!opts.showSheetLink : (this.mode === 'embedded');
    this.showConnectDrive = opts.showConnectDrive !== undefined ? !!opts.showConnectDrive : (this.mode === 'embedded');
    this.showShareAgent = Boolean(opts.showShareAgent);
    this.showAgentThreads = Boolean(opts.showAgentThreads);
    this.bubbleIconText = opts.bubbleIcon || '';
    this.isPoppedOut = Boolean(opts.isPoppedOut);
    this.isBubbleMode = Boolean(opts.isBubbleMode);
    this.dockContainer = opts.dockContainer || opts.mountTo || null;
    this._savedPos = opts.savedPos || null;
    this.onPopOutChange = opts.onPopOutChange || null;
    this.onBubbleChange = opts.onBubbleChange || null;
    this._dragCleanup = null;
    this.idPrefix = opts.idPrefix || (this.mode === 'embedded' || opts.isPoppedOut ? 'wayside' : 'social-chat');

    this._chatLog = [];
    this._unreadCount = 0;
    this._typingTimer = null;
    this._debugCleanup = null;
    this._debugLogLines = 0;
    this._savedUpTo = 0;
    this._savingHistory = false;

    // Instantiate session
    this.session = new SocialSession({
      sheetId: this.sheetId,
      displayName: this.displayName,
      password: this.password,
      signal: this.signal,
      persistChat: this.persistChat,
      onMessage: (msg) => {
        const msgThread = String(msg.threadId || 'default').trim() || 'default';
        const currentThread = String(this._activeThreadId || 'default').trim() || 'default';
        if (!this.showAgentThreads || msg.self || msgThread === currentThread) {
          this.appendMessage({
            id: msg.id,
            sender: msg.sender || msg.name || 'Collaborator',
            text: msg.text,
            ts: msg.ts,
            self: msg.self,
          });
        }
        if (!msg.self && typeof this.onPeerMessage === 'function') {
          this.onPeerMessage(msg);
        }
      },
      onPeersChanged: (peers) => {
        const count = peers?.size ?? (Array.isArray(peers) ? peers.length : 0);
        if (this.peerCount) {
          this.peerCount.textContent = `${count} peer${count !== 1 ? 's' : ''}`;
        }
        if (this.mode === 'embedded' && this.subtitle && !this.session.inCall) {
          const base = this.baseSubtitle || (this.sheetId ? `Linked: ${this.sheetId}` : 'Linked on first share');
          this.setSubtitle(`P2P · ${count} connected · ${base}`, { isBase: false });
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
    this._initDragAndBubble();

    // Bind media elements to session
    this.session.bindRemoteAudio(this.remoteAudio);
    this.session.bindRemoteVideo(this.remoteVideo);
    this.session.bindLocalVideo(this.localVideo);

    if (this.isPoppedOut) {
      this.popOut();
    } else if (opts.mountTo) {
      this.mount(opts.mountTo);
    } else if (this.mode === 'floating' && typeof document !== 'undefined') {
      this.mount(document.body);
    }

    if (this._savedPos) {
      this.setPosition(this._savedPos.left, this._savedPos.top);
    }

    if (this.isBubbleMode) {
      this.setBubbleMode(true);
    }

    if (this.sheetId) {
      this.session.start();
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
    if (this.bubbleFab) this.bubbleFab.setAttribute('title', `${title} — Click to expand`);
    if (this.root && this.isBubbleMode) this.root.setAttribute('title', `${title} — Click to expand`);
  }

  setSubtitle(subtitle, { isBase = true } = {}) {
    this.subtitleText = subtitle;
    if (isBase && subtitle) {
      this.baseSubtitle = subtitle;
    }
    if (this.subtitleTextEl) this.subtitleTextEl.textContent = subtitle;
  }

  setSignaling(sheetId, signal) {
    if (!sheetId || !signal) return null;
    this.sheetId = String(sheetId);
    const connect = this.session.setSignaling(this.sheetId, signal);
    if (this.mode === 'embedded' && !this.session.inCall) {
      if (!this.baseSubtitle || this.baseSubtitle === 'Linked on first share' || this.baseSubtitle.startsWith('Linked:')) {
        this.setSubtitle(`Linked: ${this.sheetId}`);
      }
    }
    return connect;
  }

  _buildDOM() {
    const isFloating = this.mode === 'floating' || this.isPoppedOut;
    const idPrefix = this.idPrefix;
    let rootClasses = isFloating
      ? 'social-chat-panel'
      : 'social-chat-panel social-chat-embedded chat-box';
    if (this.isPoppedOut) rootClasses += ' social-chat-popped-out';
    if (this.isBubbleMode) rootClasses += ' social-chat-bubble-mode';

    this.root = el('div', { className: rootClasses });

    /* ---------- Chat Bubble FAB (Truncated bubble mode) ---------- */
    const initialBubbleIcon = this.bubbleIconText || (this.titleText.includes('AI') ? '🤖' : '💬');
    this.bubbleIcon = el('span', { className: 'social-chat-bubble-icon' }, [initialBubbleIcon]);
    this._bubbleUnreadBadge = el('span', { className: 'social-chat-bubble-badge hidden' }, ['0']);
    this._bubbleCallIndicator = el('span', { className: 'social-chat-bubble-call-indicator hidden' });
    this.bubbleFab = el('div', {
      className: 'social-chat-bubble-fab',
      id: `${idPrefix}-bubble-fab`,
      title: `${this.titleText} — Click to expand`,
    }, [
      this.bubbleIcon,
      this._bubbleUnreadBadge,
      this._bubbleCallIndicator,
    ]);

    /* ---------- Header ---------- */
    const header = el('div', { className: 'social-chat-header chat-box-head' });

    this.titleEl = el('span', {
      className: 'social-chat-title',
      id: `${idPrefix}-crew-title`,
    }, [this.titleText]);

    this.statusDot = el('span', {
      className: 'social-chat-status social-chat-status-listening',
    });

    this.statusLabel = el('span', {
      className: 'social-chat-status-label',
    }, [isFloating ? this.subtitleText : (this.sheetId ? 'Listening…' : 'Idle')]);

    this.peerCount = el('span', {
      className: 'social-chat-peer-count',
    }, ['0 peers']);

    this.unreadBadge = el('span', {
      className: 'social-chat-unread hidden',
    }, ['0']);

    const headerActions = el('div', { className: 'chat-box-actions social-header-actions' });
    const subtitleActions = el('div', { className: 'chat-box-actions social-subtitle-actions' });
    const linkActions = isFloating ? headerActions : subtitleActions;

    if (this.showSheetLink) {
      this.sheetBtn = el('button', {
        className: 'btn btn-muted',
        id: `${idPrefix}-sheet-btn`,
        title: 'Open the shared Waymark',
        on: { click: () => this.onOpenSheet() },
      }, ['🔗 Waymark']);
      linkActions.append(this.sheetBtn);
    }

    if (this.showConnectDrive) {
      this.connectBtn = el('button', {
        className: 'btn btn-muted',
        id: `${idPrefix}-connect-btn`,
        title: 'Connect a shared ledger from Drive',
        on: { click: () => this.onConnectDrive() },
      }, ['📥 Connect']);
      linkActions.append(this.connectBtn);
    }

    if (this.showShareAgent) {
      this.shareAgentBtn = el('button', {
        className: 'btn btn-muted',
        id: `${idPrefix}-share-agent-btn`,
        title: 'Share this Waymark AI agent with family or collaborators',
        on: { click: () => this.onShareAgent() },
      }, ['🤝 Share Agent']);
      linkActions.append(this.shareAgentBtn);
    }

    this.settingsBtn = el('button', {
      className: 'social-chat-settings-btn btn-icon',
      title: 'Chat settings',
      on: { click: () => this.settingsPanel.classList.toggle('hidden') },
    }, ['⚙️']);
    headerActions.append(this.settingsBtn);

    if (this.showPopout) {
      this.popoutBtn = el('button', {
        className: 'social-chat-popout btn-icon',
        id: `${idPrefix}-popout-btn`,
        title: this.isPoppedOut ? 'Dock chat back to Wayside' : 'Pop out chat',
        'aria-label': this.isPoppedOut ? 'Dock chat back to Wayside' : 'Pop out chat',
        on: { click: () => {
          if (this.isPoppedOut) this.dock();
          else this.popOut();
        } },
      }, [this.isPoppedOut ? '↙' : '↗']);
      headerActions.append(this.popoutBtn);
    }

    if (this.showBubble) {
      this.bubbleBtn = el('button', {
        className: 'social-chat-bubble-toggle btn-icon',
        id: `${idPrefix}-bubble-btn`,
        title: 'Truncate to chat bubble',
        'aria-label': 'Truncate to chat bubble',
        on: { click: () => {
          if (!this.isPoppedOut) {
            this.popOut();
          }
          this.setBubbleMode(!this.isBubbleMode);
        } },
      }, ['💬']);
      headerActions.append(this.bubbleBtn);
    }

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
        id: `${idPrefix}-close-btn`,
        title: isFloating ? 'Disconnect' : 'Close chat',
        on: { click: () => this.onClose() },
      }, ['✕']);
      headerActions.append(this.closeBtn);
    }

    header.append(
      this.titleEl,
      this.statusDot,
      this.statusLabel,
      this.peerCount,
      this.unreadBadge,
      headerActions,
    );

    /* ---------- Sheet Line (Wayside subtitle) ---------- */
    this.subtitleTextEl = el('span', {
      className: 'social-chat-subtitle-text',
    }, [this.subtitleText]);
    this.subtitle = el('div', {
      className: 'chat-sheet-line',
      id: `${idPrefix}-sheet-line`,
    }, [this.subtitleTextEl, subtitleActions]);

    /* ---------- Agent Conversation Thread Bar (Agent chats only) ---------- */
    this.agentThreadBar = null;
    this.threadSelect = null;
    if (this.showAgentThreads) {
      this.threadSelect = el('select', {
        className: 'wayside-thread-select',
        id: `${idPrefix}-thread-select`,
        title: 'Switch between saved AI conversations in Google Drive',
        on: { change: (e) => this.onSelectThread(e.target.value) },
      }, [
        el('option', { value: 'default' }, ['💬 General Conversation (0)']),
      ]);

      this.newThreadBtn = el('button', {
        type: 'button',
        className: 'btn btn-muted wayside-thread-btn',
        id: `${idPrefix}-new-thread-btn`,
        title: 'Start a new conversation thread (previous threads stay saved in Google Drive)',
        on: { click: () => this.onNewThread() },
      }, ['＋ New']);

      this.clearThreadBtn = el('button', {
        type: 'button',
        className: 'btn btn-muted wayside-thread-btn',
        id: `${idPrefix}-clear-thread-btn`,
        title: 'Clear active context and start a fresh thread',
        on: { click: () => this.onClearThread() },
      }, ['🧹 Clear']);

      this.agentThreadBar = el('div', {
        className: 'wayside-thread-bar',
        id: `${idPrefix}-thread-bar`,
      }, [this.threadSelect, this.newThreadBtn, this.clearThreadBtn]);
    }

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
      id: `${idPrefix}-media-container`,
    });
    this.localVideo = el('video', {
      className: 'social-local-video wayside-local-video',
      id: `${idPrefix}-local-video`,
      muted: true,
      autoplay: true,
      playsInline: true,
    });
    this.remoteVideo = el('video', {
      className: 'social-remote-video wayside-remote-video',
      id: `${idPrefix}-remote-video`,
      autoplay: true,
      playsInline: true,
    });
    // Remote audio lives outside mediaContainer so it is never muted by display:none
    this.remoteAudio = el('audio', {
      className: 'social-remote-audio',
      id: `${idPrefix}-remote-audio`,
      autoplay: true,
      playsInline: true,
    });
    this.mediaContainer.append(this.remoteVideo, this.localVideo);

    /* ---------- Call Bar ---------- */
    this.callBar = el('div', { className: 'social-call-bar chat-box-actions' });
    this.callBtn = el('button', {
      className: 'social-call-btn btn',
      id: `${idPrefix}-call-btn`,
      title: 'Start audio call',
    }, ['📹 Call']);

    this.videoCallBtn = el('button', {
      className: 'social-call-btn social-call-btn-video btn',
      id: `${idPrefix}-video-call-btn`,
      title: 'Start video call',
    }, ['📹 Video']);

    this.hangupBtn = el('button', {
      className: 'social-call-btn social-call-btn-hangup btn hidden',
      title: 'End call',
    }, ['🔴 Hang Up']);

    this.muteBtn = el('button', {
      className: 'social-call-btn social-call-btn-mute btn hidden',
      id: `${idPrefix}-mute-btn`,
      title: 'Toggle mute',
    }, ['🔇 Mute']);

    this.camToggleBtn = el('button', {
      className: 'social-call-btn social-call-btn-cam btn hidden',
      id: `${idPrefix}-cam-btn`,
      title: 'Toggle camera',
    }, ['📷 Cam Off']);

    this.debugBtn = el('button', {
      className: 'social-call-btn social-debug-btn btn hidden',
      title: 'Audio debug panel',
    }, ['🐛 Debug']);

    this.callBtn.addEventListener('click', () => {
      this.toggleCall({ video: false });
    });

    this.videoCallBtn.addEventListener('click', () => {
      this.toggleCall({ video: true });
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
      id: `${idPrefix}-chat-log`,
    });

    /* ---------- Typing Indicator ---------- */
    this.typingIndicator = el('div', { className: 'social-typing-indicator hidden' });

    /* ---------- Input Bar ---------- */
    const inputBar = el('div', { className: 'social-chat-input-bar' });
    this.input = el('input', {
      className: 'social-chat-input chat-input',
      id: `${idPrefix}-chat-input`,
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
      this.bubbleFab,
      header,
      ...((!isFloating || this.isPoppedOut || idPrefix === 'wayside') ? [this.subtitle] : []),
      ...(this.agentThreadBar ? [this.agentThreadBar] : []),
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
        <button type="button" class="social-debug-close" data-action="social-debug-close" title="Close">✕</button>
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
        <div class="social-debug-label">Event Log <button type="button" class="social-debug-clear-log" data-action="social-debug-clear-log" title="Clear">clear</button></div>
        <div class="social-debug-log sd-event-log"></div>
      </div>
      <div class="social-debug-section">
        <button type="button" class="social-debug-download" data-action="social-debug-download">📥 Download Debug Snapshot</button>
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
      const linkText = this.sheetId ? `Linked: ${this.sheetId}` : 'Linked on first share';
      this.setSubtitle(`Incoming call from ${name || 'a Waymarker'} · ${linkText}`);
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
    const hasLocalVideo = Boolean(hasVideo || this.localVideo?.srcObject?.getVideoTracks()?.length);
    const hasRemoteVideo = Boolean(this.remoteVideo?.srcObject?.getVideoTracks()?.length);
    if (hasLocalVideo) {
      this.camToggleBtn.classList.remove('hidden');
    }
    if (hasLocalVideo || hasRemoteVideo) {
      this.mediaContainer.classList.remove('hidden');
    }
    this.debugBtn.classList.remove('hidden');
    this.root.classList.add('social-chat-in-call');
    if (this._bubbleCallIndicator) {
      this._bubbleCallIndicator.classList.remove('hidden');
    }
    if (this.subtitle) {
      const linkText = this.sheetId ? `Linked: ${this.sheetId}` : 'Linked on first share';
      this.setSubtitle(`📹 In call · ${linkText}`);
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
    if (this._bubbleCallIndicator) {
      this._bubbleCallIndicator.classList.add('hidden');
    }
    this.muteBtn.textContent = '🔇 Mute';
    this.camToggleBtn.textContent = '📷 Cam Off';
    if (this.subtitle) {
      this.setSubtitle(this.sheetId ? `Linked: ${this.sheetId}` : 'Linked on first share');
    }
  }

  async toggleCall({ video = false } = {}) {
    if (this.session.inCall || this.session.callState === 'calling') {
      await this.session.endCall();
      this.exitCallUI();
      return null;
    }
    if (this.session.callState === 'ringing') {
      return this.session.acceptCall(video).catch(() => null);
    }
    try {
      if (this.onBeforeStartCall) await this.onBeforeStartCall();
      return await this.session.startCall({ audio: true, video });
    } catch (err) {
      showToast(`Could not start call: ${err.message}`, 'error');
      return null;
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

  clearMessages(emptyHint = '') {
    if (!this.messages) return;
    this.messages.replaceChildren();
    this._chatLog = [];
    if (emptyHint) {
      this.messages.append(
        el('div', { className: 'wayside-thread-empty' }, [emptyHint])
      );
    }
  }

  setThreads(threads = [], activeThreadId = 'default') {
    this._activeThreadId = String(activeThreadId || 'default').trim() || 'default';
    if (!this.threadSelect) return;
    const list = Array.isArray(threads) && threads.length
      ? threads
      : [{ id: 'default', label: '💬 General Conversation (0)', title: 'General Conversation' }];
    const activeMeta = list.find(t => t.id === this._activeThreadId);
    this._activeThreadTitle = activeMeta?.title || '';
    this.threadSelect.replaceChildren(
      ...list.map(t => el('option', { value: t.id }, [t.label]))
    );
    const hasActive = list.some(t => t.id === this._activeThreadId);
    this.threadSelect.value = hasActive ? this._activeThreadId : list[0].id;
  }

  appendMessage({ id, sender, text, ts, self = false, failed = false, history = false }) {
    const emptyEl = this.messages?.querySelector('.wayside-thread-empty');
    if (emptyEl) emptyEl.remove();
    const isSelf = history
      ? (self || (sender === this.displayName) || (this.userEmail && (sender || '').toLowerCase() === this.userEmail.toLowerCase()))
      : Boolean(self);
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

    if (!history && !isSelf && sender !== 'System') {
      clearTimeout(this._typingTimer);
      this.typingIndicator.classList.add('hidden');
    }

    const isAiSender = sender === 'Waymark AI' || (sender || '').toLowerCase() === 'assistant@waymark.internal';
    const initial = isAiSender ? '🤖' : (sender || '?')[0].toUpperCase();
    const textSpan = el('span', { className: 'social-chat-bubble-text' });
    appendLinkified(textSpan, text);

    const numTs = typeof ts === 'number' ? ts : (ts ? new Date(ts).getTime() : 0);
    const timeText = (numTs && !isNaN(numTs) && numTs > 0)
      ? timeAgo(new Date(numTs).toISOString())
      : '';
    const who = isSelf ? 'You' : (isAiSender ? 'Waymark AI' : (sender || '').split('@')[0]);

    const bodyChildren = [
      el('span', { className: 'social-chat-bubble-name' }, [who]),
      textSpan,
    ];
    if (timeText) {
      bodyChildren.push(el('span', { className: 'social-chat-bubble-time' }, [timeText]));
    }

    bubble.append(
      el('div', { className: 'social-avatar social-avatar-sm', style: `background: ${avatarColor(sender || 'Anonymous')}` }, [initial]),
      el('div', { className: 'social-chat-bubble-body' }, bodyChildren),
    );

    this.messages.append(bubble);
    this.messages.scrollTop = this.messages.scrollHeight;

    if (!history && sender !== 'System') {
      this._chatLog.push({ name: sender, text, ts: numTs || Date.now(), self: isSelf });
    }

    if (!isSelf && sender !== 'System') {
      if (this.isBubbleMode) {
        this._unreadCount++;
        if (this._bubbleUnreadBadge) {
          this._bubbleUnreadBadge.textContent = String(this._unreadCount);
          this._bubbleUnreadBadge.classList.remove('hidden');
        }
      } else if (this.root.classList.contains('social-chat-minimized')) {
        this._unreadCount++;
        this.unreadBadge.textContent = String(this._unreadCount);
        this.unreadBadge.classList.remove('hidden');
      }
    }
  }

  sendMessage() {
    const text = this.input.value.trim();
    if (!text || !this.session) return;
    const baseExtra = this._activeThreadId && this._activeThreadId !== 'default'
      ? { threadId: this._activeThreadId, threadTitle: this._activeThreadTitle || '' }
      : {};
    const customExtra = typeof this.getMessageExtra === 'function' ? (this.getMessageExtra(text) || {}) : {};
    this.session.sendMessage(text, { ...baseExtra, ...customExtra });
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
    if (!getChatSaveHistory() || !this.signal?.appendChatHistory) return;
    if (this._savingHistory) return;
    const unsaved = this._chatLog.slice(this._savedUpTo);
    if (unsaved.length === 0) return;

    this._savingHistory = true;
    const saveCount = unsaved.length;
    const { cols: c, totalCols: tc } = this.signal;
    const rows = unsaved.map(m => {
      const row = new Array(tc || 7).fill('');
      if (c.text >= 0)     row[c.text]     = m.text;
      if (c.author >= 0)   row[c.author]   = m.name;
      if (c.date >= 0)     row[c.date]     = m.ts ? new Date(m.ts).toISOString() : new Date().toISOString();
      if (c.category >= 0) row[c.category] = 'chat';
      return row;
    });
    try {
      await this.signal.appendChatHistory(rows);
      this._savedUpTo += saveCount;
    } catch (err) {
      console.warn('[social] chat history save failed:', err);
    } finally {
      this._savingHistory = false;
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

  debugLog(msg) {
    const log = this.debugPanel?.querySelector('.sd-event-log');
    if (!log) return;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = document.createElement('div');
    line.textContent = `[${ts}] ${msg}`;
    log.append(line);
    this._debugLogLines++;
    if (this._debugLogLines > 200) { log.firstChild?.remove(); this._debugLogLines--; }
    log.scrollTop = log.scrollHeight;
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

    // Log ICE connection state
    for (const [peerId, r] of connect._rtc || []) {
      const ice = r?.pc?.iceConnectionState || '?';
      this.debugLog(`ICE[${peerId.slice(0, 6)}]: ${ice}`);
    }

    // Read browser constraints from mic track
    const micTrack = connect._rawStream?.getAudioTracks()?.[0];
    if (micTrack) {
      try {
        const settings = micTrack.getSettings();
        if (els.aec) els.aec.textContent = settings.echoCancellation ? '✅ on' : '❌ off';
        if (els.ns) els.ns.textContent = settings.noiseSuppression ? '✅ on' : '❌ off';
        if (els.agc) els.agc.textContent = settings.autoGainControl ? '✅ on' : '❌ off';
        this.debugLog(`Mic: ${micTrack.label || 'default'}`);
        this.debugLog(`AEC=${settings.echoCancellation} NS=${settings.noiseSuppression} AGC=${settings.autoGainControl}`);
      } catch {}
    }

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
          if (els.outMeter) {
            els.outMeter.style.width = `${(ds.volume * 100).toFixed(0)}%`;
          }
          if (els.outVal) {
            els.outVal.textContent = `${(ds.volume * 100).toFixed(0)}%`;
          }
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
      url: typeof location !== 'undefined' ? (location.origin + location.pathname) : '',
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

  popOut() {
    if (this.isPoppedOut) return;
    this.isPoppedOut = true;

    if (!this.dockContainer && this.root?.parentElement && this.root.parentElement !== document.body) {
      this.dockContainer = this.root.parentElement;
    }

    if (this.root && this.root.parentElement !== document.body && typeof document !== 'undefined') {
      document.body.append(this.root);
    }

    this.root?.classList.remove('social-chat-embedded');
    this.root?.classList.add('social-chat-popped-out');

    if (this.popoutBtn) {
      this.popoutBtn.textContent = '↙';
      this.popoutBtn.title = 'Dock chat back to Wayside';
      this.popoutBtn.setAttribute('aria-label', 'Dock chat back to Wayside');
    }

    if (this._savedPos) {
      this.setPosition(this._savedPos.left, this._savedPos.top);
    } else if (typeof window !== 'undefined') {
      const winWidth = 420;
      const winHeight = Math.min(560, window.innerHeight - 32);
      const defaultLeft = Math.max(8, window.innerWidth - winWidth - 24);
      const defaultTop = Math.max(8, window.innerHeight - winHeight - 24);
      this.setPosition(defaultLeft, defaultTop);
    }

    if (typeof this.onPopOutChange === 'function') {
      this.onPopOutChange(true);
    }
  }

  dock() {
    if (!this.isPoppedOut) return;
    this.isPoppedOut = false;

    if (this.isBubbleMode) {
      this.setBubbleMode(false);
    }

    this.root?.classList.remove('social-chat-popped-out');
    this.root?.classList.remove('social-chat-bubble-mode');
    this.root?.classList.add('social-chat-embedded');

    if (this.root) {
      this.root.style.left = '';
      this.root.style.top = '';
      this.root.style.right = '';
      this.root.style.bottom = '';
    }

    const container = this.dockContainer || (typeof document !== 'undefined' ? document.getElementById('wayside-chat-container') : null);
    if (container && this.root) {
      container.replaceChildren(this.root);
    }

    if (this.popoutBtn) {
      this.popoutBtn.textContent = '↗';
      this.popoutBtn.title = 'Pop out chat';
      this.popoutBtn.setAttribute('aria-label', 'Pop out chat');
    }

    if (typeof this.onPopOutChange === 'function') {
      this.onPopOutChange(false);
    }
  }

  setBubbleMode(isBubble) {
    this.isBubbleMode = Boolean(isBubble);
    if (!this.root) return;

    if (this.isBubbleMode) {
      if (!this.isPoppedOut) {
        this.popOut();
      }
      this.root.classList.add('social-chat-bubble-mode');
      this.root.setAttribute('title', `${this.titleText} — Click to expand`);

      // Sync unread badge
      if (this._bubbleUnreadBadge) {
        this._bubbleUnreadBadge.textContent = String(this._unreadCount);
        this._bubbleUnreadBadge.classList.toggle('hidden', this._unreadCount <= 0);
      }
      if (this._bubbleCallIndicator) {
        this._bubbleCallIndicator.classList.toggle('hidden', !this.session?.inCall);
      }
    } else {
      this.root.classList.remove('social-chat-bubble-mode');
      this.root.removeAttribute('title');
      this._unreadCount = 0;
      if (this.unreadBadge) this.unreadBadge.classList.add('hidden');
      if (this._bubbleUnreadBadge) this._bubbleUnreadBadge.classList.add('hidden');

      if (typeof window !== 'undefined') {
        const winWidth = 420;
        const winHeight = 560;
        let curLeft = parseFloat(this.root.style.left) || (window.innerWidth - winWidth - 24);
        let curTop = parseFloat(this.root.style.top) || (window.innerHeight - winHeight - 24);
        const maxLeft = Math.max(8, window.innerWidth - winWidth - 8);
        const maxTop = Math.max(8, window.innerHeight - winHeight - 8);
        curLeft = Math.max(8, Math.min(maxLeft, curLeft));
        curTop = Math.max(8, Math.min(maxTop, curTop));
        this.root.style.left = `${curLeft}px`;
        this.root.style.top = `${curTop}px`;
        this._savedPos = { left: curLeft, top: curTop };
      }
    }

    if (typeof this.onBubbleChange === 'function') {
      this.onBubbleChange(this.isBubbleMode);
    }
  }

  setPosition(left, top) {
    if (!this.root || typeof window === 'undefined') return;
    if (typeof left === 'number' && typeof top === 'number') {
      const size = this.isBubbleMode ? 58 : 420;
      const height = this.isBubbleMode ? 58 : 560;
      const maxLeft = Math.max(8, window.innerWidth - size - 8);
      const maxTop = Math.max(8, window.innerHeight - height - 8);
      const clampedLeft = Math.max(8, Math.min(maxLeft, left));
      const clampedTop = Math.max(8, Math.min(maxTop, top));
      this.root.style.left = `${clampedLeft}px`;
      this.root.style.top = `${clampedTop}px`;
      this.root.style.right = 'auto';
      this.root.style.bottom = 'auto';
      this._savedPos = { left: clampedLeft, top: clampedTop };
    }
  }

  setDockContainer(container) {
    if (container) {
      this.dockContainer = container;
    }
  }

  _initDragAndBubble() {
    if (typeof window === 'undefined' || !this.root) return;
    let activeDrag = null;

    const onPointerDown = (e, type) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (type === 'header') {
        if (e.target.closest('button, input, select, a, textarea')) return;
        if (!this.isPoppedOut && this.mode !== 'floating') return;
      } else if (type === 'bubble') {
        if (!this.isBubbleMode) return;
      }

      const rect = this.root.getBoundingClientRect();
      activeDrag = {
        type,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left,
        origTop: rect.top,
        hasMoved: false,
      };
      this.root.classList.add('social-chat-dragging');
    };

    const onPointerMove = (e) => {
      if (!activeDrag) return;
      const dx = e.clientX - activeDrag.startX;
      const dy = e.clientY - activeDrag.startY;
      if (!activeDrag.hasMoved && Math.hypot(dx, dy) < 4) return;
      activeDrag.hasMoved = true;

      const rect = this.root.getBoundingClientRect();
      const w = activeDrag.type === 'bubble' ? 58 : (rect.width || 420);
      const h = activeDrag.type === 'bubble' ? 58 : (rect.height || 560);
      const maxLeft = Math.max(8, window.innerWidth - w - 8);
      const maxTop = Math.max(8, window.innerHeight - h - 8);

      let newLeft = activeDrag.origLeft + dx;
      let newTop = activeDrag.origTop + dy;

      newLeft = Math.max(8, Math.min(maxLeft, newLeft));
      newTop = Math.max(8, Math.min(maxTop, newTop));

      this.root.style.left = `${newLeft}px`;
      this.root.style.top = `${newTop}px`;
      this.root.style.right = 'auto';
      this.root.style.bottom = 'auto';
      this._savedPos = { left: newLeft, top: newTop };
    };

    const onPointerUp = (e) => {
      if (!activeDrag) return;
      this.root.classList.remove('social-chat-dragging');
      const wasMoved = activeDrag.hasMoved;
      const dragType = activeDrag.type;
      activeDrag = null;

      if (!wasMoved && dragType === 'bubble') {
        this.setBubbleMode(false);
      }
    };

    const header = this.root.querySelector('.social-chat-header');
    const headerDownHandler = (e) => onPointerDown(e, 'header');
    const bubbleDownHandler = (e) => onPointerDown(e, 'bubble');

    if (header) {
      header.addEventListener('pointerdown', headerDownHandler);
    }
    if (this.bubbleFab) {
      this.bubbleFab.addEventListener('pointerdown', bubbleDownHandler);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    this._dragCleanup = () => {
      if (header) header.removeEventListener('pointerdown', headerDownHandler);
      if (this.bubbleFab) this.bubbleFab.removeEventListener('pointerdown', bubbleDownHandler);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }

  destroy({ keepBlock = false } = {}) {
    this._stopDebug();
    if (this._dragCleanup) {
      this._dragCleanup();
      this._dragCleanup = null;
    }
    if (this.session) {
      this.session.destroy({ keepBlock: keepBlock || this.session.connect?._paused });
    }
    if (this.root) {
      this.root.remove();
    }
  }
}
