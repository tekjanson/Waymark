/* ============================================================
   templates/poll.js \u2014 Poll / Survey: animated bars + live mode
   ============================================================ */

import { el, cell, editableCell, registerTemplate, buildDirSyncBtn, delegateEvent } from './shared.js';

/* ---------- Module state ---------- */
let liveTimer = null;

const definition = {
  name: 'Poll / Survey',
  icon: '\uD83D\uDCCA',
  color: '#be185d',
  priority: 18,
  itemNoun: 'Option',
  defaultHeaders: ['Option', 'Votes', 'Percent', 'Notes'],

  detect(lower) {
    return lower.some(h => /^(vote|votes|response|responses|poll|ballot|tally)/.test(h))
      && lower.some(h => /^(option|choice|answer|candidate|selection|question|item)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, votes: -1, percent: -1, notes: -1 };
    cols.votes   = lower.findIndex(h => /^(vote|votes|count|tally|responses?|score)/.test(h));
    cols.text    = lower.findIndex((h, i) => i !== cols.votes && /^(option|choice|answer|candidate|selection|question|item|name)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.votes);
    cols.percent = lower.findIndex((h, i) => i !== cols.votes && i !== cols.text && /^(percent|%|share|ratio|proportion)/.test(h));
    cols.notes   = lower.findIndex((h, i) => i !== cols.votes && i !== cols.text && i !== cols.percent && /^(notes?|comment|detail|info)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',    label: 'Option',   colIndex: cols.text,    type: 'text',   placeholder: 'Choice or answer', required: true },
      { role: 'votes',   label: 'Votes',    colIndex: cols.votes,   type: 'number', placeholder: '0', defaultValue: '0' },
      { role: 'percent', label: 'Percent',   colIndex: cols.percent, type: 'text',   placeholder: 'e.g. 25%' },
      { role: 'notes',   label: 'Notes',     colIndex: cols.notes,   type: 'text',   placeholder: 'Optional notes' },
    ];
  },

  render(container, rows, cols) {
    let maxVotes = 0, totalVotes = 0;
    for (const row of rows) {
      const v = parseInt(cell(row, cols.votes)) || 0;
      if (v > maxVotes) maxVotes = v;
      totalVotes += v;
    }

    /* --- toolbar: total + live toggle --- */
    const liveBtn = el('button', {
      className: 'poll-live-btn' + (liveTimer ? ' poll-live-active' : ''),
    }, [liveTimer ? '\u25C9 Live' : '\u25CB Live']);

    liveBtn.addEventListener('click', () => {
      if (liveTimer) {
        clearInterval(liveTimer);
        liveTimer = null;
        liveBtn.textContent = '\u25CB Live';
        liveBtn.classList.remove('poll-live-active');
        window.dispatchEvent(new CustomEvent('waymark:set-refresh-rate', { detail: 0 }));
      } else {
        liveBtn.textContent = '\u25C9 Live';
        liveBtn.classList.add('poll-live-active');
        window.dispatchEvent(new CustomEvent('waymark:set-refresh-rate', { detail: 10000 }));
        liveTimer = setInterval(() => {}, 10000); // keep reference for toggle state
      }
    });

    const toolbar = el('div', { className: 'poll-toolbar' }, [
      el('span', { className: 'poll-total' }, [`${totalVotes} total votes`]),
      liveBtn,
    ]);
    container.append(toolbar);

    /* --- poll rows with animated bars + inline percentage --- */
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const text = cell(row, cols.text) || row[0] || '\u2014';
      const votes = parseInt(cell(row, cols.votes)) || 0;
      const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
      const barWidth = maxVotes > 0 ? Math.round((votes / maxVotes) * 100) : 0;
      const notes = cell(row, cols.notes);

      const barChildren = [
        el('div', { className: 'poll-bar', style: { width: `${barWidth}%` } },
          barWidth > 15 ? [el('span', { className: 'poll-bar-label' }, [`${pct}%`])] : []),
      ];

      container.append(el('div', { className: 'poll-row' }, [
        el('div', { className: 'poll-row-label' }, [
          editableCell('span', { className: 'poll-option-text' }, text, rowIdx, cols.text),
          cols.notes >= 0 ? editableCell('span', { className: 'poll-option-notes' }, notes, rowIdx, cols.notes) : null,
        ]),
        el('div', { className: 'poll-bar-wrap' }, barChildren),
        el('div', { className: 'poll-row-stats' }, [
          editableCell('span', { className: 'poll-votes-count' }, String(votes), rowIdx, cols.votes, {
            onCommit() {
              /* Recalculate all totals and update every row */
              let newTotal = 0, newMax = 0;
              const allRows = container.querySelectorAll('.poll-row');
              const voteCounts = [];
              allRows.forEach(r => {
                const v = parseInt(r.querySelector('.poll-votes-count')?.textContent) || 0;
                voteCounts.push(v);
                newTotal += v;
                if (v > newMax) newMax = v;
              });
              allRows.forEach((r, idx) => {
                const v = voteCounts[idx];
                const p = newTotal > 0 ? Math.round((v / newTotal) * 100) : 0;
                const bw = newMax > 0 ? Math.round((v / newMax) * 100) : 0;
                const pctEl = r.querySelector('.poll-pct');
                if (pctEl) pctEl.textContent = `${p}%`;
                const bar = r.querySelector('.poll-bar');
                if (bar) {
                  bar.style.width = `${bw}%`;
                  const lbl = bar.querySelector('.poll-bar-label');
                  if (bw > 15) {
                    if (lbl) lbl.textContent = `${p}%`;
                    else bar.append(el('span', { className: 'poll-bar-label' }, [`${p}%`]));
                  } else if (lbl) {
                    lbl.remove();
                  }
                }
              });
              const totalEl = container.querySelector('.poll-total');
              if (totalEl) totalEl.textContent = `${newTotal} total votes`;
            },
          }),
          el('span', { className: 'poll-pct' }, [`${pct}%`]),
        ]),
      ]));
    }
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'poll-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'poll-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'poll-dir-icon tmpl-dir-icon' }, ['\uD83D\uDCCA']),
      el('span', { className: 'poll-dir-title tmpl-dir-title' }, ['Polls & Surveys']),
      el('span', { className: 'poll-dir-count tmpl-dir-count' }, [
        `${sheets.length} poll${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'poll-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      const cols = sheet.cols || {};
      let totalVotes = 0;
      for (const row of rows) totalVotes += parseInt(cell(row, cols.votes)) || 0;

      grid.append(el('div', {
        className: 'poll-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'poll-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'poll-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} option${rows.length !== 1 ? 's' : ''} \u2022 ${totalVotes} vote${totalVotes !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.poll-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('poll', definition);
export default definition;
