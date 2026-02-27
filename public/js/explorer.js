/* ============================================================
   explorer.js — Drive Explorer sidebar
   Renders a tree of folders/sheets with lazy-load,
   expand/collapse, pin/unpin, and shared badges.
   ============================================================ */

import { api } from './api-client.js';
import { el } from './ui.js';
import * as storage from './storage.js';

let explorerRoot;
let onNavigate;       // callback from app.js

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME  = 'application/vnd.google-apps.spreadsheet';

const expandedSet = new Set();   // track expanded folder IDs

/* ---------- Public ---------- */

export function init(containerEl, navigateFn) {
  explorerRoot = containerEl;
  onNavigate = navigateFn;
}

export async function load() {
  explorerRoot.innerHTML = '';

  const mySection  = el('div', { className: 'explorer-section' });
  const sharedSection = el('div', { className: 'explorer-section' });

  mySection.append(el('div', { className: 'explorer-section-title' }, ['My Drive']));
  sharedSection.append(el('div', { className: 'explorer-section-title' }, ['Shared with Me']));

  explorerRoot.append(mySection, sharedSection);

  try {
    const [rootRes, sharedRes] = await Promise.all([
      api.drive.listRootFolders(),
      api.drive.getSharedWithMe(),
    ]);

    renderItems(mySection, rootRes.files || []);
    renderItems(sharedSection, sharedRes.files || [], true);
  } catch (err) {
    explorerRoot.append(el('p', { className: 'empty-state' }, [`Error loading Drive: ${err.message}`]));
  }
}

export function refresh() { return load(); }

/* ---------- Rendering ---------- */

function renderItems(container, items, isShared = false) {
  const folders = items.filter(i => i.mimeType === FOLDER_MIME);
  const sheets  = items.filter(i => i.mimeType === SHEET_MIME);

  for (const folder of folders) {
    container.append(buildFolderNode(folder, isShared));
  }
  for (const sheet of sheets) {
    container.append(buildSheetNode(sheet));
  }

  if (folders.length === 0 && sheets.length === 0) {
    container.append(el('div', { className: 'folder-spinner' }, ['No items']));
  }
}

function buildFolderNode(folder, isShared = false) {
  const wrapper = el('div', { className: 'folder-wrapper' });

  // Expand icon
  const expandIcon = el('span', { className: `expand-icon${expandedSet.has(folder.id) ? ' expanded' : ''}` }, ['▸']);

  // Pin button
  const pinBtn = el('button', {
    className: `btn-pin${storage.isPinned(folder.id) ? ' pinned' : ''}`,
    title: storage.isPinned(folder.id) ? 'Unpin folder' : 'Pin folder',
    on: {
      click(e) {
        e.stopPropagation();
        if (storage.isPinned(folder.id)) {
          storage.removePinnedFolder(folder.id);
          pinBtn.classList.remove('pinned');
          pinBtn.title = 'Pin folder';
        } else {
          storage.addPinnedFolder({
            id: folder.id,
            name: folder.name,
            owner: folder.owners?.[0]?.emailAddress || folder.owner || null,
            shared: isShared,
          });
          pinBtn.classList.add('pinned');
          pinBtn.title = 'Unpin folder';
        }
        // Notify app to re-render pinned folders
        window.dispatchEvent(new CustomEvent('waymark:pins-changed'));
      },
    },
  }, ['📌']);

  // Shared badge
  const badges = [];
  if (isShared || folder.shared) {
    badges.push(el('span', { className: 'badge-shared' }, ['shared']));
  }

  const row = el('div', {
    className: 'folder-item',
    dataset: { id: folder.id },
    on: {
      click() { toggleFolder(folder, wrapper, childrenEl, expandIcon); },
    },
  }, [
    expandIcon,
    el('span', { className: 'folder-icon' }, ['📁']),
    el('span', { className: 'folder-name' }, [folder.name]),
    ...badges,
    pinBtn,
  ]);

  // Owner tag for shared folders
  if (isShared && (folder.owners?.[0]?.emailAddress || folder.owner)) {
    row.append(el('span', { className: 'folder-owner' }, [folder.owners?.[0]?.emailAddress || folder.owner]));
  }

  const childrenEl = el('div', { className: 'folder-children' });
  if (expandedSet.has(folder.id)) {
    loadChildren(folder.id, childrenEl);
  }

  wrapper.append(row, childrenEl);
  return wrapper;
}

function buildSheetNode(sheet) {
  return el('div', {
    className: 'sheet-item',
    dataset: { id: sheet.id },
    on: {
      click() { onNavigate?.('sheet', sheet.id, sheet.name); },
    },
  }, [
    el('span', { className: 'sheet-icon' }, ['📊']),
    el('span', {}, [sheet.name]),
  ]);
}

/* ---------- Expand / Collapse ---------- */

async function toggleFolder(folder, wrapper, childrenEl, expandIcon) {
  if (expandedSet.has(folder.id)) {
    expandedSet.delete(folder.id);
    expandIcon.classList.remove('expanded');
    childrenEl.innerHTML = '';
  } else {
    expandedSet.add(folder.id);
    expandIcon.classList.add('expanded');
    await loadChildren(folder.id, childrenEl);
  }
}

async function loadChildren(folderId, container) {
  container.innerHTML = '';
  container.append(el('div', { className: 'folder-spinner' }, ['Loading…']));

  try {
    const res = await api.drive.listChildren(folderId);
    container.innerHTML = '';
    renderItems(container, res.files || []);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { className: 'folder-spinner' }, [`Error: ${err.message}`]));
  }
}
