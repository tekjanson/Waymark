/* ============================================================
   templates/arcade/helpers.js — Constants, game registry lookup
   ============================================================ */

import { getGames } from '../../arcade/engine.js';

/* ---------- Template constants ---------- */

export const ARCADE_COLS = {
  game: 'game',
  player1: 'player1',
  player2: 'player2',
  score: 'score',
  status: 'status',
  date: 'date',
};

/* ---------- Game list for lobby UI ---------- */

/**
 * Get all registered games as an array sorted by name.
 * @returns {{ key: string, name: string, description: string, icon: string, maxPlayers: number, netModel: string }[]}
 */
export function getGameList() {
  const games = getGames();
  return Array.from(games.values())
    .map(g => ({
      key: g.key,
      name: g.name,
      description: g.description,
      icon: g.icon,
      maxPlayers: g.maxPlayers,
      netModel: g.netModel,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Net model display label.
 * @param {string} model
 * @returns {string}
 */
export function netModelLabel(model) {
  switch (model) {
    case 'lockstep': return 'Turn-Based';
    case 'rollback': return 'Real-Time';
    case 'host-authority': return 'Host-Based';
    default: return model;
  }
}
