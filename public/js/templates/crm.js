/* templates/crm.js — CRM: cycle deal stage, all fields editable */

import { el, cell, editableCell, emitEdit, registerTemplate } from './shared.js';

const definition = {
  name: 'CRM',
  icon: '🤝',
  color: '#b45309',
  priority: 23,

  detect(lower) {
    return lower.some(h => /^(company|lead|prospect|account|organization|org)/.test(h))
      && lower.some(h => /^(deal|stage|pipeline|status|phase)/.test(h) || /^(value|worth|revenue|amount|\$)/.test(h));
  },

  columns(lower) {
    const cols = { company: -1, contact: -1, stage: -1, value: -1, notes: -1 };
    cols.company = lower.findIndex(h => /^(company|lead|prospect|account|organization|org|business)/.test(h));
    if (cols.company === -1) cols.company = 0;
    cols.stage   = lower.findIndex(h => /^(deal|stage|pipeline|status|phase)/.test(h));
    cols.contact = lower.findIndex((h, i) => i !== cols.company && i !== cols.stage && /^(contact|person|name|who|rep|salesperson)/.test(h));
    cols.value   = lower.findIndex((h, i) => i !== cols.company && /^(value|worth|revenue|amount|deal.?size|\$|price|arr)/.test(h));
    cols.notes   = lower.findIndex((h, i) => i !== cols.company && i !== cols.stage && i !== cols.contact && i !== cols.value && /^(notes?|comment|detail|info|next.?step|follow)/.test(h));
    return cols;
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
    // Pipeline summary
    const stageCounts = {};
    let totalValue = 0;
    for (const row of rows) {
      const cls = template.stageClass(cell(row, cols.stage));
      stageCounts[cls] = (stageCounts[cls] || 0) + 1;
      const val = parseFloat((cell(row, cols.value) || '0').replace(/[^-\d.]/g, ''));
      totalValue += val;
    }

    container.append(el('div', { className: 'crm-summary' }, [
      el('span', { className: 'crm-summary-total' }, [`Pipeline: $${totalValue.toLocaleString()}`]),
      el('span', { className: 'crm-summary-count' }, [`${rows.length} deals`]),
    ]));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const company = cell(row, cols.company) || row[0] || '—';
      const contact = cell(row, cols.contact);
      const stage = cell(row, cols.stage);
      const value = cell(row, cols.value);
      const notes = cell(row, cols.notes);
      const cls = template.stageClass(stage);

      const stageBadge = el('button', {
        className: `crm-stage-btn crm-stage-${cls}`,
        title: 'Click to cycle deal stage',
      }, [stage || 'Lead']);

      stageBadge.addEventListener('click', () => {
        const states = template.dealStages;
        const current = stageBadge.textContent.trim();
        const idx = states.findIndex(s => s.toLowerCase() === current.toLowerCase());
        const next = states[(idx + 1) % states.length];
        stageBadge.textContent = next;
        stageBadge.className = `crm-stage-btn crm-stage-${template.stageClass(next)}`;
        const card = stageBadge.closest('.crm-card');
        if (card) card.className = `crm-card crm-card-${template.stageClass(next)}`;
        emitEdit(rowIdx, cols.stage, next);
      });

      container.append(el('div', { className: `crm-card crm-card-${cls}` }, [
        el('div', { className: 'crm-card-header' }, [
          editableCell('span', { className: 'crm-card-company' }, company, rowIdx, cols.company),
          cols.value >= 0 ? editableCell('span', { className: 'crm-card-value' }, value, rowIdx, cols.value) : null,
        ]),
        el('div', { className: 'crm-card-body' }, [
          stageBadge,
          cols.contact >= 0 ? editableCell('span', { className: 'crm-card-contact' }, contact, rowIdx, cols.contact) : null,
        ]),
        cols.notes >= 0 ? editableCell('div', { className: 'crm-card-notes' }, notes, rowIdx, cols.notes) : null,
      ]));
    }
  },
};

registerTemplate('crm', definition);
export default definition;
