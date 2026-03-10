/* ============================================================
   explorer.js — Drive Explorer sidebar
   Renders a tree of folders/sheets with lazy-load,
   expand/collapse, pin/unpin, and shared badges.
   ============================================================ */

import { api } from './api-client.js';
import { el, showToast } from './ui.js';
import * as userData from './user-data.js';

let explorerRoot;
let onNavigate;       // callback from app.js

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME  = 'application/vnd.google-apps.spreadsheet';
const IGNORE_FILE = '.waymarkIgnore';

const expandedSet = new Set();   // track expanded folder IDs
const ignoreCache = new Map();   // folderId → string[] of ignore patterns

/* ---------- Public ---------- */

export function init(containerEl, navigateFn) {
  explorerRoot = containerEl;
  onNavigate = navigateFn;
}

export async function load() {
  // Restore expanded folders from persistent user data
  const saved = userData.getExpandedFolders();
  expandedSet.clear();
  for (const id of saved) expandedSet.add(id);

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

    // Apply root-level .waymarkIgnore filtering
    const rootFiles = await applyWaymarkIgnore('root', rootRes.files || []);
    renderItems(mySection, rootFiles, false, 'root');

    // Filter out user-hidden items from shared results
    const sharedFiles = (sharedRes.files || []).filter(f => !userData.isHidden(f.id));
    renderItems(sharedSection, sharedFiles, true);
  } catch (err) {
    explorerRoot.append(el('p', { className: 'empty-state' }, [`Error loading Drive: ${err.message}`]));
  }
}

export function refresh() { return load(); }

/* ---------- Rendering ---------- */

function renderItems(container, items, isShared = false, parentFolderId = null) {
  const folders = items.filter(i => i.mimeType === FOLDER_MIME);
  const sheets  = items.filter(i => i.mimeType === SHEET_MIME);

  for (const folder of folders) {
    container.append(buildFolderNode(folder, isShared, parentFolderId));
  }
  for (const sheet of sheets) {
    container.append(buildSheetNode(sheet, parentFolderId, isShared));
  }

  if (folders.length === 0 && sheets.length === 0) {
    container.append(el('div', { className: 'folder-spinner' }, ['No items']));
  }
}

function buildFolderNode(folder, isShared = false, parentFolderId = null) {
  const wrapper = el('div', { className: 'folder-wrapper' });

  // Expand icon
  const expandIcon = el('span', { className: `expand-icon${expandedSet.has(folder.id) ? ' expanded' : ''}` }, ['▸']);

  // Pin button
  const pinBtn = el('button', {
    className: `btn-pin${userData.isPinned(folder.id) ? ' pinned' : ''}`,
    title: userData.isPinned(folder.id) ? 'Unpin folder' : 'Pin folder',
    on: {
      click(e) {
        e.stopPropagation();
        if (userData.isPinned(folder.id)) {
          userData.removePinnedFolder(folder.id);
          pinBtn.classList.remove('pinned');
          pinBtn.title = 'Pin folder';
          showToast('Folder unpinned', 'success');
        } else {
          userData.addPinnedFolder({
            id: folder.id,
            name: folder.name,
            owner: folder.owners?.[0]?.emailAddress || folder.owner || null,
            shared: isShared,
          });
          pinBtn.classList.add('pinned');
          pinBtn.title = 'Unpin folder';
          showToast('Folder pinned to home', 'success');
        }
        pinBtn.classList.add('pin-bounce');
        pinBtn.addEventListener('animationend', () => pinBtn.classList.remove('pin-bounce'), { once: true });
        // Notify app to re-render pinned folders
        window.dispatchEvent(new CustomEvent('waymark:pins-changed'));
      },
    },
  }, ['📌']);

  // Open in Google Drive button
  const openDriveBtn = el('button', {
    className: 'btn-open-drive',
    title: 'Open in Google Drive',
    on: {
      click(e) {
        e.stopPropagation();
        window.open(`https://drive.google.com/drive/folders/${folder.id}`, '_blank');
      },
    },
  }, ['↗']);

  // Ignore button — uses .waymarkIgnore for owned folders, user-data for shared items
  const ignoreBtn = (parentFolderId || isShared) ? el('button', {
    className: 'btn-ignore',
    title: 'Hide from WayMark',
    on: {
      click(e) {
        e.stopPropagation();
        if (parentFolderId) {
          addToIgnoreFile(parentFolderId, folder.name, wrapper);
        } else {
          hideSharedItem(folder, wrapper);
        }
      },
    },
  }, ['🚫']) : null;

  // Shared badge
  const badges = [];
  if (isShared || folder.shared) {
    badges.push(el('span', { className: 'badge-shared' }, ['shared']));
  }

  const rowChildren = [
    expandIcon,
    el('span', { className: 'folder-icon' }, ['📁']),
    el('span', { className: 'folder-name' }, [folder.name]),
    ...badges,
    openDriveBtn,
    pinBtn,
  ];
  if (ignoreBtn) rowChildren.push(ignoreBtn);

  const row = el('div', {
    className: 'folder-item',
    dataset: { id: folder.id },
    on: {
      click() { toggleFolder(folder, wrapper, childrenEl, expandIcon); },
    },
  }, rowChildren);

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

function buildSheetNode(sheet, parentFolderId = null, isShared = false) {
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

  // Ignore button — .waymarkIgnore for owned folders, user-data for shared/root-level
  if (parentFolderId || isShared) {
    wrapper.append(el('button', {
      className: 'btn-ignore',
      title: 'Hide from WayMark',
      on: {
        click(e) {
          e.stopPropagation();
          if (parentFolderId) {
            addToIgnoreFile(parentFolderId, sheet.name, wrapper);
          } else {
            hideSharedItem(sheet, wrapper);
          }
        },
      },
    }, ['🚫']));
  }

  return wrapper;
}

/* ---------- Expand / Collapse ---------- */

async function toggleFolder(folder, wrapper, childrenEl, expandIcon) {
  if (expandedSet.has(folder.id)) {
    expandedSet.delete(folder.id);
    expandIcon.classList.remove('expanded');
    childrenEl.innerHTML = '';
    userData.removeExpandedFolder(folder.id);
  } else {
    expandedSet.add(folder.id);
    expandIcon.classList.add('expanded');
    await loadChildren(folder.id, childrenEl);
    userData.addExpandedFolder(folder.id);
  }
}

async function loadChildren(folderId, container) {
  container.innerHTML = '';
  container.append(el('div', { className: 'folder-spinner' }, ['Loading…']));

  try {
    const res = await api.drive.listChildren(folderId);
    let items = res.files || [];

    // Check for .waymarkIgnore and filter items
    items = await applyWaymarkIgnore(folderId, items);

    container.innerHTML = '';
    renderItems(container, items, false, folderId);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { className: 'folder-spinner' }, [`Error: ${err.message}`]));
  }
}

