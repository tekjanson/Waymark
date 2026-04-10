/* ============================================================
   ledger/helpers.js — Pure helpers for the Ledger template
   ============================================================ */

/* ---------- Constants ---------- */

export const ENTRY_TYPES = ['Income', 'Expense', 'Transfer'];

export const TYPE_COLORS = {
  income:   '#059669',
  expense:  '#dc2626',
  transfer: '#7c3aed',
};

export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ---------- Parsing ---------- */

/**
 * Parse a currency / numeric string to a plain number (absolute value).
 * @param {string} raw
 * @returns {number}
 */
export function parseAmt(raw) {
  return parseFloat((raw || '0').replace(/[^-\d.]/g, '')) || 0;
}

/**
 * Format a number as a dollar string with 2 decimal places.
 * @param {number} n
 * @param {Object} [opts]
 * @param {boolean} [opts.sign] — prefix positive values with '+'
 * @returns {string}
 */
export function fmtDollars(n, opts = {}) {
  const abs = Math.abs(n);
  const formatted = '$' + abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (opts.sign && n > 0) return '+' + formatted;
  return formatted;
}

/**
 * Return true if the entry type string represents income.
 * @param {string} typeVal
 * @returns {boolean}
 */
export function isIncome(typeVal) {
  return /^(income|revenue|credit|cr\b|deposit|receipt|sale|earning|in\b)/i.test((typeVal || '').trim());
}

/**
 * Return true if the entry type string represents an expense.
 * @param {string} typeVal
 * @returns {boolean}
 */
export function isExpense(typeVal) {
  return /^(expense|cost|debit|dr\b|payment|out\b|purchase|fee|charge|withdrawal|spend)/i.test((typeVal || '').trim());
}

/**
 * Return the signed amount: income = positive, expense = negative.
 * Unrecognised type defaults to positive (income).
 * @param {string} typeVal
 * @param {number} amt — absolute value
 * @returns {number}
 */
export function signedAmt(typeVal, amt) {
  if (isExpense(typeVal)) return -Math.abs(amt);
  return Math.abs(amt);
}

/**
 * Group ledger rows by category.
 * @param {string[][]} rows
 * @param {Object} cols — column index map
 * @param {function} cellFn — cell(row, idx) accessor
 * @returns {Map<string, Array<{row, idx}>>}
 */
export function groupLedgerByCategory(rows, cols, cellFn) {
  const groups = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cat = (cellFn(row, cols.category) || 'Uncategorized').trim() || 'Uncategorized';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push({ row, idx: i });
  }
  return groups;
}

/**
 * Compute P&L summary across all rows.
 * @param {string[][]} rows
 * @param {Object} cols
 * @param {function} cellFn
 * @returns {{ totalIncome: number, totalExpenses: number, netProfit: number }}
 */
export function computePnL(rows, cols, cellFn) {
  let totalIncome = 0;
  let totalExpenses = 0;
  for (const row of rows) {
    const type = cellFn(row, cols.type);
    const amt = parseAmt(cellFn(row, cols.amount));
    if (isIncome(type)) totalIncome += amt;
    else if (isExpense(type)) totalExpenses += amt;
  }
  return { totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses };
}

/**
 * Build monthly income/expense totals for chart rendering.
 * @param {string[][]} rows
 * @param {Object} cols
 * @param {function} cellFn
 * @returns {{ labels: string[], income: number[], expenses: number[] }}
 */
export function buildMonthlyTotals(rows, cols, cellFn) {
  const map = new Map(); // 'YYYY-MM' → { income, expenses }
  for (const row of rows) {
    const dateStr = cellFn(row, cols.date);
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, { income: 0, expenses: 0 });
    const entry = map.get(key);
    const type = cellFn(row, cols.type);
    const amt = parseAmt(cellFn(row, cols.amount));
    if (isIncome(type)) entry.income += amt;
    else if (isExpense(type)) entry.expenses += amt;
  }
  const sorted = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const labels  = sorted.map(([key]) => {
    const [, m] = key.split('-');
    return MONTH_NAMES[parseInt(m, 10) - 1] || key;
  });
  const income   = sorted.map(([, v]) => v.income);
  const expenses = sorted.map(([, v]) => v.expenses);
  return { labels, income, expenses };
}
