/* ============================================================
   templates/inventory.js \u2014 Inventory: low-stock alerts + reorder
   ============================================================ */

import { el, cell, editableCell, groupByColumn, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

const DEFAULT_THRESHOLD = 3;

/** Extract leading numeric value from a quantity string like "5 lbs" */
function parseQty(str) {
  if (!str) return 0;
  const m = str.match(/^[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, '')) : 0;
}

const definition = {
  name: 'Inventory',
  icon: '\uD83D\uDCE6',
  color: '#f59e0b',
  priority: 15,
  itemNoun: 'Item',
  defaultHeaders: ['Item', 'Quantity', 'Category', 'Location'],

  detect(lower) {
    return lower.some(h => /^(quantity|qty|count|stock|amount|price|cost|sku|upc|in.?stock)/.test(h))
      && !lower.some(h => /^(status|done|complete|check|\u2713|\u2714)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, quantity: -1, category: -1, extra: -1, threshold: -1 };
    cols.text      = lower.findIndex(h => /^(item|name|product|title|description|what)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.quantity  = lower.findIndex(h => /^(quantity|qty|count|stock|amount|in.?stock)/.test(h));
    cols.category  = lower.findIndex(h => /^(category|type|group|section|aisle|shelf|department)/.test(h));
    cols.extra     = lower.findIndex(h => /^(price|cost|expir|notes?|brand|unit)/.test(h));
    cols.threshold = lower.findIndex(h => /^(threshold|min|minimum|reorder|low)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Item',     colIndex: cols.text,     type: 'text', placeholder: 'Item name', required: true },
      { role: 'quantity', label: 'Quantity',  colIndex: cols.quantity, type: 'text', placeholder: '1' },
      { role: 'category', label: 'Category',  colIndex: cols.category, type: 'text', placeholder: 'Category' },
      { role: 'extra',    label: 'Details',   colIndex: cols.extra,    type: 'text', placeholder: 'Price, notes, etc.' },
    ];
  },

  render(container, rows, cols) {
    /* --- classify items and collect stats --- */
    const lowItems = [];
    const okItems = [];
    let totalItems = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const qty = parseQty(cell(row, cols.quantity));
      const thresh = cols.threshold >= 0 ? parseQty(cell(row, cols.threshold)) : DEFAULT_THRESHOLD;
      const isLow = qty > 0 && qty < thresh;
      totalItems++;
      if (isLow) {
        lowItems.push({ row, originalIndex: i });
      } else {
        okItems.push({ row, originalIndex: i });
      }
    }

    /* --- summary bar --- */
    const summary = el('div', { className: 'inv-summary' }, [
      el('span', { className: 'inv-summary-item' }, [`\uD83D\uDCE6 ${totalItems} items`]),
      el('span', { className: 'inv-summary-item inv-summary-low' }, [`\u26A0\uFE0F ${lowItems.length} low stock`]),
    ]);
    container.append(summary);

    /* --- low-stock reorder section (at top) --- */
    if (lowItems.length > 0) {
      container.append(el('div', { className: 'inv-reorder-header' }, ['\u26A0 Reorder Needed']));
      const reorderGrid = el('div', { className: 'template-inv-grid' });
      for (const { row, originalIndex } of lowItems) {
        reorderGrid.append(buildCard(row, originalIndex, cols, true));
      }
      container.append(reorderGrid);
    }

    /* --- remaining items by category --- */
    const groups = groupByColumn(okItems.map(({ row, originalIndex }) => {
      return { row, originalIndex };
    }), -1, 'All Items');

    // Regroup ok items by category
    const catMap = new Map();
    for (const { row, originalIndex } of okItems) {
      const cat = cell(row, cols.category) || 'All Items';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat).push({ row, originalIndex });
    }

    for (const [cat, catItems] of catMap) {
      container.append(el('div', { className: 'template-inv-category' }, [cat]));
      const grid = el('div', { className: 'template-inv-grid' });
      for (const { row, originalIndex } of catItems) {
        grid.append(buildCard(row, originalIndex, cols, false));
      }
      container.append(grid);
    }
  },
};

/** Build a single inventory card */
function buildCard(row, originalIndex, cols, isLow) {
  const rowIdx = originalIndex + 1;
  const text  = cell(row, cols.text) || row[0] || '\u2014';
  const qty   = cell(row, cols.quantity);
  const extra = cell(row, cols.extra);

  return el('div', { className: 'template-inv-card' + (isLow ? ' inv-low-stock' : '') }, [
    el('div', { className: 'template-inv-card-header' }, [
      editableCell('span', { className: 'template-inv-name' }, text, rowIdx, cols.text),
      cols.quantity >= 0 ? editableCell('span', { className: 'template-inv-qty' + (isLow ? ' inv-qty-low' : '') }, qty, rowIdx, cols.quantity) : null,
    ]),
    cols.extra >= 0 ? editableCell('div', { className: 'template-inv-extra' }, extra, rowIdx, cols.extra) : null,
    isLow ? el('span', { className: 'inv-low-badge' }, ['\u26A0 Low']) : null,
  ]);
}

registerTemplate('inventory', definition);
export default definition;
