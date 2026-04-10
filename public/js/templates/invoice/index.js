/* ============================================================
   invoice/index.js — Invoice & Quote Management: AR summary,
   invoice cards with line items, status lifecycle cycling
   ============================================================ */

import {
  el, cell, emitEdit, registerTemplate,
  delegateEvent, buildDirSyncBtn,
} from '../shared.js';
import {
  parseAmt, parseQty, fmtDollars, lineTotal,
  statusClass, nextStatus, groupInvoices,
  invoiceTotal, computeARSummary, isOverdue,
  INVOICE_STATUSES,
} from './helpers.js';

/* ---------- Status badge ---------- */

/**
 * Build a status badge element for an invoice.
 * Clicking cycles the status and emits the edit.
 * @param {string} status
 * @param {number} rowIdx — 1-based first row of invoice
 * @param {number} colIdx — status column index
 * @returns {HTMLElement}
 */
function buildStatusBadge(status, rowIdx, colIdx) {
  const cls = statusClass(status);
  const badge = el('span', {
    className: `invoice-status invoice-status-${cls}`,
    title: 'Click to advance status',
  }, [status || 'Draft']);

  if (colIdx >= 0) {
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = badge.textContent.trim();
      const next = nextStatus(current);
      badge.textContent = next;
      badge.className = `invoice-status invoice-status-${statusClass(next)}`;
      emitEdit(rowIdx, colIdx, next);
    });
  }
  return badge;
}

/* ---------- Invoice card ---------- */

/**
 * Build a collapsible invoice card with line items.
 * @param {Object} inv — from groupInvoices()
 * @param {Object} cols
 * @returns {HTMLElement}
 */
