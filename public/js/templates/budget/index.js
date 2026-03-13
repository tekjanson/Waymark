/* ============================================================
   templates/budget/index.js — Budget: grouped by category,
   subtotals, chart, and statement upload
   ============================================================ */

import { el, cell, editableCell, showToast, delegateEvent, groupByColumn, registerTemplate } from '../shared.js';
import { parseStatement } from './parser.js';

/* ---------- Helpers ---------- */

/** Parse a currency / numeric string to a plain number */
function parseAmt(raw) {
  return parseFloat((raw || '0').replace(/[^-\d.]/g, '')) || 0;
}

/** Stable color palette for category chart segments */
const CAT_COLORS = ['#059669','#2563eb','#d97706','#7c3aed','#dc2626','#0891b2','#be185d','#65a30d'];

/* ---------- Statement Upload Modal ---------- */

/**
 * Open an upload modal to import bank/credit card statements.
 * Parsed transactions are appended to the current sheet via the
 * template's _onAddRow callback (injected by checklist.js).
 *
 * @param {Object} cols — column index map from template.columns()
 * @param {number} totalColumns — total number of columns in the sheet
 * @param {function} onAddRow — callback(rowsToAppend: string[][])
 */
function openUploadModal(cols, totalColumns, onAddRow) {
  const existing = document.getElementById('budget-upload-modal');
  if (existing) existing.remove();

  let parsedTransactions = [];

  const fileInput = el('input', {
    className: 'budget-upload-file-input',
    type: 'file',
    accept: '.csv,.ofx,.qfx,.pdf',
  });

  const dropZone = el('div', { className: 'budget-upload-drop-zone' }, [
    el('div', { className: 'budget-upload-drop-icon' }, ['\uD83D\uDCC4']),
    el('div', { className: 'budget-upload-drop-text' }, ['Drop a statement file here']),
    el('div', { className: 'budget-upload-drop-hint' }, ['CSV, OFX, QFX, or PDF from your bank']),
    el('button', { className: 'btn btn-secondary budget-upload-browse-btn', type: 'button' }, ['Browse Files']),
  ]);

  const previewSection = el('div', { className: 'budget-upload-preview hidden' });
  const statusBar = el('div', { className: 'budget-upload-status hidden' });

  const importBtn = el('button', {
    className: 'btn btn-primary budget-upload-import-btn',
    type: 'button',
    disabled: true,
  }, ['Import Transactions']);

  const modal = el('div', {
    id: 'budget-upload-modal',
    className: 'modal-overlay',
  }, [
    el('div', { className: 'modal budget-upload-modal-content' }, [
      el('div', { className: 'modal-header' }, [
        el('h3', {}, ['\uD83C\uDFE6 Upload Statement']),
        el('button', { className: 'modal-close', type: 'button', 'aria-label': 'Close' }, ['\u2715']),
      ]),
      el('div', { className: 'modal-body' }, [
        dropZone,
        fileInput,
        statusBar,
        previewSection,
      ]),
      el('div', { className: 'modal-footer' }, [
        el('button', { className: 'btn btn-secondary', type: 'button' }, ['Cancel']),
        importBtn,
      ]),
    ]),
  ]);

  /* ---------- File handling ---------- */

  function handleFile(file) {
    if (!file) return;
    const isPDF = file.name.toLowerCase().endsWith('.pdf');

    // Show loading state for PDF (requires CDN library load)
    if (isPDF) {
      statusBar.textContent = 'Loading PDF parser\u2026';
      statusBar.className = 'budget-upload-status';
      statusBar.classList.remove('hidden');
      importBtn.disabled = true;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await parseStatement(reader.result, file.name);
        parsedTransactions = result.transactions;

        if (parsedTransactions.length === 0) {
          statusBar.textContent = 'No transactions found in this file. Check the format and try again.';
          statusBar.className = 'budget-upload-status budget-upload-status-error';
          statusBar.classList.remove('hidden');
          previewSection.classList.add('hidden');
          importBtn.disabled = true;
          return;
        }

        statusBar.textContent = `Found ${parsedTransactions.length} transaction${parsedTransactions.length !== 1 ? 's' : ''} (${result.format} format)`;
        statusBar.className = 'budget-upload-status budget-upload-status-success';
        statusBar.classList.remove('hidden');

        renderPreview(parsedTransactions, previewSection);
        previewSection.classList.remove('hidden');
        dropZone.classList.add('hidden');
        importBtn.disabled = false;
      } catch (err) {
        statusBar.textContent = `Parse error: ${err.message}`;
        statusBar.className = 'budget-upload-status budget-upload-status-error';
        statusBar.classList.remove('hidden');
        previewSection.classList.add('hidden');
        importBtn.disabled = true;
      }
    };
    reader.onerror = () => {
      statusBar.textContent = 'Failed to read file';
      statusBar.className = 'budget-upload-status budget-upload-status-error';
      statusBar.classList.remove('hidden');
    };

    if (isPDF) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  function renderPreview(transactions, container) {
    container.innerHTML = '';
    const maxShow = Math.min(transactions.length, 20);
    const remaining = transactions.length - maxShow;

    const table = el('div', { className: 'budget-upload-table' }, [
      el('div', { className: 'budget-upload-table-header' }, [
        el('span', { className: 'budget-upload-col-date' }, ['Date']),
        el('span', { className: 'budget-upload-col-desc' }, ['Description']),
        el('span', { className: 'budget-upload-col-amt' }, ['Amount']),
        el('span', { className: 'budget-upload-col-cat' }, ['Category']),
      ]),
    ]);

    for (let i = 0; i < maxShow; i++) {
      const t = transactions[i];
      const amt = parseFloat(t.amount) || 0;
      table.append(el('div', { className: 'budget-upload-table-row' }, [
        el('span', { className: 'budget-upload-col-date' }, [t.date || '\u2014']),
        el('span', { className: 'budget-upload-col-desc' }, [t.description]),
        el('span', { className: `budget-upload-col-amt ${amt >= 0 ? 'budget-amt-positive' : 'budget-amt-negative'}` }, [
          `$${Math.abs(amt).toFixed(2)}`,
        ]),
        el('span', { className: 'budget-upload-col-cat' }, [t.category || '\u2014']),
      ]));
    }

    if (remaining > 0) {
      table.append(el('div', { className: 'budget-upload-table-more' }, [
        `+ ${remaining} more transaction${remaining !== 1 ? 's' : ''}`,
      ]));
    }

    container.append(table);
  }

  /* ---------- Event wiring ---------- */

  // Browse button
  dropZone.querySelector('.budget-upload-browse-btn').addEventListener('click', () => {
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('budget-upload-drop-active');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('budget-upload-drop-active');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('budget-upload-drop-active');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });

  // Import button
  importBtn.addEventListener('click', async () => {
    if (parsedTransactions.length === 0 || !onAddRow) return;
    importBtn.disabled = true;
    importBtn.textContent = 'Importing\u2026';

    try {
      const newRows = parsedTransactions.map(t => {
        const row = new Array(totalColumns).fill('');
        if (cols.text >= 0) row[cols.text] = t.description;
        if (cols.amount >= 0) row[cols.amount] = t.amount;
        if (cols.category >= 0) row[cols.category] = t.category;
        if (cols.date >= 0) row[cols.date] = t.date;
        return row;
      });

      await onAddRow(newRows);
      modal.remove();
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
      importBtn.disabled = false;
      importBtn.textContent = 'Import Transactions';
    }
  });

  // Close handlers
  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('.modal-footer .btn-secondary').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  document.body.append(modal);
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Budget',
  icon: '\uD83D\uDCB0',
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

  render(container, rows, cols, template) {
    /* ---------- Compute totals ---------- */
    let totalIncome = 0, totalExpense = 0;
    for (const row of rows) {
      const amt = parseAmt(cell(row, cols.amount));
      if (amt > 0) totalIncome += amt; else totalExpense += Math.abs(amt);
    }
    const balance = totalIncome - totalExpense;

    /* ---------- Summary bar with upload button ---------- */
    const summaryBar = el('div', { className: 'budget-summary' }, [
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
    ]);
    container.append(summaryBar);

    /* ---------- Upload Statement button ---------- */
    const uploadBtn = el('button', {
      className: 'btn budget-upload-btn',
      type: 'button',
      title: 'Upload a bank or credit card statement',
    }, ['\uD83C\uDFE6 Upload Statement']);

    uploadBtn.addEventListener('click', () => {
      const totalCols = template._totalColumns || 5;
      openUploadModal(cols, totalCols, template._onAddRow);
    });

    container.append(el('div', { className: 'budget-actions' }, [uploadBtn]));

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
          title: `${s.cat}: $${s.spent.toLocaleString()} (${s.pct}%)${s.over ? ' \u2014 OVER BUDGET' : ''}`,
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

  /** Compute aggregate stats from full row data for directory roll-up caching.
   * @param {string[][]} rows — all data rows (no header)
   * @param {Object} cols — column index map
   * @returns {Object} { income, expense, balance, rowCount }
   */
  computeDirStats(rows, cols) {
    let income = 0, expense = 0;
    for (const row of rows) {
      const amt = parseAmt(cell(row, cols.amount));
      if (amt > 0) income += amt; else expense += Math.abs(amt);
    }
    return { income, expense, balance: income - expense, rowCount: rows.length };
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

    /* Compute per-sheet summaries — prefer pre-computed dirStats when available */
    let grandIncome = 0, grandExpense = 0;
    const sheetStats = [];

    for (const sheet of sheets) {
      let income, expense;
      if (sheet.dirStats) {
        income = sheet.dirStats.income;
        expense = sheet.dirStats.expense;
      } else {
        income = 0; expense = 0;
        for (const row of sheet.rows) {
          const amt = parseAmt(cell(row, sheet.cols.amount));
          if (amt > 0) income += amt; else expense += Math.abs(amt);
        }
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
