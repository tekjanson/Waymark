/* ============================================================
   templates/tracker.js \u2014 Tracker: milestones + completion ETA
   ============================================================ */

import { el, cell, editableCell, emitEdit, parseProgress, registerTemplate, drawBarChart, buildDirSyncBtn, delegateEvent, isRowProtected } from './shared.js';

/* ---------- Helpers ---------- */

const MILESTONES = [25, 50, 75];

/** Calculate estimated completion date from start date + current progress */
function calcETA(startStr, pct) {
  if (!startStr || pct <= 0 || pct >= 100) return null;
  const start = new Date(startStr);
  if (isNaN(start.getTime())) return null;
  const elapsed = (Date.now() - start.getTime()) / 86400000; // days
  if (elapsed <= 0) return null;
  const dailyRate = pct / elapsed;
  const remaining = (100 - pct) / dailyRate;
  const eta = new Date(Date.now() + remaining * 86400000);
  return eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const definition = {
  name: 'Progress Tracker',
  icon: '\uD83D\uDCCA',
  color: '#2563eb',
  priority: 20,
  itemNoun: 'Goal',
  defaultHeaders: ['Goal', 'Progress', 'Target', 'Started', 'Notes'],

  detect(lower) {
    return lower.some(h => /^(progress|percent|%|score|rating|level|grade|completion)/.test(h))
      && lower.some(h => /^(item|task|name|goal|metric|title|description|activity|habit)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, progress: -1, target: -1, notes: -1, started: -1 };
    cols.text     = lower.findIndex(h => /^(item|task|name|goal|metric|title|description)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.progress = lower.findIndex(h => /^(progress|percent|%|score|rating|level|grade|completion|current)/.test(h));
    cols.target   = lower.findIndex((h, i) => i !== cols.text && i !== cols.progress && /^(target|goal|max|total|out.of|capacity)/.test(h));
    cols.notes    = lower.findIndex((h, i) => i !== cols.text && i !== cols.progress && i !== cols.target && /^(notes?|comment|detail|info|status)/.test(h));
    cols.started  = lower.findIndex((h, i) => i !== cols.text && i !== cols.progress && i !== cols.target && i !== cols.notes && /^(start|started|begin|from|date)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Goal',     colIndex: cols.text,     type: 'text',   placeholder: 'Goal or item name', required: true },
      { role: 'progress', label: 'Progress', colIndex: cols.progress, type: 'number', placeholder: '0', defaultValue: '0' },
      { role: 'target',   label: 'Target',   colIndex: cols.target,   type: 'number', placeholder: '100' },
      { role: 'notes',    label: 'Notes',    colIndex: cols.notes,    type: 'text',   placeholder: 'Status notes' },
    ];
  },

  render(container, rows, cols) {
    /* Summary bar chart — shown when there are multiple rows */
    if (rows.length > 1) {
      const chartLabels = rows.map(r => (cell(r, cols.text) || r[0] || '').slice(0, 12));
      const chartValues = rows.map(r => parseProgress(cell(r, cols.progress), cell(r, cols.target)));
      const chartColors = chartValues.map(pct =>
        pct >= 100 ? '#16a34a' : pct >= 50 ? '#2563eb' : pct >= 25 ? '#f59e0b' : '#dc2626'
      );
      const chartWrap = el('div', { className: 'tracker-chart-wrap' });
      chartWrap.appendChild(el('div', { className: 'chart-container-title' }, ['Progress Overview']));
      drawBarChart(chartWrap, { labels: chartLabels, values: chartValues, colors: chartColors }, {
        height: 160,
        showValues: false,
        title: 'Progress Overview',
      });
      container.append(chartWrap);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const text     = cell(row, cols.text) || row[0] || '\u2014';
      const rawProg  = cell(row, cols.progress);
      const rawTarget = cell(row, cols.target);
      const notes    = cell(row, cols.notes);
      const started  = cell(row, cols.started);

      let pct = parseProgress(rawProg, rawTarget);

      const barColor = pct >= 100 ? 'var(--color-success)' :
                       pct >= 50  ? 'var(--color-primary)' :
                       pct >= 25  ? 'var(--color-warning)' : 'var(--color-error)';

      const bar = el('div', { className: 'template-tracker-bar', style: { width: `${Math.min(pct, 100)}%`, background: barColor } });
      const pctEl = el('span', { className: 'template-tracker-pct' }, [`${Math.round(pct)}%`]);

      /* milestone markers */
      const milestoneEls = MILESTONES.map(m => {
        const marker = el('span', {
          className: 'tracker-milestone' + (pct >= m ? ' tracker-milestone-passed' : ''),
          style: { left: `${m}%` },
        });
        return marker;
      });

      const barWrapInner = el('div', { className: 'tracker-bar-inner' }, [bar, ...milestoneEls]);

      const progressCell = editableCell('div', {
        className: 'template-tracker-bar-wrap',
        title: 'Click to update progress',
      }, rawProg || '0', rowIdx, cols.progress, {
        renderContent(wrapper) {
          wrapper.textContent = '';
          wrapper.append(barWrapInner);
        },
        onCommit(value) {
          const newPct = parseProgress(value, rawTarget);
          const newColor = newPct >= 100 ? 'var(--color-success)' :
                           newPct >= 50  ? 'var(--color-primary)' :
                           newPct >= 25  ? 'var(--color-warning)' : 'var(--color-error)';
          bar.style.width = `${Math.min(newPct, 100)}%`;
          bar.style.background = newColor;
          pctEl.textContent = `${Math.round(newPct)}%`;
          milestoneEls.forEach((mk, idx) => {
            mk.classList.toggle('tracker-milestone-passed', newPct >= MILESTONES[idx]);
          });
        },
      });

      /* ETA calculation */
      const eta = calcETA(started, pct);
      const infoChildren = [
        editableCell('span', { className: 'template-tracker-label' }, text, rowIdx, cols.text),
      ];
      if (eta && pct < 100) {
        infoChildren.push(el('span', { className: 'tracker-eta' }, [`ETA: ${eta}`]));
      } else if (pct >= 100) {
        infoChildren.push(el('span', { className: 'tracker-complete' }, ['\u2713 Complete']));
      }
      if (cols.notes >= 0) {
        infoChildren.push(editableCell('span', { className: 'template-tracker-notes' }, notes, rowIdx, cols.notes));
      }

      container.append(el('div', { className: 'template-tracker-row' }, [
        el('div', { className: 'template-tracker-info' }, infoChildren),
        progressCell,
        pctEl,
        ...(isRowProtected(rowIdx) ? [el('span', {
          className: 'tracker-row-lock',
          title: 'Row protected — editing disabled',
        }, ['🔒'])] : []),
      ]));
    }
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'tracker-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'tracker-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'tracker-dir-icon tmpl-dir-icon' }, ['\uD83D\uDCCA']),
      el('span', { className: 'tracker-dir-title tmpl-dir-title' }, ['Progress Trackers']),
      el('span', { className: 'tracker-dir-count tmpl-dir-count' }, [
        `${sheets.length} tracker${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'tracker-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      const cols = sheet.cols || {};
      let totalPct = 0;
      for (const row of rows) totalPct += parseProgress(cell(row, cols.progress), cell(row, cols.target));
      const avg = rows.length ? Math.round(totalPct / rows.length) : 0;

      grid.append(el('div', {
        className: 'tracker-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'tracker-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'tracker-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} goal${rows.length !== 1 ? 's' : ''} \u2022 ${avg}% avg`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.tracker-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('tracker', definition);
export default definition;
