/* templates/contacts.js — Contacts: all fields editable inline */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Contacts',
  icon: '📇',
  color: '#ec4899',
  priority: 15,

  detect(lower) {
    return lower.some(h => /^(email|phone|mobile|cell|telephone)/.test(h))
      && lower.some(h => /^(name|contact|person|who|first|last)/.test(h));
  },

  columns(lower) {
    const cols = { name: -1, email: -1, phone: -1, role: -1 };
    cols.name  = lower.findIndex(h => /^(name|contact|person|who|first)/.test(h));
    if (cols.name === -1) cols.name = 0;
    cols.email = lower.findIndex(h => /^(email|e-mail)/.test(h));
    cols.phone = lower.findIndex(h => /^(phone|mobile|cell|telephone|tel)/.test(h));
    cols.role  = lower.findIndex(h => /^(role|title|relationship|department|company|org|group|type)/.test(h));
    return cols;
  },

  render(container, rows, cols) {
    const grid = el('div', { className: 'template-contacts-grid' });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const name  = cell(row, cols.name) || row[0] || '—';
      const email = cell(row, cols.email);
      const phone = cell(row, cols.phone);
      const role  = cell(row, cols.role);

      grid.append(el('div', { className: 'template-contact-card' }, [
        editableCell('div', { className: 'template-contact-name' }, name, rowIdx, cols.name),
        cols.role >= 0 ? editableCell('div', { className: 'template-contact-role' }, role, rowIdx, cols.role) : null,
        el('div', { className: 'template-contact-details' }, [
          cols.phone >= 0 ? editableCell('span', { className: 'template-contact-link' }, phone, rowIdx, cols.phone) : null,
          cols.email >= 0 ? editableCell('span', { className: 'template-contact-link' }, email, rowIdx, cols.email) : null,
        ]),
      ]));
    }

    container.append(grid);
  },
};

registerTemplate('contacts', definition);
export default definition;
