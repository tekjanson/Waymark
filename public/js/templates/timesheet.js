/* templates/timesheet.js — Timesheet: all fields editable inline, shows totals */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Timesheet',
  icon: '⏱️',
  color: '#4338ca',
  priority: 20,

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

  render(container, rows, cols) {
    // Summary
    let totalHours = 0, billableHours = 0, totalBillable = 0;
    for (const row of rows) {
      const hrs = parseFloat(cell(row, cols.hours)) || 0;
      const rate = parseFloat((cell(row, cols.rate) || '0').replace(/[^-\d.]/g, '')) || 0;
      const isBillable = /^(yes|true|1|✓|billable)$/i.test((cell(row, cols.billable) || '').trim());
      totalHours += hrs;
      if (isBillable) { billableHours += hrs; totalBillable += hrs * rate; }
    }

    container.append(el('div', { className: 'ts-summary' }, [
      el('div', { className: 'ts-summary-item' }, [
        el('span', { className: 'ts-summary-label' }, ['Total Hours']),
        el('span', { className: 'ts-summary-value' }, [totalHours.toFixed(1)]),
      ]),
      el('div', { className: 'ts-summary-item' }, [
        el('span', { className: 'ts-summary-label' }, ['Billable']),
        el('span', { className: 'ts-summary-value' }, [billableHours.toFixed(1)]),
      ]),
      el('div', { className: 'ts-summary-item' }, [
        el('span', { className: 'ts-summary-label' }, ['Revenue']),
        el('span', { className: 'ts-summary-value' }, [`$${totalBillable.toLocaleString()}`]),
      ]),
    ]));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const text = cell(row, cols.text) || row[0] || '—';
      const hours = cell(row, cols.hours);
      const client = cell(row, cols.client);
      const rate = cell(row, cols.rate);
      const billable = cell(row, cols.billable);
      const date = cell(row, cols.date);
      const isBillable = /^(yes|true|1|✓|billable)$/i.test((billable || '').trim());

      container.append(el('div', { className: `ts-row ${isBillable ? 'ts-billable' : 'ts-nonbillable'}` }, [
        el('div', { className: 'ts-row-info' }, [
          editableCell('span', { className: 'ts-row-text' }, text, rowIdx, cols.text),
          cols.client >= 0 ? editableCell('span', { className: 'ts-row-client' }, client, rowIdx, cols.client) : null,
          cols.date >= 0 ? editableCell('span', { className: 'ts-row-date' }, date, rowIdx, cols.date) : null,
        ]),
        el('div', { className: 'ts-row-right' }, [
          editableCell('span', { className: 'ts-hours' }, hours || '0', rowIdx, cols.hours),
          cols.rate >= 0 ? editableCell('span', { className: 'ts-row-rate' }, rate, rowIdx, cols.rate) : null,
          cols.billable >= 0 ? editableCell('span', { className: `ts-billable-badge ${isBillable ? 'ts-is-billable' : ''}` }, billable || '—', rowIdx, cols.billable) : null,
        ]),
      ]));
    }
  },
};

registerTemplate('timesheet', definition);
export default definition;
