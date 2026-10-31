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
function getPinnedFolders() {
  return get('pinned_folders') || [];
}
function setPinnedFolders(folders) {
  set('pinned_folders', folders);
}
function addPinnedFolder(folder) {
  const pinned = getPinnedFolders();
  if (pinned.find(f => f.id === folder.id)) return;
  pinned.push(folder);
  setPinnedFolders(pinned);
}
function removePinnedFolder(folderId) {
  setPinnedFolders(getPinnedFolders().filter(f => f.id !== folderId));
}
function isPinned(folderId) {
  return getPinnedFolders().some(f => f.id === folderId);
}

/* --- Pinned Sheets --- */
function getPinnedSheets() {
  return get('pinned_sheets') || [];
}
function setPinnedSheets(sheets) {
  set('pinned_sheets', sheets);
}

/* --- Preferences --- */

/**
 * Selected Home Page layout architecture (1–50). Mirrored to Drive via
 * user-data; this localStorage copy gives a zero-flash load on startup.
 * @returns {number}
 */
function getHomeTemplateMode() {
  const v = parseInt(get('home_template_mode'), 10);
  return (v >= 1 && v <= 50) ? v : 1;
}
function setHomeTemplateMode(mode) {
  const n = parseInt(mode, 10);
  set('home_template_mode', (n >= 1 && n <= 50) ? n : 1);
}

/* --- Wayboard widgets --- */
function getHomeWidgets() {
  return get('home_widgets');
}
function setHomeWidgets(widgets) {
  set('home_widgets', widgets);
}
function getHomeWidgetsVersion() {
  return get('home_widgets_version') || 0;
}
function setHomeWidgetsVersion(version) {
  set('home_widgets_version', Number(version) || 0);
}
function getAutoRefresh() {
  const v = get('auto_refresh');
  return v === null ? true : v;   // default on
}
function setAutoRefresh(enabled) {
  set('auto_refresh', !!enabled);
}
function getLastView() {
  return get('last_view') || '/';
}
function setLastView(hash) {
  set('last_view', hash);
}
function getSidebarOpen() {
  const v = get('sidebar_open');
  return v === null ? true : v;
}
function setSidebarOpen(open) {
  set('sidebar_open', !!open);
}

/* --- Tutorial --- */
function getTutorialCompleted() {
  return !!get('tutorial_completed');
}
function setTutorialCompleted(done) {
  set('tutorial_completed', !!done);
}
function getTutorialStep() {
  return get('tutorial_step') || 0;
}
function setTutorialStep(step) {
  set('tutorial_step', step);
}

/* --- Theme --- */

/**
 * Get the saved theme preference ('light', 'dark', or 'system').
 * @returns {string}
 */
function getTheme() {
  return get('theme') || 'light';
}

/**
 * Save the theme preference.
 * @param {'light'|'dark'|'system'} theme
 */
function setTheme(theme) {
  set('theme', theme);
}

/* --- Recent Sheets --- */
function getRecentSheets() {
  return get('recent_sheets') || [];
}
function setRecentSheets(sheets) {
  set('recent_sheets', sheets);
}

/* --- Search History --- */
function getSearchHistory() {
  return get('search_history') || [];
}
function setSearchHistory(history) {
  set('search_history', history);
}

/* --- Expanded Folders --- */
function getExpandedFolders() {
  return get('expanded_folders') || [];
}
function setExpandedFolders(folders) {
  set('expanded_folders', folders);
}

/* --- Generated Categories --- */
function getGeneratedCategories() {
  return get('generated_categories') || [];
}
function setGeneratedCategories(categories) {
  set('generated_categories', categories);
}

/* --- Import History --- */
function getImportHistory() {
  return get('import_history') || [];
}
function setImportHistory(history) {
  set('import_history', history);
}

/* --- Calorie & Fitness Tracker profile (per sheet) --- */

/** Read the stored profile/goal for a calorie tracker sheet, or null. */
function getCalorieProfile(sheetId) {
  if (!sheetId) return null;
  return get(`calorie_profile_${sheetId}`);
}

