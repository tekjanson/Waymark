/* ============================================================
   explorer.js — Drive Explorer sidebar
   Uses Google Picker for file selection. Shows a prominent
   "Open from Drive" button plus recently-opened sheets.
   ============================================================ */

import { api } from './api-client.js';
import { el, showToast } from './ui.js';
import * as userData from './user-data.js';

let explorerRoot;
let onNavigate;       // callback from app.js

/* ---------- Public ---------- */

export function init(containerEl, navigateFn) {
  explorerRoot = containerEl;
  onNavigate = navigateFn;
}

export async function load() {
  explorerRoot.innerHTML = '';

  // "Open from Drive" button — launches Google Picker
  const pickerBtn = el('button', {
    className: 'btn btn-google explorer-picker-btn',
    on: { click: openFilePicker },
  }, ['📂 Open from Google Drive']);

  const pickerSection = el('div', { className: 'explorer-section explorer-picker-section' }, [
    el('p', { className: 'explorer-picker-hint' }, [
      'Select a spreadsheet from your Google Drive to view it in WayMark.',
    ]),
    pickerBtn,
  ]);

  explorerRoot.append(pickerSection);

  // Recent sheets section
  const recents = userData.getRecentSheets();
  if (recents && recents.length > 0) {
    const recentSection = el('div', { className: 'explorer-section' });
    recentSection.append(el('div', { className: 'explorer-section-title' }, ['Recently Opened']));

    for (const sheet of recents) {
      recentSection.append(buildRecentNode(sheet));
    }
    explorerRoot.append(recentSection);
  }

  // Pinned sheets section
  const pinned = userData.getPinnedSheets();
  if (pinned && pinned.length > 0) {
    const pinnedSection = el('div', { className: 'explorer-section' });
    pinnedSection.append(el('div', { className: 'explorer-section-title' }, ['Pinned Sheets']));

    for (const sheet of pinned) {
      pinnedSection.append(buildRecentNode(sheet, true));
    }
    explorerRoot.append(pinnedSection);
  }

  if ((!recents || recents.length === 0) && (!pinned || pinned.length === 0)) {
    explorerRoot.append(
      el('p', { className: 'empty-state' }, [
        'No recent sheets yet. Use the button above to open a spreadsheet from Google Drive.',
      ])
    );
  }
}

export function refresh() { return load(); }

/* ---------- Picker integration ---------- */

async function openFilePicker() {
  try {
    const result = await api.picker.pickSpreadsheets({ includeSharedDrives: true });
    if (!result || result.length === 0) return; // user cancelled
    const file = result[0];
    onNavigate?.('sheet', file.id, file.name);
  } catch (err) {
    showToast(`Failed to open Picker: ${err.message}`, 'error');
  }
}

/* ---------- Rendering ---------- */

function buildRecentNode(sheet, isPinned = false) {
  const wrapper = el('div', {
    className: 'sheet-item',
    dataset: { id: sheet.id },
    on: {
      click() { onNavigate?.('sheet', sheet.id, sheet.name); },
    },
  }, [
    el('span', { className: 'sheet-icon' }, ['📊']),
    el('span', {}, [sheet.name]),
  ]);

  if (isPinned) {
    wrapper.append(el('span', { className: 'badge-pinned' }, ['📌']));
  }

  return wrapper;
}

/* ---------- Exported utilities (kept for compat) ---------- */

/**
 * Apply .waymarkIgnore filtering — kept for folder-contents view.
 * With Picker-based access, this only applies to app-created folders.
 */
export async function applyWaymarkIgnore(_folderId, items) {
  return items;
}
