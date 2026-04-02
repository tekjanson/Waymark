/* ============================================================
   templates/arcade/cards.js — Game selection card builders
   ============================================================ */

import { el } from '../shared.js';
import { getGameList, netModelLabel } from './helpers.js';

/**
 * Build the game selection grid.
 * @param {function} onSelect — (gameKey) => void
 * @returns {HTMLElement}
 */
export function buildGameGrid(onSelect) {
  const games = getGameList();
  const grid = el('div', { className: 'arcade-game-grid' }, []);

  for (const game of games) {
    const card = el('div', {
      className: 'arcade-game-card',
      dataset: { game: game.key },
      on: {
        click: () => onSelect(game.key),
      },
    }, [
      el('div', { className: 'arcade-game-icon' }, [game.icon]),
      el('div', { className: 'arcade-game-info' }, [
        el('div', { className: 'arcade-game-name' }, [game.name]),
        el('div', { className: 'arcade-game-desc' }, [game.description]),
        el('div', { className: 'arcade-game-meta' }, [
          el('span', { className: 'arcade-game-badge' }, [
            netModelLabel(game.netModel),
          ]),
          el('span', { className: 'arcade-game-badge' }, [
            `${game.maxPlayers}P`,
          ]),
        ]),
      ]),
    ]);
    grid.append(card);
  }

  return grid;
}

/**
 * Build a peer list for inviting opponents.
 * @param {Map} peers — peerId → { name, channel }
 * @param {function} onInvite — (peerId) => void
 * @returns {HTMLElement}
 */
export function buildPeerList(peers, onInvite) {
  if (!peers || peers.size === 0) {
    return el('div', { className: 'arcade-no-peers' }, [
      el('p', {}, ['No peers connected.']),
      el('p', { className: 'arcade-hint' }, [
        'Open this sheet on another device to play together!',
      ]),
    ]);
  }

  const list = el('div', { className: 'arcade-peer-list' }, []);
  for (const [peerId, info] of peers) {
    const peerCard = el('div', { className: 'arcade-peer-card', dataset: { peerId } }, [
      el('span', { className: 'arcade-peer-name' }, [info.name || 'Peer']),
      el('span', { className: 'arcade-peer-channel' }, [
        info.channel === 'rtc' ? '🟢' : '🟡',
      ]),
      el('button', {
        className: 'arcade-invite-btn',
        on: { click: () => onInvite(peerId) },
      }, ['Invite']),
    ]);
    list.append(peerCard);
  }
  return list;
}

/**
 * Build match history rows from sheet data.
 * @param {string[][]} rows — sheet rows
 * @param {Object} cols — column indices
 * @returns {HTMLElement}
 */
export function buildMatchHistory(rows, cols) {
  if (!rows || rows.length === 0) {
    return el('div', { className: 'arcade-no-history' }, [
      'No matches played yet.',
    ]);
  }

  const table = el('div', { className: 'arcade-history' }, []);
  const header = el('div', { className: 'arcade-history-row arcade-history-header' }, [
    el('span', {}, ['Game']),
    el('span', {}, ['Player 1']),
    el('span', {}, ['Player 2']),
    el('span', {}, ['Score']),
    el('span', {}, ['Result']),
  ]);
  table.append(header);

  for (const row of rows) {
    const game = (row[cols.game] || '').trim();
    const p1 = (row[cols.player1] || '').trim();
    const p2 = (row[cols.player2] || '').trim();
    const score = (row[cols.score] || '').trim();
    const status = (row[cols.status] || '').trim();

    const rowEl = el('div', { className: 'arcade-history-row' }, [
      el('span', {}, [game]),
      el('span', {}, [p1]),
      el('span', {}, [p2]),
      el('span', {}, [score]),
      el('span', { className: `arcade-status-${status.toLowerCase()}` }, [status]),
    ]);
    table.append(rowEl);
  }

  return table;
}
