/* ============================================================
   templates/passwords.js — Password Manager: encrypted vault
   with inline editing, category grouping, and search
   ============================================================ */

import { el, cell, editableCell, delegateEvent, registerTemplate } from './shared.js';

/* ---------- Copy to clipboard helper ---------- */

function copyToClip(text, label) {
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => {});
}

const definition = {
  name: 'Password Manager',
  icon: '🔑',
  color: '#7c3aed',
  priority: 22,
  itemNoun: 'Entry',
  defaultHeaders: ['Site', 'Username', 'Password', 'URL', 'Category', 'Notes'],

  detect(lower) {
    return lower.some(h => /^(password|passwd|secret|credential)/.test(h))
      && lower.some(h => /^(site|service|website|domain|app|account|login|user.?name)/.test(h));
  },

  columns(lower) {
    const cols = { site: -1, username: -1, password: -1, url: -1, category: -1, notes: -1 };
    cols.site     = lower.findIndex(h => /^(site|service|website|domain|app|account|platform)/.test(h));
    cols.username = lower.findIndex((h, i) => /^(user.?name|login|email|user|id)/.test(h) && i !== cols.site);
    cols.password = lower.findIndex(h => /^(password|passwd|secret|credential|pass)/.test(h));
    cols.url      = lower.findIndex((h, i) => /^(url|link|address|href|web)/.test(h) && i !== cols.site && i !== cols.username);
    cols.category = lower.findIndex((h, i) => /^(category|type|group|folder|tag)/.test(h) && i !== cols.site);
    cols.notes    = lower.findIndex((h, i) => /^(notes?|comment|detail|info|description)/.test(h) && i !== cols.site && i !== cols.password);
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'site',     label: 'Site',     colIndex: cols.site,     type: 'text', placeholder: 'e.g. GitHub', required: true },
      { role: 'username', label: 'Username', colIndex: cols.username, type: 'text', placeholder: 'Username or email' },
      { role: 'password', label: 'Password', colIndex: cols.password, type: 'text', placeholder: 'Password' },
      { role: 'url',      label: 'URL',      colIndex: cols.url,      type: 'text', placeholder: 'https://...' },
      { role: 'category', label: 'Category', colIndex: cols.category, type: 'text', placeholder: 'e.g. Work, Personal' },
      { role: 'notes',    label: 'Notes',    colIndex: cols.notes,    type: 'text', placeholder: 'Optional notes' },
    ];
  },

  render(container, rows, cols) {
    /* ---------- Group by category ---------- */
    const groups = new Map(); // category → [{row, rowIdx}]
    const uncategorized = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cat = (cols.category >= 0 ? cell(row, cols.category) : '').trim() || '';
      const entry = { row, rowIdx: i + 1 };
      if (cat) {
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(entry);
      } else {
        uncategorized.push(entry);
      }
    }

    /* ---------- Search bar ---------- */
    const searchInput = el('input', {
      className: 'passwords-search',
      type: 'text',
      placeholder: '🔍 Search passwords…',
    });
    container.append(el('div', { className: 'passwords-toolbar' }, [searchInput]));

    /* ---------- Stats bar ---------- */
    const total = rows.length;
    container.append(el('div', { className: 'passwords-stats' }, [
      el('span', {}, [`${total} ${total === 1 ? 'entry' : 'entries'}`]),
      el('span', { className: 'passwords-stats-hint' }, ['🔐 Enable column encryption from the ⋮ menu to protect sensitive data']),
    ]));

    /* ---------- Vault grid ---------- */
    const grid = el('div', { className: 'passwords-grid' });
    container.append(grid);

    function renderGroup(name, entries) {
      if (name) {
        grid.append(el('div', { className: 'passwords-category-header' }, [
          el('span', { className: 'passwords-category-name' }, [name]),
          el('span', { className: 'passwords-category-count' }, [`${entries.length}`]),
        ]));
      }
      for (const { row, rowIdx } of entries) {
        grid.append(buildCard(row, rowIdx, cols));
      }
    }

    // Render categorized groups first, sorted alphabetically
    const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, entries] of sortedGroups) {
      renderGroup(name, entries);
    }
    // Then uncategorized
    if (uncategorized.length) {
      renderGroup(groups.size > 0 ? 'Uncategorized' : '', uncategorized);
    }

    /* ---------- Search filter ---------- */
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const cards = grid.querySelectorAll('.passwords-card');
      const headers = grid.querySelectorAll('.passwords-category-header');

      for (const card of cards) {
        const text = card.textContent.toLowerCase();
        card.classList.toggle('hidden', q && !text.includes(q));
      }

      // Hide category headers if all their cards are hidden
      for (const header of headers) {
        let next = header.nextElementSibling;
        let anyVisible = false;
        while (next && !next.classList.contains('passwords-category-header')) {
          if (next.classList.contains('passwords-card') && !next.classList.contains('hidden')) {
            anyVisible = true;
          }
          next = next.nextElementSibling;
        }
        header.classList.toggle('hidden', q && !anyVisible);
      }
    });

    /* ---------- Delegated copy buttons ---------- */
    delegateEvent(grid, 'click', '.passwords-copy-btn', (e, btn) => {
      const field = btn.dataset.field;
      const rIdx = Number(btn.dataset.rowIdx);
      const entry = rows[rIdx - 1];
      if (!entry) return;
      let val = '';
      if (field === 'username' && cols.username >= 0) val = cell(entry, cols.username);
      if (field === 'password' && cols.password >= 0) val = cell(entry, cols.password);
      if (field === 'url' && cols.url >= 0) val = cell(entry, cols.url);
      if (val) {
        copyToClip(val, field);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '📋'; }, 1200);
      }
    });
  },
};