/** Persist the profile/goal for a calorie tracker sheet. */
function setCalorieProfile(sheetId, profile) {
  if (!sheetId) return;
  set(`calorie_profile_${sheetId}`, profile);
}

/* --- Generic per-template preferences (namespaced) --- */

/** Read a namespaced template preference value, or null. */
function getTemplatePref(key) {
  if (!key) return null;
  return get(`tpl_${key}`);
}

/** Persist a namespaced template preference value. */
function setTemplatePref(key, value) {
  if (!key) return;
  set(`tpl_${key}`, value);
}

/* --- Dismissed Items --- */
function getDismissedItems() {
  return get('dismissed_items') || [];
}
function setDismissedItems(items) {
  set('dismissed_items', items);
}

/* --- Hidden Items --- */
function getHiddenItems() {
  return get('hidden_items') || [];
}
function setHiddenItems(items) {
  set('hidden_items', items);
}

/* --- Dashboards --- */
function getDashboards() {
  return get('dashboards') || [];
}
function setDashboards(dashboards) {
  set('dashboards', dashboards);
}

/* --- Sort Order --- */
function getSortOrder() {
  return get('sort_order') || 'name';
}
function setSortOrder(order) {
  set('sort_order', order);
}

/* --- Agent --- */

/**
 * Get the legacy single API key (backward compat).
 * Migrates to key ring format on first access if needed.
 * @returns {string}
 */
function getAgentApiKey() {
  const keys = getAgentKeys();
  return keys.length > 0 ? keys[0].key : '';
}

/**
 * Set a single API key (backward compat).
 * Migrates the value into the key ring array.
 * @param {string} key
 */
function setAgentApiKey(key) {
  if (key) {
    const keys = getAgentKeys();
    if (keys.length === 0) {
      setAgentKeys([{ key, nickname: 'Key 1', addedAt: new Date().toISOString(), requestsToday: 0, lastUsed: null, lastError: null, isBilled: false }]);
    } else {
      keys[0].key = key;
      setAgentKeys(keys);
    }
  } else {
    setAgentKeys([]);
  }
}

/**
 * Get all agent API keys (key ring).
 * Handles migration from legacy single-key format.
 * @returns {Array<{key: string, nickname: string, addedAt: string, requestsToday: number, lastUsed: string|null, lastError: string|null, isBilled: boolean}>}
 */
function getAgentKeys() {
  const keys = get('agent_keys');
  if (Array.isArray(keys)) return keys;
  // Migrate legacy single key
  const legacy = get('agent_api_key');
  if (legacy) {
    const migrated = [{ key: legacy, nickname: 'Key 1', addedAt: new Date().toISOString(), requestsToday: 0, lastUsed: null, lastError: null, isBilled: false }];
    set('agent_keys', migrated);
    remove('agent_api_key');
    return migrated;
  }
  return [];
}

/**
 * Save the full key ring array.
 * @param {Array} keys
 */
function setAgentKeys(keys) {
  if (Array.isArray(keys) && keys.length > 0) set('agent_keys', keys);
  else { remove('agent_keys'); remove('agent_api_key'); }
}

/**
 * Record a successful request for a key (by index).
 * @param {number} idx
 */
function recordKeyUsage(idx) {
  const keys = getAgentKeys();
  if (keys[idx]) {
    keys[idx].requestsToday = (keys[idx].requestsToday || 0) + 1;
    keys[idx].lastUsed = new Date().toISOString();
    keys[idx].lastError = null;
    setAgentKeys(keys);
  }
}

/**
 * Record a rate-limit error for a key (by index).
 * @param {number} idx
 */
function recordKeyError(idx) {
  const keys = getAgentKeys();
  if (keys[idx]) {
    keys[idx].lastError = new Date().toISOString();
    setAgentKeys(keys);
  }
}

/**
 * Reset daily request counters (call daily or on new day detection).
 */
