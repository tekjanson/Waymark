/* ============================================================
   templates/habit.js — Habit Tracker with analytics, categories,
   goals, streak tracking, and multi-view (Weekly / Stats)
   ============================================================ */

import { el, cell, editableCell, comboCell, emitEdit, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CHECK_RE = /^(✓|✔|x|yes|1|true|done)$/i;

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

/** Collect unique categories from rows. */
function uniqueCategories(rows, catIdx) {
  if (catIdx < 0) return [];
  const seen = new Set();
  for (const r of rows) {
    const v = cell(r, catIdx).trim();
    if (v) seen.add(v);
  }
  return [...seen].sort();
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
    const cols = { text: -1, category: -1, goal: -1, days: [], streak: -1, notes: -1 };
    cols.text     = lower.findIndex(h => /^(habit|routine|daily|activity|task|name)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.category = lower.findIndex(h => /^(category|group|type|area)/.test(h));
    cols.goal     = lower.findIndex((h, i) => i !== cols.text && i !== cols.category && /^(goal|target|freq)/.test(h));
    cols.streak   = lower.findIndex(h => /^(streak|total|count|score)/.test(h));
    cols.notes    = lower.findIndex((h, i) => i !== cols.text && i !== cols.category && i !== cols.goal && i !== cols.streak && /^(note|comment|memo)/.test(h));

    const dayPattern = /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/;
    const used = new Set([cols.text, cols.category, cols.goal, cols.streak, cols.notes]);
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

    // State
    let activeView = 'weekly';

    /* ---------- View Toolbar ---------- */
    const toolbar = el('div', { className: 'habit-toolbar' });
    const btnWeekly = el('button', { className: 'habit-view-btn habit-view-btn-active', dataset: { view: 'weekly' } }, ['📅 Weekly']);
    const btnStats  = el('button', { className: 'habit-view-btn', dataset: { view: 'stats' } }, ['📊 Stats']);
    toolbar.append(btnWeekly, btnStats);
    container.append(toolbar);

    const viewContainer = el('div', { className: 'habit-view-container' });
    container.append(viewContainer);

    function switchView(view) {
      activeView = view;
      toolbar.querySelectorAll('.habit-view-btn').forEach(b => {
        b.classList.toggle('habit-view-btn-active', b.dataset.view === view);
      });
      viewContainer.innerHTML = '';
      if (view === 'weekly') renderWeekly(viewContainer, rows, cols);
      else renderStats(viewContainer, rows, cols);
    }

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.habit-view-btn');
      if (btn && btn.dataset.view) switchView(btn.dataset.view);
    });

    /* Initial render */
    renderWeekly(viewContainer, rows, cols);
  },
};

/* ---------- Weekly View ---------- */

