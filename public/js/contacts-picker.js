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
 * Check whether a sheet metadata entry is a Contacts book or a likely candidate
 * (e.g. pinned/recent before `templateKey` was populated).
 * @param {{ id?: string, name?: string, templateKey?: string }|null|undefined} sheet
 * @returns {boolean}
 */
export function isCandidateContactsBook(sheet) {
  if (!sheet || !sheet.id) return false;
  if (sheet.templateKey === 'contacts') return true;
  if (!sheet.templateKey && /\b(contacts?|directory|address\s*book|crews?|roster|people)\b/i.test(sheet.name || '')) {
    return true;
  }
  return false;
}

/**
 * Extract a clean spreadsheet ID from a `Share_Data_Sheet` or `Social_Data_Location` cell.
 * @param {string} raw
 * @returns {string}
 */
export function extractLedgerSheetId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const hashMatch = s.match(/#\/(?:sheet|public)\/([^/?#\s]+)/);
  if (hashMatch) return decodeURIComponent(hashMatch[1]);
  const urlMatch = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return s;
}

/**
 * Normalize a contact email cell (handles `"Name <email@domain>"` or surrounding whitespace).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeContactEmail(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const angle = s.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (angle) return angle[1].trim();
  return s;
}

/**
 * Discover unique contacts and Waymarker Crews across the user's Contacts
 * Waymark sheets. Contacts books are detected from recently opened + pinned
 * sheets (templateKey === 'contacts' or candidate name verified by header).
 * @returns {Promise<{ contacts: Array<{ name: string, email: string, group?: string, book: string, ledgerSheetId?: string }>, crews: Array<{ name: string, members: Array<{ name: string, email: string }>, ledgerSheetId?: string }> }>}
 */