function resetDailyKeyCounters() {
  const keys = getAgentKeys();
  keys.forEach(k => { k.requestsToday = 0; });
  setAgentKeys(keys);
}
function getAgentModel() {
  return get('agent_model') || '';
}
function setAgentModel(model) {
  if (model) set('agent_model', model);
  else remove('agent_model');
}

/* ---------- Provider selection ---------- */
function getAgentProvider() {
  return get('agent_provider') || 'gemini';
}
function setAgentProvider(provider) {
  if (provider) set('agent_provider', provider);
  else remove('agent_provider');
}

/* ---------- Claude key ring ---------- */
function getClaudeKeys() {
  return get('agent_claude_keys') || [];
}
function setClaudeKeys(keys) {
  if (Array.isArray(keys) && keys.length > 0) set('agent_claude_keys', keys);
  else remove('agent_claude_keys');
}
function getClaudeModel() {
  return get('agent_claude_model') || '';
}
function setClaudeModel(model) {
  if (model) set('agent_claude_model', model);
  else remove('agent_claude_model');
}
function recordClaudeKeyUsage(idx) {
  const keys = getClaudeKeys();
  if (keys[idx]) {
    keys[idx].requestsToday = (keys[idx].requestsToday || 0) + 1;
    keys[idx].lastUsed = new Date().toISOString();
    keys[idx].lastError = null;
    setClaudeKeys(keys);
  }
}
function recordClaudeKeyError(idx) {
  const keys = getClaudeKeys();
  if (keys[idx]) {
    keys[idx].lastError = new Date().toISOString();
    setClaudeKeys(keys);
  }
}

/* ---------- Ollama settings ---------- */
function getOllamaModel() {
  return get('agent_ollama_model') || '';
}
function setOllamaModel(model) {
  if (model) set('agent_ollama_model', model);
  else remove('agent_ollama_model');
}
function getOllamaBaseUrl() {
  return get('agent_ollama_base_url') || '';
}
function setOllamaBaseUrl(url) {
  if (url) set('agent_ollama_base_url', url);
  else remove('agent_ollama_base_url');
}

/* ---------- OpenAI key ring ---------- */
function getOpenAIKeys() {
  return get('agent_openai_keys') || [];
}
function setOpenAIKeys(keys) {
  if (Array.isArray(keys) && keys.length > 0) set('agent_openai_keys', keys);
  else remove('agent_openai_keys');
}
function getOpenAIModel() {
  return get('agent_openai_model') || '';
}
function setOpenAIModel(model) {
  if (model) set('agent_openai_model', model);
  else remove('agent_openai_model');
}
function getOpenAIImageModel() {
  return get('agent_openai_image_model') || '';
}
function setOpenAIImageModel(model) {
  if (model) set('agent_openai_image_model', model);
  else remove('agent_openai_image_model');
}
function recordOpenAIKeyUsage(idx) {
  const keys = getOpenAIKeys();
  if (keys[idx]) {
    keys[idx].requestsToday = (keys[idx].requestsToday || 0) + 1;
    keys[idx].lastUsed = new Date().toISOString();
    keys[idx].lastError = null;
    setOpenAIKeys(keys);
  }
}
function recordOpenAIKeyError(idx) {
  const keys = getOpenAIKeys();
  if (keys[idx]) {
    keys[idx].lastError = new Date().toISOString();
    setOpenAIKeys(keys);
  }
}

/* ---------- Provider pricing tier ---------- */

/**
 * Billing tier for the Gemini provider. Gemini's Free Tier cannot generate
 * photorealistic images and is rate-limited, so the router treats 'free' as
 * Tier 0 (cheapest) and 'paid' as Tier 1.
 * @returns {'free'|'paid'}
 */
function getGeminiTier() {
  return get('agent_gemini_tier') || 'free';
}
function setGeminiTier(tier) {
  set('agent_gemini_tier', tier === 'paid' ? 'paid' : 'free');
}

/* ---------- Simultaneously enabled providers (cost-aware router) ---------- */

/**
 * The set of providers the cost-aware router may use at the same time.
 * When unset, every provider that has a usable configuration is considered
 * enabled, so existing single-provider setups keep working unchanged.
 * @returns {string[]|null}  explicit enabled list, or null for "auto"
 */
