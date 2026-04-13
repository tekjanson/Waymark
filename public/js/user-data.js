/* ============================================================
   user-data.js — Persistent user data stored in Google Drive

   Manages a "Waymark" root folder in the user's Drive with:
     Waymark/
       .waymark-data.json   ← user settings, pins, preferences
       Examples/             ← generated example sheets
       Imports/              ← imported sheets

   Data is cached in memory and synced to Drive on writes.
   Falls back to localStorage when Drive is unavailable.
   ============================================================ */

import { api } from './api-client.js';
import * as storage from './storage.js';

/* ---------- Constants ---------- */

const WAYMARK_ROOT_FOLDER = 'Waymark';
const DATA_FILENAME = '.waymark-data.json';
const EXAMPLES_FOLDER = 'Examples';
const IMPORTS_FOLDER = 'Imports';

/* ---------- Default user data schema ---------- */

/**
 * Schema v2 — everything the app needs to persist across
 * sessions and devices.  Fields are merge-safe: new keys are
 * added silently via the spread in _doInit().
 */
function defaultUserData() {
  return {
    version: 2,

    /* ── Pins & navigation ── */
    pinnedFolders: [],          // { id, name, owner?, shared? }[]
    pinnedSheets: [],           // { id, name, templateKey?, pinnedAt }[]
    lastView: '/',              // URL hash of last route

    /* ── Preferences ── */
    preferences: {
      theme: 'light',           // 'light' | 'dark' | 'system'
      autoRefresh: true,        // auto-reload sheet every 60 s
      sidebarOpen: true,        // explorer sidebar visible
      sortOrder: 'name',        // explorer sort: 'name' | 'modified'
      importFolderId: null,     // custom import target folder ID (null = Waymark/Imports)
      importFolderName: null,   // display name of custom import folder
      githubRef: 'main',        // pinned GitHub ref (branch, tag, or commit SHA)
      mqttBridge: false,          // MQTT debug bridge enabled
      mqttBrokerUrl: '',          // custom MQTT broker URL (empty = auto-detect)
    },

    /* ── Tutorial ── */
    tutorialCompleted: false,
    tutorialStep: 0,            // last step reached (0-based)

    /* ── Recent activity ── */
    recentSheets: [],           // { id, name, templateKey?, openedAt }[]  (max 20)
    searchHistory: [],          // { query, resultCount, searchedAt }[]  (max 30)

    /* ── Explorer state ── */
    expandedFolders: [],        // folder ID strings

    /* ── Example generation log ── */
    generatedCategories: [],    // category names already generated

    /* ── Import history ── */
    importHistory: [],          // { sheetId, sheetName, templateKey, importedAt }[]  (max 50)

    /* ── Dismissed UI elements ── */
    dismissedItems: [],         // string IDs of dismissed banners/tips/what's-new

    /* ── Hidden Drive items ── */
    hiddenItems: [],            // { id, name }[] — items hidden from explorer (e.g. shared)

    /* ── AI Agent ── */
    agentConversations: [],     // { id, title, messages[], createdAt, updatedAt }[] (max 10)
    agentSettings: null,        // { apiKey, model, keys? } — null = opt-out (use localStorage only)

    /* ── Dashboards ── */
    dashboards: [],             // { id, name, layout, panels[] }[] — multi-sheet composite views

    /* ── WebRTC Signaling ── */
    signalingSheetId: null,          // spreadsheetId of the private .waymark-signaling sheet (key storage)
    publicSignalingSheetId: null,    // spreadsheetId of the public .waymark-public-signaling sheet (encrypted P2P)

    /* ── Lock-on-Submit ── */
    lockOnSubmitSheets: {},     // { [spreadsheetId]: boolean } — sheets with row-lock enabled

    /* ── Housekeeping ── */
    updatedAt: new Date().toISOString(),
  };
}

/* ---------- Capacity limits ---------- */
const MAX_RECENT_SHEETS  = 20;
const MAX_SEARCH_HISTORY = 30;
const MAX_IMPORT_HISTORY = 50;
const MAX_AGENT_CONVERSATIONS = 10;
const MAX_AGENT_MESSAGES = 50;

/* ---------- Internal state ---------- */

let _rootFolderId = null;      // cached Waymark folder ID
let _dataFileId = null;        // cached .waymark-data.json file ID
let _userData = null;           // cached user data in memory
let _initialized = false;
let _initPromise = null;        // singleton init promise to avoid races

