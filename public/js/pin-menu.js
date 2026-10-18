/* ============================================================
   pin-menu.js — Contextual pin popover
   Clicking 📌 lets the user either Pin a sheet to Home OR add it
   to one of their Linker / Community Linker sheets (structured
   index hubs for personal and community Waymarks).
   ============================================================ */

import { el, showToast } from './ui.js';
import { api } from './api-client.js';
import * as userData from './user-data.js';
import { TEMPLATES } from './templates/index.js';

/* ---------- Module state ---------- */

let _menu = null;
let _anchor = null;

/* ---------- Public API ---------- */

/**
 * Open the contextual pin popover anchored to the pin button.
 * @param {{ anchorEl: HTMLElement, sheetId: string, sheetTitle: string, templateKey: string }} ctx
 */
export function showPinMenu({ anchorEl, sheetId, sheetTitle, templateKey }) {
  _close();
  if (!sheetId) return;
  _anchor = anchorEl;

  const linkers = discoverLinkers(sheetId);
  const items = [buildHomeItem(sheetId, sheetTitle, templateKey)];

  items.push(el('div', { className: 'pin-menu-divider' }));
  items.push(el('div', { className: 'pin-menu-label' }, ['Add to Linker']));

  if (linkers.length === 0) {
    items.push(el('div', { className: 'pin-menu-hint' }, [
      'Open a Community Linker sheet once and it will appear here as an index hub you can add to.',
    ]));
  } else {
    for (const linker of linkers) {
      items.push(el('button', {
        className: 'pin-menu-item',
        type: 'button',
        on: {
          click: async () => {
            _close();
            try {
              await addToLinker(linker, { sheetId, sheetTitle, templateKey });
            } catch (err) {
              showToast(`Could not add to ${linker.name}: ${err.message}`, 'error');
            }
          },
        },
      }, [
        el('span', { className: 'pin-menu-emoji' }, ['🔗']),
        el('span', { className: 'pin-menu-text' }, [linker.name || 'Linker']),
      ]));
    }
  }

  _menu = el('div', { className: 'pin-menu', role: 'menu' }, items);
  document.body.appendChild(_menu);
  position(_menu, anchorEl);

  // Defer so the opening click does not immediately close the menu.
  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }, 0);
}

/* ---------- Internal ---------- */

function buildHomeItem(sheetId, sheetTitle, templateKey) {
  const pinned = userData.isSheetPinned(sheetId);
  return el('button', {
    className: 'pin-menu-item',
    type: 'button',
    on: {
      click: async () => {
        try {
          if (userData.isSheetPinned(sheetId)) {
            await userData.removePinnedSheet(sheetId);
            showToast('Unpinned from Home', 'success');
          } else {
            await userData.addPinnedSheet({ id: sheetId, name: sheetTitle || 'Untitled', templateKey });
            showToast('Pinned to Home', 'success');
          }
          syncPinButton(sheetId);
          window.dispatchEvent(new CustomEvent('waymark:pins-changed'));
        } catch (err) {
          showToast(`Could not update pin: ${err.message}`, 'error');
        }
        _close();
      },
    },
  }, [
    el('span', { className: 'pin-menu-emoji' }, [pinned ? '📍' : '📌']),
    el('span', { className: 'pin-menu-text' }, [pinned ? 'Unpin from Home' : 'Pin to Home']),
  ]);
}

/**
 * Discover the user's Linker sheets from recently opened + pinned sheets.
 * Cheap and local — no Drive scan. Excludes the current sheet.
 * @param {string} currentSheetId
 * @returns {Array<{ id: string, name: string }>}
 */
function discoverLinkers(currentSheetId) {
  const pool = [...userData.getPinnedSheets(), ...userData.getRecentSheets()];
  const seen = new Set();
  const linkers = [];
  for (const s of pool) {
    if (!s || s.templateKey !== 'linker') continue;
    if (s.id === currentSheetId || seen.has(s.id)) continue;
    seen.add(s.id);
    linkers.push({ id: s.id, name: s.name || 'Linker' });
  }
  return linkers;
}

/**
 * Append a reference to the current sheet into a Linker sheet, mapping the
 * row onto the linker's actual column layout.
 * @param {{ id: string, name: string }} linker
 * @param {{ sheetId: string, sheetTitle: string, templateKey: string }} ctx
 */
async function addToLinker(linker, { sheetId, sheetTitle, templateKey }) {
  const data = await api.sheets.getSpreadsheet(linker.id);
  const tab = (data.tabs && data.tabs[0]) || null;
  const tabTitle = (tab && tab.title) || data.sheetTitle || 'Sheet1';
  const values = (tab && tab.values) || data.values || [];
  const headers = values[0] && values[0].length
    ? values[0]
    : (TEMPLATES.linker?.defaultHeaders || ['Name', 'Description', 'Link', 'Type', 'Tags', 'Icon']);
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  const cols = TEMPLATES.linker.columns(lower);

  const nameCol = cols.name >= 0 ? cols.name : 0;
  const linkCol = cols.link >= 0 ? cols.link : 2;

  // Skip duplicates — scan the link column for this sheet id.
  const alreadyListed = values.slice(1).some(row => (row[linkCol] || '').includes(sheetId));
  if (alreadyListed) {
    showToast(`Already listed in ${linker.name}`, 'info');
    return;
  }

  const width = Math.max(headers.length, linkCol + 1, nameCol + 1);
  const row = new Array(width).fill('');
  const tpl = TEMPLATES[templateKey];
  const put = (idx, val) => { if (idx >= 0 && idx < width) row[idx] = val; };

  put(nameCol, sheetTitle || 'Untitled');
  put(linkCol, `#/sheet/${sheetId}`);
  put(cols.type, 'waymark');
  put(cols.description, tpl ? tpl.name : '');
  put(cols.tags, templateKey || '');
  put(cols.icon, tpl ? tpl.icon : '');

  await api.sheets.appendRows(linker.id, tabTitle, [row]);
  showToast(`Added to ${linker.name}`, 'success');
}

/** Reflect the current home-pin state on the anchor pin button. */
function syncPinButton(sheetId) {
  if (!_anchor) return;
  const pinned = userData.isSheetPinned(sheetId);
  _anchor.classList.toggle('pinned', pinned);
  _anchor.title = pinned ? 'Unpin sheet' : 'Pin sheet';
  _anchor.classList.add('pin-bounce');
  _anchor.addEventListener('animationend', () => _anchor && _anchor.classList.remove('pin-bounce'), { once: true });
}

/** Position the popover under the anchor, kept inside the viewport. */
function position(menu, anchorEl) {
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 240;
  let left = rect.left;
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuWidth - 8);
  }
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${left}px`;
}

function onDocClick(e) {
  if (_menu && !_menu.contains(e.target) && e.target !== _anchor && !(_anchor && _anchor.contains(e.target))) {
    _close();
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') _close();
}

function _close() {
  if (_menu) { _menu.remove(); _menu = null; }
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onKeyDown, true);
}