function getEnabledProviders() {
  const v = get('agent_enabled_providers');
  return Array.isArray(v) ? v : null;
}
function setEnabledProviders(providers) {
  if (Array.isArray(providers)) set('agent_enabled_providers', providers);
  else remove('agent_enabled_providers');
}
function getAgentConversation() {
  return get('agent_conversation') || [];
}
function setAgentConversation(messages) {
  set('agent_conversation', messages || []);
}

/**
 * Get the last-used key index for round-robin rotation.
 * @returns {number}
 */
function getAgentKeyIndex() {
  return get('agent_key_index') || 0;
}

/**
 * Set the current key index.
 * @param {number} idx
 */
function setAgentKeyIndex(idx) {
  set('agent_key_index', idx);
}

/* --- Agent Context Files --- */
function getAgentContextFiles() {
  return get('agent_context_files') || [];
}
function setAgentContextFiles(files) {
  if (Array.isArray(files) && files.length > 0) set('agent_context_files', files);
  else remove('agent_context_files');
}

/* --- Import Folder --- */
function getImportFolderId() {
  return get('import_folder_id') || null;
}
function setImportFolderId(folderId) {
  if (folderId) set('import_folder_id', folderId);
  else remove('import_folder_id');
}
function getImportFolderName() {
  return get('import_folder_name') || null;
}
function setImportFolderName(folderName) {
  if (folderName) set('import_folder_name', folderName);
  else remove('import_folder_name');
}

/* --- GitHub Ref --- */
function getGithubRef() {
  return get('github_ref') || 'main';
}
function setGithubRef(ref) {
  set('github_ref', ref || 'main');
}

/* --- Folder Index Cache --- */

/**
 * Get cached folder index (sheet summaries keyed by sheet ID).
 * @param {string} folderId
 * @returns {Object|null}  { [sheetId]: { name, headers, firstRow, templateKey, icon, modified } }
 */
function getFolderIndex(folderId) {
  return get('folder_idx_' + folderId);
}

/**
 * Store folder index cache.
 * @param {string} folderId
 * @param {Object} index
 */
function setFolderIndex(folderId, index) {
  set('folder_idx_' + folderId, index);
}

/* --- Clear All --- */
function clearAll() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX))
    .forEach(k => localStorage.removeItem(k));
}

/* --- Notifications --- */
function getNotifications() {
  return get('notifications') || [];
}
function setNotifications(items) {
  set('notifications', items || []);
}
function getNotificationSettings() {
  return get('notification_settings') || {};
}
function setNotificationSettings(settings) {
  set('notification_settings', settings || {});
}
function getNotifSheetId() {
  return localStorage.getItem('waymark_notif_sheet_id') || null;
}
function setNotifSheetId(id) {
  if (id) {
    localStorage.setItem('waymark_notif_sheet_id', id);
  } else {
    localStorage.removeItem('waymark_notif_sheet_id');
  }
}
function getNotificationRules(sheetId) {
  const all = get('notification_rules') || {};
  return all[sheetId] || [];
}
function setNotificationRules(sheetId, rules) {
  const all = get('notification_rules') || {};
  if (rules && rules.length > 0) {
    all[sheetId] = rules;
  } else {
    delete all[sheetId];
  }
  set('notification_rules', all);
}
function getAllNotificationRules() {
  return get('notification_rules') || {};
}

/* --- Bilateral sharing cursors (last-seen row counts per shared sheet) --- */
function getBilateralCursors() {
  return get('bilateral_cursors') || {};
}
function getBilateralCursor(sheetId) {
  return getBilateralCursors()[sheetId] || 0;
}
function setBilateralCursor(sheetId, count) {
  const all = getBilateralCursors();
  all[sheetId] = count;
  set('bilateral_cursors', all);
}
function getChatCursors() {
  return get('chat_cursors') || {};
}
function getChatCursor(sheetId) {
  return getChatCursors()[sheetId] || 0;
}
function setChatCursor(sheetId, count) {
  const all = getChatCursors();
  all[sheetId] = count;
  set('chat_cursors', all);
}

