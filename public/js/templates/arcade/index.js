/* ============================================================
   templates/arcade/index.js — Arcade template barrel
   ============================================================ */

import { el, registerTemplate, cell, WaymarkConnect, showToast } from '../shared.js';
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

/* ---------- Render ---------- */

function render(container, rows, cols) {
  container.innerHTML = '';
  _container = container;
  _cols = cols;

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

  // Peers section
  const peersSection = el('div', { className: 'arcade-section arcade-peers-section' }, [
    el('h3', { className: 'arcade-section-title' }, ['Players Online']),
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

  // Start the game immediately for now (in the future, send invite and wait for accept)
  openGameModal({
    gameKey: _selectedGame,
    waymarkConnect: _waymarkConnect,
    remotePeerId: peerId,
    onClose() {
      // Could record result to sheet here
    },
  });
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
    render(container, rows, cols);
  },

  /**
   * Called by the social/webrtc layer when peers change.
   * @param {Object} wc — WaymarkConnect instance
   */
  setConnect(wc) {
    _waymarkConnect = wc;
    if (wc) {
      const origCb = wc.onPeersChanged;
      wc.onPeersChanged = (peers) => {
        _peers = peers;
        refreshPeerList();
        if (origCb) origCb(peers);
      };
    }
  },
};

function refreshPeerList() {
  if (!_container) return;
  const section = _container.querySelector('.arcade-peers-section');
  if (!section) return;
  // Replace peer list content
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
