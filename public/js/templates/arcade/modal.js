/* ============================================================
   templates/arcade/modal.js — Game viewport modal / fullscreen
   ============================================================ */

import { el } from '../shared.js';
import { initRenderer, destroyRenderer, resize, pageToVirtual } from '../../arcade/renderer.js';
import { startInput, stopInput, startMouseInput, stopMouseInput } from '../../arcade/input.js';
import {
  createContext, startLoop, stopLoop, getGame,
  registerScene, switchScene,
} from '../../arcade/engine.js';
import { createArcadeNet, MSG, decodeMessage, encodeControl } from '../../arcade/net.js';
import { createRollback } from '../../arcade/rollback.js';
import { sampleAll, sampleInput, P1_KEYS, P2_KEYS, createTouchControls, destroyTouchControls } from '../../arcade/input.js';

/* ---------- State ---------- */

let _modal = null;
let _canvas = null;
let _ctx = null;
let _onClose = null;
let _rttEl = null;
let _disconnectTimer = null;

/* ---------- Public API ---------- */

/**
 * Open the game viewport.
 * @param {Object} opts
 * @param {string} opts.gameKey
 * @param {Object} opts.waymarkConnect — WaymarkConnect instance
 * @param {string} opts.remotePeerId
 * @param {function} opts.onClose — called when modal is closed
 * @param {function} [opts.onGameEnd] — (result) => void
 */
export function openGameModal(opts) {
  const { gameKey, waymarkConnect, remotePeerId, onClose, onGameEnd } = opts;
  _onClose = onClose;

  const game = getGame(gameKey);
  if (!game) return;

  // Create modal overlay
  _canvas = el('canvas', { className: 'arcade-canvas' });
  const closeBtn = el('button', {
    className: 'arcade-modal-close',
    on: { click: closeGameModal },
  }, ['✕']);
  const gameLabel = el('div', { className: 'arcade-modal-title' }, [
    `${game.icon} ${game.name}`,
  ]);
  _rttEl = remotePeerId
    ? el('span', { className: 'arcade-rtt', title: 'Round-trip latency to opponent' }, ['--'])
    : null;
  const wrapper = el('div', { className: 'arcade-canvas-wrap' }, [_canvas]);

  // Connecting overlay — shown while waiting for DataChannels
  const connectingOverlay = remotePeerId
    ? el('div', { className: 'arcade-connecting-overlay', id: 'arcade-connecting' }, [
        el('div', { className: 'arcade-connecting-spinner' }),
        el('div', { className: 'arcade-connecting-text' }, ['Connecting to opponent…']),
      ])
    : null;

  const modalBody = el('div', { className: 'arcade-modal' }, [
    el('div', { className: 'arcade-modal-bar' }, [
      gameLabel,
      _rttEl || el('span'),
      closeBtn,
    ]),
    wrapper,
  ]);
  if (connectingOverlay) wrapper.append(connectingOverlay);

  _modal = el('div', { className: 'arcade-modal-overlay' }, [modalBody]);

  // Close on overlay click
  _modal.addEventListener('click', (e) => {
    if (e.target === _modal) closeGameModal();
  });

  // Close on Escape
  _modal._escHandler = (e) => {
    if (e.key === 'Escape') closeGameModal();
  };
  document.addEventListener('keydown', _modal._escHandler);

  document.body.append(_modal);

  // Initialise engine
  initRenderer(_canvas);
  startInput();
  startMouseInput(_canvas, pageToVirtual);

  // Create virtual touch controls for action games on touch devices
  const needsDpad = game.inputSchema && (
    game.inputSchema.includes('left') || game.inputSchema.includes('up')
  );
  if (needsDpad) {
    const canvasWrap = _modal.querySelector('.arcade-canvas-wrap');
    createTouchControls(canvasWrap, {
      showKick: game.inputSchema.includes('action1'),
    });
  }

  // Create engine context
  _ctx = createContext();
  _ctx.canvas = _canvas;
  _ctx.game = game;
  _ctx.gameKey = gameKey;

  // Determine player assignment (lower peerId = player 0)
  if (waymarkConnect && remotePeerId) {
    _ctx.localPlayerId = waymarkConnect.peerId < remotePeerId ? 0 : 1;
    _ctx.remotePeerId = remotePeerId;

    // Set up arcade network channels
    const arcadeNet = createArcadeNet(waymarkConnect, remotePeerId);
    if (arcadeNet) {
      console.log(`[Arcade] ArcadeNet created for peer ${remotePeerId} (localPlayer=${_ctx.localPlayerId})`);
      _ctx.net = arcadeNet;
      _ctx.netReady = false;

      arcadeNet.onOpen = () => {
        console.log(`[Arcade] ArcadeNet READY — both channels open for peer ${remotePeerId}`);
        _ctx.netReady = true;
        // Dismiss connecting overlay
        const overlay = document.getElementById('arcade-connecting');
        if (overlay) overlay.remove();
      };

      arcadeNet.onRttUpdate = (rtt) => {
        if (_rttEl) _rttEl.textContent = `~${Math.round(rtt)}ms`;
      };

      arcadeNet.onClose = () => {
        console.warn(`[Arcade] ArcadeNet channel CLOSED for peer ${remotePeerId}`);
        _ctx.netReady = false;
        _showDisconnectOverlay();
      };

      if (game.netModel === 'rollback') {
        setupRollbackGame(_ctx, game, arcadeNet);
      } else {
        setupLockstepGame(_ctx, game, arcadeNet);
      }
    } else {
      console.error(`[Arcade] createArcadeNet returned null for peer ${remotePeerId} — no RTCPeerConnection exists. Game will run in solo mode.`);
    }
  } else {
    // Local / solo mode — player 0, no network
    _ctx.localPlayerId = 0;
  }

  // Register game scene
  registerScene('playing', {
    init() {
      game.init(_ctx);
    },
    update() {
      // Wait for network channels to be ready before processing game logic
      if (_ctx.net && !_ctx.netReady) return;

      if (_ctx.rollback) {
        _ctx.rollback.advance(_ctx);
      } else {
        // Solo / lockstep: sample local input and pass it.
        // Board games (chess/checkers) ignore these args, but
        // action games (slime-volley/soccer) need them.
        const input = sampleAll();
        // In solo mode, let a second local player use WASD.
        const p2input = _ctx.net ? 0 : sampleInput(P2_KEYS);
        game.update(_ctx, _ctx.frame, input, p2input);
      }
    },
    render(ctx, prevState, currState, alpha) {
      game.render(_ctx, prevState, currState, alpha);
    },
    cleanup() {
      if (game.cleanup) game.cleanup(_ctx);
    },
  });

  switchScene('playing');
  startLoop(_ctx);

  // Force a resize after layout
  requestAnimationFrame(() => resize());
}

