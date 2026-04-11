/* ============================================================
   templates/arcade/index.js — Arcade template barrel
   ============================================================ */

import { el, registerTemplate, cell, WaymarkConnect, showToast, buildHandshakePasswordRow } from '../shared.js';
import { getGameList, netModelLabel } from './helpers.js';
import { buildGameGrid, buildPeerList, buildMatchHistory } from './cards.js';
import { openGameModal, closeGameModal, isGameActive } from './modal.js';

/* Side-effect: import all games so they self-register */
import '../../arcade/games/chess.js';
import '../../arcade/games/checkers.js';
import '../../arcade/games/slime-volley.js';
import '../../arcade/games/slime-soccer.js';

/* ---------- Module State ---------- */

let _container = null;
let _waymarkConnect = null;
let _peers = new Map();
let _selectedGame = '';
let _cols = {};
let _statusDot = null;
let _statusLabel = null;
let _peerCountEl = null;
let _pendingInvite = null;       // { peerId, gameKey } — outgoing invite waiting for response
let _inviteNotification = null;  // DOM element for incoming invite banner
let _sessionPassword = '';       // Optional session password for encrypted handshakes
let _template = null;            // Cached template ref for reconnect after password change
let _inviteTimeout = null;       // setTimeout ID for outgoing invite auto-cancel

/* ---------- Constants ---------- */

const INVITE_TIMEOUT_MS = 30_000;
const INVITE_COUNTDOWN_STEP = 1000;

/* ---------- Cleanup ---------- */

function destroyConnect() {
  if (_waymarkConnect) {
    _waymarkConnect.destroy();
    _waymarkConnect = null;
  }
  _peers = new Map();
  _container = null;
  _statusDot = null;
  _statusLabel = null;
  _peerCountEl = null;
  _pendingInvite = null;
  dismissInviteNotification();
}

// When navigating away from the sheet, pause the connection (keeping the
// signaling block alive) rather than destroying it.  All UI state is rebuilt
// by render() when the user returns, and the module-level _statusDot /
// _statusLabel / _peerCountEl refs are updated there before startConnect()
// is called, so the existing WaymarkConnect callbacks see the new DOM elements.
window.addEventListener('waymark:sheet-hidden', () => {
  if (_waymarkConnect) _waymarkConnect.pause();
  _peers = new Map();
  _container = null;
  _statusDot = null;
  _statusLabel = null;
  _peerCountEl = null;
  _pendingInvite = null;
  dismissInviteNotification();
});

/* ---------- Column Detection ---------- */

function columns(lower) {
  const cols = {};
  cols.game = lower.findIndex(h => /game|title/i.test(h));
  cols.player1 = lower.findIndex((h, i) => /player\s*1|p1|white|home/i.test(h) && i !== cols.game);
  cols.player2 = lower.findIndex((h, i) => /player\s*2|p2|black|away/i.test(h) && i !== cols.game && i !== cols.player1);
  cols.score = lower.findIndex((h, i) => /score|result/i.test(h) && i !== cols.game);
  cols.status = lower.findIndex((h, i) => /status|outcome|winner/i.test(h) && i !== cols.game && i !== cols.score);
  cols.date = lower.findIndex((h, i) => /date|time|played/i.test(h) && i !== cols.game);
  return cols;
}

/* ---------- Start WebRTC Connection ---------- */

/** Create and start WaymarkConnect for automatic peer discovery. */
function startConnect(template) {
  if (_waymarkConnect && !_waymarkConnect._destroyed) {
    // Connection is paused (user navigated away and returned) — resume it.
    // render() has already updated _statusDot/_statusLabel/_peerCountEl to new
    // DOM elements, so the existing callbacks will update the correct UI.
    _waymarkConnect.resume().catch(() => {});
    return;
  }
  if (_waymarkConnect) { _waymarkConnect.destroy(); _waymarkConnect = null; }

  _template = template; // Cache for reconnect after password change

  const sheetId = template._rtcSheetId;
  const signal = template._rtcSignal;
  const displayName = template._rtcUserName || 'Anonymous';

  if (!sheetId) {
    console.warn('[Arcade] startConnect skipped — no sheetId on template');
    return;
  }

  console.log(`[Arcade] startConnect sheetId=${sheetId} user=${displayName}`);

  _waymarkConnect = new WaymarkConnect(sheetId, {
    displayName,
    password: _sessionPassword || null,
    signal: signal || null,
    onMessage() { /* arcade doesn't use chat messages */ },
    onPeersChanged(peers) {
      _peers = peers;
      refreshPeerList();
      if (_peerCountEl) {
        _peerCountEl.textContent = `${peers.size} player${peers.size !== 1 ? 's' : ''}`;
      }
    },
    onStatusChanged(status) {
      if (_statusDot) {
        _statusDot.className = `arcade-status-dot arcade-status-${status}`;
      }
      if (_statusLabel) {
        const labels = {
          connected: 'Connected',
          listening: 'Searching for players…',
          pairing: 'Found a player…',
          disconnected: 'Disconnected',
        };
        _statusLabel.textContent = labels[status] || status;
      }
    },
    onRemoteStream() { /* arcade doesn't use audio/video */ },
    onCallEnded() {},
    onCallActive() {},
    onArcadeMessage(fromPeerId, msg) {
      handleArcadeMessage(fromPeerId, msg);
    },
  });

  _waymarkConnect.start();
}

