/* ============================================================
   templates/timesheet.js — Timesheet: editable inline, grouping,
   subtotals, and invoice export
   ============================================================ */

import { el, cell, editableCell, registerTemplate, delegateEvent, buildDirSyncBtn } from './shared.js';

/* --- helpers ------------------------------------------------ */
const BILLABLE_RE = /^(yes|true|1|\u2713|billable)$/i;
function parseHrs(row, cols) { return parseFloat(cell(row, cols.hours)) || 0; }
function parseRate(row, cols) {
  return parseFloat((cell(row, cols.rate) || '0').replace(/[^-\d.]/g, '')) || 0;
}
function isBillable(row, cols) {
  return BILLABLE_RE.test((cell(row, cols.billable) || '').trim());
}
function fmtDollars(n) { return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

const GROUP_MODES = ['none', 'client', 'date', 'project'];

function groupKey(row, cols, mode) {
  if (mode === 'client')  return (cell(row, cols.client) || '').trim() || 'No Client';
  if (mode === 'date')    return (cell(row, cols.date) || '').trim() || 'No Date';
  if (mode === 'project') return (cell(row, cols.text) || row[0] || '').trim() || 'Untitled';
  return '';
}

/* build groups map: label -> [{row, idx}] */
function buildGroups(rows, cols, mode) {
  const map = new Map();
  for (let i = 0; i < rows.length; i++) {
    const key = groupKey(rows[i], cols, mode);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ row: rows[i], idx: i });
  }
  return map;
}

/* subtotals for a list of {row} entries */
function subtotal(entries, cols) {
  let hrs = 0, billHrs = 0, rev = 0;
  for (const { row } of entries) {
    const h = parseHrs(row, cols);
    const r = parseRate(row, cols);
    hrs += h;
    if (isBillable(row, cols)) { billHrs += h; rev += h * r; }
  }
  return { hrs, billHrs, rev };
}

