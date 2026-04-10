/* ============================================================
   invoice/helpers.js — Pure helpers for the Invoice template
   ============================================================ */

/* ---------- Constants ---------- */

export const INVOICE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Paid', 'Overdue', 'Cancelled'];

export const STATUS_NEXT = {
  draft:      'Sent',
  sent:       'Viewed',
  viewed:     'Paid',
  paid:       'Paid',
  overdue:    'Paid',
  cancelled:  'Draft',
};

/* ---------- Parsing ---------- */

/**
 * Parse a currency / numeric string to a number.
 * @param {string} raw
 * @returns {number}
 */
export function parseAmt(raw) {
  return parseFloat((raw || '0').replace(/[^-\d.]/g, '')) || 0;
}

/**
 * Parse a quantity string to a (positive) number; default 1.
 * @param {string} raw
 * @returns {number}
 */
export function parseQty(raw) {
  const n = parseFloat((raw || '').trim());
  return (isFinite(n) && n > 0) ? n : 1;
}

/**
 * Format a number as a dollar string with 2 decimal places.
 * @param {number} n
 * @returns {string}
 */
export function fmtDollars(n) {
  return '$' + Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Compute the line total (qty × unit price).
 * @param {string[]} row
 * @param {Object} cols
 * @param {function} cellFn
 * @returns {number}
 */
export function lineTotal(row, cols, cellFn) {
  const qty   = parseQty(cellFn(row, cols.qty));
  const price = parseAmt(cellFn(row, cols.unitPrice));
  return qty * price;
}

/**
 * Get the CSS class suffix for an invoice status.
 * @param {string} status
 * @returns {string}
 */
export function statusClass(status) {
  return (status || 'draft').toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * Get the next status in the cycle for an invoice.
 * @param {string} current
 * @returns {string}
 */
export function nextStatus(current) {
  const key = (current || 'draft').toLowerCase().trim();
  return STATUS_NEXT[key] || 'Sent';
}

/**
 * Group rows into invoice objects.
 * A new invoice starts whenever the invoice # column is non-empty.
 * Continuation rows (blank invoice #) belong to the preceding invoice.
 *
 * @param {string[][]} rows
 * @param {Object} cols
 * @param {function} cellFn
 * @returns {Array<{ invNum:string, client:string, date:string, due:string, status:string, firstRowIdx:number, rows:Array<{row,idx}> }>}
 */
export function groupInvoices(rows, cols, cellFn) {
  const invoices = [];
  let current = null;
  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const invNum = cellFn(row, cols.invoice).trim();
    if (invNum) {
      current = {
        invNum,
        client:      cellFn(row, cols.client),
        date:        cellFn(row, cols.date),
        due:         cellFn(row, cols.due),
        status:      cellFn(row, cols.status) || 'Draft',
        notes:       cellFn(row, cols.notes),
        firstRowIdx: i,
        rows:        [{ row, idx: i }],
      };
      invoices.push(current);
    } else if (current) {
      current.rows.push({ row, idx: i });
    }
  }
  return invoices;
}

/**
 * Compute the subtotal for one invoice (sum of all line totals).
 * @param {Object} invoice — from groupInvoices()
 * @param {Object} cols
 * @param {function} cellFn
 * @returns {number}
 */
export function invoiceTotal(invoice, cols, cellFn) {
  let total = 0;
  for (const { row } of invoice.rows) {
    total += lineTotal(row, cols, cellFn);
  }
  return total;
}

/**
 * Compute AR summary: total invoiced, paid, outstanding.
 * @param {Array} invoices — from groupInvoices()
 * @param {Object} cols
 * @param {function} cellFn
 * @returns {{ totalInvoiced:number, totalPaid:number, totalOutstanding:number }}
 */
export function computeARSummary(invoices, cols, cellFn) {
  let totalInvoiced = 0;
  let totalPaid = 0;
  for (const inv of invoices) {
    const tot = invoiceTotal(inv, cols, cellFn);
    totalInvoiced += tot;
    if (/^paid$/i.test((inv.status || '').trim())) totalPaid += tot;
  }
  return { totalInvoiced, totalPaid, totalOutstanding: totalInvoiced - totalPaid };
}

/**
 * Check if an invoice is overdue based on its due date.
 * @param {string} dueDate — date string
 * @param {string} status
 * @returns {boolean}
 */
export function isOverdue(dueDate, status) {
  if (!dueDate || /^(paid|cancelled)/i.test((status || '').trim())) return false;
  const due = new Date(dueDate);
  return !isNaN(due.getTime()) && due < new Date();
}