export async function discoverDirectory() {
  const pool = [...userData.getPinnedSheets(), ...userData.getRecentSheets()];
  const books = [];
  const seenBook = new Set();
  for (const s of pool) {
    if (!isCandidateContactsBook(s) || seenBook.has(s.id)) continue;
    seenBook.add(s.id);
    books.push(s);
  }

  const contacts = [];
  const seenEmail = new Set();
  const crewsByKey = new Map();

  for (const book of books) {
    try {
      const data = await api.sheets.getSpreadsheet(book.id);
      const tab = (data.tabs && data.tabs[0]) || null;
      const values = (tab && tab.values) || data.values || [];
      if (values.length < 2) continue;
      const lower = (values[0] || []).map(h => (h || '').toLowerCase().trim());
      if (book.templateKey !== 'contacts' && !TEMPLATES.contacts.detect(lower)) {
        continue;
      }
      book.templateKey = 'contacts';
      const cols = TEMPLATES.contacts.columns(lower);
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const email = normalizeContactEmail(cols.email >= 0 ? row[cols.email] : '');
        const name = ((cols.name >= 0 ? row[cols.name] : '') || '').trim();
        const group = ((cols.group >= 0 ? row[cols.group] : '') || '').trim();
        const shareCell = cols.shareSheet >= 0 ? row[cols.shareSheet] : '';
        const socialCell = cols.socialLocation >= 0 ? row[cols.socialLocation] : '';
        const ledgerSheetId = extractLedgerSheetId(shareCell) || extractLedgerSheetId(socialCell);
        const validEmail = email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

        if (group) {
          const gKey = group.toLowerCase();
          const groupOnlyLedger = !validEmail ? (ledgerSheetId || undefined) : undefined;
          if (!crewsByKey.has(gKey)) {
            crewsByKey.set(gKey, { name: group, members: [], ledgerSheetId: groupOnlyLedger, _seen: new Set() });
          } else if (groupOnlyLedger && !crewsByKey.get(gKey).ledgerSheetId) {
            crewsByKey.get(gKey).ledgerSheetId = groupOnlyLedger;
          }
          const crew = crewsByKey.get(gKey);
          if (validEmail) {
            const eKey = email.toLowerCase();
            if (!crew._seen.has(eKey)) {
              crew._seen.add(eKey);
              crew.members.push({ name: name || email, email });
            }
          }
        }

        if (!validEmail) continue;
        const key = email.toLowerCase();
        if (seenEmail.has(key)) continue;
        seenEmail.add(key);
        contacts.push({
          name,
          email,
          group: group || undefined,
          book: book.name || data.title || 'Contacts',
          ledgerSheetId: ledgerSheetId || undefined,
        });
      }
    } catch {
      /* skip unreadable book */
    }
  }

  // Also include past collaborators and crews from known Share Ledgers
  try {
    const me = (api.auth.getUser?.()?.email || '').trim().toLowerCase();
    for (const l of userData.getShareLedgers()) {
      if (!l?.sheetId) continue;
      const group = String(l.group || '').trim();
      if (group) {
        const gKey = group.toLowerCase();
        if (!crewsByKey.has(gKey)) {
          crewsByKey.set(gKey, { name: group, members: [], _seen: new Set() });
        }
      }
      let email = String(l.contactEmail || '').trim().toLowerCase();
      if ((!email || email === me) && String(l.key || '').startsWith('contact-pair:')) {
        const parts = String(l.key).slice('contact-pair:'.length).split('::').map(s => s.trim().toLowerCase());
        email = parts.find(p => p && p !== me) || '';
      }
      if (email && email !== me && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !seenEmail.has(email)) {
        seenEmail.add(email);
        const prefix = email.split('@')[0];
        const name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        contacts.push({ name, email, group: group || undefined, book: 'Past Collaborators' });
      }
    }
  } catch {
    /* ignore */
  }

  contacts.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const crews = [...crewsByKey.values()]
    .map(({ name, members, ledgerSheetId }) => ({ name, members, ...(ledgerSheetId ? { ledgerSheetId } : {}) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { contacts, crews };
}

/**
 * Discover unique contacts across the user's Contacts Waymark sheets.
 * Contacts books are detected cheaply from recently opened + pinned sheets
 * (templateKey === 'contacts'); each is read once and deduped by email.
 * @returns {Promise<Array<{ name: string, email: string, group?: string, book: string }>>}
 */
export async function discoverContacts() {
  const { contacts } = await discoverDirectory();
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
  let crews = [];
  try {
    const dir = await discoverDirectory();
    contacts = dir.contacts;
    crews = dir.crews;
  } catch {
    contacts = [];
    crews = [];
  }

  if (!contacts.length && !crews.length) {
    container.classList.add('hidden');
    return 0;
  }
  container.classList.remove('hidden');

  const crewOptions = crews.length
    ? [
        el('optgroup', { label: 'Waymarker Crews' },
          crews.map(cr => el('option', {
            value: `group:${cr.name}`,
            dataset: { emails: (cr.members || []).map(m => m.email).filter(Boolean).join(',') },
          }, [
            `🏠 ${cr.name} (${cr.members.length} Waymarker${cr.members.length === 1 ? '' : 's'})`,
          ]))
        ),
      ]
    : [];

  // Dropdown picker — shows name · email (plus Waymarker Crews), fills the collaborator email field.
  const select = el('select', { className: 'share-invite-contact-select', 'aria-label': 'Pick a contact' }, [
    el('option', { value: '' }, ['— Pick from your Contacts —']),
    ...contacts.map(c => el('option', { value: c.email }, [c.name ? `${c.name} · ${c.email}` : c.email])),
    ...crewOptions,
  ]);

  let settingFromPicker = false;
  emailInput.addEventListener('input', () => {
    if (!settingFromPicker) {
      const current = (emailInput.value || '').trim();
      if (!current.toLowerCase().startsWith('group:')) {
        delete emailInput.dataset.selectedGroup;
        delete emailInput.dataset.memberEmails;
      }
      if (select.value && select.value !== current) {
        select.value = '';
      }
    }
  });

  select.addEventListener('change', () => {
    if (!select.value) return;
    settingFromPicker = true;
    const selectedOpt = select.options[select.selectedIndex];
    if (select.value.startsWith('group:')) {
      const groupName = select.value.slice('group:'.length);
      emailInput.dataset.selectedGroup = groupName;
      if (selectedOpt?.dataset?.emails) {
        emailInput.dataset.memberEmails = selectedOpt.dataset.emails;
      } else {
        delete emailInput.dataset.memberEmails;
      }
      emailInput.value = `group:${groupName}`;
    } else {
      delete emailInput.dataset.selectedGroup;
      delete emailInput.dataset.memberEmails;
      emailInput.value = select.value;
    }
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    settingFromPicker = false;
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