/* ---------- Initialization ---------- */

/**
 * Ensure the Waymark root folder and data file exist.
 * This is idempotent — calling it multiple times is safe.
 * @returns {Promise<void>}
 */
export async function init() {
  if (_initialized) return;
  if (_initPromise) return _initPromise;

  _initPromise = _doInit();
  try {
    await _initPromise;
    _initialized = true;
  } finally {
    _initPromise = null;
  }
}

async function _doInit() {
  try {
    // Find or create the Waymark root folder
    _rootFolderId = await ensureFolder(WAYMARK_ROOT_FOLDER);

    // Find or create the data file
    const existing = await api.drive.findFile(DATA_FILENAME, _rootFolderId);
    if (existing) {
      _dataFileId = existing.id;
      _userData = await api.drive.readJsonFile(existing.id);
      // Merge with defaults for forward-compat (new fields added later)
      // Deep-merge preferences so newly-added preference fields aren't lost
      const defaults = defaultUserData();
      _userData = {
        ...defaults,
        ..._userData,
        preferences: { ...defaults.preferences, ...(_userData.preferences || {}) },
      };
    } else {
      // Seed from localStorage for migration
      _userData = migrateFromLocalStorage();
      const created = await api.drive.createJsonFile(
        DATA_FILENAME,
        _userData,
        [_rootFolderId]
      );
      _dataFileId = created.id;
    }

    // Sync loaded data back to localStorage as a fallback cache
    syncToLocalStorage(_userData);

    // Ensure the WebRTC signaling sheet exists (fire-and-forget)
    ensureSignalingSheet().catch(e =>
      console.warn('[user-data] ensureSignalingSheet:', e)
    );
  } catch (err) {
    console.warn('[user-data] Drive init failed, falling back to localStorage:', err);
    _userData = migrateFromLocalStorage();
  }
}

/**
 * Find or create the private .waymark-signaling spreadsheet (plain text config) and the
 * public .waymark-public-signaling spreadsheet (encrypted P2P signaling).
 *
 * The private sheet stores ONLY plain text config — NO encryption key.
 * The AES-256 key lives exclusively in localStorage['waymark_signal_key'].
 * Key distribution between peers happens ONLY over the WebRTC DataChannel.
 *
 * The public sheet uses column-T signaling cells; ALL cell values are
 * AES-256-GCM encrypted with the key from localStorage.
 *
 * Called once after init. Idempotent — skips creation for sheets already recorded.
 * @returns {Promise<void>}
 */
async function ensureSignalingSheet() {
  if (!_rootFolderId) return;

  const updates = {};

  // Create the private config sheet if missing
  if (!_userData?.signalingSheetId) {
    const created = await api.sheets.createSpreadsheet(
      '.waymark-signaling', [], _rootFolderId
    );
    updates.signalingSheetId = created.spreadsheetId;
    // No key is written here — only a plain-text JSON config marker
    try {
      await _writePrivateConfig(created.spreadsheetId, { version: 1, createdAt: new Date().toISOString() });
    } catch (e) {
      console.warn('[user-data] Failed to write private config marker:', e);
    }
    // Generate and store the AES-256 key in localStorage ONLY
    if (!localStorage.getItem('waymark_signal_key')) {
      const keyHex = _generateSignalKeyHex();
      localStorage.setItem('waymark_signal_key', keyHex);
    }
  }

  // Create the public signaling sheet if missing
  if (!_userData?.publicSignalingSheetId) {
    const pub = await api.sheets.createSpreadsheet(
      '.waymark-public-signaling', [], _rootFolderId
    );
    updates.publicSignalingSheetId = pub.spreadsheetId;
    // Grant public write access — all cells are AES-256-GCM encrypted so there
    // is no privacy risk. This is required for cross-device P2P signaling.
    try {
      const token = await api.auth.getToken();
      await import('./drive.js').then(d => d.setPublicWritable(token, pub.spreadsheetId));
    } catch (e) {
      console.warn('[user-data] Could not set public signaling sheet writable:', e);
    }
  }

  if (Object.keys(updates).length > 0) {
    await save(updates);
  }
}

/**
 * Generate a 64-char hex AES-256 key using the Web Crypto API.
 * @returns {string}
 */
