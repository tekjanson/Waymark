/* templates/inventory.js — Inventory: all fields editable inline */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Inventory',
  icon: '📦',
  color: '#f59e0b',
  priority: 15,

  detect(lower) {
    return lower.some(h => /^(quantity|qty|count|stock|amount|price|cost|sku|upc|in.?stock)/.test(h))
      && !lower.some(h => /^(status|done|complete|check|✓|✔)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, quantity: -1, category: -1, extra: -1 };
    cols.text     = lower.findIndex(h => /^(item|name|product|title|description|what)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.quantity = lower.findIndex(h => /^(quantity|qty|count|stock|amount|in.?stock)/.test(h));
    cols.category = lower.findIndex(h => /^(category|type|group|section|aisle|shelf|department)/.test(h));
    cols.extra    = lower.findIndex(h => /^(price|cost|expir|notes?|brand|unit)/.test(h));
    return cols;
  },

  render(container, rows, cols) {
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cat = cols.category >= 0 ? cell(row, cols.category) || 'Other' : 'All Items';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({ row, originalIndex: i });
    }

    for (const [cat, catItems] of groups) {
      container.append(el('div', { className: 'template-inv-category' }, [cat]));

      const grid = el('div', { className: 'template-inv-grid' });
      for (const { row, originalIndex } of catItems) {
        const rowIdx = originalIndex + 1;
        const text  = cell(row, cols.text) || row[0] || '—';
        const qty   = cell(row, cols.quantity);
        const extra = cell(row, cols.extra);

        grid.append(el('div', { className: 'template-inv-card' }, [
          el('div', { className: 'template-inv-card-header' }, [
            editableCell('span', { className: 'template-inv-name' }, text, rowIdx, cols.text),
            cols.quantity >= 0 ? editableCell('span', { className: 'template-inv-qty' }, qty, rowIdx, cols.quantity) : null,
          ]),
          cols.extra >= 0 ? editableCell('div', { className: 'template-inv-extra' }, extra, rowIdx, cols.extra) : null,
        ]));
      }
      container.append(grid);
    }
  },
};

registerTemplate('inventory', definition);
export default definition;
