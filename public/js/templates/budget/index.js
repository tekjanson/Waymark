/* ============================================================
   templates/budget/index.js — Budget: grouped by category,
   subtotals, chart, and statement upload
   ============================================================ */

import { el, cell, editableCell, showToast, delegateEvent, registerTemplate, drawBarChart, drawPieChart, buildDirSyncBtn } from '../shared.js';
import { parseStatement, reParsePDFTransactions, parseQuickAddBudgetEntry } from './parser.js';

/* ---------- Helpers ---------- */

/** Parse a currency / numeric string to a plain number */
function parseAmt(raw) {
  return parseFloat((raw || '0').replace(/[^-\d.]/g, '')) || 0;
}

/** Stable color palette for category chart segments */
const CAT_COLORS = ['#059669','#2563eb','#d97706','#7c3aed','#dc2626','#0891b2','#be185d','#65a30d'];

/** Sample onboarding transactions shown before users add their own data */
const SAMPLE_ROWS = [
  ['Paycheck', '5200', 'Income', '2026-10-01', ''],
  ['Rent', '-1500', 'Housing', '2026-10-01', '1500'],
  ['Groceries', '-420', 'Food', '2026-10-05', '500'],
  ['Home Depot Solar Parts', '-142.50', 'Home', '2026-10-08', '300'],
  ['Internet', '-70', 'Utilities', '2026-10-10', '90'],
  ['Streaming Services', '-32', 'Entertainment', '2026-10-12', '45'],
];

/** Format a number as whole-dollar currency */
function money(value) {
  return `$${Math.round(value).toLocaleString()}`;
}

/** Return YYYY-MM from a row date */
function rowMonth(row, dateCol) {
  const date = cell(row, dateCol);
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : '';
}

/** Compute income and expense totals for a row set */
function computeTotals(rows, cols) {
  let income = 0, expense = 0;
  for (const row of rows) {
    const amt = parseAmt(cell(row, cols.amount));
    if (amt > 0) income += amt; else expense += Math.abs(amt);
  }
  return { income, expense, balance: income - expense };
}

/** Compute month-over-month delta for a metric */
function computeDelta(rows, cols, metric, month) {
  if (cols.date < 0) return 0;
  const byMonth = new Map();
  for (const row of rows) {
    const month = rowMonth(row, cols.date);
    if (!month) continue;
    const amt = parseAmt(cell(row, cols.amount));
    const totals = byMonth.get(month) || { income: 0, expense: 0 };
    if (amt > 0) totals.income += amt; else totals.expense += Math.abs(amt);
    byMonth.set(month, totals);
  }
  const months = [...byMonth.keys()].sort();
  const currentMonth = month || months[months.length - 1];
  const currentIndex = months.indexOf(currentMonth);
  if (currentIndex < 1) return null;
  const current = byMonth.get(months[currentIndex]);
  const previous = byMonth.get(months[currentIndex - 1]);
  const currentValue = metric === 'balance' ? current.income - current.expense : current[metric];
  const previousValue = metric === 'balance' ? previous.income - previous.expense : previous[metric];
  if (!previousValue) return null;
  return Math.round(((currentValue - previousValue) / Math.abs(previousValue)) * 100);
}