/* ---------- Disconnect Overlay ---------- */

const DISCONNECT_TIMEOUT_S = 10;

/**
 * Show the "Connection lost" overlay with a countdown and Return to Lobby button.
 */
function _showDisconnectOverlay() {
  const wrap = _modal && _modal.querySelector('.arcade-canvas-wrap');
  if (!wrap || document.getElementById('arcade-disconnected')) return;

  let remaining = DISCONNECT_TIMEOUT_S;
  const countdownEl = el('span', { className: 'arcade-connecting-text' }, [`Returning to lobby in ${remaining}s…`]);
  const returnBtn = el('button', {
    className: 'arcade-disconnect-btn',
    on: { click: closeGameModal },
  }, ['Return to Lobby']);

  const dcOverlay = el('div', {
    className: 'arcade-connecting-overlay',
    id: 'arcade-disconnected',
  }, [
    el('div', { className: 'arcade-disconnect-icon' }, ['⚠️']),
    el('div', { className: 'arcade-connecting-text arcade-disconnect-title' }, ['Connection lost']),
    countdownEl,
    returnBtn,
  ]);
  wrap.append(dcOverlay);

  _disconnectTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(_disconnectTimer);
      _disconnectTimer = null;
      closeGameModal();
    } else {
      countdownEl.textContent = `Returning to lobby in ${remaining}s…`;
    }
  }, 1000);
}

/**
 * Close the game modal and clean up all resources.
 */
export function closeGameModal() {
  if (_disconnectTimer) {
    clearInterval(_disconnectTimer);
    _disconnectTimer = null;
  }
  if (_ctx) {
    stopLoop(_ctx);
    if (_ctx.net) _ctx.net.destroy();
    _ctx = null;
  }

  stopInput();
  destroyTouchControls();
  if (_canvas) {
    stopMouseInput(_canvas);
  }
  destroyRenderer();

  if (_modal) {
    if (_modal._escHandler) {
      document.removeEventListener('keydown', _modal._escHandler);
    }
    _modal.remove();
    _modal = null;
  }

  _canvas = null;
  _rttEl = null;
  if (_onClose) _onClose();
  _onClose = null;
}

/* ---------- Network Setup Helpers ---------- */

function setupRollbackGame(ctx, game, arcadeNet) {
  const rollback = createRollback({
    serialize: game.serialize,
    deserialize: game.deserialize,
    simulate(c, frame, localInput, remoteInput) {
      game.update(c, frame, localInput, remoteInput);
    },
    net: arcadeNet,
    localPlayer: ctx.localPlayerId,
  });

  ctx.rollback = rollback;

  // Wire up network messages
  arcadeNet.onFastMessage = (buffer) => {
    const view = new DataView(buffer);
    const type = view.getUint8(0);
    if (type === MSG.INPUT) {
      rollback.onRemoteInput(ctx, buffer);
    } else if (type === MSG.INPUT_ACK) {
      rollback.onInputAck(buffer);
    }
  };

  arcadeNet.onReliableMessage = (buffer) => {
    const msg = decodeMessage(buffer);
    if (msg.type === MSG.GAME_END) {
      ctx.ended = true;
    } else if (msg.type === MSG.STATE_SNAP) {
      rollback.onStateSnap(ctx, buffer);
    }
  };
}

function setupLockstepGame(ctx, game, arcadeNet) {
  // Turn-based games receive moves over reliable channel
  arcadeNet.onReliableMessage = (buffer) => {
    if (game.onNetMessage) {
      game.onNetMessage(ctx, buffer);
    }
  };

  arcadeNet.onFastMessage = () => {
    // Ignore fast messages for lockstep games
  };
}

/**
 * Check if a game is currently active.
 * @returns {boolean}
 */
export function isGameActive() {
  return _modal !== null;
}