/* ---------- .waymarkIgnore support ---------- */

/**
 * Add an item name to the .waymarkIgnore file in the given folder.
 * Creates the file if it doesn't exist, appends to it if it does.
 * Removes the item's DOM node on success.
 * @param {string} folderId     parent folder containing the item
 * @param {string} itemName     name of the file/folder to ignore
 * @param {HTMLElement} itemEl  DOM element to remove on success
 */
async function addToIgnoreFile(folderId, itemName, itemEl) {
  try {
    const ignoreFile = await api.drive.findFileInFolder(IGNORE_FILE, folderId);

    if (ignoreFile) {
      // Append to existing file
      const existing = await api.drive.readTextFile(ignoreFile.id);
      const lines = existing.split('\n').map(l => l.trim()).filter(Boolean);

      // Don't duplicate
      if (lines.includes(itemName)) {
        showToast(`"${itemName}" is already ignored`, 'info');
        return;
      }

      const updated = existing.trimEnd() + '\n' + itemName + '\n';
      await api.drive.updateTextFile(ignoreFile.id, updated);
    } else {
      // Create new .waymarkIgnore file
      const content = '# Items hidden from WayMark\n' + itemName + '\n';
      await api.drive.createTextFile(IGNORE_FILE, content, [folderId]);
    }

    // Invalidate cache for this folder
    ignoreCache.delete(folderId);

    // Remove item from the DOM
    itemEl.remove();
    showToast(`"${itemName}" hidden from WayMark`, 'success');
  } catch (err) {
    showToast(`Failed to ignore "${itemName}": ${err.message}`, 'error');
  }
}

/**
 * Hide a shared Drive item via user-data (no parent folder to write .waymarkIgnore).
 * @param {{ id: string, name: string }} item
 * @param {HTMLElement} itemEl  DOM element to remove on success
 */
async function hideSharedItem(item, itemEl) {
  try {
    if (userData.isHidden(item.id)) {
      showToast(`"${item.name}" is already hidden`, 'info');
      return;
    }
    await userData.addHiddenItem({ id: item.id, name: item.name });
    itemEl.remove();
    showToast(`"${item.name}" hidden from WayMark`, 'success');
  } catch (err) {
    showToast(`Failed to hide "${item.name}": ${err.message}`, 'error');
  }
}

/**
 * Parse a .waymarkIgnore file content into an array of patterns.
 * Lines starting with # are comments, empty lines are skipped.
 * Supports simple glob patterns: * matches any sequence,
 * ? matches a single character.
 * @param {string} content
 * @returns {RegExp[]}
 */
function parseIgnorePatterns(content) {
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(pattern => {
      // Convert simple glob to regex
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${escaped}$`, 'i');
    });
}

/**
 * Check if a file/folder name matches any ignore pattern.
 * @param {string} name
 * @param {RegExp[]} patterns
 * @returns {boolean}
 */
function isIgnored(name, patterns) {
  return patterns.some(re => re.test(name));
}

/**
 * Apply .waymarkIgnore filtering to a list of Drive items in a folder.
 * Exported for use by folder-contents view in app.js.
 * @param {string} folderId
 * @param {Object[]} items
 * @returns {Promise<Object[]>}
 */
export async function applyWaymarkIgnore(folderId, items) {
  try {
    let patterns;
    if (ignoreCache.has(folderId)) {
      patterns = ignoreCache.get(folderId);
    } else {
      // First check if .waymarkIgnore exists among the items we already loaded
      let ignoreFile = items.find(i => i.name === IGNORE_FILE);

      // Fallback: explicit lookup (covers cases where listChildren didn't include it)
      if (!ignoreFile) {
        ignoreFile = await api.drive.findFileInFolder(IGNORE_FILE, folderId);
      }

      if (ignoreFile) {
        const content = await api.drive.readTextFile(ignoreFile.id);
        patterns = parseIgnorePatterns(content);
      } else {
        patterns = [];
      }
      ignoreCache.set(folderId, patterns);
    }

    if (patterns.length === 0) return items;

    // Filter out ignored items (also hide the .waymarkIgnore file itself)
    return items.filter(item =>
      item.name !== IGNORE_FILE && !isIgnored(item.name, patterns)
    );
  } catch {
    // On any error, return items unfiltered
    return items;
  }
}