function _generateSignalKeyHex() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Write a plain-text JSON config object to Sheet1!A1 of the private sheet.
 * This sheet never stores any encryption key.
 * @param {string} sheetId
 * @param {object} config
 * @returns {Promise<void>}
 */
async function _writePrivateConfig(sheetId, config) {
  const token = await api.auth.getToken();
  const range = 'Sheet1!A1';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values: [[JSON.stringify(config)]] }),
  });
  if (!res.ok) throw new Error(`Private config write failed: ${res.status}`);
}

/* ---------- Folder helpers ---------- */

/**
 * Get the Waymark root folder ID (initializes if needed).
 * @returns {Promise<string>}
 */
export async function getRootFolderId() {
  await init();
  return _rootFolderId;
}

/**
 * Get (or create) the Examples subfolder inside Waymark/.
 * @returns {Promise<string>}  folder ID
 */
export async function getExamplesFolderId() {
  await init();
  return ensureFolder(EXAMPLES_FOLDER, _rootFolderId);
}

/**
 * Get (or create) the Imports subfolder inside Waymark/.
 * If the user has a custom import folder configured, returns that instead.
 * @returns {Promise<string>}  folder ID
 */
export async function getImportsFolderId() {
  await init();
  const custom = getImportFolderId();
  if (custom) return custom;
  return ensureFolder(IMPORTS_FOLDER, _rootFolderId);
}

/**
 * Find or create a folder by name, optionally within a parent.
 * @param {string} name
 * @param {string} [parentId]  parent folder ID (root if omitted)
 * @returns {Promise<string>}  folder ID
 */
async function ensureFolder(name, parentId) {
  const existing = await api.drive.findFolder(name, parentId);
  if (existing) return existing.id;
  const created = await api.drive.createFile(
    name,
    'application/vnd.google-apps.folder',
    parentId ? [parentId] : []
  );
  return created.id;
}

/* ---------- Data access ---------- */

/**
 * Get the full user data object (read-only snapshot).
 * @returns {Object}
 */
export function getData() {
  return _userData ? { ..._userData } : defaultUserData();
}

/**
 * Persist updated user data to Drive (and localStorage fallback).
 * @param {Object} data  partial or full data to merge
 * @returns {Promise<void>}
 */
async function save(data) {
  _userData = { ..._userData, ...data, updatedAt: new Date().toISOString() };
  syncToLocalStorage(_userData);

  if (_dataFileId) {
    try {
      await api.drive.updateJsonFile(_dataFileId, _userData);
    } catch (err) {
      console.warn('[user-data] Drive save failed:', err);
    }
  }
}

/* ---------- Pinned Folders ---------- */

/**
 * @returns {{ id: string, name: string, owner?: string, shared?: boolean }[]}
 */
export function getPinnedFolders() {
  return (_userData?.pinnedFolders) || [];
}

export async function setPinnedFolders(folders) {
  await save({ pinnedFolders: folders });
}

export async function addPinnedFolder(folder) {
  const pinned = getPinnedFolders();
  if (pinned.find(f => f.id === folder.id)) return;
  pinned.push(folder);
  await save({ pinnedFolders: pinned });
}

export async function removePinnedFolder(folderId) {
  await save({ pinnedFolders: getPinnedFolders().filter(f => f.id !== folderId) });
}

export function isPinned(folderId) {
  return getPinnedFolders().some(f => f.id === folderId);
}

/* ---------- Pinned Sheets ---------- */

const MAX_PINNED_SHEETS = 20;

/**
 * @returns {{ id: string, name: string, templateKey?: string, pinnedAt: string }[]}
 */
export function getPinnedSheets() {
  return (_userData?.pinnedSheets) || [];
}

export async function addPinnedSheet(sheet) {
  const pinned = getPinnedSheets().filter(s => s.id !== sheet.id);
  pinned.unshift({ ...sheet, pinnedAt: new Date().toISOString() });
  if (pinned.length > MAX_PINNED_SHEETS) pinned.length = MAX_PINNED_SHEETS;
  await save({ pinnedSheets: pinned });
}

export async function removePinnedSheet(sheetId) {
  await save({ pinnedSheets: getPinnedSheets().filter(s => s.id !== sheetId) });
}

export function isSheetPinned(sheetId) {
  return getPinnedSheets().some(s => s.id === sheetId);
}

/* ---------- Preferences ---------- */

