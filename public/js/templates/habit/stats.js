/* ============================================================
   templates/habit/stats.js — Summary analytics panel
   for the Habit Tracker template.
   Supports single-week and multi-week modes with trend
   comparison and weekly history charts.
   ============================================================ */

import { el, cell } from '../shared.js';
import { habitState, weekCompletionRate } from './helpers.js';

/* ---------- Summary Stats Panel ---------- */

/**
 * Build an empty summary panel (populated later by updateSummary).
 * @returns {HTMLElement}
 */
export function buildSummaryPanel() {
  return el('div', { className: 'habit-summary hidden' });
}

/**
 * Compute per-habit stats for a set of rows from the given day columns.
 * @param {Array} rows
 * @param {number[]} dayCols
 * @param {number} textCol
 * @returns {Array<{name: string, done: number, total: number, pct: number}>}
 */
function computeHabitStats(rows, dayCols, textCol) {
  const stats = [];
  for (const row of rows) {
    const name = cell(row, textCol) || '?';
    let done = 0;
    for (const col of dayCols) {
      const s = habitState(cell(row, col));
      if (s === 'done') done++;
      else if (s === 'partial') done += 0.5;
    }
    stats.push({ name, done, total: dayCols.length, pct: dayCols.length ? Math.round((done / dayCols.length) * 100) : 0 });
  }
  return stats;
}

/**
 * Populate (or refresh) the summary panel with live stats from the DOM.
 * Reads toggle states from rendered grid cells rather than raw data,
 * so it stays accurate after interactive toggles.
 * @param {HTMLElement} container — the top-level template container
 * @param {Object}      cols     — column index map
 * @param {Array}       [weeks]  — optional sorted week objects for multi-week mode
 * @param {number}      [weekIdx] — optional current week index
 */
export function updateSummary(container, cols, weeks, weekIdx) {
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

  /* Also check Day View items */
  const dayItems = container.querySelectorAll('.habit-day-item');
  if (dayItems.length > 0 && habitStats.length === 0) {
    for (const item of dayItems) {
      const name = item.querySelector('.habit-day-name')?.textContent || '?';
      const state = item.dataset.state || 'empty';
      habitStats.push({
        name,
        done: state === 'done' ? 1 : 0,
        total: 1,
        pct: state === 'done' ? 100 : 0,
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
  const titleText = weeks && weeks[weekIdx]
    ? `\uD83D\uDCCA ${weeks[weekIdx].label}`
    : '\uD83D\uDCCA Weekly Summary';
  panel.append(el('h4', { className: 'habit-summary-title' }, [titleText]));

  /* Overall progress bar */
  panel.append(el('div', { className: 'habit-summary-overall' }, [
    el('span', { className: 'habit-summary-label' }, ['Overall']),
    el('div', { className: 'habit-summary-bar' }, [
      el('div', { className: 'habit-summary-bar-fill', style: `width: ${overallPct}%` }),
    ]),
    el('span', { className: 'habit-summary-pct' }, [`${overallPct}%`]),
  ]));

  /* Trend comparison (multi-week only) */
  if (weeks && weeks.length > 1 && weekIdx > 0) {
    const prevWeek = weeks[weekIdx - 1];
    const prevStats = computeHabitStats(prevWeek.rows, cols.days, cols.text);
    const prevDone = prevStats.reduce((s, h) => s + h.done, 0);
    const prevTotal = prevStats.reduce((s, h) => s + h.total, 0);
    const prevPct = prevTotal ? Math.round((prevDone / prevTotal) * 100) : 0;
    const diff = overallPct - prevPct;

    const arrow = diff > 0 ? '\u2191' : diff < 0 ? '\u2193' : '\u2192';
    const trendClass = diff > 0 ? 'habit-trend-up' : diff < 0 ? 'habit-trend-down' : 'habit-trend-same';

    panel.append(el('div', { className: `habit-trend ${trendClass}` }, [
      el('span', { className: 'habit-trend-arrow' }, [arrow]),
      el('span', {}, [
        `${Math.abs(diff)}% ${diff > 0 ? 'improvement' : diff < 0 ? 'decrease' : 'same'} vs previous week`,
      ]),
    ]));
  }

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

  /* Weekly history chart (multi-week, 2+ weeks) */
  if (weeks && weeks.length > 1) {
    const historySection = el('div', { className: 'habit-history' });
    historySection.append(el('h5', { className: 'habit-history-title' }, ['Weekly History']));
    const historyGrid = el('div', { className: 'habit-history-grid' });

    for (let w = 0; w < weeks.length; w++) {
      const rate = weekCompletionRate(weeks[w].rows, cols.days);
      const pctH = Math.round(rate * 100);
      const barContainer = el('div', { className: 'habit-history-bar-container' });
      const barWrap = el('div', { className: 'habit-history-bar' });
      barWrap.append(el('div', {
        className: `habit-history-fill ${w === weekIdx ? 'habit-history-active' : ''}`,
        style: `height: ${pctH}%`,
        title: `${weeks[w].label}: ${pctH}%`,
      }));
      barContainer.append(barWrap);
      barContainer.append(el('span', { className: 'habit-history-label' }, [
        weeks[w].iso.slice(5),
      ]));
      historyGrid.append(barContainer);
    }

    historySection.append(historyGrid);
    panel.append(historySection);
  }
}
