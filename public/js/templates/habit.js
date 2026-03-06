/* ============================================================
   templates/habit.js — Habit Tracker with week navigation,
   analytics, categories, goals, and streak tracking
   ============================================================ */

import { el, cell, editableCell, comboCell, emitEdit, registerTemplate } from './shared.js';

/* ---------- Constants ---------- */

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CHECK_RE = /^(✓|✔|x|yes|1|true|done)$/i;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ---------- Helpers ---------- */

/** Test whether a cell value counts as "checked". */
function isChecked(val) { return CHECK_RE.test((val || '').trim()); }

/** Count checked days for a row across day columns. */
function countChecked(row, dayCols) {
  return dayCols.reduce((n, idx) => n + (isChecked(cell(row, idx)) ? 1 : 0), 0);
}

/** Parse a goal string like "5x" or "5x/week" → number, or NaN. */
function parseGoal(raw) {
  const m = (raw || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** Collect unique categories from items. */
function uniqueCategories(items, catIdx) {
  if (catIdx < 0) return [];
  const seen = new Set();
  for (const it of items) {
    const v = cell(it.row, catIdx).trim();
    if (v) seen.add(v);
  }
  return [...seen].sort();
}

/** Parse a week cell value into a Date. */
function parseWeekDate(val) {
  if (!val) return null;
  const d = new Date(val.trim());
  return isNaN(d.getTime()) ? null : d;
}

/** Format a date as "Week of Mar 2, 2026". */
function formatWeekLabel(date) {
  return `Week of ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Format a date as short label "Mar 2". */
function formatWeekShort(date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Build [{row, rowIdx}] from raw rows array. */
function toItems(rows) {
  return rows.map((row, i) => ({ row, rowIdx: i + 1 }));
}

/** Group items by week column. Returns sorted array of week objects. */
function groupByWeek(allItems, weekIdx) {
  const map = new Map();
  for (const it of allItems) {
    const raw = cell(it.row, weekIdx).trim();
    const date = parseWeekDate(raw);
    const key = date ? date.toISOString().slice(0, 10) : (raw || 'unknown');
    if (!map.has(key)) {
      map.set(key, {
        date,
        dateKey: key,
        label: date ? formatWeekLabel(date) : key,
        shortLabel: date ? formatWeekShort(date) : key,
        items: [],
      });
    }
    map.get(key).items.push(it);
  }
  return [...map.values()].sort((a, b) => {
    if (a.date && b.date) return a.date - b.date;
    return a.dateKey.localeCompare(b.dateKey);
  });
}

/** Compute completion % for a set of items. */
function completionPct(items, dayCols) {
  const total = items.length * dayCols.length;
  if (total === 0) return 0;
  const checked = items.reduce((n, it) => n + countChecked(it.row, dayCols), 0);
  return Math.round((checked / total) * 100);
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Habit Tracker',
  icon: '🔄',
  color: '#d97706',
  priority: 22,
  itemNoun: 'Habit',

  detect(lower) {
    return lower.some(h => /^(habit|routine|daily)/.test(h))
      && lower.some(h => /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|streak)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, category: -1, goal: -1, week: -1, days: [], streak: -1, notes: -1 };
    cols.text     = lower.findIndex(h => /^(habit|routine|daily|activity|task|name)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.category = lower.findIndex(h => /^(category|group|type|area)/.test(h));
    cols.goal     = lower.findIndex((h, i) => i !== cols.text && i !== cols.category && /^(goal|target|freq)/.test(h));
    cols.week     = lower.findIndex((h, i) => {
      const used = [cols.text, cols.category, cols.goal];
      return !used.includes(i) && /^(week|date|period)/.test(h);
    });
    cols.streak   = lower.findIndex(h => /^(streak|total|count|score)/.test(h));
    cols.notes    = lower.findIndex((h, i) => {
      const used = [cols.text, cols.category, cols.goal, cols.week, cols.streak];
      return !used.includes(i) && /^(note|comment|memo)/.test(h);
    });

    const dayPattern = /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/;
    const used = new Set([cols.text, cols.category, cols.goal, cols.week, cols.streak, cols.notes]);
    for (let i = 0; i < lower.length; i++) {
      if (!used.has(i) && dayPattern.test(lower[i])) cols.days.push(i);
    }
    return cols;
  },

  addRowFields(cols) {
    const fields = [
      { role: 'text', label: 'Habit', colIndex: cols.text, type: 'text', placeholder: 'New habit', required: true },
    ];
    if (cols.category >= 0) fields.push({ role: 'category', label: 'Category', colIndex: cols.category, type: 'text', placeholder: 'e.g. Health' });
    if (cols.goal >= 0) fields.push({ role: 'goal', label: 'Goal', colIndex: cols.goal, type: 'text', placeholder: 'e.g. 5x/week' });
    return fields;
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    const allItems = toItems(rows);
    const hasWeeks = cols.week >= 0;
    const weeks = hasWeeks ? groupByWeek(allItems, cols.week) : null;
    const multiWeek = hasWeeks && weeks && weeks.length > 1;

    let weekIdx = weeks ? weeks.length - 1 : 0;
    let activeView = 'weekly';

    /* ---------- View Toolbar ---------- */
    const toolbar = el('div', { className: 'habit-toolbar' });
    const btnWeekly = el('button', { className: 'habit-view-btn habit-view-btn-active', dataset: { view: 'weekly' } }, ['📅 Weekly']);
    const btnStats  = el('button', { className: 'habit-view-btn', dataset: { view: 'stats' } }, ['📊 Stats']);
    toolbar.append(btnWeekly, btnStats);
    if (multiWeek) {
      toolbar.append(el('button', { className: 'habit-view-btn', dataset: { view: 'history' } }, ['📆 History']));
    }
    container.append(toolbar);

    /* ---------- Week Navigator ---------- */
    let weekNav = null;
    let weekLabelEl = null;
    let weekCounterEl = null;
    let prevBtn = null;
    let nextBtn = null;

    if (multiWeek) {
      weekNav = el('div', { className: 'habit-week-nav' });
      prevBtn = el('button', { className: 'habit-week-nav-btn', title: 'Previous week' }, ['‹']);
      nextBtn = el('button', { className: 'habit-week-nav-btn', title: 'Next week' }, ['›']);
      weekLabelEl = el('span', { className: 'habit-week-label' });
      weekCounterEl = el('span', { className: 'habit-week-counter' });
      weekNav.append(prevBtn, weekLabelEl, weekCounterEl, nextBtn);
      container.append(weekNav);

      prevBtn.addEventListener('click', () => {
        if (weekIdx > 0) { weekIdx--; syncWeekNav(); refreshView(); }
      });
      nextBtn.addEventListener('click', () => {
        if (weekIdx < weeks.length - 1) { weekIdx++; syncWeekNav(); refreshView(); }
      });
    }

    function syncWeekNav() {
      if (!weekNav) return;
      const w = weeks[weekIdx];
      weekLabelEl.textContent = w.label;
      weekCounterEl.textContent = `${weekIdx + 1} of ${weeks.length}`;
      prevBtn.disabled = weekIdx <= 0;
      nextBtn.disabled = weekIdx >= weeks.length - 1;
      prevBtn.classList.toggle('habit-week-nav-disabled', weekIdx <= 0);
      nextBtn.classList.toggle('habit-week-nav-disabled', weekIdx >= weeks.length - 1);
    }

    if (multiWeek) syncWeekNav();

    /* ---------- View Container ---------- */
    const viewContainer = el('div', { className: 'habit-view-container' });
    container.append(viewContainer);

    function currentItems() {
      if (!hasWeeks || !weeks) return allItems;
      return weeks[weekIdx].items;
    }

    function refreshView() {
      viewContainer.innerHTML = '';
      if (activeView === 'weekly') {
        renderWeekly(viewContainer, currentItems(), cols);
      } else if (activeView === 'stats') {
        renderStats(viewContainer, currentItems(), cols, multiWeek ? weeks : null, weekIdx);
      } else if (activeView === 'history') {
        renderHistory(viewContainer, weeks, cols, (idx) => {
          weekIdx = idx;
          syncWeekNav();
          switchView('weekly');
        });
      }
    }

    function switchView(view) {
      activeView = view;
      toolbar.querySelectorAll('.habit-view-btn').forEach(b => {
        b.classList.toggle('habit-view-btn-active', b.dataset.view === view);
      });
      if (weekNav) weekNav.classList.toggle('hidden', view === 'history');
      refreshView();
    }

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.habit-view-btn');
      if (btn && btn.dataset.view) switchView(btn.dataset.view);
    });

    refreshView();
  },
};

/* ---------- Weekly View ---------- */

function renderWeekly(container, items, cols) {
  const categories = uniqueCategories(items, cols.category);
  const hasCategories = categories.length > 0;

  // Group items by category
  const groups = new Map();
  if (hasCategories) {
    for (const cat of categories) groups.set(cat, []);
    groups.set('', []);
    for (const it of items) {
      const cat = cell(it.row, cols.category).trim();
      (groups.get(cat) || groups.get('')).push(it);
    }
  } else {
    groups.set('', [...items]);
  }

  // Summary bar
  const totalChecked = items.reduce((n, it) => n + countChecked(it.row, cols.days), 0);
  const totalCells = items.length * cols.days.length;
  const overallPct = totalCells > 0 ? Math.round((totalChecked / totalCells) * 100) : 0;

  const summaryBar = el('div', { className: 'habit-summary-bar' });
  summaryBar.append(
    el('div', { className: 'habit-summary-stat' }, [
      el('span', { className: 'habit-summary-value' }, [String(items.length)]),
      el('span', { className: 'habit-summary-label' }, ['Habits']),
    ]),
    el('div', { className: 'habit-summary-stat' }, [
      el('span', { className: 'habit-summary-value' }, [`${overallPct}%`]),
      el('span', { className: 'habit-summary-label' }, ['Completion']),
    ]),
    el('div', { className: 'habit-summary-stat' }, [
      el('span', { className: 'habit-summary-value' }, [`${totalChecked}/${totalCells}`]),
      el('span', { className: 'habit-summary-label' }, ['Check-ins']),
    ]),
  );
  container.append(summaryBar);

  // Render each group
  for (const [catName, catItems] of groups) {
    if (catItems.length === 0) continue;

    if (hasCategories) {
      container.append(el('div', { className: 'habit-category-header' }, [
        el('span', { className: 'habit-category-label' }, [catName || 'Uncategorized']),
        el('span', { className: 'habit-category-count' }, [`${catItems.length} habit${catItems.length !== 1 ? 's' : ''}`]),
      ]));
    }

    const table = el('div', { className: 'habit-table' });

    // Header row
    const headerRow = el('div', { className: 'habit-grid-row habit-grid-header' });
    headerRow.append(el('div', { className: 'habit-grid-cell habit-name-cell' }, ['Habit']));
    for (let d = 0; d < cols.days.length; d++) {
      const dayDone = catItems.reduce((n, it) => n + (isChecked(cell(it.row, cols.days[d])) ? 1 : 0), 0);
      const dayPct = catItems.length > 0 ? Math.round((dayDone / catItems.length) * 100) : 0;
      headerRow.append(el('div', { className: 'habit-grid-cell habit-day-cell' }, [
        el('div', { className: 'habit-day-label' }, [DAY_ABBR[d] || 'Day']),
        el('div', { className: `habit-day-pct ${dayPct === 100 ? 'habit-day-pct-perfect' : ''}` }, [`${dayPct}%`]),
      ]));
    }
    if (cols.streak >= 0) headerRow.append(el('div', { className: 'habit-grid-cell habit-streak-cell' }, ['🔥']));
    if (cols.goal >= 0) headerRow.append(el('div', { className: 'habit-grid-cell habit-goal-cell' }, ['Goal']));
    table.append(headerRow);

    // Data rows
    for (const { row, rowIdx } of catItems) {
      const text = cell(row, cols.text) || row[0] || '—';
      const streak = cols.streak >= 0 ? cell(row, cols.streak) : '';
      const streakNum = parseInt(streak, 10) || 0;
      const done = countChecked(row, cols.days);
      const goalNum = cols.goal >= 0 ? parseGoal(cell(row, cols.goal)) : NaN;
      const goalMet = !isNaN(goalNum) && done >= goalNum;

      const gridRow = el('div', { className: `habit-grid-row ${goalMet ? 'habit-row-goal-met' : ''}` });

      // Name cell (editable)
      gridRow.append(editableCell('div', { className: 'habit-grid-cell habit-name-cell' }, text, rowIdx, cols.text));

      // Day toggle cells
      for (const dayIdx of cols.days) {
        const val = cell(row, dayIdx);
        const checked = isChecked(val);
        const dayCell = el('div', {
          className: `habit-grid-cell habit-day-cell habit-toggle ${checked ? 'habit-checked' : ''}`,
          title: 'Click to toggle',
          dataset: { rowIdx: String(rowIdx), colIdx: String(dayIdx) },
        }, [checked ? '✓' : '']);

        dayCell.addEventListener('click', () => {
          const nowChecked = !dayCell.classList.contains('habit-checked');
          dayCell.classList.toggle('habit-checked', nowChecked);
          dayCell.textContent = nowChecked ? '✓' : '';
          emitEdit(rowIdx, dayIdx, nowChecked ? '✓' : '');
        });
        gridRow.append(dayCell);
      }

      // Streak cell
      if (cols.streak >= 0) {
        const streakBadge = streakNum >= 7 ? 'habit-streak-fire' : streakNum >= 3 ? 'habit-streak-warm' : '';
        gridRow.append(editableCell('div', {
          className: `habit-grid-cell habit-streak-cell ${streakBadge}`,
        }, streak, rowIdx, cols.streak, {
          renderContent(wrapper) {
            if (!streak) { wrapper.textContent = '—'; return; }
            wrapper.textContent = `${streakNum >= 3 ? '🔥 ' : ''}${streak}`;
          },
        }));
      }

      // Goal progress cell
      if (cols.goal >= 0) {
        const goalRaw = cell(row, cols.goal);
        if (!isNaN(goalNum)) {
          const pct = Math.min(100, Math.round((done / goalNum) * 100));
          gridRow.append(el('div', { className: 'habit-goal-cell habit-grid-cell' }, [
            el('div', { className: 'habit-goal-bar-bg' }, [
              el('div', { className: `habit-goal-bar-fill ${goalMet ? 'habit-goal-bar-met' : ''}`, style: `width:${pct}%` }),
            ]),
            el('span', { className: 'habit-goal-text' }, [`${done}/${goalNum}`]),
          ]));
        } else {
          gridRow.append(editableCell('div', { className: 'habit-grid-cell habit-goal-cell' }, goalRaw, rowIdx, cols.goal));
        }
      }

      table.append(gridRow);
    }

    container.append(table);
  }
}

/* ---------- Stats View ---------- */

function renderStats(container, items, cols, allWeeks, weekIdx) {
  const statsWrap = el('div', { className: 'habit-stats' });

  const totalDays = cols.days.length;
  const habitCount = items.length;
  const totalCells = habitCount * totalDays;
  const totalChecked = items.reduce((n, it) => n + countChecked(it.row, cols.days), 0);
  const overallPct = totalCells > 0 ? Math.round((totalChecked / totalCells) * 100) : 0;

  /* --- Overall completion ring --- */
  const ringSize = 120;
  const ringStroke = 10;
  const ringRadius = (ringSize - ringStroke) / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - overallPct / 100);

  const ringSvg = `<svg viewBox="0 0 ${ringSize} ${ringSize}" width="${ringSize}" height="${ringSize}" class="habit-ring-svg">
    <circle cx="${ringSize / 2}" cy="${ringSize / 2}" r="${ringRadius}" fill="none" stroke="var(--color-border)" stroke-width="${ringStroke}" />
    <circle cx="${ringSize / 2}" cy="${ringSize / 2}" r="${ringRadius}" fill="none" stroke="#d97706" stroke-width="${ringStroke}"
      stroke-dasharray="${ringCircumference}" stroke-dashoffset="${ringOffset}"
      stroke-linecap="round" transform="rotate(-90 ${ringSize / 2} ${ringSize / 2})" />
  </svg>`;

  const ringWrap = el('div', { className: 'habit-stats-card habit-stats-ring-card' });
  const ringVisual = el('div', { className: 'habit-ring-wrap' });
  ringVisual.innerHTML = ringSvg; // static SVG, no user content
  ringVisual.append(el('div', { className: 'habit-ring-label' }, [`${overallPct}%`]));
  ringWrap.append(
    el('h3', { className: 'habit-stats-title' }, ['Overall Completion']),
    ringVisual,
    el('p', { className: 'habit-stats-subtitle' }, [`${totalChecked} of ${totalCells} check-ins this week`]),
  );
  statsWrap.append(ringWrap);

  /* --- Week-over-week trend (multi-week only) --- */
  if (allWeeks && allWeeks.length > 1) {
    const trendCard = el('div', { className: 'habit-stats-card habit-trend-card' });
    trendCard.append(el('h3', { className: 'habit-stats-title' }, ['📈 Weekly Trend']));

    const trendData = allWeeks.map((w, i) => ({
      label: w.shortLabel,
      pct: completionPct(w.items, cols.days),
      isActive: i === weekIdx,
    }));

    const trendChart = el('div', { className: 'habit-trend-chart' });
    for (const d of trendData) {
      const barH = Math.max(4, d.pct);
      const hue = Math.round((d.pct / 100) * 120);
      const bar = el('div', { className: `habit-trend-week ${d.isActive ? 'habit-trend-active' : ''}` }, [
        el('div', { className: 'habit-trend-bar', style: `height:${barH}%;background:hsl(${hue},70%,45%)` }),
        el('span', { className: 'habit-trend-pct' }, [`${d.pct}%`]),
        el('span', { className: 'habit-trend-label' }, [d.label]),
      ]);
      trendChart.append(bar);
    }
    trendCard.append(trendChart);

    // Show improvement
    if (trendData.length >= 2) {
      const first = trendData[0].pct;
      const last = trendData[trendData.length - 1].pct;
      const diff = last - first;
      const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
      trendCard.append(el('p', { className: 'habit-stats-insight' }, [
        `${arrow} ${diff > 0 ? '+' : ''}${diff}% since ${trendData[0].label}`,
      ]));
    }

    statsWrap.append(trendCard);
  }

  /* --- Day-of-week heatmap --- */
  const dayCard = el('div', { className: 'habit-stats-card' });
  dayCard.append(el('h3', { className: 'habit-stats-title' }, ['Day Strength']));
  const dayBar = el('div', { className: 'habit-day-heatmap' });
  let bestDay = { idx: 0, pct: 0 };
  let worstDay = { idx: 0, pct: 100 };
  for (let d = 0; d < totalDays; d++) {
    const done = items.reduce((n, it) => n + (isChecked(cell(it.row, cols.days[d])) ? 1 : 0), 0);
    const pct = habitCount > 0 ? Math.round((done / habitCount) * 100) : 0;
    if (pct > bestDay.pct) bestDay = { idx: d, pct };
    if (pct < worstDay.pct) worstDay = { idx: d, pct };
    const hue = Math.round((pct / 100) * 120);
    dayBar.append(el('div', { className: 'habit-heatmap-day' }, [
      el('div', { className: 'habit-heatmap-bar', style: `height:${Math.max(4, pct)}%;background:hsl(${hue},70%,45%)` }),
      el('span', { className: 'habit-heatmap-label' }, [DAY_ABBR[d] || '?']),
      el('span', { className: 'habit-heatmap-pct' }, [`${pct}%`]),
    ]));
  }
  dayCard.append(dayBar);
  if (totalDays > 0) {
    dayCard.append(el('p', { className: 'habit-stats-insight' }, [
      `💪 Best: ${DAY_ABBR[bestDay.idx]} (${bestDay.pct}%)`,
    ]));
    dayCard.append(el('p', { className: 'habit-stats-insight' }, [
      `📉 Weakest: ${DAY_ABBR[worstDay.idx]} (${worstDay.pct}%)`,
    ]));
  }
  statsWrap.append(dayCard);

  /* --- Streak Leaderboard --- */
  if (cols.streak >= 0) {
    const streakCard = el('div', { className: 'habit-stats-card' });
    streakCard.append(el('h3', { className: 'habit-stats-title' }, ['🔥 Streak Leaderboard']));
    const sorted = items
      .map(it => ({ name: cell(it.row, cols.text) || it.row[0] || 'Habit', streak: parseInt(cell(it.row, cols.streak), 10) || 0 }))
      .sort((a, b) => b.streak - a.streak);

    const list = el('div', { className: 'habit-streak-list' });
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const maxStreak = sorted[0].streak || 1;
      const barPct = Math.round((item.streak / maxStreak) * 100);
      list.append(el('div', { className: 'habit-streak-item' }, [
        el('span', { className: 'habit-streak-rank' }, [medal]),
        el('span', { className: 'habit-streak-name' }, [item.name]),
        el('div', { className: 'habit-streak-bar-bg' }, [
          el('div', { className: 'habit-streak-bar-fill', style: `width:${barPct}%` }),
        ]),
        el('span', { className: 'habit-streak-val' }, [`${item.streak} day${item.streak !== 1 ? 's' : ''}`]),
      ]));
    }
    streakCard.append(list);
    statsWrap.append(streakCard);
  }

  /* --- Per-Habit Completion Rates --- */
  const habitCard = el('div', { className: 'habit-stats-card' });
  habitCard.append(el('h3', { className: 'habit-stats-title' }, ['Per-Habit Completion']));
  const habitList = el('div', { className: 'habit-completion-list' });
  for (const it of items) {
    const name = cell(it.row, cols.text) || it.row[0] || 'Habit';
    const done = countChecked(it.row, cols.days);
    const pct = totalDays > 0 ? Math.round((done / totalDays) * 100) : 0;
    habitList.append(el('div', { className: 'habit-completion-item' }, [
      el('span', { className: 'habit-completion-name' }, [name]),
      el('div', { className: 'habit-completion-bar-bg' }, [
        el('div', { className: `habit-completion-bar-fill ${pct === 100 ? 'habit-completion-perfect' : ''}`, style: `width:${pct}%` }),
      ]),
      el('span', { className: 'habit-completion-pct' }, [`${pct}%`]),
    ]));
  }
  habitCard.append(habitList);
  statsWrap.append(habitCard);

  /* --- Category Breakdown (if categories exist) --- */
  if (cols.category >= 0) {
    const cats = uniqueCategories(items, cols.category);
    if (cats.length > 0) {
      const catCard = el('div', { className: 'habit-stats-card' });
      catCard.append(el('h3', { className: 'habit-stats-title' }, ['Category Breakdown']));
      const catList = el('div', { className: 'habit-completion-list' });
      for (const cat of cats) {
        const catItems = items.filter(it => cell(it.row, cols.category).trim() === cat);
        const catChecked = catItems.reduce((n, it) => n + countChecked(it.row, cols.days), 0);
        const catTotal = catItems.length * totalDays;
        const pct = catTotal > 0 ? Math.round((catChecked / catTotal) * 100) : 0;
        catList.append(el('div', { className: 'habit-completion-item' }, [
          el('span', { className: 'habit-completion-name' }, [cat]),
          el('div', { className: 'habit-completion-bar-bg' }, [
            el('div', { className: 'habit-completion-bar-fill', style: `width:${pct}%` }),
          ]),
          el('span', { className: 'habit-completion-pct' }, [`${pct}%`]),
        ]));
      }
      catCard.append(catList);
      statsWrap.append(catCard);
    }
  }

  /* --- Goal Achievement --- */
  if (cols.goal >= 0) {
    const goalsData = items
      .map(it => ({ name: cell(it.row, cols.text) || it.row[0] || 'Habit', done: countChecked(it.row, cols.days), goal: parseGoal(cell(it.row, cols.goal)) }))
      .filter(g => !isNaN(g.goal));
    if (goalsData.length > 0) {
      const goalCard = el('div', { className: 'habit-stats-card' });
      goalCard.append(el('h3', { className: 'habit-stats-title' }, ['🎯 Goal Achievement']));
      const met = goalsData.filter(g => g.done >= g.goal).length;
      goalCard.append(el('p', { className: 'habit-stats-subtitle' }, [
        `${met} of ${goalsData.length} goals met this week`,
      ]));
      const goalList = el('div', { className: 'habit-completion-list' });
      for (const g of goalsData) {
        const pct = Math.min(100, Math.round((g.done / g.goal) * 100));
        const isMet = g.done >= g.goal;
        goalList.append(el('div', { className: 'habit-completion-item' }, [
          el('span', { className: 'habit-completion-name' }, [`${isMet ? '✅' : '⬜'} ${g.name}`]),
          el('div', { className: 'habit-completion-bar-bg' }, [
            el('div', { className: `habit-completion-bar-fill ${isMet ? 'habit-completion-perfect' : ''}`, style: `width:${pct}%` }),
          ]),
          el('span', { className: 'habit-completion-pct' }, [`${g.done}/${g.goal}`]),
        ]));
      }
      goalCard.append(goalList);
      statsWrap.append(goalCard);
    }
  }

  container.append(statsWrap);
}

/* ---------- History View ---------- */

function renderHistory(container, allWeeks, cols, onSelectWeek) {
  const wrap = el('div', { className: 'habit-history' });

  // Collect unique habit names across all weeks
  const habitNames = [];
  const habitSet = new Set();
  for (const w of allWeeks) {
    for (const it of w.items) {
      const name = cell(it.row, cols.text).trim();
      if (name && !habitSet.has(name)) {
        habitSet.add(name);
        habitNames.push(name);
      }
    }
  }

  /* --- Week overview cards --- */
  wrap.append(el('h3', { className: 'habit-history-title' }, ['Week Overview']));
  const weeksGrid = el('div', { className: 'habit-history-grid' });
  for (let i = allWeeks.length - 1; i >= 0; i--) {
    const w = allWeeks[i];
    const checked = w.items.reduce((n, it) => n + countChecked(it.row, cols.days), 0);
    const total = w.items.length * cols.days.length;
    const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

    let goalsMet = 0;
    let goalsTotal = 0;
    if (cols.goal >= 0) {
      for (const it of w.items) {
        const g = parseGoal(cell(it.row, cols.goal));
        if (!isNaN(g)) {
          goalsTotal++;
          if (countChecked(it.row, cols.days) >= g) goalsMet++;
        }
      }
    }

    const hue = Math.round((pct / 100) * 120);
    const card = el('div', { className: 'habit-history-card', title: `Click to view ${w.label}` });
    card.addEventListener('click', () => onSelectWeek(i));

    card.append(
      el('div', { className: 'habit-history-card-header' }, [
        el('span', { className: 'habit-history-card-label' }, [w.shortLabel]),
        el('span', { className: 'habit-history-card-pct', style: `color:hsl(${hue},70%,40%)` }, [`${pct}%`]),
      ]),
      el('div', { className: 'habit-history-bar-bg' }, [
        el('div', { className: 'habit-history-bar-fill', style: `width:${pct}%;background:hsl(${hue},70%,45%)` }),
      ]),
      el('div', { className: 'habit-history-card-detail' }, [
        `${checked}/${total} check-ins${goalsTotal > 0 ? ` · ${goalsMet}/${goalsTotal} goals` : ''}`,
      ]),
    );
    weeksGrid.append(card);
  }
  wrap.append(weeksGrid);

  /* --- Habit-by-week heatmap table --- */
  if (habitNames.length > 0 && allWeeks.length > 1) {
    wrap.append(el('h3', { className: 'habit-history-title' }, ['Habit Progress Over Time']));
    const table = el('div', { className: 'habit-heatmap-table' });

    // Header: blank + week labels
    const headerRow = el('div', { className: 'habit-heatmap-row habit-heatmap-header' });
    headerRow.append(el('div', { className: 'habit-heatmap-cell habit-heatmap-name' }));
    for (const w of allWeeks) {
      headerRow.append(el('div', { className: 'habit-heatmap-cell habit-heatmap-week-label' }, [w.shortLabel]));
    }
    table.append(headerRow);

    // Row per habit
    for (const name of habitNames) {
      const row = el('div', { className: 'habit-heatmap-row' });
      row.append(el('div', { className: 'habit-heatmap-cell habit-heatmap-name' }, [name]));

      for (const w of allWeeks) {
        const match = w.items.find(it => cell(it.row, cols.text).trim() === name);
        if (match) {
          const done = countChecked(match.row, cols.days);
          const total = cols.days.length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const hue = Math.round((pct / 100) * 120);
          row.append(el('div', {
            className: 'habit-heatmap-cell habit-heatmap-value',
            style: `background:hsl(${hue},70%,90%);color:hsl(${hue},70%,30%)`,
            title: `${done}/${total} days`,
          }, [`${done}/${total}`]));
        } else {
          row.append(el('div', { className: 'habit-heatmap-cell habit-heatmap-empty' }, ['—']));
        }
      }

      table.append(row);
    }

    wrap.append(table);
  }

  container.append(wrap);
}

registerTemplate('habit', definition);
export default definition;
