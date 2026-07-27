/* ============================================================
   templates/rfi.js — Construction RFI: Kanban swim-lanes & cards
   ============================================================ */

import { el, cell, editableCell, registerTemplate, buildDirSyncBtn, delegateEvent } from './shared.js';

const STATUS_CYCLE = ['Draft', 'Open', 'Pending', 'Closed'];

const definition = {
  name: 'Construction RFI',
  icon: '📋',
  color: '#0284c7',
  priority: 25,
  itemNoun: 'RFI',
  defaultHeaders: ['RFI Number', 'Subject', 'Status', 'Assigned To', 'Response Due', 'Official Response'],

  detect(lower) {
    return lower.some(h => /^(rfi|rfi\s*number|reference|id)/.test(h))
      && lower.some(h => /^(status|state|stage)/.test(h));
  },

  columns(lower) {
    const cols = { rfiNumber: -1, subject: -1, status: -1, assignedTo: -1, responseDue: -1, officialResponse: -1 };
    cols.rfiNumber        = lower.findIndex(h => /^(rfi|rfi\s*number|reference|id)/.test(h));
    cols.status           = lower.findIndex(h => /^(status|state|stage)/.test(h));
    cols.subject          = lower.findIndex((h, i) => i !== cols.rfiNumber && i !== cols.status && /^(subject|question|title|topic|summary)/.test(h));
    if (cols.subject === -1) cols.subject = lower.findIndex((_, i) => i !== cols.rfiNumber && i !== cols.status);
    cols.assignedTo       = lower.findIndex(h => /^(assigned|assignee|owner|dri|to)/.test(h));
    cols.responseDue      = lower.findIndex(h => /^(due|response\s*due|deadline|date)/.test(h));
    cols.officialResponse = lower.findIndex(h => /^(official\s*response|response|answer|reply|solution)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'rfiNumber',        label: 'RFI Number',        colIndex: cols.rfiNumber,        type: 'text',   placeholder: 'e.g. RFI-001', required: true },
      { role: 'subject',          label: 'Subject',           colIndex: cols.subject,          type: 'text',   placeholder: 'Question or subject', required: true },
      { role: 'status',           label: 'Status',            colIndex: cols.status,           type: 'select', options: STATUS_CYCLE, defaultValue: 'Open' },
      { role: 'assignedTo',       label: 'Assigned To',       colIndex: cols.assignedTo,       type: 'text',   placeholder: 'Name or email' },
      { role: 'responseDue',      label: 'Response Due',      colIndex: cols.responseDue,      type: 'date' },
      { role: 'officialResponse', label: 'Official Response', colIndex: cols.officialResponse, type: 'text',   placeholder: 'Enter answer...' },
    ];
  },

  render(container, rows, cols) {
    /* --- 1. Status Summary Bar --- */
    const counts = STATUS_CYCLE.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
    for (const row of rows) {
      const status = cell(row, cols.status) || 'Draft';
      if (counts[status] !== undefined) counts[status]++;
    }

    const summaryBar = el('div', { className: 'rfi-summary-bar' }, [
      el('div', { className: 'rfi-badge rfi-badge-open' }, ['Total Open: ', el('span', { className: 'count-open' }, [String(counts['Open'] || 0)])]),
      el('div', { className: 'rfi-badge rfi-badge-pending' }, ['Pending: ', el('span', { className: 'count-pending' }, [String(counts['Pending'] || 0)])]),
      el('div', { className: 'rfi-badge rfi-badge-closed' }, ['Closed: ', el('span', { className: 'count-closed' }, [String(counts['Closed'] || 0)])]),
    ]);
    container.append(summaryBar);

    /* --- 2. Kanban Swim-Lanes --- */
    const kanban = el('div', { className: 'rfi-kanban' });
    const columnContainers = {};

    STATUS_CYCLE.forEach(status => {
      const cardsContainer = el('div', { className: 'rfi-cards' });
      columnContainers[status] = cardsContainer;
      kanban.append(el('div', { className: 'rfi-column' }, [
        el('h3', {}, [status]),
        cardsContainer,
      ]));
    });

    /* --- 3. Render Cards into Swim-Lanes --- */
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1; // 1-based data row index in Waymark
      const rfiNum = cell(row, cols.rfiNumber) || row[0] || 'Unknown RFI';
      const subject = cell(row, cols.subject) || 'No subject provided';
      const status = cell(row, cols.status) || 'Draft';
      const assigned = cell(row, cols.assignedTo);
      const due = cell(row, cols.responseDue);
      const response = cell(row, cols.officialResponse);

      const cardChildren = [
        el('h4', {}, [editableCell('span', { className: 'rfi-num-text' }, rfiNum, rowIdx, cols.rfiNumber)]),
        el('p', {}, [editableCell('span', { className: 'rfi-subject-text' }, subject, rowIdx, cols.subject)]),
      ];

      // Metadata row (Assigned & Due Date)
      if (cols.assignedTo >= 0 || cols.responseDue >= 0) {
        const metaChildren = [];
        if (cols.assignedTo >= 0) metaChildren.push(el('span', { className: 'rfi-meta-assigned' }, ['Assigned: ', editableCell('span', {}, assigned || 'Unassigned', rowIdx, cols.assignedTo)]));
        if (cols.responseDue >= 0) metaChildren.push(el('span', { className: 'rfi-meta-due' }, ['Due: ', editableCell('span', {}, due || 'No date', rowIdx, cols.responseDue)]));
        cardChildren.push(el('div', { className: 'rfi-meta', style: { fontSize: '0.8rem', color: '#64748b', marginBottom: '8px' } }, metaChildren));
      }

      // Interactive Status Badge (clicking triggers Waymark's native editor to cycle/change status)
      if (cols.status >= 0) {
        cardChildren.push(
          editableCell('button', { className: `rfi-status-btn ${status.toLowerCase()}` }, status, rowIdx, cols.status)
        );
      }

      // Official Response box
      if (cols.officialResponse >= 0) {
        cardChildren.push(
          el('div', { className: 'rfi-response-wrap', style: { marginTop: '8px' } }, [
            el('label', { style: { fontSize: '0.75rem', fontWeight: 'bold', color: '#334155' } }, ['Official Response:']),
            editableCell('div', { className: 'rfi-response-box', style: { padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', marginTop: '4px', fontSize: '0.875rem' } }, response || 'Click to enter response...', rowIdx, cols.officialResponse)
          ])
        );
      }

      const card = el('div', { className: 'rfi-card' }, cardChildren);
      const targetCol = columnContainers[status] || columnContainers['Draft'];
      targetCol.append(card);
    }

    container.append(kanban);
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'rfi-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'rfi-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'rfi-dir-icon tmpl-dir-icon' }, ['📋']),
      el('span', { className: 'rfi-dir-title tmpl-dir-title' }, ['Construction RFIs']),
      el('span', { className: 'rfi-dir-count tmpl-dir-count' }, [
        `${sheets.length} RFI board${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'rfi-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'rfi-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'rfi-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'rfi-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} RFI${rows.length !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.rfi-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('rfi', definition);
export default definition;