/* ============================================================
   storage.js — localStorage helpers for client preferences
   ============================================================ */

const PREFIX = 'waymark_';

function get(key) {
  try { return JSON.parse(localStorage.getItem(PREFIX + key)); }
  catch { return null; }
}

function set(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

function remove(key) {
  localStorage.removeItem(PREFIX + key);
}

/* --- Pinned Folders --- */

export function getPinnedFolders() {
  return get('pinned_folders') || [];
}

export function setPinnedFolders(folders) {
  set('pinned_folders', folders);
}

export function addPinnedFolder(folder) {
  const pinned = getPinnedFolders();
  if (pinned.find(f => f.id === folder.id)) return;
  pinned.push(folder);
  setPinnedFolders(pinned);
}

export function removePinnedFolder(folderId) {
  setPinnedFolders(getPinnedFolders().filter(f => f.id !== folderId));
}

export function isPinned(folderId) {
  return getPinnedFolders().some(f => f.id === folderId);
}

/* --- Preferences --- */

export function getAutoRefresh() {
  const v = get('auto_refresh');
  return v === null ? true : v;   // default on
}

export function setAutoRefresh(enabled) {
  set('auto_refresh', !!enabled);
}

export function getLastView() {
  return get('last_view') || '/';
}

export function setLastView(hash) {
  set('last_view', hash);
}

export function getSidebarOpen() {
  const v = get('sidebar_open');
  return v === null ? true : v;
}

export function setSidebarOpen(open) {
  set('sidebar_open', !!open);
}

/* --- Tutorial --- */

export function getTutorialCompleted() {
  return !!get('tutorial_completed');
}

export function setTutorialCompleted(done) {
  set('tutorial_completed', !!done);
}

/* --- Clear All --- */

export function clearAll() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX))
    .forEach(k => localStorage.removeItem(k));
}