/* --- Cleared notifications (so "Clear all" survives Push Notification Sheet re-sync) --- */

const MAX_CLEARED_NOTIF_KEYS = 500;
function getClearedNotifKeys() {
  return get('cleared_notif_keys') || [];
}
function addClearedNotifKeys(keys) {
  const merged = [...new Set([...getClearedNotifKeys(), ...(keys || []).filter(Boolean)])];
  set('cleared_notif_keys', merged.slice(-MAX_CLEARED_NOTIF_KEYS));
}

/* --- Accepted & Rejected Shared Waymarks --- */
function getAcceptedShares() {
  return get('accepted_shares') || [];
}
function setAcceptedShares(ids) {
  set('accepted_shares', Array.isArray(ids) ? ids : []);
}
function addAcceptedShare(docId) {
  if (!docId) return;
  const current = new Set(getAcceptedShares());
  current.add(docId);
  setAcceptedShares([...current]);
  removeRejectedShare(docId);
}
function isShareAccepted(docId) {
  return Boolean(docId && getAcceptedShares().includes(docId));
}
function getRejectedShares() {
  return get('rejected_shares') || [];
}
function setRejectedShares(ids) {
  set('rejected_shares', Array.isArray(ids) ? ids : []);
}
function addRejectedShare(docId) {
  if (!docId) return;
  const current = new Set(getRejectedShares());
  current.add(docId);
  setRejectedShares([...current]);
  setAcceptedShares(getAcceptedShares().filter(id => id !== docId));
}
function removeRejectedShare(docId) {
  if (!docId) return;
  setRejectedShares(getRejectedShares().filter(id => id !== docId));
}
function isShareRejected(docId) {
  return Boolean(docId && getRejectedShares().includes(docId));
}

/* --- Shared Document ↔ Share Ledger Registry --- */
function getAllSharedDocLedgers() {
  return get('shared_doc_ledgers') || {};
}
function getSharedDocLedgers(docId) {
  if (!docId) return [];
  const all = getAllSharedDocLedgers();
  return Array.isArray(all[docId]) ? all[docId] : [];
}
function recordSharedDocLedger(docId, entry = {}) {
  if (!docId || !entry.ledgerSheetId) return;
  const all = getAllSharedDocLedgers();
  const list = Array.isArray(all[docId]) ? all[docId] : [];
  const idx = list.findIndex(item => item.ledgerSheetId === entry.ledgerSheetId);
  const nextEntry = {
    ledgerSheetId: entry.ledgerSheetId,
    contactEmail: entry.contactEmail || (idx >= 0 ? list[idx].contactEmail : '') || '',
    group: entry.group || (idx >= 0 ? list[idx].group : '') || '',
    docTitle: entry.docTitle || (idx >= 0 ? list[idx].docTitle : '') || '',
    waymarkType: entry.waymarkType || (idx >= 0 ? list[idx].waymarkType : '') || '',
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) list[idx] = nextEntry;
  else list.push(nextEntry);
  all[docId] = list;
  set('shared_doc_ledgers', all);
}

/* --- Sheet Content Digests (for collaborative change detection) --- */
function getSheetDigests() {
  return get('sheet_digests') || {};
}
function getSheetDigest(sheetId) {
  if (!sheetId) return null;
  return getSheetDigests()[sheetId] || null;
}
function setSheetDigest(sheetId, digest) {
  if (!sheetId) return;
  const all = getSheetDigests();
  if (digest) {
    const previousModifiedTime = all[sheetId]?.modifiedTime;
    all[sheetId] = digest.modifiedTime || !previousModifiedTime
      ? digest
      : { ...digest, modifiedTime: previousModifiedTime };
  }
  else delete all[sheetId];
  set('sheet_digests', all);
}

/* ---------- Cross-Feature Links ---------- */

/**
 * Get cross-feature links for a sheet.
 * @param {string} sheetId
 * @returns {Array<{featureId: string, linkedSheetId: string, linkedSheetName: string}>}
 */