export function getAutoRefresh() {
  return _userData?.preferences?.autoRefresh ?? true;
}

export async function setAutoRefresh(enabled) {
  const prefs = { ...(_userData?.preferences || {}), autoRefresh: !!enabled };
  await save({ preferences: prefs });
}

export function getLastView() {
  return _userData?.lastView || '/';
}

export async function setLastView(hash) {
  await save({ lastView: hash });
}

export function getSidebarOpen() {
  return _userData?.preferences?.sidebarOpen ?? true;
}

export async function setSidebarOpen(open) {
  const prefs = { ...(_userData?.preferences || {}), sidebarOpen: !!open };
  await save({ preferences: prefs });
}

/* ---------- Tutorial ---------- */

export function getTutorialCompleted() {
  return !!_userData?.tutorialCompleted;
}

export async function setTutorialCompleted(done) {
  await save({ tutorialCompleted: !!done });
}

export function getTutorialStep() {
  return _userData?.tutorialStep ?? 0;
}

export async function setTutorialStep(step) {
  await save({ tutorialStep: step });
}

/* ---------- Recent Sheets ---------- */

/**
 * @returns {{ id: string, name: string, templateKey?: string, openedAt: string }[]}
 */
export function getRecentSheets() {
  return (_userData?.recentSheets) || [];
}

/**
 * Record that a sheet was opened. Moves duplicates to the top and caps the list.
 * @param {{ id: string, name: string, templateKey?: string }} sheet
 */
export async function addRecentSheet(sheet) {
  const recent = getRecentSheets().filter(s => s.id !== sheet.id);
  recent.unshift({ ...sheet, openedAt: new Date().toISOString() });
  if (recent.length > MAX_RECENT_SHEETS) recent.length = MAX_RECENT_SHEETS;
  await save({ recentSheets: recent });
}

/* ---------- Search History ---------- */

/**
 * @returns {{ query: string, resultCount: number, searchedAt: string }[]}
 */
export function getSearchHistory() {
  return (_userData?.searchHistory) || [];
}

/**
 * Record a search query. Deduplicates (most recent wins) and caps.
 */
export async function addSearchEntry(query, resultCount) {
  const history = getSearchHistory().filter(e => e.query !== query);
  history.unshift({ query, resultCount, searchedAt: new Date().toISOString() });
  if (history.length > MAX_SEARCH_HISTORY) history.length = MAX_SEARCH_HISTORY;
  await save({ searchHistory: history });
}

/* ---------- Expanded Folders ---------- */

/**
 * @returns {string[]}  array of folder IDs
 */
export function getExpandedFolders() {
  return (_userData?.expandedFolders) || [];
}

export async function setExpandedFolders(folderIds) {
  await save({ expandedFolders: folderIds });
}

export async function addExpandedFolder(folderId) {
  const expanded = getExpandedFolders();
  if (!expanded.includes(folderId)) {
    expanded.push(folderId);
    await save({ expandedFolders: expanded });
  }
}

export async function removeExpandedFolder(folderId) {
  await save({ expandedFolders: getExpandedFolders().filter(id => id !== folderId) });
}

/* ---------- Generated Categories ---------- */

/**
 * @returns {string[]}  category names that have been generated
 */
export function getGeneratedCategories() {
  return (_userData?.generatedCategories) || [];
}

export async function addGeneratedCategories(categories) {
  const existing = new Set(getGeneratedCategories());
  for (const c of categories) existing.add(c);
  await save({ generatedCategories: [...existing] });
}

/* ---------- Import History ---------- */

/**
 * @returns {{ sheetId: string, sheetName: string, templateKey: string, importedAt: string }[]}
 */
export function getImportHistory() {
  return (_userData?.importHistory) || [];
}

export async function addImportEntry(entry) {
  const history = getImportHistory();
  history.unshift({ ...entry, importedAt: new Date().toISOString() });
  if (history.length > MAX_IMPORT_HISTORY) history.length = MAX_IMPORT_HISTORY;
  await save({ importHistory: history });
}

/* ---------- Dismissed UI Items ---------- */

/**
 * @returns {string[]}  IDs of dismissed banners/tips
 */
export function getDismissedItems() {
  return (_userData?.dismissedItems) || [];
}

export function isDismissed(itemId) {
  return getDismissedItems().includes(itemId);
}

