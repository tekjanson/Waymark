/* ============================================================
   templates/scoreboard.js — Scoreboard / Leaderboard template
   ============================================================ */

import { el, cell, editableCell, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

/**
 * Return medal emoji for rank 1–3, empty string otherwise.
 * @param {number} rank — 1-based rank
 * @returns {string}
 */
export function medalIcon(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

/**
 * Return ordinal suffix string (1st, 2nd, 3rd, 4th, etc.).
 * @param {number} n
 * @returns {string}
 */
export function rankSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Parse a score string to a number, stripping commas and whitespace.
 * Returns 0 for invalid input.
 * @param {string} raw
 * @returns {number}
 */
export function parseScore(raw) {
  if (!raw) return 0;
  const n = parseFloat(String(raw).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

/**
 * Format a score number back to a display string with thousands commas.
 * @param {number} n
 * @returns {string}
 */
export function formatScore(n) {
  return n.toLocaleString('en-US');
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Scoreboard',
  icon: '🏆',
  color: '#d97706',
  priority: 33,
  itemNoun: 'Player',
  defaultHeaders: ['Player', 'Score', 'Games Played', 'Win Rate', 'Streak'],

  /**
   * Detect: requires a player/name column + score/points column.
   * @param {string[]} lower
   * @returns {boolean}
   */
  detect(lower) {
    const hasPlayer = lower.some(h => /^(player|name|team|contestant|competitor|user)/.test(h));
    const hasScore  = lower.some(h => /^(score|points|pts|total|rating|rank)/.test(h));
    return hasPlayer && hasScore;
  },

  /**
   * Map header positions to semantic column roles.
   * @param {string[]} lower
   * @returns {Object}
   */
  columns(lower) {
    const cols = { player: -1, score: -1, games: -1, winrate: -1, streak: -1, rank: -1 };
    cols.player  = lower.findIndex(h => /^(player|name|team|contestant|competitor|user)/.test(h));
    if (cols.player === -1) cols.player = 0;
    cols.score   = lower.findIndex(h => /^(score|points|pts|total|rating)/.test(h));
    if (cols.score === -1) cols.score = 1;
    cols.rank    = lower.findIndex(h => /^rank/.test(h));
    cols.games   = lower.findIndex(h => /^(games|played|matches|gp)/.test(h));
    cols.winrate = lower.findIndex(h => /^(win|win rate|wr|wins?)/.test(h));
    cols.streak  = lower.findIndex(h => /^(streak|combo|consecutive)/.test(h));
    return cols;
  },

  /**
   * Add-row field definitions.
   * @param {Object} cols
   * @returns {Array}
   */
  addRowFields(cols) {
    return [
      { role: 'player',  label: 'Player / Name',  colIndex: cols.player,  type: 'text',   placeholder: 'Player name', required: true },
      { role: 'score',   label: 'Score / Points',  colIndex: cols.score,   type: 'number', placeholder: '0', defaultValue: '0' },
      { role: 'games',   label: 'Games Played',    colIndex: cols.games,   type: 'number', placeholder: '0' },
      { role: 'winrate', label: 'Win Rate',         colIndex: cols.winrate, type: 'text',   placeholder: '0%' },
      { role: 'streak',  label: 'Streak',           colIndex: cols.streak,  type: 'number', placeholder: '0' },
    ];
  },

  /**
   * Render podium + ranked list.
   * @param {HTMLElement} container
   * @param {string[][]} rows
   * @param {Object} cols
   */
  render(container, rows, cols) {
    /* Sort rows by score descending — positions determine rank */
    const indexed = rows.map((row, i) => ({ row, origIdx: i + 1, score: parseScore(cell(row, cols.score)) }));
    indexed.sort((a, b) => b.score - a.score);

    /* ---------- Podium (top 3) ---------- */
    const topThree = indexed.slice(0, Math.min(3, indexed.length));

    if (topThree.length >= 1) {
      /* Build podium blocks — layout order: 2nd | 1st | 3rd */
      const podiumItems = topThree.map((entry, i) => {
        const rank = i + 1;
        const name = cell(entry.row, cols.player) || entry.row[0] || '—';
        const scoreVal = cell(entry.row, cols.score);

        const heights = ['250px', '200px', '170px'];
        return el('div', {
          className: `scoreboard-podium-block scoreboard-rank-${rank}`,
          style: { order: rank === 1 ? '1' : rank === 2 ? '0' : '2' },
        }, [
          el('div', { className: 'scoreboard-podium-medal' }, [medalIcon(rank)]),
          editableCell('div', { className: 'scoreboard-podium-name' }, name, entry.origIdx, cols.player),
          editableCell('div', { className: 'scoreboard-podium-score' }, scoreVal, entry.origIdx, cols.score),
          el('div', { className: 'scoreboard-podium-stand', style: { height: heights[i] } }, [
            el('span', { className: 'scoreboard-podium-pos' }, [rankSuffix(rank)]),
          ]),
        ]);
      });

      container.append(el('div', { className: 'scoreboard-podium' }, podiumItems));
    }

    /* ---------- Ranked list ---------- */
    const listEl = el('div', { className: 'scoreboard-list' });

    for (let i = 0; i < indexed.length; i++) {
      const { row, origIdx, score } = indexed[i];
      const rank = i + 1;
      const name    = cell(row, cols.player) || row[0] || '—';
      const scoreRaw = cell(row, cols.score);
      const games   = cell(row, cols.games);
      const winrate = cell(row, cols.winrate);
      const streak  = cell(row, cols.streak);
      const streakN = parseScore(streak);

      /* Rank indicator */
      const rankEl = el('div', { className: `scoreboard-rank-num scoreboard-rank-num-${Math.min(rank, 4)}` }, [
        rank <= 3
          ? el('span', { className: 'scoreboard-medal' }, [medalIcon(rank)])
          : el('span', { className: 'scoreboard-ordinal' }, [String(rank)]),
      ]);

      /* Player name */
      const playerEl = editableCell('div', { className: 'scoreboard-player-name' }, name, origIdx, cols.player);

      /* Score */
      const scoreEl = editableCell('div', { className: `scoreboard-score${rank <= 3 ? ' scoreboard-score-top' : ''}` }, scoreRaw, origIdx, cols.score, {
        renderContent(w) { w.textContent = score > 0 ? formatScore(score) : (scoreRaw || '0'); },
        onCommit(v, w) {
          const n = parseScore(v);
          w.textContent = n > 0 ? formatScore(n) : (v || '0');
        },
      });

      /* Optional badges */
      const badges = [];
      if (streakN > 0) {
        badges.push(el('span', { className: 'scoreboard-streak-badge' }, [`🔥 ${streakN}`]));
      }
      if (winrate) {
        badges.push(editableCell('span', { className: 'scoreboard-winrate-badge' }, winrate, origIdx, cols.winrate));
      }
      if (games) {
        badges.push(editableCell('span', { className: 'scoreboard-games-badge' }, games, origIdx, cols.games, {
          renderContent(w) { w.textContent = `${games} games`; },
          onCommit(v, w) { w.textContent = `${v} games`; },
        }));
      }

      const infoEl = el('div', { className: 'scoreboard-player-info' }, [
        playerEl,
        ...(badges.length ? [el('div', { className: 'scoreboard-badges' }, badges)] : []),
      ]);

      listEl.append(
        el('div', { className: `scoreboard-row${rank <= 3 ? ' scoreboard-row-top' : ''}` }, [
          rankEl,
          infoEl,
          scoreEl,
        ])
      );
    }

    container.append(listEl);
  },
};

registerTemplate('scoreboard', definition);
export default definition;