/* ---------- Render ---------- */

function render(container, rows, cols, template) {
  // Rebuild the DOM but preserve the existing WaymarkConnect across auto-refreshes.
  // Only tear it down when the sheet actually changes (handled by waymark:sheet-hidden).
  container.innerHTML = '';
  _container = container;
  _cols = cols;

  // Re-select previously selected game after re-render
  const prevSelected = _selectedGame;

  // Lobby wrapper
  const lobby = el('div', { className: 'arcade-lobby' }, []);

  // Header
  const header = el('div', { className: 'arcade-header' }, [
    el('div', { className: 'arcade-title' }, [
      el('span', { className: 'arcade-title-icon' }, ['🎮']),
      el('span', {}, ['Game Arcade']),
    ]),
    el('div', { className: 'arcade-subtitle' }, [
      'Pick a game and challenge a connected peer!',
    ]),
  ]);
  lobby.append(header);

  // Two columns: games + peers
  const body = el('div', { className: 'arcade-body' }, []);

  // Games section
  const gamesSection = el('div', { className: 'arcade-section' }, [
    el('h3', { className: 'arcade-section-title' }, ['Games']),
    buildGameGrid(onGameSelect),
  ]);
  body.append(gamesSection);

  // Peers section — with connection status
  _statusDot = el('span', { className: 'arcade-status-dot arcade-status-listening' });
  _statusLabel = el('span', { className: 'arcade-status-label' }, ['Searching for players…']);
  _peerCountEl = el('span', { className: 'arcade-peer-count-label' }, ['0 players']);

  // Session password input — uses reusable handshake-auth helper
  const { row: pwRow, getPassword: getPw } = buildHandshakePasswordRow({
    prefix: 'arcade',
    initialValue: _sessionPassword,
    onPasswordChange(newPw) {
      _sessionPassword = newPw || '';
      if (_waymarkConnect) _waymarkConnect.setPassword(newPw);
    },
  });

  const peersSection = el('div', { className: 'arcade-section arcade-peers-section' }, [
    el('h3', { className: 'arcade-section-title' }, ['Players Online']),
    el('div', { className: 'arcade-connection-bar' }, [
      _statusDot,
      _statusLabel,
      _peerCountEl,
    ]),
    pwRow,
    buildPeerList(_peers, onInvite),
  ]);
  body.append(peersSection);

  lobby.append(body);

  // Match history
  if (rows && rows.length > 0) {
    const histSection = el('div', { className: 'arcade-section arcade-history-section' }, [
      el('h3', { className: 'arcade-section-title' }, ['Match History']),
      buildMatchHistory(rows, cols),
    ]);
    lobby.append(histSection);
  }

  container.append(lobby);

  // Automatically start peer discovery (no-ops if already connected)
  startConnect(template);

  // Re-apply previous game selection highlight after DOM rebuild
  if (prevSelected) {
    _selectedGame = prevSelected;
    const cards = _container.querySelectorAll('.arcade-game-card');
    for (const card of cards) {
      card.classList.toggle('arcade-game-card-selected', card.dataset.game === prevSelected);
    }
  }

  // If connection is already live, push the latest peer count into the new DOM elements
  if (_waymarkConnect && _peers.size > 0) {
    refreshPeerList();
    if (_peerCountEl) {
      _peerCountEl.textContent = `${_peers.size} player${_peers.size !== 1 ? 's' : ''}`;
    }
  }
}

/* ---------- Interaction Handlers ---------- */