export async function dismissItem(itemId) {
  const items = getDismissedItems();
  if (!items.includes(itemId)) {
    items.push(itemId);
    await save({ dismissedItems: items });
  }
}

/* ---------- Hidden Items ---------- */

/**
 * @returns {{ id: string, name: string }[]}  items hidden from the explorer
 */
export function getHiddenItems() {
  return (_userData?.hiddenItems) || [];
}

export function isHidden(itemId) {
  return getHiddenItems().some(i => i.id === itemId);
}

/**
 * Hide a Drive item from the explorer.
 * @param {{ id: string, name: string }} item
 */
export async function addHiddenItem(item) {
  const items = getHiddenItems();
  if (!items.some(i => i.id === item.id)) {
    items.push({ id: item.id, name: item.name });
    await save({ hiddenItems: items });
  }
}

/**
 * Un-hide a Drive item.
 * @param {string} itemId
 */
export async function removeHiddenItem(itemId) {
  await save({ hiddenItems: getHiddenItems().filter(i => i.id !== itemId) });
}

/* ---------- Sort Order ---------- */

export function getSortOrder() {
  return _userData?.preferences?.sortOrder || 'name';
}

export async function setSortOrder(order) {
  const prefs = { ...(_userData?.preferences || {}), sortOrder: order };
  await save({ preferences: prefs });
}

/* ---------- Theme ---------- */

/**
 * Get the user's theme preference ('light', 'dark', or 'system').
 * @returns {string}
 */
export function getTheme() {
  return _userData?.preferences?.theme || 'light';
}

/**
 * Set the theme preference.
 * @param {'light'|'dark'|'system'} theme
 */
export async function setTheme(theme) {
  const prefs = { ...(_userData?.preferences || {}), theme: theme || 'light' };
  await save({ preferences: prefs });
}

/* ---------- Import Folder ---------- */

/**
 * Get the custom import folder ID (null = default Waymark/Imports).
 * @returns {string|null}
 */
export function getImportFolderId() {
  return _userData?.preferences?.importFolderId || null;
}

/**
 * Get the custom import folder display name.
 * @returns {string|null}
 */
export function getImportFolderName() {
  return _userData?.preferences?.importFolderName || null;
}

/**
 * Set a custom folder for imports.
 * @param {string|null} folderId  Drive folder ID (null to reset to default)
 * @param {string|null} folderName  display name
 */
export async function setImportFolder(folderId, folderName) {
  const prefs = { ...(_userData?.preferences || {}), importFolderId: folderId, importFolderName: folderName };
  await save({ preferences: prefs });
}

/* ---------- GitHub Ref (Version Pinning) ---------- */

/**
 * Get the user's pinned GitHub ref (branch, tag, or commit SHA).
 * Defaults to 'main' if not set.
 * @returns {string}
 */
export function getGithubRef() {
  return _userData?.preferences?.githubRef || 'main';
}

/**
 * Pin the user to a specific GitHub ref.
 * @param {string} ref  branch name, tag, or commit SHA
 */
export async function setGithubRef(ref) {
  const prefs = { ...(_userData?.preferences || {}), githubRef: ref || 'main' };
  await save({ preferences: prefs });
}

/* ---------- MQTT Debug Bridge ---------- */

export function getMqttBridge() {
  return !!_userData?.preferences?.mqttBridge;
}

export async function setMqttBridge(enabled) {
  const prefs = { ...(_userData?.preferences || {}), mqttBridge: !!enabled };
  await save({ preferences: prefs });
}

export function getMqttBrokerUrl() {
  return _userData?.preferences?.mqttBrokerUrl || '';
}

export async function setMqttBrokerUrl(url) {
  const prefs = { ...(_userData?.preferences || {}), mqttBrokerUrl: url || '' };
  await save({ preferences: prefs });
}

/* ---------- Agent Conversations ---------- */

/**
 * Get all stored agent conversations.
 * @returns {Array}
 */
export function getAgentConversations() {
  return _userData?.agentConversations || [];
}

/**
 * Save or update an agent conversation.
 * @param {{ id: string, title: string, messages: Array, createdAt: string, updatedAt: string }} conversation
 */
