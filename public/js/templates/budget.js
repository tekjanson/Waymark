/* ============================================================
   templates/budget.js — Budget: grouped by category, subtotals, chart
   ============================================================ */

import { el, cell, editableCell, delegateEvent, groupByColumn, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

/** Parse a currency / numeric string to a plain number */
function parseAmt(raw) {
  return parseFloat((raw || '0').replace(/[^-\d.]/g, '')) || 0;
}

/** Stable color palette for category chart segments */
const CAT_COLORS = ['#059669','#2563eb','#d97706','#7c3aed','#dc2626','#0891b2','#be185d','#65a30d'];

const definition = {
  name: 'Budget',
  icon: '💰',
  color: '#059669',
  priority: 20,
  itemNoun: 'Transaction',

  detect(lower) {
    return lower.some(h => /^(budget|income|expense|spent|balance)/.test(h))
      && lower.some(h => /^(amount|cost|price|total|sum|\$)/.test(h) || /^(budget|income|expense)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, amount: -1, category: -1, date: -1, budget: -1 };
    cols.amount   = lower.findIndex(h => /^(amount|cost|price|total|sum|\$)/.test(h));
    cols.budget   = lower.findIndex((h, i) => i !== cols.amount && /^(budget|limit|planned|allocated)/.test(h));
    cols.category = lower.findIndex(h => /^(category|type|group)/.test(h));
    cols.text     = lower.findIndex((h, i) => i !== cols.amount && i !== cols.category && i !== cols.budget && /^(description|item|name|memo|what|note|label)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.amount && i !== cols.category && i !== cols.budget);
    cols.date     = lower.findIndex(h => /^(date|when|day|month)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Description', colIndex: cols.text,     type: 'text',   placeholder: 'Item or description', required: true },
      { role: 'amount',   label: 'Amount',      colIndex: cols.amount,   type: 'number', placeholder: '0.00', required: true },
      { role: 'category', label: 'Category',    colIndex: cols.category, type: 'text',   placeholder: 'e.g. Food, Rent' },
      { role: 'date',     label: 'Date',        colIndex: cols.date,     type: 'date',   defaultValue: '__TODAY__' },
      { role: 'budget',   label: 'Budget',      colIndex: cols.budget,   type: 'number', placeholder: 'Budgeted amount' },
    ];
  },

  render(container, rows, cols) {
    /* ---------- Compute totals ---------- */
    let totalIncome = 0, totalExpense = 0;
    for (const row of rows) {
      const amt = parseAmt(cell(row, cols.amount));
      if (amt > 0) totalIncome += amt; else totalExpense += Math.abs(amt);
    }
    const balance = totalIncome - totalExpense;

    /* ---------- Summary bar ---------- */
    container.append(el('div', { className: 'budget-summary' }, [
      el('div', { className: 'budget-summary-item budget-income' }, [
        el('span', { className: 'budget-summary-label' }, ['Income']),
        el('span', { className: 'budget-summary-value' }, [`$${totalIncome.toLocaleString()}`]),
      ]),
      el('div', { className: 'budget-summary-item budget-expense' }, [
        el('span', { className: 'budget-summary-label' }, ['Expenses']),
        el('span', { className: 'budget-summary-value' }, [`$${totalExpense.toLocaleString()}`]),
      ]),
      el('div', { className: `budget-summary-item ${balance >= 0 ? 'budget-positive' : 'budget-negative'}` }, [
        el('span', { className: 'budget-summary-label' }, ['Balance']),
        el('span', { className: 'budget-summary-value' }, [`$${balance.toLocaleString()}`]),
      ]),
    ]));

    /* ---------- Group by category ---------- */
    const groups = groupByColumn(rows, cols.category, 'Uncategorized');

    /* ---------- Category chart (stacked horizontal bar) ---------- */
    if (cols.category >= 0 && totalExpense > 0) {
      const catStats = [];
      let colorIdx = 0;
      for (const [cat, items] of groups) {
        let spent = 0, budgeted = 0;
        for (const { row } of items) {
          const amt = parseAmt(cell(row, cols.amount));
          if (amt < 0) spent += Math.abs(amt);
          if (cols.budget >= 0) budgeted += parseAmt(cell(row, cols.budget));
        }
        if (spent > 0) {
          catStats.push({
            cat, spent, budgeted,
            pct: Math.round((spent / totalExpense) * 100),
            color: CAT_COLORS[colorIdx % CAT_COLORS.length],
            over: budgeted > 0 && spent > budgeted,
          });
        }
        colorIdx++;
      }

      const chartBar = el('div', { className: 'budget-chart-bar' });
      for (const s of catStats) {
        chartBar.append(el('div', {
          className: `budget-chart-segment ${s.over ? 'budget-chart-over' : ''}`,
          style: `width:${Math.max(s.pct, 3)}%;background:${s.color}`,
          title: `${s.cat}: $${s.spent.toLocaleString()} (${s.pct}%)${s.over ? ' — OVER BUDGET' : ''}`,
        }));
      }

      const legend = el('div', { className: 'budget-chart-legend' });
      for (const s of catStats) {
        legend.append(el('div', { className: `budget-chart-legend-item ${s.over ? 'budget-chart-legend-over' : ''}` }, [
          el('span', { className: 'budget-chart-swatch', style: `background:${s.color}` }),
          el('span', {}, [`${s.cat} $${s.spent.toLocaleString()} (${s.pct}%)`]),
          s.over ? el('span', { className: 'budget-chart-over-badge' }, ['Over']) : null,
        ]));
      }

      container.append(el('div', { className: 'budget-chart' }, [chartBar, legend]));
    }

    /* ---------- Category groups with subtotals ---------- */
    for (const [cat, items] of groups) {
      let catSpent = 0, catBudgeted = 0;
      for (const { row } of items) {
        const amt = parseAmt(cell(row, cols.amount));
        catSpent += amt;
        if (cols.budget >= 0) catBudgeted += parseAmt(cell(row, cols.budget));
      }
      const overBudget = cols.budget >= 0 && catBudgeted > 0 && Math.abs(catSpent) > catBudgeted;

      /* Category header with subtotal */
      const subtotalText = cols.budget >= 0 && catBudgeted > 0
        ? `$${Math.abs(catSpent).toLocaleString()} / $${catBudgeted.toLocaleString()}`
        : `$${Math.abs(catSpent).toLocaleString()}`;

      container.append(el('div', { className: `budget-category-label ${overBudget ? 'budget-category-over' : ''}` }, [
        el('span', {}, [cat]),
        el('span', { className: 'budget-category-subtotal' }, [subtotalText]),
      ]));

      /* Individual rows */
      for (const { row, originalIndex } of items) {
        const rowIdx = originalIndex + 1;
        const text = cell(row, cols.text) || row[0] || '\u2014';
        const amount = cell(row, cols.amount);
        const date = cell(row, cols.date);
        const budget = cell(row, cols.budget);
        const amtNum = parseAmt(amount);
        const isIncome = amtNum > 0;

        container.append(el('div', { className: 'budget-row' }, [
          el('div', { className: 'budget-row-info' }, [
            editableCell('span', { className: 'budget-row-text' }, text, rowIdx, cols.text),
            cols.date >= 0 ? editableCell('span', { className: 'budget-row-date' }, date, rowIdx, cols.date) : null,
          ]),
          cols.budget >= 0 ? editableCell('span', { className: 'budget-row-limit' }, budget, rowIdx, cols.budget) : null,
          editableCell('span', { className: `budget-amount ${isIncome ? 'budget-amt-positive' : 'budget-amt-negative'}` }, amount || '$0', rowIdx, cols.amount),
        ]));
      }
    }
  },

  /* ---------- Directory View: financial overview across sheets ---------- */
  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'budget-directory' });

    /* Title bar */
    wrapper.append(el('div', { className: 'budget-dir-title-bar' }, [
      el('span', { className: 'budget-dir-icon' }, ['\uD83D\uDCB0']),
      el('span', { className: 'budget-dir-title' }, ['Financial Overview']),
      el('span', { className: 'budget-dir-count' }, [
        `${sheets.length} budget${sheets.length !== 1 ? 's' : ''}`,
      ]),
    ]));

    /* Compute per-sheet summaries */
    let grandIncome = 0, grandExpense = 0;
    const sheetStats = [];

    for (const sheet of sheets) {
      let income = 0, expense = 0;
      for (const row of sheet.rows) {
        const amt = parseAmt(cell(row, sheet.cols.amount));
        if (amt > 0) income += amt; else expense += Math.abs(amt);
      }
      grandIncome += income;
      grandExpense += expense;
      sheetStats.push({ id: sheet.id, name: sheet.name, income, expense, balance: income - expense });
    }

    const grandBalance = grandIncome - grandExpense;

    /* Grand totals bar */
    wrapper.append(el('div', { className: 'budget-dir-totals' }, [
      el('div', { className: 'budget-dir-total-item' }, [
        el('span', { className: 'budget-dir-total-label' }, ['Total Income']),
        el('span', { className: 'budget-dir-total-value budget-dir-income' }, [`$${grandIncome.toLocaleString()}`]),
      ]),
      el('div', { className: 'budget-dir-total-item' }, [
        el('span', { className: 'budget-dir-total-label' }, ['Total Expenses']),
        el('span', { className: 'budget-dir-total-value budget-dir-expense' }, [`$${grandExpense.toLocaleString()}`]),
      ]),
      el('div', { className: 'budget-dir-total-item' }, [
        el('span', { className: 'budget-dir-total-label' }, ['Net Balance']),
        el('span', { className: `budget-dir-total-value ${grandBalance >= 0 ? 'budget-dir-income' : 'budget-dir-expense'}` }, [`$${grandBalance.toLocaleString()}`]),
      ]),
    ]));

    /* Mini trend chart (horizontal bar per sheet) */
    if (sheetStats.length > 1) {
      const maxAmt = Math.max(...sheetStats.map(s => Math.max(s.income, s.expense)), 1);
      const chart = el('div', { className: 'budget-dir-chart' });
      chart.append(el('div', { className: 'budget-dir-chart-title' }, ['Income vs Expenses']));
      for (const s of sheetStats) {
        const incPct = Math.round((s.income / maxAmt) * 100);
        const expPct = Math.round((s.expense / maxAmt) * 100);
        chart.append(el('div', { className: 'budget-dir-chart-row' }, [
          el('span', { className: 'budget-dir-chart-label' }, [s.name]),
          el('div', { className: 'budget-dir-chart-bars' }, [
            el('div', { className: 'budget-dir-bar budget-dir-bar-income', style: `width:${Math.max(incPct, 2)}%`, title: `Income: $${s.income.toLocaleString()}` }),
            el('div', { className: 'budget-dir-bar budget-dir-bar-expense', style: `width:${Math.max(expPct, 2)}%`, title: `Expenses: $${s.expense.toLocaleString()}` }),
          ]),
        ]));
      }
      chart.append(el('div', { className: 'budget-dir-chart-legend' }, [
        el('span', { className: 'budget-dir-legend-item' }, [
          el('span', { className: 'budget-dir-legend-swatch budget-dir-bar-income' }),
          'Income',
        ]),
        el('span', { className: 'budget-dir-legend-item' }, [
          el('span', { className: 'budget-dir-legend-swatch budget-dir-bar-expense' }),
          'Expenses',
        ]),
      ]));
      wrapper.append(chart);
    }

    /* Sheet cards grid */
    const grid = el('div', { className: 'budget-dir-grid' });
    for (const s of sheetStats) {
      const isPositive = s.balance >= 0;
      grid.append(el('div', {
        className: `budget-dir-card ${isPositive ? '' : 'budget-dir-card-negative'}`,
        dataset: { entryId: s.id, entryName: s.name },
      }, [
        el('div', { className: 'budget-dir-card-name' }, [s.name]),
        el('div', { className: 'budget-dir-card-stats' }, [
          el('span', { className: 'budget-dir-card-income' }, [`+$${s.income.toLocaleString()}`]),
          el('span', { className: 'budget-dir-card-expense' }, [`\u2212$${s.expense.toLocaleString()}`]),
        ]),
        el('div', { className: `budget-dir-card-balance ${isPositive ? 'budget-dir-income' : 'budget-dir-expense'}` }, [
          `Balance: $${s.balance.toLocaleString()}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.budget-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('budget', definition);
export default definition;