function getCrossLinks(sheetId) {
  const all = get('cross_links') || {};
  return all[sheetId] || [];
}

/**
 * Set cross-feature links for a sheet.
 * @param {string} sheetId
 * @param {Array<{featureId: string, linkedSheetId: string, linkedSheetName: string}>} links
 */
function setCrossLinks(sheetId, links) {
  const all = get('cross_links') || {};
  if (links && links.length > 0) {
    all[sheetId] = links;
  } else {
    delete all[sheetId];
  }
  set('cross_links', all);
}

/* ---------- Chat Preferences ---------- */
function getChatSaveHistory() {
  return get('chat_save_history') ?? true;
}
function setChatSaveHistory(enabled) {
  set('chat_save_history', !!enabled);
}
function getChatSoundEnabled() {
  return get('chat_sound_enabled') ?? true;
}
function setChatSoundEnabled(enabled) {
  set('chat_sound_enabled', !!enabled);
}

/* ---------- Audio Processing ---------- */

/** @returns {boolean} Echo cancellation enabled (default true) */
function getEchoCancellation() {
  return get('audio_echo_cancellation') ?? true;
}

/** @param {boolean} enabled */
function setEchoCancellation(enabled) {
  set('audio_echo_cancellation', !!enabled);
}

/** @returns {boolean} Noise suppression enabled (default true) */
function getNoiseSuppression() {
  return get('audio_noise_suppression') ?? true;
}

/** @param {boolean} enabled */
function setNoiseSuppression(enabled) {
  set('audio_noise_suppression', !!enabled);
}

/** @returns {boolean} Auto gain control enabled (default true) */
function getAutoGainControl() {
  return get('audio_auto_gain') ?? true;
}

/** @param {boolean} enabled */
function setAutoGainControl(enabled) {
  set('audio_auto_gain', !!enabled);
}

/** @returns {number} Noise gate threshold in dB (default -50) */
function getNoiseGateThreshold() {
  return get('audio_gate_threshold') ?? -50;
}

/** @param {number} dB */
function setNoiseGateThreshold(dB) {
  set('audio_gate_threshold', Number(dB));
}

/** @returns {number} High-pass filter cutoff in Hz (default 80) */
function getHighPassFreq() {
  return get('audio_highpass_freq') ?? 80;
}

/** @param {number} hz */
function setHighPassFreq(hz) {
  set('audio_highpass_freq', Number(hz));
}

/** @returns {number} Echo suppression strength. 0 = off, 1 = full mute while speaking. Default 0.95 */
function getEchoSuppression() {
  return get('audio_echo_suppression') ?? 0.95;
}

/** @param {number} level — 0 to 1 */
function setEchoSuppression(level) {
  set('audio_echo_suppression', Number(level));
}

/* --- AI Model Preference --- */

/** @returns {string} Current AI model: 'claude' or 'gemini' (default 'claude') */
function getAiModel() {
  return get('ai_model') ?? 'claude';
}

/** @param {string} model — 'claude' or 'gemini' */
function setAiModel(model) {
  set('ai_model', String(model));
}

/* --- Generic get/set for model-swap --- */

/** Internal: Generic storage getter */
function getStorageValue(key) {
  return get(key);
}

/** Internal: Generic storage setter */
function setStorageValue(key, value) {
  set(key, value);
}


/* --- Generic Raw Storage Helpers --- */

function getRaw(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function setRaw(key, value) {
  try { localStorage.setItem(key, value); }
  catch { /* noop */ }
}

function removeRaw(key) {
  try { localStorage.removeItem(key); }
  catch { /* noop */ }
}

function getJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* noop */ }
}

function getSheetLocked(sheetId) {
  return getRaw('waymark-lock-' + sheetId) === '1';
}

function setSheetLocked(sheetId, locked) {
  setRaw('waymark-lock-' + sheetId, locked ? '1' : '0');
}