/**
 * Build a single password entry card.
 * @param {string[]} row
 * @param {number} rowIdx — 1-based
 * @param {Object} cols
 * @returns {HTMLElement}
 */
function buildCard(row, rowIdx, cols) {
  const site     = cell(row, cols.site) || row[0] || '—';
  const username = cell(row, cols.username);
  const password = cell(row, cols.password);
  const url      = cell(row, cols.url);
  const notes    = cell(row, cols.notes);

  // Determine if password looks encrypted (still ciphertext)
  const isEnc = password.startsWith('\u{1F512}ENC:');
  const maskedPw = isEnc ? '🔒 Encrypted' : (password ? '••••••••' : '—');

  const card = el('div', { className: 'passwords-card' }, [
    el('div', { className: 'passwords-card-header' }, [
      el('span', { className: 'passwords-card-icon' }, [site[0]?.toUpperCase() || '?']),
      el('div', { className: 'passwords-card-title-group' }, [
        editableCell('div', { className: 'passwords-card-site' }, site, rowIdx, cols.site),
        url ? el('a', {
          className: 'passwords-card-url',
          href: url.startsWith('http') ? url : `https://${url}`,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [url.replace(/^https?:\/\/(www\.)?/, '')]) : null,
      ]),
    ]),
    el('div', { className: 'passwords-card-fields' }, [
      cols.username >= 0 ? el('div', { className: 'passwords-field' }, [
        el('span', { className: 'passwords-field-label' }, ['Username']),
        el('div', { className: 'passwords-field-value-row' }, [
          editableCell('span', { className: 'passwords-field-value' }, username, rowIdx, cols.username),
          el('button', {
            className: 'passwords-copy-btn',
            type: 'button',
            dataset: { field: 'username', rowIdx: String(rowIdx) },
            title: 'Copy username',
          }, ['📋']),
        ]),
      ]) : null,
      cols.password >= 0 ? el('div', { className: 'passwords-field' }, [
        el('span', { className: 'passwords-field-label' }, ['Password']),
        el('div', { className: 'passwords-field-value-row' }, [
          isEnc
            ? el('span', { className: 'passwords-field-value encrypted-cell' }, ['Encrypted'])
            : editableCell('span', { className: 'passwords-field-value passwords-field-pw' }, password, rowIdx, cols.password),
          el('button', {
            className: 'passwords-copy-btn',
            type: 'button',
            dataset: { field: 'password', rowIdx: String(rowIdx) },
            title: 'Copy password',
          }, ['📋']),
        ]),
      ]) : null,
    ]),
    cols.notes >= 0 && notes ? editableCell('div', { className: 'passwords-card-notes' }, notes, rowIdx, cols.notes) : null,
  ]);

  return card;
}

registerTemplate('passwords', definition);
export default definition;
