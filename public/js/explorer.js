/* ============================================================
   explorer.js — Drive Explorer sidebar
   Uses Google Picker for file selection. Shows "Open from Drive"
   + "Pin a Folder" buttons plus recently-opened sheets and
   pinned folders.
   ============================================================ */

import { api } from './api-client.js';
import { el, showToast } from './ui.js';
import * as userData from './user-data.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

let explorerRoot;
let onNavigate;       // callback from app.js

/* ---------- Public ---------- */

export function init(containerEl, navigateFn) {
  explorerRoot = containerEl;
  onNavigate = navigateFn;
}

export async function load() {
  explorerRoot.innerHTML = '';

  // Picker buttons row
  const openBtn = el('button', {
    className: 'btn btn-google explorer-picker-btn',
    on: { click: openFilePicker },
  }, ['📂 Open from Drive']);

  const pinFolderBtn = el('button', {
    className: 'btn btn-secondary explorer-pin-folder-btn',
    on: { click: pinFolderViaPicker },
  }, ['📌 Pin a Folder']);

  const pickerSection = el('div', { className: 'explorer-section explorer-picker-section' }, [
    el('p', { className: 'explorer-picker-hint' }, [
      'Browse your Google Drive — select a spreadsheet or folder.',
    ]),
    el('div', { className: 'explorer-btn-row' }, [openBtn, pinFolderBtn]),
  ]);

  explorerRoot.append(pickerSection);

  // Pinned folders section
  const pinnedFolders = userData.getPinnedFolders();
  if (pinnedFolders && pinnedFolders.length > 0) {
    const folderSection = el('div', { className: 'explorer-section' });
    folderSection.append(el('div', { className: 'explorer-section-title' }, ['Pinned Folders']));

    for (const folder of pinnedFolders) {
      folderSection.append(buildFolderNode(folder));
    }
    explorerRoot.append(folderSection);
  }

  // Recent sheets section
  const recents = userData.getRecentSheets();
  if (recents && recents.length > 0) {
    const recentSection = el('div', { className: 'explorer-section' });
    recentSection.append(el('div', { className: 'explorer-section-title' }, ['Recently Opened']));

    for (const sheet of recents) {
      recentSection.append(buildSheetNode(sheet));
    }
    explorerRoot.append(recentSection);
  }

  // Pinned sheets section
  const pinnedSheets = userData.getPinnedSheets();
  if (pinnedSheets && pinnedSheets.length > 0) {
    const pinnedSection = el('div', { className: 'explorer-section' });
    pinnedSection.append(el('div', { className: 'explorer-section-title' }, ['Pinned Sheets']));

    for (const sheet of pinnedSheets) {
      pinnedSection.append(buildSheetNode(sheet, true));
    }
    explorerRoot.append(pinnedSection);
  }

  const hasContent = (pinnedFolders?.length > 0) || (recents?.length > 0) || (pinnedSheets?.length > 0);
  if (!hasContent) {
    explorerRoot.append(
      el('p', { className: 'empty-state' }, [
        'No recent items yet. Use the buttons above to browse your Google Drive.',
      ])
    );
  }
}

export function refresh() { return load(); }

/**
 * Auto-pin the Waymark root folder if the user has no pinned folders yet.
 * Called once after user-data initializes.
 */
export async function autoPinWaymarkFolder() {
  const pinned = userData.getPinnedFolders();
  if (pinned.length > 0) return;
  try {
    const rootId = await userData.getRootFolderId();
    if (rootId) {
      await userData.addPinnedFolder({ id: rootId, name: 'Waymark' });
    }
  } catch { /* non-critical */ }
}

/* ---------- Picker integration ---------- */

async function openFilePicker() {
  try {
    const result = await api.picker.pickSpreadsheets({ includeSharedDrives: true });
    if (!result || result.length === 0) return;
    const file = result[0];
    if (file.mimeType === FOLDER_MIME) {
      onNavigate?.('folder', file.id, file.name);
    } else {
      onNavigate?.('sheet', file.id, file.name);
    }
  } catch (err) {
    showToast(`Failed to open Picker: ${err.message}`, 'error');
  }
}

async function pinFolderViaPicker() {
  try {
    const folder = await api.picker.pickFolder();
    if (!folder) return;
    // Fetch full metadata to capture owner/shared info for the pin card
    let owner = null;
    let shared = false;
    try {
      const meta = await api.drive.getFile(folder.id);
      shared = !!meta.shared;
      const o = meta.owners?.[0];
      if (o && !o.me) owner = o.displayName || o.emailAddress || null;
    } catch { /* non-critical */ }
    await userData.addPinnedFolder({ id: folder.id, name: folder.name, owner, shared });
    showToast(`📌 Pinned "${folder.name}"`, 'success');
    load();
  } catch (err) {
    showToast(`Failed to pin folder: ${err.message}`, 'error');
  }
}

/* ---------- Rendering ---------- */

function buildFolderNode(folder) {
  return el('div', {
    className: 'sheet-item folder-item',
    dataset: { id: folder.id },
    on: {
      click() { onNavigate?.('folder', folder.id, folder.name); },
    },
  }, [
    el('span', { className: 'sheet-icon' }, ['📁']),
    el('span', {}, [folder.name]),
    folder.shared
      ? el('span', { className: 'badge-shared' }, ['shared'])
      : null,
    el('span', { className: 'badge-pinned' }, ['📌']),
  ]);
}

function buildSheetNode(sheet, isPinned = false) {
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
