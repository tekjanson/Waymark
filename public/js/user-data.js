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
      // Map of templateKey -> { id, name } for default creation folder per template
      defaultCreationFolderByTemplate: {},
      fleetSheetId: null,       // Agent Registry sheet ID (for the Dev Fleet sidebar button)
      githubRef: 'main',        // pinned GitHub ref (branch, tag, or commit SHA)
      mqttBridge: false,          // MQTT debug bridge enabled
      mqttBrokerUrl: '',          // custom MQTT broker URL (empty = auto-detect)
      homeTemplateMode: 1,        // selected Home Page layout architecture (1–50)
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
    agentKeysSheetId: null,     // Drive-synced link to the AI keys vault (passwords sheet)
    agentKeysSheetName: null,   // friendly name of the linked vault sheet

    /* ── Dashboards ── */
    dashboards: [],             // { id, name, layout, panels[] }[] — multi-sheet composite views
    homeWidgets: null,           // null = starter widgets; [] = intentionally empty; otherwise saved Wayboard widgets
    homeWidgetsVersion: 0,       // Wayboard widget schema migration marker

    /* ── WebRTC Signaling ── */
    signalingSheetId: null,          // spreadsheetId of the private .waymark-signaling sheet (key storage)
    publicSignalingSheetId: null,    // spreadsheetId of the public .waymark-public-signaling sheet (encrypted P2P)

    /* ── Bilateral sharing sheets ── */
    shareLedgers: [],                // { key, contactEmail?, group?, sheetId, ownerEmail?, permissionAttempted?, createdAt }[] — one per contact pair/crew

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
async function init() {
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
      if (!Array.isArray(_userData.homeWidgets) && Array.isArray(storage.getHomeWidgets?.())) {
        _userData.homeWidgets = storage.getHomeWidgets();
      }
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

  // Re-read .waymark-data.json from Drive to pick up signaling IDs that may
  // have been written by the orchestrator (which runs outside the browser).
  // Without this, the in-memory _userData can clobber the IDs on the next save().
  if (_dataFileId) {
    try {
      const freshData = await api.drive.readJsonFile(_dataFileId);
      if (freshData?.signalingSheetId && !_userData?.signalingSheetId) {
        _userData.signalingSheetId = freshData.signalingSheetId;
      }
      if (freshData?.publicSignalingSheetId && !_userData?.publicSignalingSheetId) {
        _userData.publicSignalingSheetId = freshData.publicSignalingSheetId;
      }
    } catch (e) {
      console.warn('[user-data] ensureSignalingSheet: re-read Drive failed:', e);
    }
  }

  const updates = {};

  // Create the private config sheet if missing
  if (!_userData?.signalingSheetId) {
    // Search globally by name to find a sheet created by the orchestrator
    const token = await api.auth.getToken();
    const drive = await import('./drive.js');
    const existing = await drive.findFileGlobal(token, '.waymark-signaling');
    if (existing) {
      updates.signalingSheetId = existing.id;
    } else {
      const created = await api.sheets.createSpreadsheet(
        '.waymark-signaling', [], _rootFolderId
      );
      updates.signalingSheetId = created.spreadsheetId;
      try {
        await _writePrivateConfig(created.spreadsheetId, { version: 1, createdAt: new Date().toISOString() });
      } catch (e) {
        console.warn('[user-data] Failed to write private config marker:', e);
      }
    }
  }

  // Create the public signaling sheet if missing
  if (!_userData?.publicSignalingSheetId) {
    const token = await api.auth.getToken();
    const drive = await import('./drive.js');
    const existing = await drive.findFileGlobal(token, '.waymark-public-signaling');
    if (existing) {
      updates.publicSignalingSheetId = existing.id;
    } else {
      const pub = await api.sheets.createSpreadsheet(
        '.waymark-public-signaling', [], _rootFolderId
      );
      updates.publicSignalingSheetId = pub.spreadsheetId;
      try {
        await drive.setPublicWritable(token, pub.spreadsheetId);
      } catch (e) {
        console.warn('[user-data] Could not set public signaling sheet writable:', e);
      }
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
async function getRootFolderId() {
  await init();
  return _rootFolderId;
}

/**
 * Get the default creation folder for a specific template key.
 * @param {string} templateKey
 * @returns {{id:string,name:string}|null}
 */
async function getDefaultFolderForTemplate(templateKey) {
  await init();
  const prefs = _userData?.preferences || {};
  return (prefs.defaultCreationFolderByTemplate || {})[templateKey] || null;
}

/**
 * Set the default creation folder for a specific template key.
 * Persists the mapping to Drive.
 * @param {string} templateKey
 * @param {string} folderId
 * @param {string} folderName
 */
async function setDefaultFolderForTemplate(templateKey, folderId, folderName) {
  await init();
  _userData.preferences = _userData.preferences || {};
  _userData.preferences.defaultCreationFolderByTemplate = _userData.preferences.defaultCreationFolderByTemplate || {};
  if (!folderId) {
    delete _userData.preferences.defaultCreationFolderByTemplate[templateKey];
  } else {
    _userData.preferences.defaultCreationFolderByTemplate[templateKey] = { id: folderId, name: folderName };
  }
  await save({ preferences: _userData.preferences });
}

/**
 * Get (or create) the Examples subfolder inside Waymark/.
 * @returns {Promise<string>}  folder ID
 */
async function getExamplesFolderId() {
  await init();
  return ensureFolder(EXAMPLES_FOLDER, _rootFolderId);
}

/**
 * Get (or create) the Imports subfolder inside Waymark/.
 * If the user has a custom import folder configured, returns that instead.
 * @returns {Promise<string>}  folder ID
 */
async function getImportsFolderId() {
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
function getData() {
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
      // Guard: if we're about to write without signaling IDs, try to preserve
      // them from the current Drive state (may have been set by the orchestrator).
      if (!_userData.publicSignalingSheetId || !_userData.signalingSheetId) {
        try {
          const current = await api.drive.readJsonFile(_dataFileId);
          if (current?.signalingSheetId && !_userData.signalingSheetId) {
            _userData.signalingSheetId = current.signalingSheetId;
          }
          if (current?.publicSignalingSheetId && !_userData.publicSignalingSheetId) {
            _userData.publicSignalingSheetId = current.publicSignalingSheetId;
          }
        } catch (_) { /* best-effort — don't block saves */ }
      }
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
function getPinnedFolders() {
  return (_userData?.pinnedFolders) || [];
}
async function setPinnedFolders(folders) {
  await save({ pinnedFolders: folders });
}
async function addPinnedFolder(folder) {
  const pinned = getPinnedFolders();
  if (pinned.find(f => f.id === folder.id)) return;
  pinned.push(folder);
  await save({ pinnedFolders: pinned });
}
async function removePinnedFolder(folderId) {
  await save({ pinnedFolders: getPinnedFolders().filter(f => f.id !== folderId) });
}
function isPinned(folderId) {
  return getPinnedFolders().some(f => f.id === folderId);
}

/* ---------- Pinned Sheets ---------- */

const MAX_PINNED_SHEETS = 20;

/**
 * @returns {{ id: string, name: string, templateKey?: string, pinnedAt: string }[]}
 */
function getPinnedSheets() {
  return (_userData?.pinnedSheets) || [];
}
async function addPinnedSheet(sheet) {
  const pinned = getPinnedSheets().filter(s => s.id !== sheet.id);
  pinned.unshift({ ...sheet, pinnedAt: new Date().toISOString() });
  if (pinned.length > MAX_PINNED_SHEETS) pinned.length = MAX_PINNED_SHEETS;
  await save({ pinnedSheets: pinned });
}
async function removePinnedSheet(sheetId) {
  await save({ pinnedSheets: getPinnedSheets().filter(s => s.id !== sheetId) });
}
function isSheetPinned(sheetId) {
  return getPinnedSheets().some(s => s.id === sheetId);
}

/* ---------- Preferences ---------- */
function getAutoRefresh() {
  return _userData?.preferences?.autoRefresh ?? true;
}
async function setAutoRefresh(enabled) {
  const prefs = { ...(_userData?.preferences || {}), autoRefresh: !!enabled };
  await save({ preferences: prefs });
}

/**
 * Selected Home Page layout architecture (1–50). Falls back to the localStorage
 * mirror (zero-flash) when Drive data hasn't hydrated yet.
 * @returns {number}
 */
function getHomeTemplateMode() {
  const v = parseInt(_userData?.preferences?.homeTemplateMode, 10);
  if (v >= 1 && v <= 50) return v;
  try { return storage.getHomeTemplateMode(); } catch { return 1; }
}
async function setHomeTemplateMode(mode) {
  const n = parseInt(mode, 10);
  const value = (n >= 1 && n <= 50) ? n : 1;
  const prefs = { ...(_userData?.preferences || {}), homeTemplateMode: value };
  try { storage.setHomeTemplateMode(value); } catch { /* localStorage mirror is best-effort */ }
  await save({ preferences: prefs });
}
function getLastView() {
  return _userData?.lastView || '/';
}
async function setLastView(hash) {
  await save({ lastView: hash });
}
function getSidebarOpen() {
  return _userData?.preferences?.sidebarOpen ?? true;
}
async function setSidebarOpen(open) {
  const prefs = { ...(_userData?.preferences || {}), sidebarOpen: !!open };
  await save({ preferences: prefs });
}

/* ---------- Tutorial ---------- */
function getTutorialCompleted() {
  return !!_userData?.tutorialCompleted;
}
async function setTutorialCompleted(done) {
  await save({ tutorialCompleted: !!done });
}
function getTutorialStep() {
  return _userData?.tutorialStep ?? 0;
}
async function setTutorialStep(step) {
  await save({ tutorialStep: step });
}

/* ---------- Recent Sheets ---------- */

/**
 * @returns {{ id: string, name: string, templateKey?: string, openedAt: string }[]}
 */
function getRecentSheets() {
  return (_userData?.recentSheets) || [];
}

/**
 * Record that a sheet was opened. Moves duplicates to the top and caps the list.
 * @param {{ id: string, name: string, templateKey?: string }} sheet
 */
async function addRecentSheet(sheet) {
  const recent = getRecentSheets().filter(s => s.id !== sheet.id);
  recent.unshift({ ...sheet, openedAt: new Date().toISOString() });
  if (recent.length > MAX_RECENT_SHEETS) recent.length = MAX_RECENT_SHEETS;
  await save({ recentSheets: recent });
}

/* ---------- Search History ---------- */

/**
 * @returns {{ query: string, resultCount: number, searchedAt: string }[]}
 */
function getSearchHistory() {
  return (_userData?.searchHistory) || [];
}

/**
 * Record a search query. Deduplicates (most recent wins) and caps.
 */
async function addSearchEntry(query, resultCount) {
  const history = getSearchHistory().filter(e => e.query !== query);
  history.unshift({ query, resultCount, searchedAt: new Date().toISOString() });
  if (history.length > MAX_SEARCH_HISTORY) history.length = MAX_SEARCH_HISTORY;
  await save({ searchHistory: history });
}

/* ---------- Expanded Folders ---------- */

/**
 * @returns {string[]}  array of folder IDs
 */
function getExpandedFolders() {
  return (_userData?.expandedFolders) || [];
}
async function setExpandedFolders(folderIds) {
  await save({ expandedFolders: folderIds });
}
async function addExpandedFolder(folderId) {
  const expanded = getExpandedFolders();
  if (!expanded.includes(folderId)) {
    expanded.push(folderId);
    await save({ expandedFolders: expanded });
  }
}
async function removeExpandedFolder(folderId) {
  await save({ expandedFolders: getExpandedFolders().filter(id => id !== folderId) });
}

/* ---------- Generated Categories ---------- */

/**
 * @returns {string[]}  category names that have been generated
 */
function getGeneratedCategories() {
  return (_userData?.generatedCategories) || [];
}
async function addGeneratedCategories(categories) {
  const existing = new Set(getGeneratedCategories());
  for (const c of categories) existing.add(c);
  await save({ generatedCategories: [...existing] });
}

/* ---------- Import History ---------- */

/**
 * @returns {{ sheetId: string, sheetName: string, templateKey: string, importedAt: string }[]}
 */
function getImportHistory() {
  return (_userData?.importHistory) || [];
}
async function addImportEntry(entry) {
  const history = getImportHistory();
  history.unshift({ ...entry, importedAt: new Date().toISOString() });
  if (history.length > MAX_IMPORT_HISTORY) history.length = MAX_IMPORT_HISTORY;
  await save({ importHistory: history });
}

/* ---------- Dismissed UI Items ---------- */

/**
 * @returns {string[]}  IDs of dismissed banners/tips
 */
function getDismissedItems() {
  return (_userData?.dismissedItems) || [];
}
function isDismissed(itemId) {
  return getDismissedItems().includes(itemId);
}
async function dismissItem(itemId) {
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
function getHiddenItems() {
  return (_userData?.hiddenItems) || [];
}
function isHidden(itemId) {
  return getHiddenItems().some(i => i.id === itemId);
}
const isItemHidden = isHidden;

/**
 * Hide a Drive item from the explorer.
 * @param {{ id: string, name: string }} item
 */
async function addHiddenItem(item) {
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
async function removeHiddenItem(itemId) {
  await save({ hiddenItems: getHiddenItems().filter(i => i.id !== itemId) });
}

/* ---------- Sort Order ---------- */
function getSortOrder() {
  return _userData?.preferences?.sortOrder || 'name';
}
async function setSortOrder(order) {
  const prefs = { ...(_userData?.preferences || {}), sortOrder: order };
  await save({ preferences: prefs });
}

/* ---------- Theme ---------- */

/**
 * Get the user's theme preference ('light', 'dark', or 'system').
 * @returns {string}
 */
function getTheme() {
  return _userData?.preferences?.theme || 'light';
}

/**
 * Set the theme preference.
 * @param {'light'|'dark'|'system'} theme
 */
async function setTheme(theme) {
  const prefs = { ...(_userData?.preferences || {}), theme: theme || 'light' };
  await save({ preferences: prefs });
}

/* ---------- Import Folder ---------- */

/**
 * Get the custom import folder ID (null = default Waymark/Imports).
 * @returns {string|null}
 */
function getImportFolderId() {
  return _userData?.preferences?.importFolderId || null;
}

/**
 * Get the custom import folder display name.
 * @returns {string|null}
 */
function getImportFolderName() {
  return _userData?.preferences?.importFolderName || null;
}

/**
 * Set a custom folder for imports.
 * @param {string|null} folderId  Drive folder ID (null to reset to default)
 * @param {string|null} folderName  display name
 */
async function setImportFolder(folderId, folderName) {
  const prefs = { ...(_userData?.preferences || {}), importFolderId: folderId, importFolderName: folderName };
  await save({ preferences: prefs });
}

/* ---------- Dev Fleet (Agent Registry) ---------- */

/**
 * Get the configured Agent Registry sheet ID (used by the Fleet sidebar button).
 * @returns {string|null}
 */
function getFleetSheetId() {
  return _userData?.preferences?.fleetSheetId || null;
}

/**
 * Set the Agent Registry sheet ID.
 * @param {string|null} sheetId
 */
async function setFleetSheetId(sheetId) {
  const prefs = { ...(_userData?.preferences || {}), fleetSheetId: sheetId || null };
  await save({ preferences: prefs });
}

/* ---------- GitHub Ref (Version Pinning) ---------- */

/**
 * Get the user's pinned GitHub ref (branch, tag, or commit SHA).
 * Defaults to 'main' if not set.
 * @returns {string}
 */
function getGithubRef() {
  return _userData?.preferences?.githubRef || 'main';
}

/**
 * Pin the user to a specific GitHub ref.
 * @param {string} ref  branch name, tag, or commit SHA
 */
async function setGithubRef(ref) {
  const prefs = { ...(_userData?.preferences || {}), githubRef: ref || 'main' };
  await save({ preferences: prefs });
}

/* ---------- MQTT Debug Bridge ---------- */
function getMqttBridge() {
  return !!_userData?.preferences?.mqttBridge;
}
async function setMqttBridge(enabled) {
  const prefs = { ...(_userData?.preferences || {}), mqttBridge: !!enabled };
  await save({ preferences: prefs });
}
function getMqttBrokerUrl() {
  return _userData?.preferences?.mqttBrokerUrl || '';
}
async function setMqttBrokerUrl(url) {
  const prefs = { ...(_userData?.preferences || {}), mqttBrokerUrl: url || '' };
  await save({ preferences: prefs });
}

/* ---------- Agent Conversations ---------- */

/**
 * Get all stored agent conversations.
 * @returns {Array}
 */
function getAgentConversations() {
  return _userData?.agentConversations || [];
}

/**
 * Save or update an agent conversation.
 * @param {{ id: string, title: string, messages: Array, createdAt: string, updatedAt: string }} conversation
 */
async function saveAgentConversation(conversation) {
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
async function deleteAgentConversation(conversationId) {
  await save({ agentConversations: getAgentConversations().filter(c => c.id !== conversationId) });
}

/* ---------- Agent Settings (Drive-backed) ---------- */

/**
 * Get agent settings from Drive. Returns null if not synced to Drive.
 * @returns {{ apiKey: string, model: string, keys?: Array } | null}
 */
function getAgentSettings() {
  return _userData?.agentSettings || null;
}

/**
 * Save agent settings to Drive. Pass null to opt out of Drive sync.
 * Supports both legacy single-key and multi-key ring formats.
 * @param {{ apiKey: string, model: string, keys?: Array } | null} settings
 */
async function saveAgentSettings(settings) {
  await save({ agentSettings: settings });
}

/* ---------- AI keys vault link (Drive-backed, cross-device) ---------- */

/**
 * Get the Drive-synced AI keys vault link, or null.
 * @returns {{ id: string, name: string } | null}
 */
function getAgentKeysSheet() {
  const id = _userData?.agentKeysSheetId || null;
  if (!id) return null;
  return { id, name: _userData?.agentKeysSheetName || id };
}

/**
 * Persist (or clear) the AI keys vault link so it follows the user across
 * devices. Pass null to clear.
 * @param {{ id: string, name?: string } | null} link
 */
async function saveAgentKeysSheet(link) {
  if (link && link.id) {
    await save({ agentKeysSheetId: link.id, agentKeysSheetName: link.name || link.id });
  } else {
    await save({ agentKeysSheetId: null, agentKeysSheetName: null });
  }
}

/* ---------- Dashboards ---------- */

/**
 * Get all stored dashboards.
 * @returns {Array<{id:string, name:string, layout:string, panels:Array}>}
 */
function getDashboards() {
  return _userData?.dashboards || [];
}

/**
 * Get the user's Wayboard widgets. `null` means use the starter widgets;
 * an empty array means the user chose to clear the dashboard.
 * @returns {Array<{id:string,type:string,title:string,sheetId?:string,size?:string}>|null}
 */
function getHomeWidgets() {
  if (Array.isArray(_userData?.homeWidgets)) return _userData.homeWidgets;
  const cached = storage.getHomeWidgets?.();
  return Array.isArray(cached) ? cached : null;
}

/** Get the synced Wayboard widget schema version for one-time migrations. */
function getHomeWidgetsVersion() {
  return Number(_userData?.homeWidgetsVersion ?? storage.getHomeWidgetsVersion?.() ?? 0);
}

/** Save the user's Wayboard widget configuration to Drive and local storage. */
async function setHomeWidgets(widgets) {
  await save({ homeWidgets: Array.isArray(widgets) ? widgets.slice(0, 16) : [], homeWidgetsVersion: 2 });
}

/**
 * Save or update a dashboard definition.
 * @param {{ id: string, name: string, layout: string, panels: Array }} dashboard
 */
async function saveDashboard(dashboard) {
  const rest = getDashboards().filter(d => d.id !== dashboard.id);
  await save({ dashboards: [dashboard, ...rest] });
}

/**
 * Delete a dashboard by ID.
 * @param {string} dashboardId
 */
async function deleteDashboard(dashboardId) {
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
    homeWidgets: storage.getHomeWidgets?.() ?? null,
    homeWidgetsVersion: storage.getHomeWidgetsVersion?.() ?? 0,
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
    if (storage.setHomeWidgets) storage.setHomeWidgets(data.homeWidgets ?? null);
    if (storage.setHomeWidgetsVersion) storage.setHomeWidgetsVersion(data.homeWidgetsVersion ?? 0);
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
async function clearAll() {
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
function getSignalingSheetId() {
  return _userData?.signalingSheetId ?? null;
}

/**
 * Get the public P2P signaling sheet ID (encrypted WebRTC handshake), or null if not yet created.
 * @returns {string|null}
 */
function getPublicSignalingSheetId() {
  return _userData?.publicSignalingSheetId ?? null;
}

/* ---------- Share Ledgers (per contact / Waymarker Crew) ---------- */

/**
 * Get all auto-provisioned Share Ledger mappings.
 * @returns {Array<{key: string, contactEmail?: string, group?: string, sheetId: string, createdAt: string}>}
 */
function getShareLedgers() {
  return (_userData?.shareLedgers) || [];
}

/**
 * Find the Share Ledger for a ledger key (contact:email or group:name).
 * @param {string} key
 * @returns {{key: string, sheetId: string}|null}
 */
function getShareLedgerFor(key) {
  return getShareLedgers().find(l => l.key === key) || null;
}

/**
 * Record a Share Ledger mapping (idempotent by ledger key).
 * @param {{key: string, contactEmail?: string, group?: string, sheetId: string, ownerEmail?: string, permissionAttempted?: boolean, aliases?: string[]}} entry
 */
async function addShareLedger({ key, contactEmail, group, sheetId, ownerEmail, permissionAttempted = false, aliases = [] }) {
  if (!key || !sheetId) return;
  const replacedKeys = new Set([key, ...aliases]);
  const existing = getShareLedgers().filter(l => !replacedKeys.has(l.key));
  existing.push({
    key,
    contactEmail: (contactEmail || '').trim().toLowerCase() || undefined,
    group: group || undefined,
    sheetId,
    ownerEmail: (ownerEmail || '').trim().toLowerCase() || undefined,
    permissionAttempted: Boolean(permissionAttempted),
    createdAt: new Date().toISOString(),
  });
  await save({ shareLedgers: existing });
}

/**
 * Rotate the AES-256 signal key.
 *
 * Generates a fresh key and stores it in localStorage['waymark_signal_key'].
 * The key is NEVER written to any Google Sheet.
 * The orchestrator is the key authority — it generates and distributes keys
 * at runtime over the WebRTC DataChannel.  This browser-side function is a
 * convenience for manual key rotation when the mesh peer is active.
 *
 * @returns {Promise<void>}
 */
async function cycleSignalKey() {
  const newKey = _generateSignalKeyHex();
  storage.setRaw('waymark_signal_key', newKey);
  // Trigger a DataChannel key-push if the P2P mesh is active.
  if (typeof window !== 'undefined' && window._waymarkMeshPeer?.broadcastKeyExchange) {
    window._waymarkMeshPeer.broadcastKeyExchange(newKey);
  }
}

/* ---------- Lock-on-Submit ---------- */

/**
 * Check whether row-locking on form submission is enabled for a spreadsheet.
 * @param {string} spreadsheetId
 * @returns {boolean}
 */
function getLockOnSubmit(spreadsheetId) {
  return !!(_userData?.lockOnSubmitSheets?.[spreadsheetId]);
}

/**
 * Enable or disable lock-on-submit for a specific spreadsheet.
 * When enabled, the owner's active session will lock each appended row
 * immediately after submission using the Sheets protected-ranges API.
 * @param {string}  spreadsheetId
 * @param {boolean} enabled
 */
async function setLockOnSubmit(spreadsheetId, enabled) {
  const locks = { ...(_userData?.lockOnSubmitSheets || {}) };
  if (enabled) {
    locks[spreadsheetId] = true;
  } else {
    delete locks[spreadsheetId];
  }
  await save({ lockOnSubmitSheets: locks });
}

/* ---------- Folder name exports (for other modules) ---------- */
const FOLDER_NAMES = {
  root: WAYMARK_ROOT_FOLDER,
  examples: EXAMPLES_FOLDER,
  imports: IMPORTS_FOLDER,
};

export {
  FOLDER_NAMES,
  addExpandedFolder,
  addGeneratedCategories,
  addHiddenItem,
  addImportEntry,
  addPinnedFolder,
  addPinnedSheet,
  addRecentSheet,
  addSearchEntry,
  addShareLedger,
  clearAll,
  cycleSignalKey,
  deleteAgentConversation,
  deleteDashboard,
  dismissItem,
  getAgentConversations,
  getAgentKeysSheet,
  getAgentSettings,
  getAutoRefresh,
  getDashboards,
  getData,
  getDefaultFolderForTemplate,
  getDismissedItems,
  getExamplesFolderId,
  getExpandedFolders,
  getFleetSheetId,
  getGeneratedCategories,
  getGithubRef,
  getHiddenItems,
  getHomeTemplateMode,
  getHomeWidgets,
  getHomeWidgetsVersion,
  getImportFolderId,
  getImportFolderName,
  getImportHistory,
  getImportsFolderId,
  getLastView,
  getLockOnSubmit,
  getMqttBridge,
  getMqttBrokerUrl,
  getPinnedFolders,
  getPinnedSheets,
  getPublicSignalingSheetId,
  getRecentSheets,
  getRootFolderId,
  getSearchHistory,
  getShareLedgerFor,
  getShareLedgers,
  getSidebarOpen,
  getSignalingSheetId,
  getSortOrder,
  getTheme,
  getTutorialCompleted,
  getTutorialStep,
  init,
  isDismissed,
  isHidden,
  isItemHidden,
  isPinned,
  isSheetPinned,
  removeExpandedFolder,
  removeHiddenItem,
  removePinnedFolder,
  removePinnedSheet,
  saveAgentConversation,
  saveAgentKeysSheet,
  saveAgentSettings,
  saveDashboard,
  setAutoRefresh,
  setDefaultFolderForTemplate,
  setExpandedFolders,
  setFleetSheetId,
  setGithubRef,
  setHomeTemplateMode,
  setHomeWidgets,
  setImportFolder,
  setLastView,
  setLockOnSubmit,
  setMqttBridge,
  setMqttBrokerUrl,
  setPinnedFolders,
  setSidebarOpen,
  setSortOrder,
  setTheme,
  setTutorialCompleted,
  setTutorialStep,
};