function renderWeekly(container, rows, cols) {
  const categories = uniqueCategories(rows, cols.category);
  const hasCategories = categories.length > 0;
  const catOptions = categories.length > 0 ? categories : undefined;

  // Group rows by category
  const groups = new Map();
  if (hasCategories) {
    for (const cat of categories) groups.set(cat, []);
    groups.set('', []);  // uncategorized
    for (let i = 0; i < rows.length; i++) {
      const cat = cell(rows[i], cols.category).trim();
      const bucket = groups.has(cat) ? groups.get(cat) : groups.get('');
      bucket.push({ row: rows[i], rowIdx: i + 1 });
    }
  } else {
    groups.set('', rows.map((row, i) => ({ row, rowIdx: i + 1 })));
  }

  // Overall summary bar
  const totalChecked = rows.reduce((n, r) => n + countChecked(r, cols.days), 0);
  const totalCells = rows.length * cols.days.length;
  const overallPct = totalCells > 0 ? Math.round((totalChecked / totalCells) * 100) : 0;

  const summaryBar = el('div', { className: 'habit-summary-bar' });
  summaryBar.append(
    el('div', { className: 'habit-summary-stat' }, [
      el('span', { className: 'habit-summary-value' }, [String(rows.length)]),
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
  for (const [catName, items] of groups) {
    if (items.length === 0) continue;

    if (hasCategories) {
      const catHeader = el('div', { className: 'habit-category-header' }, [
        el('span', { className: 'habit-category-label' }, [catName || 'Uncategorized']),
        el('span', { className: 'habit-category-count' }, [`${items.length} habit${items.length !== 1 ? 's' : ''}`]),
      ]);
      container.append(catHeader);
    }

    // Table wrapper
    const table = el('div', { className: 'habit-table' });

    // Header row
    const headerRow = el('div', { className: 'habit-grid-row habit-grid-header' });
    headerRow.append(el('div', { className: 'habit-grid-cell habit-name-cell' }, ['Habit']));
    for (let d = 0; d < cols.days.length; d++) {
      // Compute day-of-week completion for this column within this group
      const dayDone = items.reduce((n, it) => n + (isChecked(cell(it.row, cols.days[d])) ? 1 : 0), 0);
      const dayPct = items.length > 0 ? Math.round((dayDone / items.length) * 100) : 0;
      const dayLabel = DAY_ABBR[d] || 'Day';
      headerRow.append(el('div', { className: 'habit-grid-cell habit-day-cell' }, [
        el('div', { className: 'habit-day-label' }, [dayLabel]),
        el('div', { className: `habit-day-pct ${dayPct === 100 ? 'habit-day-pct-perfect' : ''}` }, [`${dayPct}%`]),
      ]));
    }
    if (cols.streak >= 0) headerRow.append(el('div', { className: 'habit-grid-cell habit-streak-cell' }, ['🔥']));
    if (cols.goal >= 0) headerRow.append(el('div', { className: 'habit-grid-cell habit-goal-cell' }, ['Goal']));
    table.append(headerRow);

    // Data rows
    for (const { row, rowIdx } of items) {
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
          const progressBar = el('div', { className: 'habit-goal-cell habit-grid-cell' }, [
            el('div', { className: 'habit-goal-bar-bg' }, [
              el('div', { className: `habit-goal-bar-fill ${goalMet ? 'habit-goal-bar-met' : ''}`, style: `width:${pct}%` }),
            ]),
            el('span', { className: 'habit-goal-text' }, [`${done}/${goalNum}`]),
          ]);
          gridRow.append(progressBar);
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

function renderStats(container, rows, cols) {
  const statsWrap = el('div', { className: 'habit-stats' });

  const totalDays = cols.days.length;
  const habitCount = rows.length;
  const totalCells = habitCount * totalDays;
  const totalChecked = rows.reduce((n, r) => n + countChecked(r, cols.days), 0);
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

  /* --- Day-of-week heatmap --- */
  const dayCard = el('div', { className: 'habit-stats-card' });
  dayCard.append(el('h3', { className: 'habit-stats-title' }, ['Day Strength']));
  const dayBar = el('div', { className: 'habit-day-heatmap' });
  let bestDay = { idx: 0, pct: 0 };
  let worstDay = { idx: 0, pct: 100 };
  for (let d = 0; d < totalDays; d++) {
    const done = rows.reduce((n, r) => n + (isChecked(cell(r, cols.days[d])) ? 1 : 0), 0);
    const pct = habitCount > 0 ? Math.round((done / habitCount) * 100) : 0;
    if (pct > bestDay.pct) bestDay = { idx: d, pct };
    if (pct < worstDay.pct) worstDay = { idx: d, pct };
    const hue = Math.round((pct / 100) * 120); // 0=red → 120=green
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
    const sorted = rows
      .map((r, i) => ({ name: cell(r, cols.text) || r[0] || 'Habit', streak: parseInt(cell(r, cols.streak), 10) || 0, idx: i }))
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
  for (let i = 0; i < rows.length; i++) {
    const name = cell(rows[i], cols.text) || rows[i][0] || 'Habit';
    const done = countChecked(rows[i], cols.days);
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
    const cats = uniqueCategories(rows, cols.category);
    if (cats.length > 0) {
      const catCard = el('div', { className: 'habit-stats-card' });
      catCard.append(el('h3', { className: 'habit-stats-title' }, ['Category Breakdown']));
      const catList = el('div', { className: 'habit-completion-list' });
      for (const cat of cats) {
        const catRows = rows.filter(r => cell(r, cols.category).trim() === cat);
        const catChecked = catRows.reduce((n, r) => n + countChecked(r, cols.days), 0);
        const catTotal = catRows.length * totalDays;
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
    const goalsData = rows
      .map((r, i) => ({ name: cell(r, cols.text) || r[0] || 'Habit', done: countChecked(r, cols.days), goal: parseGoal(cell(r, cols.goal)) }))
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

registerTemplate('habit', definition);
export default definition;
