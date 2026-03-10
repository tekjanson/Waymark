/* ============================================================
   templates/contacts.js — Contacts: all fields editable inline
   ============================================================ */

import { el, cell, editableCell, delegateEvent, registerTemplate } from './shared.js';

const definition = {
  name: 'Contacts',
  icon: '📇',
  color: '#ec4899',
  priority: 15,
  itemNoun: 'Contact',

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

  addRowFields(cols) {
    return [
      { role: 'name',  label: 'Name',  colIndex: cols.name,  type: 'text', placeholder: 'Full name', required: true },
      { role: 'email', label: 'Email', colIndex: cols.email, type: 'text', placeholder: 'email@example.com' },
      { role: 'phone', label: 'Phone', colIndex: cols.phone, type: 'text', placeholder: '(555) 000-0000' },
      { role: 'role',  label: 'Role',  colIndex: cols.role,  type: 'text', placeholder: 'Title or relationship' },
    ];
  },

  render(container, rows, cols) {
    /* ---------- Sort contacts alphabetically ---------- */
    const indexed = rows.map((row, i) => ({ row, rowIdx: i + 1 }));
    indexed.sort((a, b) => {
      const na = (cell(a.row, cols.name) || a.row[0] || '').toLowerCase();
      const nb = (cell(b.row, cols.name) || b.row[0] || '').toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });

    /* ---------- Collect available letters ---------- */
    const letters = new Set();
    for (const { row } of indexed) {
      const ch = (cell(row, cols.name) || row[0] || '?')[0].toUpperCase();
      if (/[A-Z]/.test(ch)) letters.add(ch);
      else letters.add('#');
    }

    /* ---------- Search bar ---------- */
    const searchInput = el('input', {
      className: 'contacts-search',
      type: 'text',
      placeholder: '\uD83D\uDD0D Search contacts\u2026',
    });
    container.append(el('div', { className: 'contacts-toolbar' }, [searchInput]));

    /* ---------- Layout: sidebar + grid ---------- */
    const sidebar = el('div', { className: 'contacts-alpha-sidebar' });
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
    for (const ch of alpha) {
      sidebar.append(el('button', {
        className: 'contacts-alpha-btn' + (letters.has(ch) ? '' : ' contacts-alpha-disabled'),
        dataset: { letter: ch },
        type: 'button',
      }, [ch]));
    }

    const grid = el('div', { className: 'template-contacts-grid' });
    const layout = el('div', { className: 'contacts-layout' }, [sidebar, grid]);
    container.append(layout);

    /* ---------- Render contact cards grouped by letter ---------- */
    let currentLetter = '';
    for (const { row, rowIdx } of indexed) {
      const name  = cell(row, cols.name) || row[0] || '\u2014';
      const email = cell(row, cols.email);
      const phone = cell(row, cols.phone);
      const role  = cell(row, cols.role);
      const ch = (name[0] || '?').toUpperCase();
      const letter = /[A-Z]/.test(ch) ? ch : '#';

      if (letter !== currentLetter) {
        grid.append(el('div', {
          className: 'contacts-letter-header',
          id: `contacts-letter-${letter}`,
        }, [letter]));
        currentLetter = letter;
      }

      grid.append(el('div', { className: 'template-contact-card', dataset: { letter } }, [
        editableCell('div', { className: 'template-contact-name' }, name, rowIdx, cols.name),
        cols.role >= 0 ? editableCell('div', { className: 'template-contact-role' }, role, rowIdx, cols.role) : null,
        el('div', { className: 'template-contact-details' }, [
          cols.phone >= 0 ? editableCell('span', { className: 'template-contact-link' }, phone, rowIdx, cols.phone) : null,
          cols.email >= 0 ? editableCell('span', { className: 'template-contact-link' }, email, rowIdx, cols.email) : null,
        ]),
      ]));
    }

    /* ---------- Alphabetical jump (delegated) ---------- */
    delegateEvent(sidebar, 'click', '.contacts-alpha-btn', (e, btn) => {
      if (btn.classList.contains('contacts-alpha-disabled')) return;
      const target = document.getElementById(`contacts-letter-${btn.dataset.letter}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    /* ---------- Search filter ---------- */
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const headers = grid.querySelectorAll('.contacts-letter-header');
      const cards = grid.querySelectorAll('.template-contact-card');

      for (const card of cards) {
        const text = card.textContent.toLowerCase();
        card.style.display = q && !text.includes(q) ? 'none' : '';
      }

      /* Hide letter headers with no visible cards */
      for (const hdr of headers) {
        const letter = hdr.textContent;
        let hasVisible = false;
        let next = hdr.nextElementSibling;
        while (next && !next.classList.contains('contacts-letter-header')) {
          if (next.style.display !== 'none') hasVisible = true;
          next = next.nextElementSibling;
        }
        hdr.style.display = q && !hasVisible ? 'none' : '';
      }
    });
  },
};

registerTemplate('contacts', definition);
export default definition;
