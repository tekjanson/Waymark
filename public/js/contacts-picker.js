/* ============================================================
   contacts-picker.js — Populate a share dialog from the user's
   Contacts Waymark sheets. Discovers contacts books from recently
   opened + pinned sheets, reads them, and exposes a dropdown +
   autocomplete that fills a collaborator email field.
   ============================================================ */

import { el } from './ui.js';
import { api } from './api-client.js';
import * as userData from './user-data.js';
import { TEMPLATES } from './templates/index.js';

/**
 * Discover unique contacts across the user's Contacts Waymark sheets.
 * Contacts books are detected cheaply from recently opened + pinned sheets
 * (templateKey === 'contacts'); each is read once and deduped by email.
 * @returns {Promise<Array<{ name: string, email: string, book: string }>>}
 */
export async function discoverContacts() {
  const pool = [...userData.getPinnedSheets(), ...userData.getRecentSheets()];
  const books = [];
  const seenBook = new Set();
  for (const s of pool) {
    if (!s || s.templateKey !== 'contacts' || seenBook.has(s.id)) continue;
    seenBook.add(s.id);
    books.push(s);
  }

  const contacts = [];
  const seenEmail = new Set();
  for (const book of books) {
    try {
      const data = await api.sheets.getSpreadsheet(book.id);
      const tab = (data.tabs && data.tabs[0]) || null;
      const values = (tab && tab.values) || data.values || [];
      if (values.length < 2) continue;
      const lower = (values[0] || []).map(h => (h || '').toLowerCase().trim());
      const cols = TEMPLATES.contacts.columns(lower);
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const email = (cols.email >= 0 ? row[cols.email] : '') || '';
        const name = (cols.name >= 0 ? row[cols.name] : '') || '';
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) continue;
        const key = email.trim().toLowerCase();
        if (seenEmail.has(key)) continue;
        seenEmail.add(key);
        contacts.push({ name: name.trim(), email: email.trim(), book: book.name || 'Contacts' });
      }
    } catch {
      /* skip unreadable book */
    }
  }

  contacts.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  return contacts;
}

/**
 * Build and mount a contacts picker (dropdown + autocomplete datalist) into a
 * container, wiring selection to fill the given email input. Hides the
 * container when the user has no contacts, so manual entry is always possible.
 * @param {HTMLElement} container
 * @param {HTMLInputElement} emailInput
 * @returns {Promise<number>}  number of contacts loaded
 */
export async function mountContactsPicker(container, emailInput) {
  if (!container || !emailInput) return 0;
  container.innerHTML = '';

  let contacts = [];
  try {
    contacts = await discoverContacts();
  } catch {
    contacts = [];
  }

  if (!contacts.length) {
    container.classList.add('hidden');
    return 0;
  }
  container.classList.remove('hidden');

  // Dropdown picker — shows name · email, fills the collaborator email field.
  const select = el('select', { className: 'share-invite-contact-select', 'aria-label': 'Pick a contact' }, [
    el('option', { value: '' }, ['— Pick from your Contacts —']),
    ...contacts.map(c => el('option', { value: c.email }, [c.name ? `${c.name} · ${c.email}` : c.email])),
  ]);
  select.addEventListener('change', () => {
    if (!select.value) return;
    emailInput.value = select.value;
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.focus();
  });

  // Autocomplete datalist — type-ahead on the manual email field.
  const listId = 'share-invite-contacts-list';
  const datalist = el('datalist', { id: listId },
    contacts.map(c => el('option', { value: c.email }, [c.name || c.email])));
  emailInput.setAttribute('list', listId);

  container.append(
    el('label', { className: 'share-contact-label' }, ['Invite from your Contacts Waymarks']),
    select,
    datalist,
  );

  return contacts.length;
}