export async function saveAgentConversation(conversation) {
  const convos = getAgentConversations().filter(c => c.id !== conversation.id);
  conversation.updatedAt = new Date().toISOString();
  // Truncate messages to limit
  if (conversation.messages.length > MAX_AGENT_MESSAGES) {
    conversation.messages = conversation.messages.slice(-MAX_AGENT_MESSAGES);
  }
  convos.unshift(conversation);
  // Limit total conversations
  await save({ agentConversations: convos.slice(0, MAX_AGENT_CONVERSATIONS) });
}

/**
 * Delete an agent conversation by ID.
 * @param {string} conversationId
 */
export async function deleteAgentConversation(conversationId) {
  await save({ agentConversations: getAgentConversations().filter(c => c.id !== conversationId) });
}

/* ---------- Agent Settings (Drive-backed) ---------- */

/**
 * Get agent settings from Drive. Returns null if not synced to Drive.
 * @returns {{ apiKey: string, model: string, keys?: Array } | null}
 */
export function getAgentSettings() {
  return _userData?.agentSettings || null;
}

/**
 * Save agent settings to Drive. Pass null to opt out of Drive sync.
 * Supports both legacy single-key and multi-key ring formats.
 * @param {{ apiKey: string, model: string, keys?: Array } | null} settings
 */
export async function saveAgentSettings(settings) {
  await save({ agentSettings: settings });
}

/* ---------- Dashboards ---------- */

/**
 * Get all stored dashboards.
 * @returns {Array<{id:string, name:string, layout:string, panels:Array}>}
 */
export function getDashboards() {
  return _userData?.dashboards || [];
}

/**
 * Save or update a dashboard definition.
 * @param {{ id: string, name: string, layout: string, panels: Array }} dashboard
 */
export async function saveDashboard(dashboard) {
  const rest = getDashboards().filter(d => d.id !== dashboard.id);
  await save({ dashboards: [dashboard, ...rest] });
}

/**
 * Delete a dashboard by ID.
 * @param {string} dashboardId
 */
export async function deleteDashboard(dashboardId) {
  await save({ dashboards: getDashboards().filter(d => d.id !== dashboardId) });
}

/* ---------- localStorage migration / fallback ---------- */

/**
 * Migrate existing localStorage data into the Drive-backed format.
 */
function migrateFromLocalStorage() {
  return {
    ...defaultUserData(),
    pinnedFolders: storage.getPinnedFolders(),
    pinnedSheets: storage.getPinnedSheets?.() || [],
    preferences: {
      theme: storage.getTheme?.() || 'light',
      autoRefresh: storage.getAutoRefresh(),
      sidebarOpen: storage.getSidebarOpen(),
      sortOrder: storage.getSortOrder?.() || 'name',
      importFolderId: storage.getImportFolderId?.() || null,
      importFolderName: storage.getImportFolderName?.() || null,
      githubRef: storage.getGithubRef?.() || 'main',
      mqttBridge: false,
      mqttBrokerUrl: '',
    },
    tutorialCompleted: storage.getTutorialCompleted(),
    tutorialStep: storage.getTutorialStep?.() || 0,
    lastView: storage.getLastView(),
    recentSheets: storage.getRecentSheets?.() || [],
    searchHistory: storage.getSearchHistory?.() || [],
    expandedFolders: storage.getExpandedFolders?.() || [],
    generatedCategories: storage.getGeneratedCategories?.() || [],
    importHistory: storage.getImportHistory?.() || [],
    dismissedItems: storage.getDismissedItems?.() || [],
    hiddenItems: storage.getHiddenItems?.() || [],
    dashboards: storage.getDashboards?.() || [],
  };
}

/**
 * Keep localStorage in sync as a fast cache / offline fallback.
 */
