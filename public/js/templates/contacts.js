/* ============================================================
   templates/contacts.js — Contacts: all fields editable inline
   ============================================================ */

import { el, cell, editableCell, delegateEvent, registerTemplate, buildDirSyncBtn } from './shared.js';

/**
 * Resolve a Share_Data_Sheet cell value to a Waymark internal link.
 * Accepts a raw sheet ID, a Waymark hash route, or a Google Sheets URL.
 * @param {string} raw
 * @returns {string|null}
 */
function resolveShareLink(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  const base = (typeof window !== 'undefined' && window.__WAYMARK_BASE) || '';
  const hash = v.match(/#\/(?:sheet|public)\/([a-zA-Z0-9_-]{3,60})/);
  if (hash) return `${base}/#/sheet/${hash[1]}`;
  const gurl = v.match(/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  if (gurl) return `${base}/#/sheet/${gurl[1]}`;
  if (/^(sheet-\d+|[a-zA-Z0-9_-]{10,})$/.test(v)) return `${base}/#/sheet/${v}`;
  return null;
}

const definition = {
  name: 'Contacts',
  icon: '📇',
  color: '#ec4899',
  priority: 15,
  itemNoun: 'Contact',
  defaultHeaders: ['Name', 'Phone', 'Email', 'Role', 'Group', 'Share_Data_Sheet', 'Social_Data_Location'],

  detect(lower) {
    return lower.some(h => /^(email|phone|mobile|cell|telephone)/.test(h))
      && lower.some(h => /^(name|contact|person|who|first|last)/.test(h));
  },

  columns(lower) {
    const cols = { name: -1, email: -1, phone: -1, role: -1, group: -1, shareSheet: -1, socialLocation: -1 };
    cols.name  = lower.findIndex(h => /^(name|contact|person|who|first)/.test(h));
    if (cols.name === -1) cols.name = 0;
    cols.email = lower.findIndex(h => /^(email|e-mail)/.test(h));
    cols.phone = lower.findIndex(h => /^(phone|mobile|cell|telephone|tel)/.test(h));
    cols.group = lower.findIndex(h => /^(group|crew|wayfarer|contact.?group)/.test(h));
    cols.shareSheet = lower.findIndex(h => /^(share.?data.?sheet|share.?sheet|share.?ledger|share_sheet|share.?id)/.test(h));
    cols.socialLocation = lower.findIndex(h => /^(social.?data|social.?channel|social.?location)/.test(h));
    cols.role  = lower.findIndex((h, i) => i !== cols.group && /^(role|title|relationship|department|company|org|type)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'name',  label: 'Name',  colIndex: cols.name,  type: 'text', placeholder: 'Full name', required: true },
      { role: 'email', label: 'Email', colIndex: cols.email, type: 'text', placeholder: 'email@example.com' },
      { role: 'phone', label: 'Phone', colIndex: cols.phone, type: 'text', placeholder: '(555) 000-0000' },
      { role: 'role',  label: 'Role',  colIndex: cols.role,  type: 'text', placeholder: 'Title or relationship' },
      { role: 'group', label: 'Group', colIndex: cols.group, type: 'text', placeholder: 'Wayfarer Crew (e.g. Family)' },
      { role: 'shareSheet', label: 'Share Sheet', colIndex: cols.shareSheet, type: 'text', placeholder: 'Auto-provisioned on first share' },
      { role: 'socialLocation', label: 'Social Channel', colIndex: cols.socialLocation, type: 'text', placeholder: 'Auto-linked presence/chat location' },
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
      const group = cell(row, cols.group);
      const shareRef = cell(row, cols.shareSheet);
      const ch = (name[0] || '?').toUpperCase();
      const letter = /[A-Z]/.test(ch) ? ch : '#';

      if (letter !== currentLetter) {
        grid.append(el('div', {
          className: 'contacts-letter-header',
          id: `contacts-letter-${letter}`,
        }, [letter]));
        currentLetter = letter;
      }

      const shareLink = resolveShareLink(shareRef);
      const cardChildren = [
        editableCell('div', { className: 'template-contact-name' }, name, rowIdx, cols.name),
        cols.role >= 0 ? editableCell('div', { className: 'template-contact-role' }, role, rowIdx, cols.role) : null,
        el('div', { className: 'template-contact-details' }, [
          cols.phone >= 0 ? editableCell('span', { className: 'template-contact-link' }, phone, rowIdx, cols.phone) : null,
          cols.email >= 0 ? editableCell('span', { className: 'template-contact-link' }, email, rowIdx, cols.email) : null,
        ]),
        el('div', { className: 'contacts-card-chips' }, [
          (cols.group >= 0 && group) ? el('span', { className: 'contacts-group-chip' }, [`\uD83E\uDDED ${group}`]) : null,
          shareLink
            ? el('a', { className: 'contacts-share-chip', href: shareLink, title: 'Open the share ledger sheet' }, ['\uD83D\uDD17 Share Sheet \u2197'])
            : null,
        ]),
      ];

      grid.append(el('div', { className: 'template-contact-card', dataset: { letter } }, cardChildren));
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

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'contacts-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'contacts-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'contacts-dir-icon tmpl-dir-icon' }, ['\uD83D\uDCC7']),
      el('span', { className: 'contacts-dir-title tmpl-dir-title' }, ['Contact Books']),
      el('span', { className: 'contacts-dir-count tmpl-dir-count' }, [
        `${sheets.length} book${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'contacts-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'contacts-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'contacts-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'contacts-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} contact${rows.length !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.contacts-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('contacts', definition);
export default definition;
