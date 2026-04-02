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
import { sampleAll } from '../../arcade/input.js';

/* ---------- State ---------- */

let _modal = null;
let _canvas = null;
let _ctx = null;
let _onClose = null;

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
  const wrapper = el('div', { className: 'arcade-canvas-wrap' }, [_canvas]);

  _modal = el('div', { className: 'arcade-modal-overlay' }, [
    el('div', { className: 'arcade-modal' }, [
      el('div', { className: 'arcade-modal-bar' }, [gameLabel, closeBtn]),
      wrapper,
    ]),
  ]);

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
      _ctx.net = arcadeNet;

      if (game.netModel === 'rollback') {
        setupRollbackGame(_ctx, game, arcadeNet);
      } else {
        setupLockstepGame(_ctx, game, arcadeNet);
      }
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
      if (_ctx.rollback) {
        _ctx.rollback.advance(_ctx);
      } else {
        // Solo / lockstep: sample local input and pass it.
        // Board games (chess/checkers) ignore these args, but
        // action games (slime-volley/soccer) need them.
        const input = sampleAll();
        game.update(_ctx, _ctx.frame, input, 0);
      }
    },
    render(ctx, alpha) {
      game.render(_ctx, null, null, alpha);
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

/**
 * Close the game modal and clean up all resources.
 */
export function closeGameModal() {
  if (_ctx) {
    stopLoop(_ctx);
    if (_ctx.net) _ctx.net.destroy();
    _ctx = null;
  }

  stopInput();
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
