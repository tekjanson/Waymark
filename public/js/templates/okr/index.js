/* ============================================================
   okr/index.js — OKR / Goals Template (barrel)

   Features: hierarchical objective → key-result tree view,
   per-KR progress bars, objective-level roll-up, quarter
   filter, collapsible objective groups, inline editing of
   progress values.
   ============================================================ */

import {
  el, cell, emitEdit, registerTemplate, editableCell,
  buildDirSyncBtn, delegateEvent,
} from '../shared.js';
import {
  parseProgress, rollupProgress, progressClass,
  normaliseQuarter, collectQuarters, groupByObjective,
} from './helpers.js';

/* ---------- Module state ---------- */
let _activeQuarter = null;
let _collapsed = new Set();  /* set of collapsed objective strings */

/* ---------- Template Definition ---------- */
const definition = {
  name: 'OKR / Goals',
  icon: '🎯',
  color: '#7c3aed',
  priority: 22,
  itemNoun: 'Key Result',
  defaultHeaders: ['Objective', 'Key Result', 'Progress', 'Target', 'Owner', 'Quarter'],

  detect(lower) {
    const hasOkr = lower.some(h => /^(okr|objective|outcome)/.test(h));
    const hasKr  = lower.some(h => /^(key.?result|kr\b)/.test(h));
    /* Require an explicit key-result column to avoid false positives on
       generic "Goal/Progress" tracker sheets */
    return hasOkr && hasKr;
  },

  columns(lower) {
    const cols = { objective: -1, keyResult: -1, progress: -1, target: -1, owner: -1, quarter: -1 };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.objective = lower.findIndex(h => /^(objective|goal|okr|aim|outcome)/.test(h));
    if (cols.objective === -1) cols.objective = 0;

    cols.keyResult = lower.findIndex((h, i) => !used().includes(i) && /^(key.?result|kr|result|milestone|measure|metric|initiative)/.test(h));
    cols.progress  = lower.findIndex((h, i) => !used().includes(i) && /^(progress|status|percent|%|done|complete|achievement|score)/.test(h));
    cols.target    = lower.findIndex((h, i) => !used().includes(i) && /^(target|goal|aim|objective|desired|expected|outcome)/.test(h));
    cols.owner     = lower.findIndex((h, i) => !used().includes(i) && /^(owner|assignee|responsible|lead|who|person|dri)/.test(h));
    cols.quarter   = lower.findIndex((h, i) => !used().includes(i) && /^(quarter|q[1-4]|period|cycle|timeframe|sprint|phase)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'objective', label: 'Objective',   colIndex: cols.objective,  type: 'text',   placeholder: 'Objective name',   required: true },
      { role: 'keyResult', label: 'Key Result',  colIndex: cols.keyResult,  type: 'text',   placeholder: 'Key result description' },
      { role: 'progress',  label: 'Progress',    colIndex: cols.progress,   type: 'text',   placeholder: '0%', defaultValue: '0%' },
      { role: 'target',    label: 'Target',      colIndex: cols.target,     type: 'text',   placeholder: 'Target value' },
      { role: 'owner',     label: 'Owner',       colIndex: cols.owner,      type: 'text',   placeholder: 'Owner name' },
      { role: 'quarter',   label: 'Quarter',     colIndex: cols.quarter,    type: 'text',   placeholder: 'Q1 2026' },
    ];
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    if (!rows.length) {
      container.append(
        el('div', { className: 'okr-empty' }, [
          el('div', { className: 'okr-empty-icon' }, ['🎯']),
          el('p', {}, ['Add rows with Objective and Key Result columns to render the OKR view.']),
        ])
      );
      return;
    }

    /* ── Quarter filter ──────────────────────────────────── */
    const quarters = collectQuarters(rows, cols.quarter);

    if (quarters.length > 1) {
      const filterBar = el('div', { className: 'okr-filter-bar' });

      const allBtn = el('button', {
        className: `okr-quarter-btn${_activeQuarter === null ? ' okr-quarter-active' : ''}`,
        on: { click: () => { _activeQuarter = null; definition.render(container, rows, cols); } },
      }, ['All']);
      filterBar.append(allBtn);

      for (const q of quarters) {
        const qBtn = el('button', {
          className: `okr-quarter-btn${_activeQuarter === q ? ' okr-quarter-active' : ''}`,
          on: { click: () => { _activeQuarter = q; definition.render(container, rows, cols); } },
        }, [q]);
        filterBar.append(qBtn);
      }
      container.append(filterBar);
    }

    /* ── Filter rows by quarter ──────────────────────────── */
    const filtered = _activeQuarter
      ? rows.filter(r => normaliseQuarter(cell(r, cols.quarter)) === _activeQuarter)
      : rows;

    if (!filtered.length) {
      container.append(
        el('div', { className: 'okr-empty' }, [
          el('p', {}, [`No key results found for ${_activeQuarter}.`]),
        ])
      );
      return;
    }

    /* ── Group by Objective ──────────────────────────────── */
    const groups = groupByObjective(filtered, cols.objective);

    for (const group of groups) {
      const progresses = group.rows.map(r => parseProgress(cell(r, cols.progress)));
      const rolled     = rollupProgress(progresses);
      const pClass     = progressClass(rolled);
      const isCollapsed = _collapsed.has(group.objective);

      /* ── Objective header ──────────────────────────────── */
      const objHeader = el('div', {
        className: 'okr-objective-header',
        on: {
          click: () => {
            if (_collapsed.has(group.objective)) {
              _collapsed.delete(group.objective);
            } else {
              _collapsed.add(group.objective);
            }
            definition.render(container, rows, cols);
          },
        },
      }, [
        el('span', { className: 'okr-collapse-icon' }, [isCollapsed ? '▶' : '▼']),
        el('span', { className: 'okr-objective-icon' }, ['🎯']),
        el('span', { className: 'okr-objective-name' }, [group.objective]),
        el('span', { className: 'okr-objective-count' }, [`${group.rows.length} KR${group.rows.length !== 1 ? 's' : ''}`]),
        el('div', { className: 'okr-rollup-bar-wrap' }, [
          el('div', { className: `okr-rollup-bar ${pClass}`, style: `width:${rolled}%` }),
        ]),
        el('span', { className: `okr-rollup-pct ${pClass}` }, [`${rolled}%`]),
      ]);

      /* ── KR list ──────────────────────────────────────── */
      const krList = el('div', { className: `okr-kr-list${isCollapsed ? ' okr-kr-hidden' : ''}` });

      group.rows.forEach((row, i) => {
        const rowIdx  = filtered.indexOf(row) + 1; /* 1-based row index */
        const krText  = cell(row, cols.keyResult)  || '—';
        const rawProg = cell(row, cols.progress);
        const target  = cell(row, cols.target)     || '';
        const owner   = cell(row, cols.owner)      || '';
        const quarter = cell(row, cols.quarter)    || '';
        const pct = parseProgress(rawProg);
        const kClass = progressClass(pct);

        /* Progress bar track */
        const progBar = el('div', { className: 'okr-kr-bar-track' }, [
          el('div', { className: `okr-kr-bar ${kClass}`, style: `width:${pct}%` }),
        ]);

        /* Editable progress cell */
        const progCell = editableCell('span', { className: 'okr-kr-prog-cell' }, rawProg || '0%', rowIdx, cols.progress);

        const krMeta = el('div', { className: 'okr-kr-meta' }, [
          target  ? el('span', { className: 'okr-kr-target',  title: 'Target'  }, [`Target: ${target}`])  : null,
          owner   ? el('span', { className: 'okr-kr-owner',   title: 'Owner'   }, [owner])                : null,
          quarter ? el('span', { className: 'okr-kr-quarter', title: 'Quarter' }, [quarter])              : null,
        ].filter(Boolean));

        const krRow = el('div', { className: 'okr-kr-row' }, [
          el('div', { className: 'okr-kr-left' }, [
            el('span', { className: 'okr-kr-bullet' }, ['◦']),
            el('span', { className: 'okr-kr-text' },  [krText]),
          ]),
          el('div', { className: 'okr-kr-right' }, [
            progBar,
            progCell,
          ]),
          krMeta,
        ]);
        krList.append(krRow);
      });

      const group_el = el('div', { className: 'okr-group' }, [objHeader, krList]);
      container.append(group_el);
    }
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'okr-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'okr-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'okr-dir-icon tmpl-dir-icon' }, ['\uD83C\uDFAF']),
      el('span', { className: 'okr-dir-title tmpl-dir-title' }, ['OKR / Goals']),
      el('span', { className: 'okr-dir-count tmpl-dir-count' }, [
        `${sheets.length} set${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'okr-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'okr-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'okr-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'okr-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} key result${rows.length !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.okr-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('okr', definition);
export default definition;
