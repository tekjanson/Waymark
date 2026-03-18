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

/* --- Pinned Sheets --- */

export function getPinnedSheets() {
  return get('pinned_sheets') || [];
}

export function setPinnedSheets(sheets) {
  set('pinned_sheets', sheets);
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

export function getTutorialStep() {
  return get('tutorial_step') || 0;
}

export function setTutorialStep(step) {
  set('tutorial_step', step);
}

/* --- Theme --- */

/**
 * Get the saved theme preference ('light', 'dark', or 'system').
 * @returns {string}
 */
export function getTheme() {
  return get('theme') || 'light';
}

/**
 * Save the theme preference.
 * @param {'light'|'dark'|'system'} theme
 */
export function setTheme(theme) {
  set('theme', theme);
}

/* --- Recent Sheets --- */

export function getRecentSheets() {
  return get('recent_sheets') || [];
}

export function setRecentSheets(sheets) {
  set('recent_sheets', sheets);
}

/* --- Search History --- */

export function getSearchHistory() {
  return get('search_history') || [];
}

export function setSearchHistory(history) {
  set('search_history', history);
}

/* --- Expanded Folders --- */

export function getExpandedFolders() {
  return get('expanded_folders') || [];
}

export function setExpandedFolders(folders) {
  set('expanded_folders', folders);
}

/* --- Generated Categories --- */

export function getGeneratedCategories() {
  return get('generated_categories') || [];
}

export function setGeneratedCategories(categories) {
  set('generated_categories', categories);
}

/* --- Import History --- */

export function getImportHistory() {
  return get('import_history') || [];
}

export function setImportHistory(history) {
  set('import_history', history);
}

/* --- Dismissed Items --- */

export function getDismissedItems() {
  return get('dismissed_items') || [];
}

export function setDismissedItems(items) {
  set('dismissed_items', items);
}

/* --- Hidden Items --- */

export function getHiddenItems() {
  return get('hidden_items') || [];
}

export function setHiddenItems(items) {
  set('hidden_items', items);
}

/* --- Sort Order --- */

export function getSortOrder() {
  return get('sort_order') || 'name';
}

export function setSortOrder(order) {
  set('sort_order', order);
}

/* --- Agent --- */

export function getAgentApiKey() {
  return get('agent_api_key') || '';
}

export function setAgentApiKey(key) {
  if (key) set('agent_api_key', key);
  else remove('agent_api_key');
}

export function getAgentModel() {
  return get('agent_model') || '';
}

export function setAgentModel(model) {
  if (model) set('agent_model', model);
  else remove('agent_model');
}

export function getAgentConversation() {
  return get('agent_conversation') || [];
}

export function setAgentConversation(messages) {
  set('agent_conversation', messages || []);
}

/* --- Import Folder --- */

export function getImportFolderId() {
  return get('import_folder_id') || null;
}

export function setImportFolderId(folderId) {
  if (folderId) set('import_folder_id', folderId);
  else remove('import_folder_id');
}

export function getImportFolderName() {
  return get('import_folder_name') || null;
}

export function setImportFolderName(folderName) {
  if (folderName) set('import_folder_name', folderName);
  else remove('import_folder_name');
}

/* --- GitHub Ref --- */

export function getGithubRef() {
  return get('github_ref') || 'main';
}

export function setGithubRef(ref) {
  set('github_ref', ref || 'main');
}

/* --- Folder Index Cache --- */

/**
 * Get cached folder index (sheet summaries keyed by sheet ID).
 * @param {string} folderId
 * @returns {Object|null}  { [sheetId]: { name, headers, firstRow, templateKey, icon, modified } }
 */
export function getFolderIndex(folderId) {
  return get('folder_idx_' + folderId);
}

/**
 * Store folder index cache.
 * @param {string} folderId
 * @param {Object} index
 */
export function setFolderIndex(folderId, index) {
  set('folder_idx_' + folderId, index);
}

/* --- Clear All --- */

export function clearAll() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX))
    .forEach(k => localStorage.removeItem(k));
}

/* --- Notifications --- */

export function getNotifications() {
  return get('notifications') || [];
}

export function setNotifications(items) {
  set('notifications', items || []);
}

export function getNotificationSettings() {
  return get('notification_settings') || {};
}

export function setNotificationSettings(settings) {
  set('notification_settings', settings || {});
}

export function getNotifSheetId() {
  return localStorage.getItem('waymark_notif_sheet_id') || null;
}

export function setNotifSheetId(id) {
  if (id) {
    localStorage.setItem('waymark_notif_sheet_id', id);
  } else {
    localStorage.removeItem('waymark_notif_sheet_id');
  }
}

export function getNotificationRules(sheetId) {
  const all = get('notification_rules') || {};
  return all[sheetId] || [];
}

export function setNotificationRules(sheetId, rules) {
  const all = get('notification_rules') || {};
  if (rules && rules.length > 0) {
    all[sheetId] = rules;
  } else {
    delete all[sheetId];
  }
  set('notification_rules', all);
}

export function getAllNotificationRules() {
  return get('notification_rules') || {};
}
