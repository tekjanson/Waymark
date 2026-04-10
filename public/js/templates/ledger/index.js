/* ============================================================
   ledger/index.js — Business Ledger: P&L summary, categorised
   entries, running balance, monthly trend chart
   ============================================================ */

import {
  el, cell, editableCell, emitEdit, registerTemplate,
  delegateEvent, groupByColumn, drawBarChart, drawPieChart,
  buildDirSyncBtn,
} from '../shared.js';
import {
  parseAmt, fmtDollars, isIncome, isExpense, signedAmt,
  groupLedgerByCategory, computePnL, buildMonthlyTotals,
  TYPE_COLORS,
} from './helpers.js';

/* ---------- Helpers ---------- */

/** CSS class for a type badge */
function typeBadgeClass(typeVal) {
  if (isIncome(typeVal)) return 'ledger-type-income';
  if (isExpense(typeVal)) return 'ledger-type-expense';
  return 'ledger-type-transfer';
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Ledger',
  icon: '📒',
  color: '#0f766e',
  priority: 22,
  itemNoun: 'Entry',
  defaultHeaders: ['Date', 'Type', 'Category', 'Description', 'Amount', 'Reference'],

  detect(lower) {
    const hasRef      = lower.some(h => /^(reference|ref\b|journal|memo|entry.?#|folio)/.test(h));
    const hasBalance  = lower.some(h => /^(balance|running.?balance|closing)/.test(h));
    const hasType     = lower.some(h => /^(type|entry.?type|txn.?type|transaction.?type)/.test(h));
    const hasAmount   = lower.some(h => /^(amount|debit|credit|value|\$)/.test(h));
    const hasCategory = lower.some(h => /^(category|account|ledger.?account|gl.?code|dept)/.test(h));
    // Strong signal: explicit "reference" column + amount, or "balance" column, or type+category+amount
    return (hasRef && hasAmount)
      || hasBalance
      || (hasType && hasCategory && hasAmount);
  },

  columns(lower) {
    const cols = { date: -1, type: -1, category: -1, text: -1, amount: -1, reference: -1, balance: -1 };
    cols.date      = lower.findIndex(h => /^(date|when|day|posted|transaction.?date)/.test(h));
    cols.type      = lower.findIndex(h => /^(type|entry.?type|txn.?type|transaction.?type|kind|cr\.?\/dr\.?)/.test(h));
    cols.amount    = lower.findIndex(h => /^(amount|debit|credit|value|\$)/.test(h));
    cols.reference = lower.findIndex((h, i) => i !== cols.amount && /^(reference|ref\b|journal|memo|entry.?#|folio|check.?#)/.test(h));
    cols.balance   = lower.findIndex((h, i) => i !== cols.amount && /^(balance|running.?balance|closing)/.test(h));
    cols.category  = lower.findIndex((h, i) => i !== cols.type && i !== cols.amount && /^(category|account|ledger.?account|gl.?code|dept|class)/.test(h));
    cols.text      = lower.findIndex((h, i) => i !== cols.date && i !== cols.type && i !== cols.amount && i !== cols.reference && i !== cols.balance && i !== cols.category && /^(description|memo|notes?|detail|item|label|name|narration)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.date && i !== cols.type && i !== cols.amount && i !== cols.reference && i !== cols.balance && i !== cols.category);
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'date',    label: 'Date',      colIndex: cols.date,      type: 'date',   defaultValue: '__TODAY__', required: true },
      { role: 'type',    label: 'Type',      colIndex: cols.type,      type: 'select', options: ['Income', 'Expense', 'Transfer'], defaultValue: 'Expense', required: true },
      { role: 'category',label: 'Category',  colIndex: cols.category,  type: 'text',   placeholder: 'e.g. Revenue, Payroll, Rent' },
      { role: 'text',    label: 'Description', colIndex: cols.text,    type: 'text',   placeholder: 'Entry description', required: true },
      { role: 'amount',  label: 'Amount',    colIndex: cols.amount,    type: 'number', placeholder: '0.00', required: true },
      { role: 'reference', label: 'Reference', colIndex: cols.reference, type: 'text', placeholder: 'Journal ref / check #' },
    ];
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    /* ---------- P&L Summary ---------- */
    const { totalIncome, totalExpenses, netProfit } = computePnL(rows, cols, cell);

    container.append(el('div', { className: 'ledger-pnl' }, [
      el('div', { className: 'ledger-pnl-item ledger-pnl-income' }, [
        el('span', { className: 'ledger-pnl-label' }, ['Total Revenue']),
        el('span', { className: 'ledger-pnl-value' }, [fmtDollars(totalIncome)]),
      ]),
      el('div', { className: 'ledger-pnl-item ledger-pnl-expense' }, [
        el('span', { className: 'ledger-pnl-label' }, ['Total Expenses']),
        el('span', { className: 'ledger-pnl-value' }, [fmtDollars(totalExpenses)]),
      ]),
      el('div', { className: `ledger-pnl-item ${netProfit >= 0 ? 'ledger-pnl-profit' : 'ledger-pnl-loss'}` }, [
        el('span', { className: 'ledger-pnl-label' }, [netProfit >= 0 ? 'Net Profit' : 'Net Loss']),
        el('span', { className: 'ledger-pnl-value' }, [fmtDollars(Math.abs(netProfit))]),
      ]),
    ]));

    /* ---------- Monthly trend chart ---------- */
    if (cols.date >= 0) {
      const { labels, income, expenses } = buildMonthlyTotals(rows, cols, cell);
      if (labels.length > 1) {
        const chartWrap = el('div', { className: 'ledger-chart' });
        chartWrap.append(el('div', { className: 'ledger-chart-title' }, ['Monthly Income vs Expenses']));
        const chartInner = el('div', { className: 'ledger-chart-inner' });

        const incomeChart = el('div', { className: 'ledger-chart-half' });
        incomeChart.append(el('div', { className: 'ledger-chart-half-label' }, ['Revenue']));
        drawBarChart(incomeChart, { labels, values: income }, {
          color: TYPE_COLORS.income,
          height: 140,
        });
        chartInner.append(incomeChart);

        const expenseChart = el('div', { className: 'ledger-chart-half' });
        expenseChart.append(el('div', { className: 'ledger-chart-half-label' }, ['Expenses']));
        drawBarChart(expenseChart, { labels, values: expenses }, {
          color: TYPE_COLORS.expense,
          height: 140,
        });
        chartInner.append(expenseChart);

        chartWrap.append(chartInner);
        container.append(chartWrap);
      }
    }

    /* ---------- Filter bar ---------- */
    let activeFilter = 'all';

    const filterBtns = ['all', 'income', 'expense'].map(f =>
      el('button', {
        className: `ledger-filter-btn ${f === activeFilter ? 'ledger-filter-active' : ''}`,
        'data-filter': f,
        type: 'button',
      }, [f.charAt(0).toUpperCase() + f.slice(1)])
    );

    const filterBar = el('div', { className: 'ledger-filter-bar' }, filterBtns);
    container.append(filterBar);

    /* ---------- Category groups ---------- */
    const groupsWrap = el('div', { className: 'ledger-groups' });
    container.append(groupsWrap);

    function renderTable() {
      groupsWrap.innerHTML = '';

      /* Compute running balance across all rows (ordered) */
      let runBalance = 0;
      const balances = rows.map(row => {
        const type = cell(row, cols.type);
        const amt  = parseAmt(cell(row, cols.amount));
        runBalance += signedAmt(type, amt);
        return runBalance;
      });

      /* Group by category */
      const groups = groupLedgerByCategory(rows, cols, cell);

      for (const [cat, items] of groups) {
        /* Category P&L */
        let catIncome = 0, catExpenses = 0;
        for (const { row } of items) {
          const type = cell(row, cols.type);
          const amt  = parseAmt(cell(row, cols.amount));
          if (isIncome(type)) catIncome += amt;
          else if (isExpense(type)) catExpenses += amt;
        }

        /* Apply filter */
        const visibleItems = items.filter(({ row }) => {
          if (activeFilter === 'all') return true;
          const type = cell(row, cols.type);
          if (activeFilter === 'income') return isIncome(type);
          if (activeFilter === 'expense') return isExpense(type);
          return true;
        });
        if (visibleItems.length === 0) continue;

        /* Category header */
        const catNet = catIncome - catExpenses;
        groupsWrap.append(el('div', { className: 'ledger-cat-label' }, [
          el('span', { className: 'ledger-cat-name' }, [cat]),
          el('span', { className: `ledger-cat-net ${catNet >= 0 ? 'ledger-cat-positive' : 'ledger-cat-negative'}` }, [
            fmtDollars(catNet, { sign: true }),
          ]),
        ]));

        /* Entry rows */
        for (const { row, idx } of visibleItems) {
          const type     = cell(row, cols.type);
          const amt      = parseAmt(cell(row, cols.amount));
          const signed   = signedAmt(type, amt);
          const dateStr  = cell(row, cols.date);
          const desc     = cell(row, cols.text);
          const ref      = cell(row, cols.reference);
          const balance  = balances[idx];

          const rowEl = el('div', { className: 'ledger-row' }, [
            el('div', { className: 'ledger-row-left' }, [
              el('span', { className: `ledger-type-badge ${typeBadgeClass(type)}` }, [type || '—']),
              el('div', { className: 'ledger-row-info' }, [
                editableCell('span', { className: 'ledger-row-desc' }, desc, idx + 1, cols.text),
                dateStr ? el('span', { className: 'ledger-row-date' }, [dateStr]) : null,
                ref ? el('span', { className: 'ledger-row-ref' }, [`Ref: ${ref}`]) : null,
              ].filter(Boolean)),
            ]),
            el('div', { className: 'ledger-row-right' }, [
              editableCell('span', {
                className: `ledger-amt ${signed >= 0 ? 'ledger-amt-positive' : 'ledger-amt-negative'}`,
              }, fmtDollars(amt, { sign: signed >= 0 }), idx + 1, cols.amount),
              cols.balance >= 0 || true
                ? el('span', { className: 'ledger-running-balance' }, [`Bal: ${fmtDollars(balance, { sign: balance >= 0 })}`])
                : null,
            ].filter(Boolean)),
          ]);
          groupsWrap.append(rowEl);
        }
      }
    }

    renderTable();

    /* ---------- Filter delegation ---------- */
    delegateEvent(filterBar, 'click', '.ledger-filter-btn', (e, btn) => {
      const f = btn.dataset.filter;
      if (f === activeFilter) return;
      activeFilter = f;
      filterBtns.forEach(b => b.classList.toggle('ledger-filter-active', b.dataset.filter === f));
      renderTable();
    });
  },

  /** Directory view — aggregate P&L across multiple ledger sheets */
  renderDirectory(container, sheets) {
    container.innerHTML = '';

    let totalIncome = 0, totalExpenses = 0;
    for (const { rows, cols } of sheets) {
      const pnl = computePnL(rows, cols, cell);
      totalIncome   += pnl.totalIncome;
      totalExpenses += pnl.totalExpenses;
    }
    const netProfit = totalIncome - totalExpenses;

    container.append(
      el('div', { className: 'ledger-directory' }, [
        el('div', { className: 'ledger-dir-title-bar' }, [
          el('span', { className: 'ledger-dir-icon' }, ['📒']),
          el('span', { className: 'ledger-dir-title' }, ['Ledger Overview']),
          el('span', { className: 'ledger-dir-count' }, [`${sheets.length} sheet${sheets.length !== 1 ? 's' : ''}`]),
        ]),
        el('div', { className: 'ledger-dir-totals' }, [
          el('div', { className: 'ledger-dir-total-item' }, [
            el('span', { className: 'ledger-dir-total-label' }, ['Total Revenue']),
            el('span', { className: 'ledger-dir-total-value ledger-dir-income' }, [fmtDollars(totalIncome)]),
          ]),
          el('div', { className: 'ledger-dir-total-item' }, [
            el('span', { className: 'ledger-dir-total-label' }, ['Total Expenses']),
            el('span', { className: 'ledger-dir-total-value ledger-dir-expense' }, [fmtDollars(totalExpenses)]),
          ]),
          el('div', { className: 'ledger-dir-total-item' }, [
            el('span', { className: 'ledger-dir-total-label' }, [netProfit >= 0 ? 'Net Profit' : 'Net Loss']),
            el('span', { className: `ledger-dir-total-value ${netProfit >= 0 ? 'ledger-dir-profit' : 'ledger-dir-loss'}` }, [fmtDollars(Math.abs(netProfit))]),
          ]),
        ]),
        buildDirSyncBtn(container),
      ])
    );
  },
};

registerTemplate('ledger', definition);
export default definition;