function syncToLocalStorage(data) {
  try {
    storage.setPinnedFolders(data.pinnedFolders || []);
    if (storage.setPinnedSheets) storage.setPinnedSheets(data.pinnedSheets || []);
    storage.setAutoRefresh(data.preferences?.autoRefresh ?? true);
    storage.setSidebarOpen(data.preferences?.sidebarOpen ?? true);
    storage.setTutorialCompleted(data.tutorialCompleted || false);
    storage.setLastView(data.lastView || '/');
    // Extended fields
    if (storage.setTutorialStep) storage.setTutorialStep(data.tutorialStep || 0);
    if (storage.setRecentSheets) storage.setRecentSheets(data.recentSheets || []);
    if (storage.setSearchHistory) storage.setSearchHistory(data.searchHistory || []);
    if (storage.setExpandedFolders) storage.setExpandedFolders(data.expandedFolders || []);
    if (storage.setGeneratedCategories) storage.setGeneratedCategories(data.generatedCategories || []);
    if (storage.setImportHistory) storage.setImportHistory(data.importHistory || []);
    if (storage.setDismissedItems) storage.setDismissedItems(data.dismissedItems || []);
    if (storage.setHiddenItems) storage.setHiddenItems(data.hiddenItems || []);
    if (storage.setDashboards) storage.setDashboards(data.dashboards || []);
    if (storage.setSortOrder) storage.setSortOrder(data.preferences?.sortOrder || 'name');
    if (storage.setTheme) storage.setTheme(data.preferences?.theme || 'light');
    if (storage.setImportFolderId) storage.setImportFolderId(data.preferences?.importFolderId || null);
    if (storage.setImportFolderName) storage.setImportFolderName(data.preferences?.importFolderName || null);
    if (storage.setGithubRef) storage.setGithubRef(data.preferences?.githubRef || 'main');
    if (storage.setMqttBridge) storage.setMqttBridge(data.preferences?.mqttBridge || false);
    if (storage.setMqttBrokerUrl) storage.setMqttBrokerUrl(data.preferences?.mqttBrokerUrl || '');
  } catch { /* localStorage quota / private mode */ }
}

/* ---------- Clear / Reset ---------- */

/**
 * Clear all user data (Drive file + localStorage).
 */
export async function clearAll() {
  _userData = defaultUserData();
  storage.clearAll();
  if (_dataFileId) {
    try {
      await api.drive.updateJsonFile(_dataFileId, _userData);
    } catch { /* ignore */ }
  }
}

/* ---------- WebRTC Signaling Sheet ---------- */

/**
 * Get the user-owned private signaling sheet ID (key storage), or null if not yet created.
 * @returns {string|null}
 */
export function getSignalingSheetId() {
  return _userData?.signalingSheetId ?? null;
}

/**
 * Get the public P2P signaling sheet ID (encrypted WebRTC handshake), or null if not yet created.
 * @returns {string|null}
 */
export function getPublicSignalingSheetId() {
  return _userData?.publicSignalingSheetId ?? null;
}

/**
 * Cycle the AES-256 signal key by generating a fresh key and writing it to
 * the private signaling sheet.  All connected peers will detect the key change
/**
 * Rotate the AES-256 signal key.
 *
 * Generates a fresh key and stores it ONLY in localStorage['waymark_signal_key'].
 * The key is NEVER written to any Google Sheet.
 * Peers receive the new key via the WebRTC DataChannel.
 *
 * @returns {Promise<void>}
 */
export async function cycleSignalKey() {
  const newKey = _generateSignalKeyHex();
  localStorage.setItem('waymark_signal_key', newKey);
  // Peers will receive the new key over the WebRTC DataChannel.
  // Trigger a DataChannel key-push if the P2P mesh is active.
  if (typeof window !== 'undefined' && window._waymarkMeshPeer?.broadcastSignalKey) {
    window._waymarkMeshPeer.broadcastSignalKey(newKey);
  }
}

/* ---------- Lock-on-Submit ---------- */

/**
 * Check whether row-locking on form submission is enabled for a spreadsheet.
 * @param {string} spreadsheetId
 * @returns {boolean}
 */
export function getLockOnSubmit(spreadsheetId) {
  return !!(_userData?.lockOnSubmitSheets?.[spreadsheetId]);
}

/**
 * Enable or disable lock-on-submit for a specific spreadsheet.
 * When enabled, the owner's active session will lock each appended row
 * immediately after submission using the Sheets protected-ranges API.
 * @param {string}  spreadsheetId
 * @param {boolean} enabled
 */
export async function setLockOnSubmit(spreadsheetId, enabled) {
  const locks = { ...(_userData?.lockOnSubmitSheets || {}) };
  if (enabled) {
    locks[spreadsheetId] = true;
  } else {
    delete locks[spreadsheetId];
  }
  await save({ lockOnSubmitSheets: locks });
}

/* ---------- Folder name exports (for other modules) ---------- */

export const FOLDER_NAMES = {
  root: WAYMARK_ROOT_FOLDER,
  examples: EXAMPLES_FOLDER,
  imports: IMPORTS_FOLDER,
};
