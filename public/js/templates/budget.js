/* templates/budget.js — Budget: all fields editable inline, grouped by category */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Budget',
  icon: '💰',
  color: '#059669',
  priority: 20,

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

  render(container, rows, cols) {
    // Summary
    let totalIncome = 0, totalExpense = 0;
    for (const row of rows) {
      const amt = parseFloat((cell(row, cols.amount) || '0').replace(/[^-\d.]/g, ''));
      if (amt > 0) totalIncome += amt; else totalExpense += Math.abs(amt);
    }
    const balance = totalIncome - totalExpense;

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

    // Group by category
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cat = cols.category >= 0 ? cell(row, cols.category) || 'Uncategorized' : 'All';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({ row, originalIndex: i });
    }

    for (const [cat, items] of groups) {
      container.append(el('div', { className: 'budget-category-label' }, [cat]));
      for (const { row, originalIndex } of items) {
        const rowIdx = originalIndex + 1;
        const text = cell(row, cols.text) || row[0] || '—';
        const amount = cell(row, cols.amount);
        const date = cell(row, cols.date);
        const budget = cell(row, cols.budget);
        const amtNum = parseFloat((amount || '0').replace(/[^-\d.]/g, ''));
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
};

registerTemplate('budget', definition);
export default definition;