/* --- definition --------------------------------------------- */
const definition = {
  name: 'Timesheet',
  icon: '\u23F1\uFE0F',
  color: '#4338ca',
  priority: 20,
  itemNoun: 'Entry',
  defaultHeaders: ['Project', 'Client', 'Hours', 'Rate', 'Billable', 'Date'],

  detect(lower) {
    return lower.some(h => /^(hours|time.?spent|duration|hrs)/.test(h))
      && lower.some(h => /^(project|client|task|work|activity|description)/.test(h))
      && lower.some(h => /^(billable|rate|client|project)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, hours: -1, client: -1, rate: -1, billable: -1, date: -1 };
    cols.hours    = lower.findIndex(h => /^(hours|time.?spent|duration|hrs)/.test(h));
    cols.client   = lower.findIndex(h => /^(client|customer|account)/.test(h));
    cols.rate     = lower.findIndex(h => /^(rate|hourly|price|\$\/hr)/.test(h));
    cols.billable = lower.findIndex(h => /^(billable|bill|invoiced|chargeable)/.test(h));
    cols.text     = lower.findIndex((h, i) => i !== cols.hours && i !== cols.client && i !== cols.rate && i !== cols.billable && /^(project|task|work|activity|description|name|entry)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.hours && i !== cols.client);
    cols.date     = lower.findIndex(h => /^(date|day|when)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Task',     colIndex: cols.text,     type: 'text',   placeholder: 'Project or task', required: true },
      { role: 'hours',    label: 'Hours',    colIndex: cols.hours,    type: 'number', placeholder: '0', required: true },
      { role: 'client',   label: 'Client',   colIndex: cols.client,   type: 'text',   placeholder: 'Client name' },
      { role: 'rate',     label: 'Rate',     colIndex: cols.rate,     type: 'number', placeholder: 'Hourly rate' },
      { role: 'billable', label: 'Billable', colIndex: cols.billable, type: 'select', options: ['Yes', 'No'], defaultValue: 'Yes' },
      { role: 'date',     label: 'Date',     colIndex: cols.date,     type: 'date',   defaultValue: '__TODAY__' },
    ];
  },

  render(container, rows, cols) {
    let groupMode = 'none';

    /* ---- global summary ----------------------------------- */
    const totals = subtotal(rows.map((row, i) => ({ row, idx: i })), cols);

    container.append(el('div', { className: 'ts-summary' }, [
      el('div', { className: 'ts-summary-item' }, [
        el('span', { className: 'ts-summary-label' }, ['Total Hours']),
        el('span', { className: 'ts-summary-value' }, [totals.hrs.toFixed(1)]),
      ]),
      el('div', { className: 'ts-summary-item' }, [
        el('span', { className: 'ts-summary-label' }, ['Billable']),
        el('span', { className: 'ts-summary-value' }, [totals.billHrs.toFixed(1)]),
      ]),
      el('div', { className: 'ts-summary-item' }, [
        el('span', { className: 'ts-summary-label' }, ['Revenue']),
        el('span', { className: 'ts-summary-value' }, [fmtDollars(totals.rev)]),
      ]),
    ]));

    /* ---- toolbar: group + invoice ------------------------- */
    const toolbar = el('div', { className: 'ts-toolbar' });
    const groupBar = el('div', { className: 'ts-group-bar' }, [
      el('span', { className: 'ts-group-label' }, ['Group by:']),
    ]);
    for (const mode of GROUP_MODES) {
      const label = mode === 'none' ? 'None' : mode.charAt(0).toUpperCase() + mode.slice(1);
      const btn = el('button', {
        className: 'ts-group-btn' + (mode === groupMode ? ' ts-group-active' : ''),
        dataset: { group: mode },
      }, [label]);
      groupBar.append(btn);
    }
    toolbar.append(groupBar);

    const invoiceBtn = el('button', { className: 'ts-invoice-btn' }, ['\uD83D\uDCCB Export Invoice']);
    toolbar.append(invoiceBtn);
    container.append(toolbar);

    /* ---- rows area ---------------------------------------- */
    const rowsWrap = el('div', { className: 'ts-rows' });
    container.append(rowsWrap);

    function renderRow(row, i) {
      const rowIdx = i + 1;
      const text = cell(row, cols.text) || row[0] || '\u2014';
      const hours = cell(row, cols.hours);
      const client = cell(row, cols.client);
      const rate = cell(row, cols.rate);
      const billable = cell(row, cols.billable);
      const date = cell(row, cols.date);
      const bill = isBillable(row, cols);

      return el('div', { className: `ts-row ${bill ? 'ts-billable' : 'ts-nonbillable'}` }, [
        el('div', { className: 'ts-row-info' }, [
          editableCell('span', { className: 'ts-row-text' }, text, rowIdx, cols.text),
          cols.client >= 0 ? editableCell('span', { className: 'ts-row-client' }, client, rowIdx, cols.client) : null,
          cols.date >= 0 ? editableCell('span', { className: 'ts-row-date' }, date, rowIdx, cols.date) : null,
        ]),
        el('div', { className: 'ts-row-right' }, [
          editableCell('span', { className: 'ts-hours' }, hours || '0', rowIdx, cols.hours),
          cols.rate >= 0 ? editableCell('span', { className: 'ts-row-rate' }, rate, rowIdx, cols.rate) : null,
          cols.billable >= 0 ? editableCell('span', { className: `ts-billable-badge ${bill ? 'ts-is-billable' : ''}` }, billable || '\u2014', rowIdx, cols.billable) : null,
        ]),
      ]);
    }

    function rebuildRows() {
      rowsWrap.innerHTML = '';
      if (groupMode === 'none') {
        for (let i = 0; i < rows.length; i++) rowsWrap.append(renderRow(rows[i], i));
        return;
      }
      const groups = buildGroups(rows, cols, groupMode);
      for (const [label, entries] of groups) {
        const sub = subtotal(entries, cols);
        const header = el('div', { className: 'ts-group-header' }, [
          el('span', { className: 'ts-group-title' }, [label]),
          el('span', { className: 'ts-group-stats' }, [
            `${sub.hrs.toFixed(1)}h`,
            sub.billHrs > 0 ? ` \u00B7 ${sub.billHrs.toFixed(1)}h billable` : '',
            sub.rev > 0 ? ` \u00B7 ${fmtDollars(sub.rev)}` : '',
          ]),
        ]);
        rowsWrap.append(header);
        for (const { row, idx } of entries) rowsWrap.append(renderRow(row, idx));
      }
    }
    rebuildRows();

    /* ---- group button clicks ------------------------------ */
    delegateEvent(container, 'click', '.ts-group-btn', (e, btn) => {
      groupMode = btn.dataset.group;
      container.querySelectorAll('.ts-group-btn').forEach(b => b.classList.toggle('ts-group-active', b === btn));
      rebuildRows();
    });

    /* ---- invoice overlay ---------------------------------- */
    invoiceBtn.addEventListener('click', () => {
      /* collect billable entries only */
      const billableEntries = [];
      for (let i = 0; i < rows.length; i++) {
        if (isBillable(rows[i], cols)) billableEntries.push({ row: rows[i], idx: i });
      }

      /* date range */
      const dates = billableEntries
        .map(e => (cell(e.row, cols.date) || '').trim())
        .filter(Boolean)
        .sort();
      const dateRange = dates.length >= 2
        ? `${dates[0]} \u2014 ${dates[dates.length - 1]}`
        : dates[0] || 'N/A';

      /* group by client for invoice lines */
      const byClient = new Map();
      for (const e of billableEntries) {
        const c = (cell(e.row, cols.client) || '').trim() || 'General';
        if (!byClient.has(c)) byClient.set(c, []);
        byClient.get(c).push(e);
      }

      /* build invoice table */
      const tableRows = [];
      let grandTotal = 0;
      for (const [client, entries] of byClient) {
        for (const { row } of entries) {
          const h = parseHrs(row, cols);
          const r = parseRate(row, cols);
          const amt = h * r;
          grandTotal += amt;
          tableRows.push(el('tr', { className: 'ts-inv-row' }, [
            el('td', {}, [cell(row, cols.date) || '']),
            el('td', {}, [client]),
            el('td', {}, [cell(row, cols.text) || row[0] || '']),
            el('td', { className: 'ts-inv-num' }, [h.toFixed(1)]),
            el('td', { className: 'ts-inv-num' }, [fmtDollars(r)]),
            el('td', { className: 'ts-inv-num' }, [fmtDollars(amt)]),
          ]));
        }
      }

      const overlay = el('div', { className: 'ts-invoice-overlay' }, [
        el('div', { className: 'ts-invoice-sheet' }, [
          el('div', { className: 'ts-inv-header' }, [
            el('h2', { className: 'ts-inv-title' }, ['Invoice']),
            el('div', { className: 'ts-inv-meta' }, [
              el('span', {}, [`Period: ${dateRange}`]),
              el('span', {}, [`Entries: ${billableEntries.length}`]),
            ]),
          ]),
          el('table', { className: 'ts-inv-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', {}, ['Date']),
                el('th', {}, ['Client']),
                el('th', {}, ['Description']),
                el('th', { className: 'ts-inv-num' }, ['Hours']),
                el('th', { className: 'ts-inv-num' }, ['Rate']),
                el('th', { className: 'ts-inv-num' }, ['Amount']),
              ]),
            ]),
            el('tbody', {}, tableRows),
            el('tfoot', {}, [
              el('tr', { className: 'ts-inv-total' }, [
                el('td', { colSpan: '3' }, ['Total']),
                el('td', { className: 'ts-inv-num' }, [totals.billHrs.toFixed(1)]),
                el('td', {}, ['']),
                el('td', { className: 'ts-inv-num' }, [fmtDollars(grandTotal)]),
              ]),
            ]),
          ]),
          el('div', { className: 'ts-inv-actions' }, [
            el('button', { className: 'ts-inv-print-btn', id: 'ts-inv-print' }, ['\uD83D\uDDA8\uFE0F Print / Save PDF']),
            el('button', { className: 'ts-inv-close-btn', id: 'ts-inv-close' }, ['Close']),
          ]),
        ]),
      ]);

      document.body.append(overlay);
      document.getElementById('ts-inv-print').addEventListener('click', () => window.print());
      document.getElementById('ts-inv-close').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    });
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'timesheet-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'timesheet-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'timesheet-dir-icon tmpl-dir-icon' }, ['\u23F1\uFE0F']),
      el('span', { className: 'timesheet-dir-title tmpl-dir-title' }, ['Timesheets']),
      el('span', { className: 'timesheet-dir-count tmpl-dir-count' }, [
        `${sheets.length} timesheet${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'timesheet-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      const cols = sheet.cols || {};
      let totalHrs = 0;
      for (const row of rows) totalHrs += parseFloat(cell(row, cols.hours)) || 0;

      grid.append(el('div', {
        className: 'timesheet-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'timesheet-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'timesheet-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'} \u2022 ${totalHrs.toFixed(1)} hrs`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.timesheet-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('timesheet', definition);
export default definition;
