/* ============================================================
   templates/habit/stats.js — Summary analytics panel
   for the Habit Tracker template.
   ============================================================ */

import { el } from '../shared.js';
import { habitState } from './helpers.js';

/* ---------- Summary Stats Panel ---------- */

/**
 * Build an empty summary panel (populated later by updateSummary).
 * @returns {HTMLElement}
 */
export function buildSummaryPanel() {
  return el('div', { className: 'habit-summary hidden' });
}

/**
 * Compute per-habit done count from a week's rows.
 * @param {Array} weekRows - [{row, origIdx}]
 * @param {number[]} dayCols
 * @returns {Map<string, {done: number, total: number}>}
 */
function weekHabitStats(weekRows, dayCols) {
  const stats = new Map();
  for (const { row } of weekRows) {
    const name = (row[0] || '').trim();
    if (!name) continue;
    let done = 0;
    for (const dc of dayCols) {
      if (habitState(row[dc] || '') === 'done') done++;
    }
    stats.set(name, { done, total: dayCols.length });
  }
  return stats;
}

/**
 * Populate (or refresh) the summary panel with live stats from the DOM.
 * Reads toggle states from rendered grid cells rather than raw data,
 * so it stays accurate after interactive toggles.
 * @param {HTMLElement} container — the top-level template container
 * @param {Object}      cols     — column index map
 * @param {Array|null}  weeks    — sorted week objects (null for single-week mode)
 * @param {number}      weekIdx  — selected week index (-1 for single-week)
 */
export function updateSummary(container, cols, weeks, weekIdx) {
  const panel = container.querySelector('.habit-summary');
  if (!panel) return;

  const isMultiWeek = weeks && weeks.length > 0 && weekIdx >= 0;

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
  const titleText = isMultiWeek
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

  /* Multi-week trend comparison */
  if (isMultiWeek && weekIdx > 0) {
    const prevWeek = weeks[weekIdx - 1];
    const curWeek  = weeks[weekIdx];
    const prevStats = weekHabitStats(prevWeek.rows, cols.days);
    const curStats  = weekHabitStats(curWeek.rows, cols.days);

    // Compute previous week's overall pct
    let prevDone = 0, prevTotal = 0;
    for (const s of prevStats.values()) { prevDone += s.done; prevTotal += s.total; }
    const prevPct = prevTotal ? Math.round((prevDone / prevTotal) * 100) : 0;

    const diff = overallPct - prevPct;
    const arrow = diff > 0 ? '\u2191' : diff < 0 ? '\u2193' : '\u2192';
    const trendClass = diff > 0 ? 'habit-trend-up' : diff < 0 ? 'habit-trend-down' : 'habit-trend-same';

    panel.append(el('div', { className: `habit-trend ${trendClass}` }, [
      el('span', { className: 'habit-trend-arrow' }, [arrow]),
      el('span', {}, [
        diff > 0
          ? `+${diff}% vs last week (${prevPct}%)`
          : diff < 0
            ? `${diff}% vs last week (${prevPct}%)`
            : `Same as last week (${prevPct}%)`,
      ]),
    ]));

    /* Per-habit trend indicators */
    const trendList = el('div', { className: 'habit-trend-list' });
    for (const h of habitStats) {
      const prev = prevStats.get(h.name);
      if (!prev) continue;
      const prevHPct = prev.total ? Math.round((prev.done / prev.total) * 100) : 0;
      const hDiff = h.pct - prevHPct;
      if (hDiff === 0) continue;
      const hArrow = hDiff > 0 ? '\u2191' : '\u2193';
      const hClass = hDiff > 0 ? 'habit-trend-up' : 'habit-trend-down';
      trendList.append(el('span', { className: `habit-trend-badge ${hClass}` }, [
        `${hArrow} ${h.name}`,
      ]));
    }
    if (trendList.children.length > 0) {
      panel.append(trendList);
    }
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

  /* Multi-week history mini chart */
  if (isMultiWeek && weeks.length > 1) {
    const historySection = el('div', { className: 'habit-week-history' });
    historySection.append(el('h5', { className: 'habit-week-history-title' }, [
      '\uD83D\uDCC5 Weekly History',
    ]));
    const historyGrid = el('div', { className: 'habit-week-history-grid' });

    for (let w = 0; w < weeks.length; w++) {
      const wk = weeks[w];
      const wStats = weekHabitStats(wk.rows, cols.days);
      let wDone = 0, wTotal = 0;
      for (const s of wStats.values()) { wDone += s.done; wTotal += s.total; }
      const wPct = wTotal ? Math.round((wDone / wTotal) * 100) : 0;

      const isSelected = w === weekIdx;
      const bar = el('div', {
        className: `habit-week-history-bar ${isSelected ? 'habit-week-history-selected' : ''}`,
        title: `${wk.label}: ${wPct}%`,
      }, [
        el('div', { className: 'habit-week-history-fill', style: `height: ${wPct}%` }),
        el('span', { className: 'habit-week-history-label' }, [
          wk.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ]),
        el('span', { className: 'habit-week-history-pct' }, [`${wPct}%`]),
      ]);
      historyGrid.append(bar);
    }

    historySection.append(historyGrid);
    panel.append(historySection);
  }
}
