/* ============================================================
   templates/habit/stats.js — Summary analytics panel
   for the Habit Tracker template.
   ============================================================ */

import { el } from '../shared.js';

/* ---------- Summary Stats Panel ---------- */

/**
 * Build an empty summary panel (populated later by updateSummary).
 * @returns {HTMLElement}
 */
export function buildSummaryPanel() {
  return el('div', { className: 'habit-summary hidden' });
}

/**
 * Populate (or refresh) the summary panel with live stats from the DOM.
 * Reads toggle states from rendered grid cells rather than raw data,
 * so it stays accurate after interactive toggles.
 * @param {HTMLElement} container — the top-level template container
 * @param {Object}      cols     — column index map
 */
export function updateSummary(container, cols) {
  const panel = container.querySelector('.habit-summary');
  if (!panel) return;

  /* Gather per-habit stats from the live DOM */
  const habitStats = [];
  const grids = container.querySelectorAll('.habit-grid');
  const gridEls = grids.length ? grids : [container];
  for (const grid of gridEls) {
    const dataRows = grid.querySelectorAll(
      '.habit-grid-row:not(.habit-grid-header):not(.habit-grid-footer)',
    );
    for (const row of dataRows) {
      const nameCell = row.querySelector('.habit-name-cell');
      const toggles = row.querySelectorAll('.habit-toggle');
      let done = 0;
      const total = toggles.length;
      for (const t of toggles) { if (t.dataset.state === 'done') done++; }
      habitStats.push({
        name: nameCell?.textContent || '?',
        done,
        total,
        pct: total ? Math.round((done / total) * 100) : 0,
      });
    }
  }

  if (habitStats.length === 0) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  /* Aggregate numbers */
  const overallDone  = habitStats.reduce((s, h) => s + h.done, 0);
  const overallTotal = habitStats.reduce((s, h) => s + h.total, 0);
  const overallPct   = overallTotal ? Math.round((overallDone / overallTotal) * 100) : 0;

  const best  = habitStats.reduce((a, b) => (a.pct >= b.pct ? a : b));
  const worst = habitStats.reduce((a, b) => (a.pct <= b.pct ? a : b));

  /* Title */
  panel.append(el('h4', { className: 'habit-summary-title' }, ['\uD83D\uDCCA Weekly Summary']));

  /* Overall progress bar */
  panel.append(el('div', { className: 'habit-summary-overall' }, [
    el('span', { className: 'habit-summary-label' }, ['Overall']),
    el('div', { className: 'habit-summary-bar' }, [
      el('div', { className: 'habit-summary-bar-fill', style: `width: ${overallPct}%` }),
    ]),
    el('span', { className: 'habit-summary-pct' }, [`${overallPct}%`]),
  ]));

  /* Best & needs-attention highlights */
  const highlights = el('div', { className: 'habit-summary-highlights' });
  highlights.append(el('div', { className: 'habit-summary-stat habit-summary-best' }, [
    el('span', { className: 'habit-summary-stat-icon' }, ['\uD83C\uDFC6']),
    el('span', {}, [`Best: ${best.name} (${best.pct}%)`]),
  ]));
  if (worst !== best) {
    highlights.append(el('div', { className: 'habit-summary-stat habit-summary-attention' }, [
      el('span', { className: 'habit-summary-stat-icon' }, ['\u26A0\uFE0F']),
      el('span', {}, [`Needs work: ${worst.name} (${worst.pct}%)`]),
    ]));
  }
  panel.append(highlights);

  /* Per-habit mini bars */
  const list = el('div', { className: 'habit-summary-list' });
  for (const h of habitStats) {
    list.append(el('div', { className: 'habit-summary-item' }, [
      el('span', { className: 'habit-summary-item-name' }, [h.name]),
      el('div', { className: 'habit-summary-bar' }, [
        el('div', { className: 'habit-summary-bar-fill', style: `width: ${h.pct}%` }),
      ]),
      el('span', { className: 'habit-summary-pct' }, [`${h.pct}%`]),
    ]));
  }
  panel.append(list);
}