function onGameSelect(gameKey) {
  _selectedGame = gameKey;
  // Highlight selected card
  if (!_container) return;
  const cards = _container.querySelectorAll('.arcade-game-card');
  for (const card of cards) {
    card.classList.toggle('arcade-game-card-selected', card.dataset.game === gameKey);
  }
}

function onInvite(peerId) {
  if (!_selectedGame) {
    showToast('Select a game first', 'error');
    return;
  }
  if (isGameActive()) {
    showToast('A game is already in progress', 'error');
    return;
  }
  if (_pendingInvite) {
    showToast('Already waiting for a response…', 'error');
    return;
  }

  const games = getGameList();
  const game = games.find(g => g.key === _selectedGame);
  const gameName = game ? game.name : _selectedGame;

  console.log(`[Arcade] sending invite to ${peerId} for game=${_selectedGame}`);

  // Send invite via the waymark DataChannel
  _waymarkConnect.sendToPeer(peerId, {
    type: 'arcade-invite',
    gameKey: _selectedGame,
    gameName,
    peerId: _waymarkConnect.peerId,
    name: _waymarkConnect.displayName,
  });

  _pendingInvite = { peerId, gameKey: _selectedGame };

  // Update UI — show waiting state on the invite button
  showWaitingState(peerId);
  showToast(`Invite sent! Waiting for response…`, 'info');

  // Auto-cancel invite after timeout
  let remaining = Math.round(INVITE_TIMEOUT_MS / 1000);
  _updateInviteCountdown(peerId, remaining);
  _inviteTimeout = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(_inviteTimeout);
      _inviteTimeout = null;
      _pendingInvite = null;
      clearWaitingState();
      showToast('Invite timed out — no response received', 'error');
    } else {
      _updateInviteCountdown(peerId, remaining);
    }
  }, INVITE_COUNTDOWN_STEP);
}

/* ---------- Arcade Message Dispatch ---------- */

function handleArcadeMessage(fromPeerId, msg) {
  console.log(`[Arcade] handleArcadeMessage from ${fromPeerId}:`, msg.type, msg);
  switch (msg.type) {
    case 'arcade-invite':
      handleIncomingInvite(fromPeerId, msg);
      break;
    case 'arcade-accept':
      handleAccept(fromPeerId, msg);
      break;
    case 'arcade-decline':
      handleDecline(fromPeerId, msg);
      break;
    default:
      console.warn(`[Arcade] unrecognised arcade message type '${msg.type}' from ${fromPeerId}`);
  }
}

function handleIncomingInvite(fromPeerId, msg) {
  if (isGameActive()) {
    console.log(`[Arcade] auto-declining invite from ${fromPeerId} — game already active`);
    // Auto-decline if already in a game
    _waymarkConnect.sendToPeer(fromPeerId, {
      type: 'arcade-decline',
      reason: 'busy',
      peerId: _waymarkConnect.peerId,
    });
    return;
  }

  // Dismiss any previous invite notification
  dismissInviteNotification();

  // Show incoming invite notification
  const peerName = msg.name || 'A player';
  const gameName = msg.gameName || msg.gameKey;

  _inviteNotification = el('div', { className: 'arcade-invite-notification' }, [
    el('div', { className: 'arcade-invite-text' }, [
      el('span', { className: 'arcade-invite-icon' }, ['🎮']),
      el('span', {}, [`${peerName} wants to play `]),
      el('strong', {}, [gameName]),
    ]),
    el('div', { className: 'arcade-invite-actions' }, [
      el('button', {
        className: 'arcade-invite-accept',
        on: {
          click: () => {
            acceptInvite(fromPeerId, msg.gameKey);
          },
        },
      }, ['Accept']),
      el('button', {
        className: 'arcade-invite-decline',
        on: {
          click: () => {
            declineInvite(fromPeerId);
          },
        },
      }, ['Decline']),
    ]),
  ]);

  // Insert at top of lobby
  if (_container) {
    const lobby = _container.querySelector('.arcade-lobby');
    if (lobby) {
      lobby.prepend(_inviteNotification);
    }
  }
}

function acceptInvite(fromPeerId, gameKey) {
  console.log(`[Arcade] accepting invite from ${fromPeerId} for game=${gameKey}`);
  dismissInviteNotification();

  // Open the game modal FIRST so ArcadeNet listener is ready before channels arrive
  openGameModal({
    gameKey,
    waymarkConnect: _waymarkConnect,
    remotePeerId: fromPeerId,
    onClose() { clearWaitingState(); },
  });

  // THEN send accept — inviter's ArcadeNet will create channels after this
  _waymarkConnect.sendToPeer(fromPeerId, {
    type: 'arcade-accept',
    gameKey,
    peerId: _waymarkConnect.peerId,
    name: _waymarkConnect.displayName,
  });
}