export {
  getPinnedFolders,
  setPinnedFolders,
  addPinnedFolder,
  removePinnedFolder,
  isPinned,
  getPinnedSheets,
  setPinnedSheets,
  getHomeTemplateMode,
  setHomeTemplateMode,
  getHomeWidgets,
  setHomeWidgets,
  getHomeWidgetsVersion,
  setHomeWidgetsVersion,
  getAutoRefresh,
  setAutoRefresh,
  getLastView,
  setLastView,
  getSidebarOpen,
  setSidebarOpen,
  getTutorialCompleted,
  setTutorialCompleted,
  getTutorialStep,
  setTutorialStep,
  getTheme,
  setTheme,
  getRecentSheets,
  setRecentSheets,
  getSearchHistory,
  setSearchHistory,
  getExpandedFolders,
  setExpandedFolders,
  getGeneratedCategories,
  setGeneratedCategories,
  getImportHistory,
  setImportHistory,
  getCalorieProfile,
  setCalorieProfile,
  getTemplatePref,
  setTemplatePref,
  getDismissedItems,
  setDismissedItems,
  getHiddenItems,
  setHiddenItems,
  getDashboards,
  setDashboards,
  getSortOrder,
  setSortOrder,
  getAgentApiKey,
  setAgentApiKey,
  getAgentKeys,
  setAgentKeys,
  recordKeyUsage,
  recordKeyError,
  resetDailyKeyCounters,
  getAgentModel,
  setAgentModel,
  getAgentProvider,
  setAgentProvider,
  getClaudeKeys,
  setClaudeKeys,
  getClaudeModel,
  setClaudeModel,
  recordClaudeKeyUsage,
  recordClaudeKeyError,
  getOllamaModel,
  setOllamaModel,
  getOllamaBaseUrl,
  setOllamaBaseUrl,
  getOpenAIKeys,
  setOpenAIKeys,
  getOpenAIModel,
  setOpenAIModel,
  getOpenAIImageModel,
  setOpenAIImageModel,
  recordOpenAIKeyUsage,
  recordOpenAIKeyError,
  getGeminiTier,
  setGeminiTier,
  getEnabledProviders,
  setEnabledProviders,
  getAgentConversation,
  setAgentConversation,
  getAgentKeyIndex,
  setAgentKeyIndex,
  getAgentContextFiles,
  setAgentContextFiles,
  getImportFolderId,
  setImportFolderId,
  getImportFolderName,
  setImportFolderName,
  getGithubRef,
  setGithubRef,
  getFolderIndex,
  setFolderIndex,
  clearAll,
  getNotifications,
  setNotifications,
  getNotificationSettings,
  setNotificationSettings,
  getNotifSheetId,
  setNotifSheetId,
  getNotificationRules,
  setNotificationRules,
  getAllNotificationRules,
  getBilateralCursors,
  getBilateralCursor,
  setBilateralCursor,
  getChatCursors,
  getChatCursor,
  setChatCursor,
  getClearedNotifKeys,
  addClearedNotifKeys,
  getAcceptedShares,
  setAcceptedShares,
  addAcceptedShare,
  isShareAccepted,
  getRejectedShares,
  setRejectedShares,
  addRejectedShare,
  removeRejectedShare,
  isShareRejected,
  getAllSharedDocLedgers,
  getSharedDocLedgers,
  recordSharedDocLedger,
  getSheetDigests,
  getSheetDigest,
  setSheetDigest,
  getCrossLinks,
  setCrossLinks,
  getChatSaveHistory,
  setChatSaveHistory,
  getChatSoundEnabled,
  setChatSoundEnabled,
  getEchoCancellation,
  setEchoCancellation,
  getNoiseSuppression,
  setNoiseSuppression,
  getAutoGainControl,
  setAutoGainControl,
  getNoiseGateThreshold,
  setNoiseGateThreshold,
  getHighPassFreq,
  setHighPassFreq,
  getEchoSuppression,
  setEchoSuppression,
  getAiModel,
  setAiModel,
  getStorageValue,
  setStorageValue,
  getRaw,
  setRaw,
  removeRaw,
  getJson,
  setJson,
  getSheetLocked,
  setSheetLocked,
};