function buildInvoiceCard(inv, cols) {
  const total  = invoiceTotal(inv, cols, cell);
  const overdue = isOverdue(inv.due, inv.status);
  const effectiveStatus = overdue && !/^(paid|cancelled)/i.test(inv.status) ? 'Overdue' : inv.status;

  /* Card header */
  const statusBadge = buildStatusBadge(effectiveStatus, inv.firstRowIdx + 1, cols.status);

  const header = el('div', { className: 'invoice-card-header' }, [
    el('div', { className: 'invoice-card-meta' }, [
      el('span', { className: 'invoice-card-num' }, [inv.invNum]),
      cols.client >= 0 && inv.client
        ? el('span', { className: 'invoice-card-client' }, [inv.client])
        : null,
    ].filter(Boolean)),
    el('div', { className: 'invoice-card-right' }, [
      el('span', { className: 'invoice-card-total' }, [fmtDollars(total)]),
      statusBadge,
      el('button', { className: 'invoice-card-toggle', type: 'button', 'aria-label': 'Toggle details' }, ['▸']),
    ]),
  ]);

  /* Date and due info */
  const dateRow = el('div', { className: 'invoice-card-dates' }, [
    inv.date ? el('span', { className: 'invoice-card-date' }, [`Issued: ${inv.date}`]) : null,
    inv.due  ? el('span', { className: `invoice-card-due ${overdue ? 'invoice-due-overdue' : ''}` }, [`Due: ${inv.due}`]) : null,
    inv.notes ? el('span', { className: 'invoice-card-note' }, [inv.notes]) : null,
  ].filter(Boolean));

  /* Line items table */
  const hasLineItems = cols.item >= 0;
  const lineRows = inv.rows.map(({ row, idx }) => {
    const item  = cols.item >= 0      ? cell(row, cols.item)      : '';
    const qty   = cols.qty >= 0       ? cell(row, cols.qty)        : '';
    const price = cols.unitPrice >= 0 ? cell(row, cols.unitPrice)  : '';
    const lt    = lineTotal(row, cols, cell);

    return el('div', { className: 'invoice-line-row' }, [
      el('span', { className: 'invoice-line-item' }, [item || '—']),
      el('span', { className: 'invoice-line-qty' }, [qty || '1']),
      el('span', { className: 'invoice-line-price' }, [price ? fmtDollars(parseAmt(price)) : '—']),
      el('span', { className: 'invoice-line-total' }, [fmtDollars(lt)]),
    ]);
  });

  const lineTable = el('div', { className: 'invoice-line-table' }, [
    hasLineItems
      ? el('div', { className: 'invoice-line-header' }, [
          el('span', {}, ['Item']),
          el('span', {}, ['Qty']),
          el('span', {}, ['Unit Price']),
          el('span', {}, ['Total']),
        ])
      : null,
    ...lineRows,
    el('div', { className: 'invoice-line-subtotal' }, [
      el('span', {}, ['Subtotal']),
      el('span', {}, ['', '']),
      el('span', {}, ['']),
      el('span', { className: 'invoice-line-subtotal-val' }, [fmtDollars(total)]),
    ]),
  ].filter(Boolean));

  const details = el('div', { className: 'invoice-card-details hidden' }, [
    dateRow,
    lineTable,
  ]);

  /* Collapse toggle */
  const card = el('div', {
    className: `invoice-card invoice-card-${statusClass(effectiveStatus)}`,
    'data-inv': inv.invNum,
  }, [header, details]);

  header.querySelector('.invoice-card-toggle').addEventListener('click', () => {
    const open = details.classList.toggle('hidden') === false;
    header.querySelector('.invoice-card-toggle').textContent = open ? '▾' : '▸';
    card.classList.toggle('invoice-card-open', open);
  });

  return card;
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Invoice',
  icon: '🧾',
  color: '#7c3aed',
  priority: 22,
  itemNoun: 'Invoice',
  defaultHeaders: ['Invoice #', 'Client', 'Date', 'Due Date', 'Status', 'Item', 'Qty', 'Unit Price', 'Notes'],

  detect(lower) {
    const hasInvoice = lower.some(h => /^(invoice|inv\.?\s*#|inv\.?\s*num|invoice.?no|quote\.?\s*#|quote.?no)/.test(h));
    const hasClient  = lower.some(h => /^(client|customer|bill\.?to|company|account)/.test(h));
    const hasDue     = lower.some(h => /^(due|due.?date|payment.?due)/.test(h));
    const hasItem    = lower.some(h => /^(item|description|service|product|line.?item)/.test(h));
    const hasPrice   = lower.some(h => /^(unit.?price|price|rate|cost|amount|\$)/.test(h));
    // Must have invoice # as primary signal, plus at least one other finance signal
    return hasInvoice && (hasClient || hasDue || hasItem || hasPrice);
  },

  columns(lower) {
    const cols = { invoice: -1, client: -1, date: -1, due: -1, status: -1, item: -1, qty: -1, unitPrice: -1, notes: -1 };
    cols.invoice   = lower.findIndex(h => /^(invoice|inv\.?\s*#|invoice.?no|quote\.?\s*#|quote.?no)/.test(h));
    cols.client    = lower.findIndex(h => /^(client|customer|bill\.?to|company|account)/.test(h));
    cols.date      = lower.findIndex((h, i) => i !== cols.client && /^(date|issued|invoice.?date)/.test(h));
    cols.due       = lower.findIndex((h, i) => i !== cols.date && /^(due|due.?date|payment.?due)/.test(h));
    cols.status    = lower.findIndex(h => /^(status|state|stage)/.test(h));
    cols.item      = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(item|description|service|product|line.?item|work|task)/.test(h));
    cols.qty       = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(qty|quantity|units?|hours?)/.test(h));
    cols.unitPrice = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(unit.?price|price|rate|cost|\$)/.test(h));
    cols.notes     = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(notes?|memo|comment|details?)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'invoice',   label: 'Invoice #', colIndex: cols.invoice,   type: 'text',   placeholder: 'e.g. INV-001', required: true },
      { role: 'client',    label: 'Client',    colIndex: cols.client,    type: 'text',   placeholder: 'Client or company name', required: true },
      { role: 'date',      label: 'Date',      colIndex: cols.date,      type: 'date',   defaultValue: '__TODAY__' },
      { role: 'due',       label: 'Due Date',  colIndex: cols.due,       type: 'date' },
      { role: 'status',    label: 'Status',    colIndex: cols.status,    type: 'select', options: INVOICE_STATUSES, defaultValue: 'Draft' },
      { role: 'item',      label: 'Item',      colIndex: cols.item,      type: 'text',   placeholder: 'Service or product description' },
      { role: 'qty',       label: 'Qty',       colIndex: cols.qty,       type: 'number', placeholder: '1' },
      { role: 'unitPrice', label: 'Unit Price',colIndex: cols.unitPrice, type: 'number', placeholder: '0.00' },
      { role: 'notes',     label: 'Notes',     colIndex: cols.notes,     type: 'text',   placeholder: 'Payment terms, notes' },
    ];
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    /* ---------- Group into invoices ---------- */
    const invoices = groupInvoices(rows, cols, cell);

    /* ---------- AR Summary ---------- */
    const { totalInvoiced, totalPaid, totalOutstanding } = computeARSummary(invoices, cols, cell);
    const overdueAmt = invoices
      .filter(inv => isOverdue(inv.due, inv.status))
      .reduce((sum, inv) => sum + invoiceTotal(inv, cols, cell), 0);

    container.append(el('div', { className: 'invoice-ar-summary' }, [
      el('div', { className: 'invoice-ar-item invoice-ar-total' }, [
        el('span', { className: 'invoice-ar-label' }, ['Total Invoiced']),
        el('span', { className: 'invoice-ar-value' }, [fmtDollars(totalInvoiced)]),
      ]),
      el('div', { className: 'invoice-ar-item invoice-ar-paid' }, [
        el('span', { className: 'invoice-ar-label' }, ['Paid']),
        el('span', { className: 'invoice-ar-value' }, [fmtDollars(totalPaid)]),
      ]),
      el('div', { className: 'invoice-ar-item invoice-ar-outstanding' }, [
        el('span', { className: 'invoice-ar-label' }, ['Outstanding']),
        el('span', { className: 'invoice-ar-value' }, [fmtDollars(totalOutstanding)]),
      ]),
      el('div', { className: `invoice-ar-item invoice-ar-overdue ${overdueAmt > 0 ? 'invoice-ar-has-overdue' : ''}` }, [
        el('span', { className: 'invoice-ar-label' }, ['Overdue']),
        el('span', { className: 'invoice-ar-value' }, [fmtDollars(overdueAmt)]),
      ]),
    ]));

    /* ---------- Status filter ---------- */
    let activeFilter = 'all';
    const filterCounts = {};
    filterCounts.all = invoices.length;
    for (const s of INVOICE_STATUSES) {
      filterCounts[s.toLowerCase()] = invoices.filter(inv => inv.status.toLowerCase() === s.toLowerCase()).length;
    }

    const statusFilters = ['all', ...INVOICE_STATUSES.map(s => s.toLowerCase())];
    const filterBtns = statusFilters.map(f => {
      const label = f === 'all' ? `All (${filterCounts.all})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${filterCounts[f] || 0})`;
      return el('button', {
        className: `invoice-filter-btn ${f === activeFilter ? 'invoice-filter-active' : ''}`,
        'data-filter': f,
        type: 'button',
      }, [label]);
    });

    const filterBar = el('div', { className: 'invoice-filter-bar' }, filterBtns);
    container.append(filterBar);

    /* ---------- Invoice cards ---------- */
    const cardsWrap = el('div', { className: 'invoice-cards' });
    container.append(cardsWrap);

    function renderCards() {
      cardsWrap.innerHTML = '';
      const visible = activeFilter === 'all'
        ? invoices
        : invoices.filter(inv => inv.status.toLowerCase() === activeFilter);

      if (visible.length === 0) {
        cardsWrap.append(el('div', { className: 'invoice-empty' }, ['No invoices match this filter.']));
        return;
      }
      for (const inv of visible) {
        cardsWrap.append(buildInvoiceCard(inv, cols));
      }
    }

    renderCards();

    delegateEvent(filterBar, 'click', '.invoice-filter-btn', (e, btn) => {
      const f = btn.dataset.filter;
      if (f === activeFilter) return;
      activeFilter = f;
      filterBtns.forEach(b => b.classList.toggle('invoice-filter-active', b.dataset.filter === f));
      renderCards();
    });
  },

  /** Directory view — aggregate AR across multiple invoice sheets */
  renderDirectory(container, sheets) {
    container.innerHTML = '';

    let totalInvoiced = 0, totalPaid = 0;
    for (const { rows, cols } of sheets) {
      const invoices = groupInvoices(rows, cols, cell);
      const ar = computeARSummary(invoices, cols, cell);
      totalInvoiced += ar.totalInvoiced;
      totalPaid     += ar.totalPaid;
    }

    container.append(
      el('div', { className: 'invoice-directory' }, [
        el('div', { className: 'invoice-dir-title-bar' }, [
          el('span', { className: 'invoice-dir-icon' }, ['🧾']),
          el('span', { className: 'invoice-dir-title' }, ['Invoice Overview']),
          el('span', { className: 'invoice-dir-count' }, [`${sheets.length} sheet${sheets.length !== 1 ? 's' : ''}`]),
        ]),
        el('div', { className: 'invoice-dir-totals' }, [
          el('div', { className: 'invoice-dir-total-item' }, [
            el('span', { className: 'invoice-dir-total-label' }, ['Total Invoiced']),
            el('span', { className: 'invoice-dir-total-value invoice-dir-invoiced' }, [fmtDollars(totalInvoiced)]),
          ]),
          el('div', { className: 'invoice-dir-total-item' }, [
            el('span', { className: 'invoice-dir-total-label' }, ['Total Paid']),
            el('span', { className: 'invoice-dir-total-value invoice-dir-paid' }, [fmtDollars(totalPaid)]),
          ]),
          el('div', { className: 'invoice-dir-total-item' }, [
            el('span', { className: 'invoice-dir-total-label' }, ['Outstanding']),
            el('span', { className: 'invoice-dir-total-value invoice-dir-outstanding' }, [fmtDollars(totalInvoiced - totalPaid)]),
          ]),
        ]),
        buildDirSyncBtn(container),
      ])
    );
  },
};

registerTemplate('invoice', definition);
export default definition;