function declineInvite(fromPeerId) {
  console.log(`[Arcade] declining invite from ${fromPeerId}`);
  dismissInviteNotification();
  _waymarkConnect.sendToPeer(fromPeerId, {
    type: 'arcade-decline',
    peerId: _waymarkConnect.peerId,
  });
}

function handleAccept(fromPeerId, msg) {
  if (!_pendingInvite || _pendingInvite.peerId !== fromPeerId) {
    console.warn(`[Arcade] handleAccept from ${fromPeerId} — no matching pending invite (pending: ${_pendingInvite ? _pendingInvite.peerId : 'none'})`);
    return;
  }
  console.log(`[Arcade] invite accepted by ${fromPeerId} for game=${_pendingInvite.gameKey}`);
  const gameKey = _pendingInvite.gameKey;
  _pendingInvite = null;
  clearWaitingState();

  // Open game modal — the acceptor already has ArcadeNet listening
  openGameModal({
    gameKey,
    waymarkConnect: _waymarkConnect,
    remotePeerId: fromPeerId,
    onClose() {},
  });
}

function handleDecline(fromPeerId, msg) {
  if (!_pendingInvite || _pendingInvite.peerId !== fromPeerId) {
    console.warn(`[Arcade] handleDecline from ${fromPeerId} — no matching pending invite`);
    return;
  }
  console.log(`[Arcade] invite declined by ${fromPeerId} reason=${msg.reason || 'none'}`);
  _pendingInvite = null;
  clearWaitingState();
  const reason = msg.reason === 'busy' ? 'They are already in a game' : 'Invite declined';
  showToast(reason, 'error');
}

function dismissInviteNotification() {
  if (_inviteNotification) {
    _inviteNotification.remove();
    _inviteNotification = null;
  }
}

function showWaitingState(peerId) {
  if (!_container) return;
  const btns = _container.querySelectorAll('.arcade-invite-btn');
  for (const btn of btns) {
    const card = btn.closest('.arcade-peer-card');
    if (!card) continue;
    // Disable all invite buttons while waiting
    btn.disabled = true;
    // Show waiting text on the invited peer's button
    if (card.dataset.peerId === peerId) {
      btn.textContent = 'Waiting…';
      btn.classList.add('arcade-invite-btn-waiting');
    }
  }
}

function clearWaitingState() {
  _pendingInvite = null;
  if (_inviteTimeout) {
    clearInterval(_inviteTimeout);
    _inviteTimeout = null;
  }
  if (!_container) return;
  const btns = _container.querySelectorAll('.arcade-invite-btn');
  for (const btn of btns) {
    btn.disabled = false;
    btn.textContent = 'Invite';
    btn.classList.remove('arcade-invite-btn-waiting');
  }
}

/**
 * Update the countdown text on the waiting invite button.
 * @param {string} peerId
 * @param {number} seconds
 */
function _updateInviteCountdown(peerId, seconds) {
  if (!_container) return;
  const cards = _container.querySelectorAll('.arcade-peer-card');
  for (const card of cards) {
    if (card.dataset.peerId !== peerId) continue;
    const btn = card.querySelector('.arcade-invite-btn');
    if (btn) btn.textContent = `Waiting… ${seconds}s`;
    break;
  }
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Arcade',
  icon: '🎮',
  color: '#7c3aed',
  priority: 20,

  detect(lower) {
    // Direct keyword match
    if (lower.some(h => /\b(arcade|game\s*lobby|game\s*room|multiplayer)\b/i.test(h))) return true;
    // Combination: "game" header + "player" header
    const hasGame = lower.some(h => /^\s*game\s*$/i.test(h));
    const hasPlayer = lower.some(h => /\bplayer\b/i.test(h));
    return hasGame && hasPlayer;
  },

  columns,

  render(container, rows, cols, template) {
    render(container, rows, cols, template);
  },
};

function refreshPeerList() {
  if (!_container) return;
  const section = _container.querySelector('.arcade-peers-section');
  if (!section) return;
  // Replace peer list content (keep connection bar, replace only the peer list element)
  const existingList = section.querySelector('.arcade-peer-list, .arcade-no-peers');
  const newList = buildPeerList(_peers, onInvite);
  if (existingList) {
    existingList.replaceWith(newList);
  } else {
    section.append(newList);
  }
}

registerTemplate('arcade', definition);
export default definition;