/** Build a short month label for the date range switcher */
function monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return 'All dates';
  const [year, monthNum] = month.split('-').map(Number);
  return new Date(year, monthNum - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

/** Return the latest YYYY-MM present in budget rows */
function latestBudgetMonth(rows, cols) {
  const months = rows.map(row => rowMonth(row, cols.date)).filter(Boolean).sort();
  return months[months.length - 1] || '';
}

/** Shift a YYYY-MM month by an offset */
function shiftMonth(month, offset) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return month;
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(year, monthNum - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Return rows visible for the selected budget period */
function filterRowsForPeriod(rows, cols, mode, month) {
  if (mode === 'all' || cols.date < 0) return rows;
  if (mode === 'month') return rows.filter(row => rowMonth(row, cols.date) === month);
  if (mode === 'ytd') {
    const year = (month || latestBudgetMonth(rows, cols)).slice(0, 4);
    return rows.filter(row => rowMonth(row, cols.date).slice(0, 4) === year);
  }
  return rows;
}

/** Group entries while preserving original sheet row indices */
function groupBudgetEntries(entries, cols) {
  const groups = new Map();
  for (const entry of entries) {
    const key = cols.category >= 0 ? (cell(entry.row, cols.category) || 'Uncategorized') : 'Uncategorized';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
}

/** Build a KPI card with an optional real delta badge */
function kpiCard(label, value, className, delta) {
  const children = [
    el('span', { className: 'budget-summary-label' }, [label]),
    el('span', { className: 'budget-summary-value' }, [money(value)]),
  ];
  if (delta !== null) {
    children.push(el('span', { className: 'budget-delta' }, [`${delta >= 0 ? '+' : ''}${delta}% MoM`]));
  }
  return el('div', { className: `budget-summary-item budget-kpi-card ${className}` }, children);
}

/** Recurring payment heuristic used for badges and insights */
function isRecurringTransaction(text, category) {
  return /\b(rent|mortgage|internet|streaming|subscription|membership|gym|insurance|electric|utility)\b/i.test(`${text} ${category}`);
}

/** Split transaction heuristic used for row badges */
function isSplitTransaction(text, category) {
  return /\bsplit\b/i.test(text) || /[/+]/.test(category);
}

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
  let rawPDFTable = null;     // for column mapping re-parse
  let currentPDFMapping = null;

  const fileInput = el('input', {
    className: 'budget-upload-file-input',
    type: 'file',
    accept: '.csv,.ofx,.qfx,.pdf,.txt',
  });

  const dropZone = el('div', { className: 'budget-upload-drop-zone' }, [
    el('div', { className: 'budget-upload-drop-icon' }, ['\uD83D\uDCC4']),
    el('div', { className: 'budget-upload-drop-text' }, ['Drop a statement file here']),
    el('div', { className: 'budget-upload-drop-hint' }, ['CSV, TXT, OFX, QFX, or PDF from your bank']),
    el('button', { className: 'btn btn-secondary budget-upload-browse-btn', type: 'button' }, ['Browse Files']),
  ]);

  const mappingSection = el('div', { className: 'budget-upload-mapping hidden' });
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
        mappingSection,
        previewSection,
      ]),
      el('div', { className: 'modal-footer' }, [
        el('button', { className: 'btn btn-secondary', type: 'button' }, ['Cancel']),
        importBtn,
      ]),
    ]),
  ]);

  /* ---------- Column mapping UI for PDF ---------- */

  const COLUMN_ROLES = [
    { value: 'skip', label: 'Skip' },
    { value: 'date', label: 'Date' },
    { value: 'description', label: 'Description' },
    { value: 'amount', label: 'Amount' },
    { value: 'balance', label: 'Balance' },
  ];

  /**
   * Render the column mapping interface for PDF files.
   * Shows a sample of the parsed table with dropdown column selectors.
   */
  function renderColumnMapping(tableRows, autoMapping) {
    mappingSection.innerHTML = '';
    if (!tableRows.length) return;

    const numCols = tableRows[0].length;
    const previewRows = tableRows.slice(0, 8);

    // Build reverse mapping: colIndex → role
    const colRoles = new Array(numCols).fill('skip');
    if (autoMapping.date >= 0 && autoMapping.date < numCols) colRoles[autoMapping.date] = 'date';
    if (autoMapping.description >= 0 && autoMapping.description < numCols) colRoles[autoMapping.description] = 'description';
    if (autoMapping.amount >= 0 && autoMapping.amount < numCols) colRoles[autoMapping.amount] = 'amount';
    if (autoMapping.balance >= 0 && autoMapping.balance < numCols) colRoles[autoMapping.balance] = 'balance';

    // Warning banner
    const warning = el('div', { className: 'budget-upload-pdf-warning' }, [
      '\u26A0\uFE0F PDF import is experimental. Please verify the column mapping below.',
    ]);

    // Column selector row
    const selectors = [];
    const selectorRow = el('div', { className: 'budget-upload-mapping-header' },
      Array.from({ length: numCols }, (_, i) => {
        const select = el('select', {
          className: 'budget-upload-col-select',
          'data-col': String(i),
        }, COLUMN_ROLES.map(role =>
          el('option', {
            value: role.value,
            ...(role.value === colRoles[i] ? { selected: true } : {}),
          }, [role.label])
        ));
        selectors.push(select);
        return el('div', { className: 'budget-upload-mapping-cell budget-upload-mapping-select' }, [select]);
      })
    );

    // Sample data rows
    const dataRowEls = previewRows.map(row =>
      el('div', { className: 'budget-upload-mapping-row' },
        row.map(cell =>
          el('div', { className: 'budget-upload-mapping-cell' }, [cell || '\u2014'])
        )
      )
    );

    if (previewRows.length < tableRows.length) {
      dataRowEls.push(el('div', { className: 'budget-upload-mapping-more' }, [
        `+ ${tableRows.length - previewRows.length} more rows`,
      ]));
    }

    // Apply mapping button
    const applyBtn = el('button', {
      className: 'btn btn-primary budget-upload-apply-mapping-btn',
      type: 'button',
    }, ['Apply Mapping']);

    applyBtn.addEventListener('click', () => {
      // Read current dropdown values
      const mapping = { date: -1, amount: -1, description: -1, balance: -1 };
      selectors.forEach((sel, i) => {
        const role = sel.value;
        if (role !== 'skip') mapping[role] = i;
      });

      currentPDFMapping = mapping;
      const result = reParsePDFTransactions(rawPDFTable, mapping);
      parsedTransactions = result.transactions;

      if (parsedTransactions.length === 0) {
        statusBar.textContent = 'No transactions matched with this mapping. Try adjusting columns.';
        statusBar.className = 'budget-upload-status budget-upload-status-error';
        statusBar.classList.remove('hidden');
        previewSection.classList.add('hidden');
        importBtn.disabled = true;
        return;
      }

      statusBar.textContent = `Found ${parsedTransactions.length} transaction${parsedTransactions.length !== 1 ? 's' : ''} (PDF format)`;
      statusBar.className = 'budget-upload-status budget-upload-status-success';
      statusBar.classList.remove('hidden');

      renderPreview(parsedTransactions, previewSection);
      previewSection.classList.remove('hidden');
      mappingSection.classList.add('hidden');
      importBtn.disabled = false;
    });

    const mappingTable = el('div', { className: 'budget-upload-mapping-table' }, [
      selectorRow,
      ...dataRowEls,
    ]);

    mappingSection.append(warning, mappingTable, applyBtn);
  }

  /* ---------- File handling ---------- */

  function handleFile(file) {
    if (!file) return;
    const isPDF = file.name.toLowerCase().endsWith('.pdf');

    // Show loading state for PDF
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

        if (isPDF && result.rawTable && result.rawTable.length > 0) {
          // PDF: show column mapping step
          rawPDFTable = result.rawTable;
          currentPDFMapping = result.autoMapping;
          parsedTransactions = result.transactions;

          statusBar.classList.add('hidden');
          dropZone.classList.add('hidden');
          renderColumnMapping(result.rawTable, result.autoMapping);
          mappingSection.classList.remove('hidden');
          previewSection.classList.add('hidden');
          importBtn.disabled = true; // until user confirms mapping
          return;
        }

        // CSV/OFX: direct preview (existing flow)
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
        mappingSection.classList.add('hidden');
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
  defaultHeaders: ['Description', 'Amount', 'Category', 'Date', 'Budget'],

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
    container.innerHTML = '';
    const isPreviewing = Boolean(template._budgetPreviewing);
    const activeRows = isPreviewing ? SAMPLE_ROWS : rows;

    /* ---------- Empty/onboarding actions ---------- */
    const previewBtn = el('button', {
      className: 'btn budget-preview-toggle',
      type: 'button',
    }, ['Preview with Sample Data']);

    previewBtn.addEventListener('click', () => {
      template._budgetPreviewing = true;
      definition.render(container, rows, cols, template);
    });

    const statementCard = el('div', {
      className: 'budget-statement-dropzone budget-upload-btn',
      role: 'button',
      tabindex: '0',
    }, [
      el('div', { className: 'budget-statement-icon' }, ['\uD83C\uDFE6']),
      el('div', { className: 'budget-statement-title' }, ['Upload Statement']),
      el('div', { className: 'budget-statement-hint' }, ['Drop CSV, OFX, TXT, or PDF statements for parsing and auto-categorization']),
    ]);

    const openUpload = () => {
      const totalCols = template._totalColumns || 5;
      openUploadModal(cols, totalCols, template._onAddRow);
    };
    statementCard.addEventListener('click', openUpload);
    statementCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openUpload();
      }
    });

    if (activeRows.length === 0) {
      container.append(el('div', { className: 'budget-empty' }, [
        el('div', { className: 'budget-empty-copy' }, [
          el('strong', {}, ['Start with a statement or a sample budget']),
          el('span', {}, ['Preview the full dashboard instantly, then clear it when you are ready to add your own transactions.']),
        ]),
        el('div', { className: 'budget-empty-actions' }, [previewBtn, statementCard]),
      ]));
      return;
    }

    if (isPreviewing) {
      const clearBtn = el('button', {
        className: 'btn btn-secondary budget-preview-clear',
        type: 'button',
      }, ['Clear & Start Mine']);
      clearBtn.addEventListener('click', () => {
        template._budgetPreviewing = false;
        definition.render(container, rows, cols, template);
      });
      container.append(el('div', { className: 'budget-preview-banner' }, [
        el('span', {}, ['Sample data preview — explore rings, cashflow, and transactions without saving anything.']),
        clearBtn,
      ]));
    }

    /* ---------- Date range filtering ---------- */
    if (!template._budgetPeriodMode) template._budgetPeriodMode = 'all';
    if (!template._budgetPeriodMonth) template._budgetPeriodMonth = latestBudgetMonth(activeRows, cols);
    const selectedMonth = template._budgetPeriodMonth || latestBudgetMonth(activeRows, cols);
    const visibleRows = filterRowsForPeriod(activeRows, cols, template._budgetPeriodMode, selectedMonth);
    const visibleEntries = activeRows
      .map((row, originalIndex) => ({ row, originalIndex }))
      .filter(entry => visibleRows.includes(entry.row));

    const setPeriod = (mode, month = selectedMonth) => {
      template._budgetPeriodMode = mode;
      template._budgetPeriodMonth = month;
      definition.render(container, rows, cols, template);
    };

    /* ---------- Compute totals ---------- */
    const { income: totalIncome, expense: totalExpense, balance } = computeTotals(visibleRows, cols);
    const burnRate = totalIncome > 0 ? Math.min(100, Math.round((totalExpense / totalIncome) * 100)) : 0;
    const savingsRate = totalIncome > 0 ? Math.max(0, Math.round((balance / totalIncome) * 100)) : 0;
    const deltaMonth = template._budgetPeriodMode === 'month' ? selectedMonth : latestBudgetMonth(visibleRows, cols);
    const incomeDelta = computeDelta(activeRows, cols, 'income', deltaMonth);
    const expenseDelta = computeDelta(activeRows, cols, 'expense', deltaMonth);
    const balanceDelta = computeDelta(activeRows, cols, 'balance', deltaMonth);

    /* ---------- KPI strip with date range switcher ---------- */
    const prevBtn = el('button', { className: 'budget-range-btn budget-range-prev', type: 'button' }, ['‹']);
    const nextBtn = el('button', { className: 'budget-range-btn budget-range-next', type: 'button' }, ['›']);
    const ytdBtn = el('button', { className: `budget-range-pill ${template._budgetPeriodMode === 'ytd' ? 'active' : ''}`, type: 'button' }, ['YTD']);
    const allBtn = el('button', { className: `budget-range-pill ${template._budgetPeriodMode === 'all' ? 'active' : ''}`, type: 'button' }, ['All Time']);
    prevBtn.addEventListener('click', () => setPeriod('month', shiftMonth(selectedMonth, -1)));
    nextBtn.addEventListener('click', () => setPeriod('month', shiftMonth(selectedMonth, 1)));
    ytdBtn.addEventListener('click', () => setPeriod('ytd'));
    allBtn.addEventListener('click', () => setPeriod('all'));

    const summaryBar = el('div', { className: 'budget-summary' }, [
      el('div', { className: 'budget-range-switcher' }, [
        prevBtn,
        el('button', { className: `budget-range-month ${template._budgetPeriodMode === 'month' ? 'active' : ''}`, type: 'button', on: { click: () => setPeriod('month') } }, [monthLabel(selectedMonth)]),
        nextBtn,
        ytdBtn,
        allBtn,
      ]),
      kpiCard('Income', totalIncome, 'budget-income', incomeDelta),
      kpiCard('Expenses', totalExpense, 'budget-expense', expenseDelta),
      kpiCard('Balance', balance, balance >= 0 ? 'budget-positive' : 'budget-negative', balanceDelta),
      el('div', { className: 'budget-rate-panel' }, [
        el('div', { className: 'budget-rate-label' }, [`Burn ${burnRate}% · Save ${savingsRate}%`]),
        el('div', { className: 'budget-rate-track' }, [
          el('span', { className: 'budget-rate-fill budget-rate-burn', style: { width: `${burnRate}%` } }),
          el('span', { className: 'budget-rate-fill budget-rate-save', style: { width: `${savingsRate}%` } }),
        ]),
      ]),
    ]);
    container.append(summaryBar);

    if (!isPreviewing) {
      container.append(el('div', { className: 'budget-onboarding-actions' }, [previewBtn, statementCard]));
    }

    /* ---------- Group by category ---------- */
    const groups = groupBudgetEntries(visibleEntries, cols);

    /* ---------- Quick-add and deterministic insight chips ---------- */
    const quickAddInput = el('input', {
      className: 'budget-quick-add-input',
      type: 'text',
      placeholder: 'Quick add: Home Depot $142.50 yesterday #solar',
    });
    quickAddInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const parsed = parseQuickAddBudgetEntry(quickAddInput.value);
      if (!parsed) {
        showToast('Add an amount, merchant, and optional date/tag', 'error');
        return;
      }
      const totalCols = template._totalColumns || 5;
      const row = new Array(totalCols).fill('');
      if (cols.text >= 0) row[cols.text] = parsed.description;
      if (cols.amount >= 0) row[cols.amount] = parsed.amount;
      if (cols.category >= 0) row[cols.category] = parsed.category;
      if (cols.date >= 0) row[cols.date] = parsed.date;
      if (template._onAddRow) await template._onAddRow([row]);
      rows.push(row);
      quickAddInput.value = '';
      showToast('Quick-added transaction', 'success');
      template._budgetPreviewing = false;
      definition.render(container, rows, cols, template);
    });

    const recurringCount = activeRows.filter(row => isRecurringTransaction(cell(row, cols.text), cell(row, cols.category))).length;
    let anomalyText = 'No envelope anomalies';
    for (const [cat, items] of groups) {
      let spent = 0, planned = 0;
      for (const { row } of items) {
        const amt = parseAmt(cell(row, cols.amount));
        if (amt < 0) spent += Math.abs(amt);
        if (cols.budget >= 0) planned += parseAmt(cell(row, cols.budget));
      }
      if (planned > 0 && spent / planned >= 0.85) {
        anomalyText = `${cat} is at ${Math.round((spent / planned) * 100)}% of plan`;
        break;
      }
    }
    const insightChips = [
      el('span', { className: 'budget-insight-chip' }, [`${recurringCount} recurring payments projected`]),
      el('span', { className: 'budget-insight-chip budget-insight-anomaly' }, [anomalyText]),
    ];

    container.append(el('div', { className: 'budget-table-tools' }, [
      quickAddInput,
      el('div', { className: 'budget-insights' }, insightChips),
    ]));

    /* ---------- Category chart (SVG donut pie) ---------- */
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
          const over = budgeted > 0 && spent > budgeted;
          catStats.push({
            label: over ? `${cat} \u26A0` : cat,
            value: spent,
            color: CAT_COLORS[colorIdx % CAT_COLORS.length],
          });
        }
        colorIdx++;
      }
      if (catStats.length > 0) {
        const chartWrap = el('div', { className: 'budget-chart' });
        chartWrap.appendChild(el('div', { className: 'chart-container-title' }, ['Spending by Category']));
        drawPieChart(chartWrap, { segments: catStats }, {
          title: 'Spending by Category',
          showLegend: true,
          donut: true,
          height: 200,
        });
        container.append(chartWrap);
      }
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
      const actualSpent = Math.abs(catSpent);
      const progress = catBudgeted > 0 ? Math.round((actualSpent / catBudgeted) * 100) : 0;
      const envelopeClass = progress > 100 ? 'budget-envelope-red'
        : progress >= 85 ? 'budget-envelope-amber'
          : 'budget-envelope-green';

      container.append(el('div', { className: `budget-category-label ${overBudget ? 'budget-category-over' : ''}` }, [
        el('span', {}, [cat]),
        el('span', { className: 'budget-category-subtotal' }, [subtotalText]),
        catBudgeted > 0 ? el('div', { className: `budget-envelope ${envelopeClass}` }, [
          el('span', { className: 'budget-envelope-label' }, [`Planned vs Actual · ${progress}%`]),
          el('span', { className: 'budget-envelope-track' }, [
            el('span', { className: 'budget-envelope-fill', style: { width: `${Math.min(progress, 120)}%` } }),
          ]),
        ]) : null,
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
        const category = cell(row, cols.category);
        const badges = [];
        if (isRecurringTransaction(text, category)) {
          badges.push(el('span', { className: 'budget-row-badge budget-row-recurring' }, ['Recurring']));
        }
        if (isSplitTransaction(text, category)) {
          badges.push(el('span', { className: 'budget-row-badge budget-row-split' }, ['Split']));
        }

        container.append(el('div', { className: 'budget-row' }, [
          el('div', { className: 'budget-row-info' }, [
            editableCell('span', { className: 'budget-row-text' }, text, rowIdx, cols.text),
            cols.date >= 0 ? editableCell('span', { className: 'budget-row-date' }, date, rowIdx, cols.date) : null,
            badges.length ? el('span', { className: 'budget-row-badges' }, badges) : null,
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
      buildDirSyncBtn(wrapper),
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

    /* Mini SVG charts — income vs expenses per sheet */
    if (sheetStats.length > 1) {
      const names = sheetStats.map(s => s.name);
      const incomeChart = el('div', { className: 'budget-dir-chart-svg' });
      const expenseChart = el('div', { className: 'budget-dir-chart-svg' });
      drawBarChart(incomeChart, {
        labels: names,
        values: sheetStats.map(s => s.income),
        color: '#059669',
      }, { title: 'Income per sheet', showValues: true, height: 160 });
      drawBarChart(expenseChart, {
        labels: names,
        values: sheetStats.map(s => s.expense),
        color: '#dc2626',
      }, { title: 'Expenses per sheet', showValues: true, height: 160 });
      wrapper.append(el('div', { className: 'budget-dir-chart' }, [
        el('div', { className: 'budget-dir-chart-title' }, ['Income vs Expenses']),
        el('div', { className: 'budget-dir-charts-row' }, [incomeChart, expenseChart]),
      ]));
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
