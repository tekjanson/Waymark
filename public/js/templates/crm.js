/* ============================================================
   templates/crm.js — CRM: cycle deal stage, funnel pipeline view,
   activity timeline, stale deal detection
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, delegateEvent, cycleStatus } from './shared.js';

/* ---------- Helpers ---------- */

/** Parse a currency / numeric string to a plain number */
function parseValue(raw) {
  return parseFloat((raw || '0').replace(/[^-\d.]/g, '')) || 0;
}

/** Format a number as a compact dollar string */
function fmtDollars(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

/** Parse date string to Date object */
function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Format date as short string */
function fmtDate(d) {
  if (!d) return '\u2014';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Check if a date is more than N days ago */
function isStale(dateStr, days = 7) {
  const d = parseDate(dateStr);
  if (!d) return false;
  return (Date.now() - d.getTime()) > days * 86400000;
}

/** Parse activity log string: "date: event | date: event | ..." */
function parseActivityLog(raw) {
  if (!raw) return [];
  return raw.split('|').map(entry => {
    const m = entry.trim().match(/^(.+?):\s*(.+)$/);
    if (!m) return null;
    return { date: m[1].trim(), text: m[2].trim() };
  }).filter(Boolean);
}

/** Append an entry to the activity log string */
function appendActivity(existing, text) {
  const now = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const entry = `${now}: ${text}`;
  return existing ? `${existing} | ${entry}` : entry;
}

const definition = {
  name: 'CRM',
  icon: '🤝',
  color: '#b45309',
  priority: 23,
  itemNoun: 'Deal',

  detect(lower) {
    return lower.some(h => /^(company|lead|prospect|account|organization|org)/.test(h))
      && lower.some(h => /^(deal|stage|pipeline|status|phase)/.test(h) || /^(value|worth|revenue|amount|\$)/.test(h));
  },

  columns(lower) {
    const cols = { company: -1, contact: -1, stage: -1, value: -1, notes: -1, lastActivity: -1, activity: -1 };
    cols.company = lower.findIndex(h => /^(company|lead|prospect|account|organization|org|business)/.test(h));
    if (cols.company === -1) cols.company = 0;
    cols.stage   = lower.findIndex(h => /^(deal|stage|pipeline|status|phase)/.test(h));
    cols.contact = lower.findIndex((h, i) => i !== cols.company && i !== cols.stage && /^(contact|person|name|who|rep|salesperson)/.test(h));
    cols.value   = lower.findIndex((h, i) => i !== cols.company && /^(value|worth|revenue|amount|deal.?size|\$|price|arr)/.test(h));
    cols.lastActivity = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(last.?activity|last.?updated|modified|updated|last.?contact)/.test(h));
    cols.activity = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(activity|log|history|timeline|changes?)/.test(h));
    cols.notes   = lower.findIndex((h, i) => i !== cols.company && i !== cols.stage && i !== cols.contact && i !== cols.value && i !== cols.lastActivity && i !== cols.activity && /^(notes?|comment|detail|info|next.?step|follow)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'company', label: 'Company', colIndex: cols.company, type: 'text',   placeholder: 'Company or lead name', required: true },
      { role: 'contact', label: 'Contact', colIndex: cols.contact, type: 'text',   placeholder: 'Contact person' },
      { role: 'stage',   label: 'Stage',   colIndex: cols.stage,   type: 'select', options: ['Lead', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'], defaultValue: 'Lead' },
      { role: 'value',   label: 'Value',   colIndex: cols.value,   type: 'number', placeholder: 'Deal value' },
      { role: 'notes',   label: 'Notes',   colIndex: cols.notes,   type: 'text',   placeholder: 'Next steps, notes' },
    ];
  },

  dealStages: ['Lead', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'],

  stageClass(val) {
    const v = (val || '').toLowerCase().trim();
    if (/^(won|closed.?won|signed|active|customer)/.test(v)) return 'won';
    if (/^(lost|closed.?lost|dead|churned)/.test(v)) return 'lost';
    if (/^(proposal|negotiat|quote|offer)/.test(v)) return 'proposal';
    if (/^(qualif|demo|evaluated)/.test(v)) return 'qualified';
    if (/^(contact|reached|engaged|replied)/.test(v)) return 'contacted';
    return 'lead';
  },

  render(container, rows, cols, template) {
    /* ---------- Group deals by stage ---------- */
    const stageOrder = ['lead', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
    const stageLabels = { lead: 'Lead', contacted: 'Contacted', qualified: 'Qualified',
                          proposal: 'Proposal', won: 'Won', lost: 'Lost' };
    const stageDeals = {};
    for (const s of stageOrder) stageDeals[s] = [];

    let totalValue = 0;
    let staleCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cls = template.stageClass(cell(row, cols.stage));
      const val = parseValue(cell(row, cols.value));
      const lastAct = cell(row, cols.lastActivity);
      const stale = isStale(lastAct);
      if (stale) staleCount++;
      totalValue += val;
      stageDeals[cls].push({ row, rowIdx: i + 1, cls, val, stale });
    }

    /* ---------- Pipeline summary bar ---------- */
    const summaryBar = el('div', { className: 'crm-summary' }, [
      el('span', { className: 'crm-summary-total' }, [`Pipeline: $${totalValue.toLocaleString()}`]),
      el('span', { className: 'crm-summary-count' }, [`${rows.length} deals`]),
      staleCount > 0 ? el('span', { className: 'crm-summary-stale' }, [`\u26A0 ${staleCount} stale`]) : null,
    ]);

    const viewToggle = el('button', { className: 'crm-view-toggle' }, ['Funnel View']);
    summaryBar.append(viewToggle);
    container.append(summaryBar);

    /* ---------- Card list (default view) ---------- */
    const cardList = el('div', { className: 'crm-card-list' });

    /* ---------- Timeline modal ---------- */
    const timelineModal = el('div', { className: 'crm-timeline-modal hidden' });
    container.append(timelineModal);

    function showTimeline(rowIdx, row) {
      timelineModal.innerHTML = '';
      const company = cell(row, cols.company) || row[0] || '\u2014';
      const stage = cell(row, cols.stage);
      const actLog = cell(row, cols.activity);
      const lastAct = cell(row, cols.lastActivity);
      const entries = parseActivityLog(actLog);

      timelineModal.append(
        el('div', { className: 'crm-timeline-header' }, [
          el('h3', { className: 'crm-timeline-title' }, [`${company} \u2014 Timeline`]),
          el('button', { className: 'crm-timeline-close', on: { click: () => timelineModal.classList.add('hidden') } }, ['\u2715']),
        ]),
        el('div', { className: 'crm-timeline-meta' }, [
          el('span', { className: `crm-stage-btn crm-stage-${template.stageClass(stage)}` }, [stage || 'Lead']),
          lastAct ? el('span', { className: 'crm-timeline-last' }, [`Last activity: ${lastAct}`]) : null,
        ]),
        el('div', { className: 'crm-timeline-body' },
          entries.length
            ? entries.map(e => el('div', { className: 'crm-timeline-entry' }, [
                el('span', { className: 'crm-timeline-date' }, [e.date]),
                el('span', { className: 'crm-timeline-dot' }),
                el('span', { className: 'crm-timeline-text' }, [e.text]),
              ])).reverse()
            : [el('div', { className: 'crm-timeline-empty' }, ['No activity recorded yet'])]
        ),
      );
      timelineModal.classList.remove('hidden');
    }

    /* Delegated stage cycling — single listener for all cards */
    delegateEvent(container, 'click', '.crm-stage-btn', (e, btn) => {
      /* Skip buttons inside timeline modal */
      if (btn.closest('.crm-timeline-modal')) return;
      const prevStage = btn.textContent;
      const next = cycleStatus(btn, template.dealStages, template.stageClass, 'crm-stage-btn crm-stage-');
      const card = btn.closest('.crm-card');
      if (card) card.className = `crm-card crm-card-${template.stageClass(next)}${isStale(cell(rows[Number(btn.dataset.rowIdx) - 1], cols.lastActivity)) ? ' crm-card-stale' : ''}`;
      const rIdx = Number(btn.dataset.rowIdx);
      emitEdit(rIdx, cols.stage, next);

      /* Log stage transition to activity column */
      if (cols.activity >= 0) {
        const existingLog = cell(rows[rIdx - 1], cols.activity);
        const newLog = appendActivity(existingLog, `${prevStage} \u2192 ${next}`);
        emitEdit(rIdx, cols.activity, newLog);
      }
    });

    /* Delegated timeline open — click company name or card header */
    delegateEvent(cardList, 'click', '.crm-card-timeline-btn', (e, btn) => {
      const rIdx = Number(btn.dataset.rowIdx);
      showTimeline(rIdx, rows[rIdx - 1]);
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const company = cell(row, cols.company) || row[0] || '\u2014';
      const contact = cell(row, cols.contact);
      const stage = cell(row, cols.stage);
      const value = cell(row, cols.value);
      const notes = cell(row, cols.notes);
      const lastAct = cell(row, cols.lastActivity);
      const cls = template.stageClass(stage);
      const stale = isStale(lastAct);

      const stageBadge = el('button', {
        className: `crm-stage-btn crm-stage-${cls}`,
        title: 'Click to cycle deal stage',
        dataset: { rowIdx: String(rowIdx) },
      }, [stage || 'Lead']);

      const timelineBtn = el('button', {
        className: 'crm-card-timeline-btn',
        title: 'View timeline',
        dataset: { rowIdx: String(rowIdx) },
      }, ['\uD83D\uDCC5']);

      const cardEl = el('div', { className: `crm-card crm-card-${cls}${stale ? ' crm-card-stale' : ''}` }, [
        el('div', { className: 'crm-card-header' }, [
          editableCell('span', { className: 'crm-card-company' }, company, rowIdx, cols.company),
          cols.value >= 0 ? editableCell('span', { className: 'crm-card-value' }, value, rowIdx, cols.value) : null,
        ]),
        el('div', { className: 'crm-card-body' }, [
          stageBadge,
          cols.contact >= 0 ? editableCell('span', { className: 'crm-card-contact' }, contact, rowIdx, cols.contact) : null,
          timelineBtn,
        ]),
        lastAct ? el('div', { className: 'crm-card-last-activity' }, [
          stale ? el('span', { className: 'crm-stale-icon' }, ['\u26A0']) : null,
          `Last: ${lastAct}`,
        ]) : null,
        cols.notes >= 0 ? editableCell('div', { className: 'crm-card-notes' }, notes, rowIdx, cols.notes) : null,
      ]);

      cardList.append(cardEl);
    }

    container.append(cardList);

    /* ---------- Funnel view ---------- */
    const funnelView = el('div', { className: 'crm-funnel hidden' });

    for (let si = 0; si < stageOrder.length; si++) {
      const s = stageOrder[si];
      const deals = stageDeals[s];
      const stageVal = deals.reduce((sum, d) => sum + d.val, 0);

      /* Conversion arrow between stages (skip before first) */
      if (si > 0) {
        const prev = stageOrder[si - 1];
        const prevCount = stageDeals[prev].length;
        const pct = prevCount > 0 ? Math.round((deals.length / prevCount) * 100) : 0;
        funnelView.append(el('div', { className: 'crm-funnel-arrow' }, [
          el('span', { className: 'crm-funnel-arrow-line' }),
          el('span', { className: 'crm-funnel-arrow-pct' }, [`${pct}%`]),
        ]));
      }

      const lane = el('div', { className: `crm-funnel-lane crm-funnel-lane-${s}` });

      /* Lane header */
      lane.append(el('div', { className: 'crm-funnel-lane-header' }, [
        el('span', { className: 'crm-funnel-lane-title' }, [stageLabels[s]]),
        el('span', { className: 'crm-funnel-lane-count' }, [`${deals.length}`]),
      ]));
      lane.append(el('div', { className: 'crm-funnel-lane-value' }, [fmtDollars(stageVal)]));

      /* Lane deal cards */
      const laneBody = el('div', { className: 'crm-funnel-lane-body' });
      for (const d of deals) {
        const company = cell(d.row, cols.company) || d.row[0] || '—';
        laneBody.append(el('div', { className: 'crm-funnel-deal' }, [
          el('span', { className: 'crm-funnel-deal-name' }, [company]),
          d.val ? el('span', { className: 'crm-funnel-deal-val' }, [fmtDollars(d.val)]) : null,
        ]));
      }
      lane.append(laneBody);

      funnelView.append(lane);
    }

    container.append(funnelView);

    /* ---------- View toggle ---------- */
    viewToggle.addEventListener('click', () => {
      const isFunnel = funnelView.classList.toggle('hidden');
      cardList.classList.toggle('hidden', !isFunnel);
      viewToggle.textContent = isFunnel ? 'Funnel View' : 'Card View';
    });
  },
};

registerTemplate('crm', definition);
export default definition;
