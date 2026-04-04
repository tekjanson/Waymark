/* ============================================================
   app.js — WayMark entry point
   Initialises all modules, manages routing, and orchestrates
   the authentication flow.
   ============================================================ */

import { api }       from './api-client.js';
import * as storage  from './storage.js';
import * as userData from './user-data.js';
import { el, showView, showLoading, hideLoading, showToast, toggleSidebar, closeSidebar, isSidebarOpen, timeAgo } from './ui.js';
import * as explorer from './explorer.js';
import * as checklist from './checklist.js';
import * as search   from './search.js';
import * as records  from './records.js';
import { generateExamples, getExampleCategories } from './examples.js';
import { Tutorial } from './tutorial.js';
import * as importer from './import.js';
import { scrapeRecipe } from './recipe-scraper.js';
import { TEMPLATES, detectTemplate } from './templates/index.js';
import * as agent from './agent.js';
import * as notifications from './notifications.js';
import * as dashboard from './dashboard.js';

/* ---------- DOM refs ---------- */
const loginScreen   = document.getElementById('login-screen');
const appScreen     = document.getElementById('app-screen');
const loginBtn      = document.getElementById('login-btn');
const logoutBtn     = document.getElementById('logout-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');
const userNameEl    = document.getElementById('user-name');
const userAvatarEl  = document.getElementById('user-avatar');
const backBtn       = document.getElementById('back-btn');
const folderBackBtn = document.getElementById('folder-back-btn');
const generateProg  = document.getElementById('generate-progress');
const tutorialBtn   = document.getElementById('tutorial-btn');

/* ---------- Sidebar menu refs ---------- */
const menuHomeBtn      = document.getElementById('menu-home-btn');
const menuExplorerBtn  = document.getElementById('menu-explorer-btn');
const menuCreateBtn    = document.getElementById('menu-create-btn');
const menuImportBtn    = document.getElementById('menu-import-btn');
const menuExamplesBtn  = document.getElementById('menu-examples-btn');
const menuAgentBtn     = document.getElementById('menu-agent-btn');
const menuDashboardBtn = document.getElementById('menu-dashboard-btn');
const explorerRefreshBtn = document.getElementById('explorer-refresh-btn');

/* ---------- Example Modal refs ---------- */
const examplesModal       = document.getElementById('examples-modal');
const examplesModalClose  = document.getElementById('examples-modal-close');
const examplesCancelBtn   = document.getElementById('examples-cancel-btn');
const examplesGenerateBtn = document.getElementById('examples-generate-btn');
const examplesSelectAll   = document.getElementById('examples-select-all');
const examplesSelectNone  = document.getElementById('examples-select-none');
const examplesCategories  = document.getElementById('examples-categories');
const examplesCount       = document.getElementById('examples-selection-count');
const examplesModalProg   = document.getElementById('examples-modal-progress');

/* ---------- Settings Modal refs ---------- */
const settingsModal       = document.getElementById('settings-modal');
const settingsModalClose  = document.getElementById('settings-modal-close');
const settingsDoneBtn     = document.getElementById('settings-done-btn');
const settingsAutoRefresh = document.getElementById('settings-auto-refresh');
const settingsMqttBridge  = document.getElementById('settings-mqtt-bridge');
const settingsMqttUrl    = document.getElementById('settings-mqtt-url');
const settingsMqttUrlApply = document.getElementById('settings-mqtt-url-apply');
const settingsSortOrder   = document.getElementById('settings-sort-order');
const settingsImportFolder = document.getElementById('settings-import-folder');
const settingsChooseFolder = document.getElementById('settings-choose-folder');
const settingsResetFolder  = document.getElementById('settings-reset-folder');
const settingsFolderBrowser = document.getElementById('settings-folder-browser');

/* ---------- Version Picker refs ---------- */
const settingsVersionSection = document.getElementById('settings-version-section');
const settingsGithubRef      = document.getElementById('settings-github-ref');
const settingsApplyRef       = document.getElementById('settings-apply-ref');
const settingsRefStatus      = document.getElementById('settings-ref-status');
const settingsRefSuggestions = document.getElementById('settings-ref-suggestions');
const settingsCurrentRef     = document.getElementById('settings-current-ref');

/* ---------- Import Modal refs ---------- */
const importModal         = document.getElementById('import-modal');
const importModalClose    = document.getElementById('import-modal-close');
const importCancelBtn     = document.getElementById('import-cancel-btn');
const importBackBtn       = document.getElementById('import-back-btn');
const importNextBtn       = document.getElementById('import-next-btn');
const importSearchInput   = document.getElementById('import-search-input');
const importSheetList     = document.getElementById('import-sheet-list');
const importStepPick      = document.getElementById('import-step-pick');
const importStepAnalyze   = document.getElementById('import-step-analyze');
const importStepReview    = document.getElementById('import-step-review');
const importPreviewName   = document.getElementById('import-preview-name');
const importPreviewRows   = document.getElementById('import-preview-rows');
const importPreviewTable  = document.getElementById('import-preview-table');
const importTemplatePick  = document.getElementById('import-template-pick');
const importDetectConf    = document.getElementById('import-detect-confidence');
const importColMapEditor  = document.getElementById('import-column-map-editor');
const importAnalysisSummary = document.getElementById('import-analysis-summary');
const importResultTemplate  = document.getElementById('import-result-template');
const importResultConfidence= document.getElementById('import-result-confidence');
const importResultRows      = document.getElementById('import-result-rows');
const importMappingTable    = document.getElementById('import-mapping-table');
const importProgress        = document.getElementById('import-progress');
const importModalTitle      = document.getElementById('import-modal-title');

/* ---------- Recipe URL Import refs ---------- */
const recipeUrlInput       = document.getElementById('recipe-url-input');
const recipeUrlImportBtn   = document.getElementById('recipe-url-import-btn');
const recipeUrlStatus      = document.getElementById('recipe-url-status');

/* ---------- Create Sheet Modal refs ---------- */
const createSheetModal          = document.getElementById('create-sheet-modal');
const createSheetModalClose     = document.getElementById('create-sheet-modal-close');
const createSheetCancelBtn      = document.getElementById('create-sheet-cancel-btn');
const createSheetCreateBtn      = document.getElementById('create-sheet-create-btn');
const createSheetNameInput      = document.getElementById('create-sheet-name');
const createSheetGrid           = document.getElementById('create-sheet-templates');
const createSheetSearchInput    = document.getElementById('create-sheet-search');
const createSheetStatus         = document.getElementById('create-sheet-status');
const createSheetProgress       = document.getElementById('create-sheet-progress');
const createSheetFolderDisplay  = document.getElementById('create-sheet-folder-display');
const createSheetChooseFolderBtn = document.getElementById('create-sheet-choose-folder-btn');

/* ---------- Legacy template headers fallback ---------- */
const LEGACY_TEMPLATE_HEADERS = {
  checklist:  ['Item', 'Status', 'Quantity', 'Notes'],
  tracker:    ['Goal', 'Progress', 'Target', 'Notes'],
  schedule:   ['Day', 'Time', 'Activity', 'Location'],
  inventory:  ['Item', 'Quantity', 'Category', 'Expires'],
  contacts:   ['Name', 'Phone', 'Email', 'Relationship'],
  log:        ['Timestamp', 'Activity', 'Duration', 'Type'],
  budget:     ['Description', 'Amount', 'Category', 'Date', 'Budget'],
  kanban:     ['Task', 'Description', 'Stage', 'Project', 'Assignee', 'Priority', 'Due', 'Label', 'Note'],
  habit:      ['Habit', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Streak'],
  grading:    ['Student', 'Homework 1', 'Homework 2', 'Midterm', 'Final', 'Grade'],
  timesheet:  ['Project', 'Client', 'Hours', 'Rate', 'Billable', 'Date'],
  poll:       ['Option', 'Votes', 'Percent', 'Notes'],
  changelog:  ['Version', 'Date', 'Type', 'What Changed'],
  crm:        ['Company', 'Contact', 'Deal Stage', 'Value', 'Notes'],
  meal:       ['Day', 'Meal', 'Recipe', 'Calories', 'Protein'],
  travel:     ['Activity', 'Date', 'Location', 'Booking', 'Cost'],
  roster:     ['Employee', 'Role', 'Shift', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  recipe:     ['Recipe', 'Servings', 'Prep Time', 'Cook Time', 'Category', 'Difficulty', 'Quantity', 'Ingredient', 'Step', 'Source'],
  testcases:  ['Test Case', 'Result', 'Expected', 'Actual', 'Priority', 'Notes'],
};

/**
 * Resolve headers used when creating a new sheet for a template.
 * Prefer the template's own defaultHeaders to keep create-sheet in sync
 * as new templates are added, with a legacy fallback map for older defs.
 * @param {string} key
 * @param {object} tpl
 * @returns {string[]}
 */
function getTemplateHeaders(key, tpl) {
  const defaults = tpl && Array.isArray(tpl.defaultHeaders) ? tpl.defaultHeaders : null;
  if (defaults && defaults.length > 0) return defaults;
  return LEGACY_TEMPLATE_HEADERS[key] || [];
}

/* ---------- Navigation history ---------- */

/**
 * Stack of internal hash routes visited since app boot.
 * Used by back buttons to decide whether to use browser history
 * or fall back to a parent/home route.
 */
let _navHistory = [];

/**
 * Maps sheet-ID → { folderId, folderName } so the sheet-view
 * back button can return to the folder the user came from.
 */
let _sheetOrigin = {};

/* ---------- Navigation callback ---------- */

function navigate(type, id, name) {
  if (type === 'sheet') {
    // Remember which folder we came from (if any)
    const curHash = window.location.hash || '#/';
    const folderMatch = curHash.match(/^#\/folder\/([^/]+)\/(.*)/);
    if (folderMatch) {
      _sheetOrigin[id] = {
        folderId: folderMatch[1],
        folderName: decodeURIComponent(folderMatch[2] || 'Folder'),
      };
    }
    window.location.hash = `#/sheet/${id}`;
  } else if (type === 'folder') {
    window.location.hash = `#/folder/${id}/${encodeURIComponent(name || '')}`;
  }
}

/* ---------- Init ---------- */

async function boot() {
  showLoading();

  // Init sub-modules
  checklist.init();
  explorer.init(document.getElementById('explorer'), navigate);
  search.init(navigate);
  notifications.init(document.querySelector('.top-bar-right'));
  dashboard.init(document.getElementById('dashboard-view'));

  // Wire UI events
  loginBtn.addEventListener('click',  () => api.auth.login());
  logoutBtn.addEventListener('click', handleLogout);
  sidebarToggle.addEventListener('click', () => {
    const open = toggleSidebar();
    userData.setSidebarOpen(open);
  });

  // Evaluate notifications when a sheet is rendered
  document.addEventListener('waymark:sheet-rendered', (e) => {
    const { sheetId, title, templateKey, rows, cols, headers } = e.detail;
    notifications.evaluateSheet(sheetId, title, templateKey, rows, cols, headers);
  });

  // Persist sidebar state from swipe/overlay events
  window.addEventListener('waymark:sidebar-closed', () => userData.setSidebarOpen(false));
  window.addEventListener('waymark:sidebar-opened', () => userData.setSidebarOpen(true));

  // Back buttons — use browser history when available, otherwise smart fallback
  backBtn.addEventListener('click', () => { goBack(); });
  folderBackBtn.addEventListener('click', () => { goBack(); });

  // Sidebar menu buttons
  if (menuHomeBtn) {
    menuHomeBtn.addEventListener('click', () => {
      window.location.hash = '#/';
      updateMenuActive('home');
      autoCloseSidebarMobile();
    });
  }
  if (menuExplorerBtn) {
    menuExplorerBtn.addEventListener('click', () => {
      window.location.hash = '#/explorer';
      updateMenuActive('explorer');
      autoCloseSidebarMobile();
    });
  }
  if (menuCreateBtn) {
    menuCreateBtn.addEventListener('click', () => {
      openCreateSheetModal();
      autoCloseSidebarMobile();
    });
  }
  if (menuImportBtn) {
    menuImportBtn.addEventListener('click', () => {
      openImportModal();
      autoCloseSidebarMobile();
    });
  }
  if (menuExamplesBtn) {
    menuExamplesBtn.addEventListener('click', () => {
      openExamplesModal();
      autoCloseSidebarMobile();
    });
  }
  if (menuAgentBtn) {
    menuAgentBtn.addEventListener('click', () => {
      window.location.hash = '#/agent';
      autoCloseSidebarMobile();
    });
  }
  if (menuDashboardBtn) {
    menuDashboardBtn.addEventListener('click', () => {
      window.location.hash = '#/dashboard';
      updateMenuActive('dashboard');
      autoCloseSidebarMobile();
    });
  }
  if (explorerRefreshBtn) {
    explorerRefreshBtn.addEventListener('click', () => explorer.refresh());
  }

  // Wire examples modal
  initExamplesModal();

  // Wire import modal
  initImportModal();

  // Wire create sheet modal
  initCreateSheetModal();

  // Wire settings modal
  initSettingsModal();

  // Wire theme toggle
  initTheme();

  // Listen for pin changes to re-render home
  window.addEventListener('waymark:pins-changed', renderHome);

  // Listen for recipe re-sync requests from the recipe template
  window.addEventListener('waymark:recipe-resync', handleRecipeResync);

  // Restore sidebar state
  toggleSidebar(userData.getSidebarOpen());

  // Start MQTT bridge early if forced via ?mqtt=1 or on localhost (dev convenience)
  const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (new URLSearchParams(location.search).has('mqtt') || isLocalDev) {
    import('./mqtt-bridge.js').then(m => m.startBridge()).catch(err => {
      console.warn('[MQTT Bridge] Failed to start (forced):', err.message);
    });
  }

  // Public route: skip auth entirely and show sheet in read-only mode
  const bootHash = window.location.hash || '#/';
  if (bootHash.startsWith('#/public/')) {
    hideLoading();
    enterPublicMode(bootHash);
    return;
  }

  // Attempt auth
  const user = await api.auth.init();
  hideLoading();

  if (user) {
    await showApp(user);
  } else {
    showLogin();
  }
}

/* ---------- Auth ---------- */

function showLogin() {
  loginScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

/* ---------- Public Mode ---------- */

/**
 * Enter public viewing mode — no auth, no sidebar, read-only.
 * @param {string} hash  current hash like '#/public/{sheetId}'
 */
function enterPublicMode(hash) {
  document.body.classList.add('waymark-public');
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');

  const sheetId = hash.replace('#/public/', '');
  showView('checklist');
  checklist.showPublic(sheetId);

  // Handle hash changes while in public mode
  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash || '#/';
    if (newHash.startsWith('#/public/')) {
      const newId = newHash.replace('#/public/', '');
      checklist.hide();
      showView('checklist');
      checklist.showPublic(newId);
    } else {
      // Leaving public mode — full reload to go through normal auth flow
      document.body.classList.remove('waymark-public');
      window.location.reload();
    }
  });
}

async function showApp(user) {
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');

  // Update user info in top bar
  _userName = user.name || user.email || '';
  userNameEl.textContent = _userName;
  if (user.picture) {
    userAvatarEl.src = user.picture;
    userAvatarEl.alt = user.name || '';
    userAvatarEl.classList.remove('hidden');
  }

  // Initialize Drive-backed user data (pins, prefs, Waymark folder)
  try {
    await userData.init();
  } catch (err) {
    console.warn('user-data init failed, using localStorage fallback:', err);
  }

  // Start MQTT bridge if enabled in settings OR via ?mqtt=1 URL param
  const mqttForced = new URLSearchParams(location.search).has('mqtt');
  if (userData.getMqttBridge() || mqttForced) {
    const mqttUrl = userData.getMqttBrokerUrl() || undefined;
    import('./mqtt-bridge.js').then(m => m.startBridge(mqttUrl)).catch(err => {
      console.warn('[MQTT Bridge] Failed to start:', err.message);
    });
  }

  // Ensure the notification sheet exists in the Waymark directory.
  // Fire-and-forget — don't block app boot if it fails.
  notifications.ensureSheet().catch(err => {
    console.warn('[notifications] Sheet setup failed:', err);
  });

  // Expose Drive-save function so the server-injected version picker can
  // persist the pinned ref to Google Drive (cross-device persistence).
  window.__waymarkSavePinnedRef = (ref) => userData.setGithubRef(ref);

  // Boot-time sync: if the user's Drive-stored pinned ref differs from
  // what the server is currently serving, switch the server to match.
  // Uses sessionStorage to run only once per session (prevents reverting
  // temporary switches on normal page refreshes).
  const serverRef = window.__WAYMARK_GITHUB_REF;
  if (serverRef && !sessionStorage.getItem('waymark_ref_synced')) {
    sessionStorage.setItem('waymark_ref_synced', '1');
    const pinnedRef = userData.getGithubRef();
    if (pinnedRef && pinnedRef !== serverRef) {
      try {
        const base = window.__WAYMARK_BASE || '';
        const syncRes = await fetch(`${base}/api/source/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: pinnedRef }),
        });
        if (syncRes.ok) {
          console.log(`[version] Restored pinned ref from Drive: ${pinnedRef}`);
          window.location.reload();
          return; // stop further init — page is reloading
        }
      } catch (err) {
        console.warn('[version] Boot sync failed, continuing with current ref:', err);
      }
    }
  }

  // Load explorer & collect known sheets before routing
  await explorer.autoPinWaymarkFolder();
  await explorer.load();
  await collectKnownSheets();

  // Route to current hash
  handleRoute();
  window.addEventListener('hashchange', handleRoute);

  // Show tutorial for first-time users
  if (!userData.getTutorialCompleted()) {
    setTimeout(() => Tutorial.start(), 600);
  }

  // Tutorial button in top bar
  if (tutorialBtn) {
    tutorialBtn.addEventListener('click', () => Tutorial.start());
  }

  // Start version checker for auto-update detection (production only)
  initUpdateChecker();
}

async function handleLogout() {
  await api.auth.logout();
  await userData.clearAll();
  storage.clearAll();
  loginScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

/* ---------- Sidebar menu helpers ---------- */

/**
 * Update active state on sidebar menu items.
 * @param {string} menuId — one of 'home', 'explorer'
 */
function updateMenuActive(menuId) {
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.menu === menuId);
  });
}

/**
 * Auto-close sidebar on narrow screens after navigating.
 */
function autoCloseSidebarMobile() {
  if (window.innerWidth <= 768 && isSidebarOpen()) {
    closeSidebar();
    userData.setSidebarOpen(false);
  }
}

/* ---------- Routing ---------- */

function handleRoute() {
  const hash = window.location.hash || '#/';

  // Handle auth callback
  if (hash === '#auth_success') {
    window.location.hash = '#/';
    return;
  }

  // Track internal navigation history
  if (_navHistory[_navHistory.length - 1] !== hash) {
    _navHistory.push(hash);
  }

  checklist.hide(); // stop any running timer
  agent.hide();
  dashboard.hide();

  // Auto-close sidebar on narrow screens when navigating to a detail view
  if (window.innerWidth <= 768 && isSidebarOpen()) {
    closeSidebar();
    userData.setSidebarOpen(false);
  }

  if (hash.startsWith('#/sheet/')) {
    const sheetId = hash.replace('#/sheet/', '');
    showView('checklist');
    checklist.show(sheetId);
    userData.setLastView(hash);
    updateMenuActive('');
  } else if (hash.startsWith('#/public/')) {
    const sheetId = hash.replace('#/public/', '');
    document.body.classList.add('waymark-public');
    showView('checklist');
    checklist.showPublic(sheetId);
    updateMenuActive('');
  } else if (hash.startsWith('#/folder/')) {
    const parts = hash.replace('#/folder/', '').split('/');
    const folderId = parts[0];
    const folderName = decodeURIComponent(parts.slice(1).join('/') || 'Folder');
    showView('folder');
    showFolderContents(folderId, folderName);
    userData.setLastView(hash);
    updateMenuActive('');
  } else if (hash.startsWith('#/search')) {
    showView('search');
    search.searchFromHash(hash);
    userData.setLastView(hash);
    updateMenuActive('');
  } else if (hash === '#/explorer') {
    showView('explorer');
    updateMenuActive('explorer');
    userData.setLastView(hash);
  } else if (hash === '#/agent') {
    showView('agent');
    agent.show(document.getElementById('agent-view'));
    updateMenuActive('agent');
    userData.setLastView(hash);
  } else if (hash.startsWith('#/dashboard')) {
    showView('dashboard');
    updateMenuActive('dashboard');
    userData.setLastView(hash);
    const dashboardMatch = hash.match(/^#\/dashboard\/(.+)/);
    if (dashboardMatch) {
      dashboard.showDashboard(dashboardMatch[1]);
    } else {
      dashboard.showHome();
    }
  } else {
    // Home
    showView('home');
    renderHome();
    userData.setLastView('#/');
    updateMenuActive('home');
  }
}

/**
 * Navigate back deterministically:
 * — From a sheet: return to the folder the user navigated from, else home
 * — From a folder: go to the previous folder or home (walk history)
 * — From explorer/search: go home
 * Never uses history.back() which can leave the app.
 */
function goBack() {
  const hash = window.location.hash || '#/';

  // From sheet view → return to originating folder, else home
  if (hash.startsWith('#/sheet/')) {
    const sheetId = hash.replace('#/sheet/', '');
    const origin = _sheetOrigin[sheetId];
    if (origin) {
      window.location.hash = `#/folder/${origin.folderId}/${encodeURIComponent(origin.folderName)}`;
    } else {
      // Walk history for a non-sheet route (folder or home)
      for (let i = _navHistory.length - 2; i >= 0; i--) {
        if (!_navHistory[i].startsWith('#/sheet/')) {
          window.location.hash = _navHistory[i];
          _navHistory = _navHistory.slice(0, i + 1);
          return;
        }
      }
      window.location.hash = '#/';
    }
    return;
  }

  // From folder view → walk history for a different route (parent folder or home)
  if (hash.startsWith('#/folder/')) {
    for (let i = _navHistory.length - 2; i >= 0; i--) {
      if (_navHistory[i] !== hash && !_navHistory[i].startsWith('#/sheet/')) {
        window.location.hash = _navHistory[i];
        _navHistory = _navHistory.slice(0, i + 1);
        return;
      }
    }
    window.location.hash = '#/';
    return;
  }

  // From any other view (explorer, search) → home
  window.location.hash = '#/';
}

/* ---------- Home — Pinned Folders ---------- */

/** Module-scoped user name for greeting. Set on login. */
let _userName = '';

/**
 * Render the full home page: greeting, quick actions, recent sheets, pinned folders.
 */
function renderHome() {
  renderGreeting();
  wireQuickActions();
  renderRecentSheets();
  renderPinnedSheets();
  renderPinnedFolders();
}

/* ---------- Home: Greeting ---------- */

function renderGreeting() {
  const greetEl = document.getElementById('home-greeting-text');
  const subEl   = document.getElementById('home-greeting-sub');
  if (!greetEl) return;

  const hour = new Date().getHours();
  let period = 'evening';
  if (hour >= 5 && hour < 12)  period = 'morning';
  else if (hour >= 12 && hour < 17) period = 'afternoon';

  const firstName = _userName ? _userName.split(' ')[0] : '';
  greetEl.textContent = firstName
    ? `Good ${period}, ${firstName}`
    : `Good ${period}`;

  const pinned  = userData.getPinnedFolders().length + userData.getPinnedSheets().length;
  const recent  = userData.getRecentSheets().length;
  if (pinned === 0 && recent === 0) {
    subEl.textContent = 'Welcome to your Wayboard — pin sheets and folders to get started';
  } else {
    subEl.textContent = 'Welcome back to your Wayboard';
  }
}

/* ---------- Home: Quick Actions ---------- */

let _quickActionsWired = false;

function wireQuickActions() {
  if (_quickActionsWired) return;
  _quickActionsWired = true;

  const wire = (id, fn) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', fn);
  };

  wire('home-action-create',   () => { openCreateSheetModal(); });
  wire('home-action-import',   () => { if (importModal) importModal.classList.remove('hidden'); });
  wire('home-action-browse',   () => { window.location.hash = '#/explorer'; });
  wire('home-action-examples', () => { openExamplesModal(); });
}

/* ---------- Home: Recent Sheets ---------- */

function renderRecentSheets() {
  const section   = document.getElementById('home-recent');
  const container = document.getElementById('home-recent-list');
  if (!section || !container) return;

  const recent = userData.getRecentSheets().slice(0, 6);
  container.innerHTML = '';

  if (recent.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  for (const sheet of recent) {
    const tpl = sheet.templateKey ? TEMPLATES[sheet.templateKey] : null;
    const icon = tpl ? tpl.icon : '📄';
    const ago  = sheet.openedAt ? timeAgo(sheet.openedAt) : '';

    const card = el('div', {
      className: 'home-recent-card',
      on: { click() { navigate('sheet', sheet.id); } },
    }, [
      el('span', { className: 'home-recent-icon' }, [icon]),
      el('div', { className: 'home-recent-info' }, [
        el('div', { className: 'home-recent-name' }, [sheet.name || 'Untitled']),
        ago ? el('div', { className: 'home-recent-time' }, [ago]) : null,
      ]),
    ]);
    container.append(card);
  }
}

/* ---------- Home: Pinned Folders ---------- */

function renderPinnedFolders() {
  const pinned = userData.getPinnedFolders();
  const container = document.getElementById('pinned-folders');
  const emptyMsg  = document.getElementById('no-pinned');
  const pinnedSheets = userData.getPinnedSheets();

  container.innerHTML = '';

  // Show empty hint only when BOTH pinned folders and pinned sheets are empty
  if (pinned.length === 0 && pinnedSheets.length === 0) {
    emptyMsg.classList.remove('hidden');
  } else {
    emptyMsg.classList.add('hidden');
  }

  if (pinned.length === 0) return;

  for (const folder of pinned) {
    const card = el('div', {
      className: 'pinned-card',
      on: {
        click() { navigate('folder', folder.id, folder.name); },
      },
    }, [
      el('span', { className: 'folder-emoji' }, ['📁']),
      el('div', { className: 'pinned-card-info' }, [
        el('div', { className: 'pinned-card-name' }, [folder.name]),
        folder.owner
          ? el('div', { className: 'pinned-card-owner', title: folder.owner }, [
              folder.owner.includes('@') ? folder.owner.split('@')[0] : folder.owner,
            ])
          : null,
        folder.shared
          ? el('span', { className: 'badge-shared' }, ['shared'])
          : null,
      ]),
    ]);
    container.append(card);
  }
}

/* ---------- Home: Pinned Sheets ---------- */

function renderPinnedSheets() {
  const section   = document.getElementById('home-pinned-sheets');
  const container = document.getElementById('pinned-sheets');
  if (!section || !container) return;

  const pinned = userData.getPinnedSheets();
  container.innerHTML = '';

  if (pinned.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  for (const sheet of pinned) {
    const tpl = sheet.templateKey ? TEMPLATES[sheet.templateKey] : null;
    const icon = tpl ? tpl.icon : '📊';

    const card = el('div', {
      className: 'pinned-card',
      on: { click() { navigate('sheet', sheet.id); } },
    }, [
      el('span', { className: 'folder-emoji' }, [icon]),
      el('div', { className: 'pinned-card-info' }, [
        el('div', { className: 'pinned-card-name' }, [sheet.name || 'Untitled']),
      ]),
    ]);
    container.append(card);
  }
}

/* ---------- Folder Contents ---------- */

const openInDriveBtn = document.getElementById('open-in-drive-btn');
const folderPinBtn   = document.getElementById('folder-pin-btn');
const dirHelpBtn     = document.getElementById('dir-help-btn');
const folderRefreshBtn = document.getElementById('folder-refresh-btn');
let currentFolderId  = null;
let currentFolderName = null;
let currentDirKey    = null;

if (openInDriveBtn) {
  openInDriveBtn.addEventListener('click', () => {
    if (currentFolderId) {
      window.open(`https://drive.google.com/drive/folders/${currentFolderId}`, '_blank');
    }
  });
}

if (folderPinBtn) {
  folderPinBtn.addEventListener('click', () => {
    if (!currentFolderId) return;
    if (userData.isPinned(currentFolderId)) {
      userData.removePinnedFolder(currentFolderId);
      folderPinBtn.classList.remove('pinned');
      folderPinBtn.title = 'Pin folder';
      showToast('Folder unpinned', 'success');
    } else {
      userData.addPinnedFolder({ id: currentFolderId, name: currentFolderName || 'Folder' });
      folderPinBtn.classList.add('pinned');
      folderPinBtn.title = 'Unpin folder';
      showToast('Folder pinned to home', 'success');
    }
    folderPinBtn.classList.add('pin-bounce');
    folderPinBtn.addEventListener('animationend', () => folderPinBtn.classList.remove('pin-bounce'), { once: true });
    window.dispatchEvent(new CustomEvent('waymark:pins-changed'));
  });
}

if (dirHelpBtn) {
  dirHelpBtn.addEventListener('click', () => {
    if (currentDirKey) Tutorial.startTemplateTutorial('dir-' + currentDirKey, true);
  });
}

/**
 * Full folder refresh via Google Picker.
 * Shows a step-by-step instruction guide, then opens a multi-select spreadsheet
 * Picker pre-navigated to the current folder.  Each sheet the user selects gets
 * drive.file access — this is how we pick up files from other team members
 * without needing elevated scopes.
 */
async function refreshFolderViaPicker() {
  if (!currentFolderId) return;

  // Remove any previous guide that wasn't cleaned up
  document.querySelector('.sync-guide-overlay')?.remove();

  const folderName = currentFolderName || 'your shared folder';

  // --- Build instruction guide overlay ---
  const guide = el('div', { className: 'sync-guide-overlay' }, [
    el('div', { className: 'sync-guide' }, [
      el('h3', { className: 'sync-guide-title' }, ['🔄 Sync Shared Files']),
      el('p', { className: 'sync-guide-intro' }, [
        'Follow these steps to pick up files shared by your team:',
      ]),
      el('ol', { className: 'sync-guide-steps' }, [
        el('li', {}, [
          'In the Picker that opens, navigate to ',
          el('strong', { className: 'sync-guide-folder' }, [folderName]),
          ' (or use the search bar at the top to find it).',
        ]),
        el('li', {}, [
          'Press ',
          el('kbd', {}, ['Ctrl']), ' + ', el('kbd', {}, ['A']),
          ' to select all files in the folder.',
        ]),
        el('li', {}, ['Click ', el('strong', {}, ['Select']), ' to confirm.']),
      ]),
      el('p', { className: 'sync-guide-wait' }, [
        'The view will refresh automatically once you\'re done.',
      ]),
      el('div', { className: 'sync-guide-actions' }, [
        el('button', {
          className: 'sync-guide-btn sync-guide-open',
          type: 'button',
        }, ['Open Picker']),
        el('button', {
          className: 'sync-guide-btn sync-guide-cancel',
          type: 'button',
        }, ['Cancel']),
      ]),
    ]),
  ]);

  document.getElementById('folder-view').append(guide);

  // Wait for user to click "Open Picker" or "Cancel"
  const action = await new Promise((resolve) => {
    guide.querySelector('.sync-guide-open').addEventListener('click', () => resolve('open'));
    guide.querySelector('.sync-guide-cancel').addEventListener('click', () => resolve('cancel'));
  });

  if (action === 'cancel') {
    guide.remove();
    return;
  }

  // Keep the guide visible while the Picker is open — it sits behind the Picker
  // popup and remains visible if the user moves windows around
  guide.querySelector('.sync-guide-open').disabled = true;
  guide.querySelector('.sync-guide-open').textContent = 'Waiting for Picker…';

  const picked = await api.picker.pickSpreadsheets({
    multiSelect: true,
    includeSharedDrives: true,
    parentFolderId: currentFolderId,
    title: 'Select all files to sync',
  });

  guide.remove();

  if (!picked || picked.length === 0) return;   // user cancelled Picker

  showToast(`Syncing ${picked.length} file${picked.length !== 1 ? 's' : ''}…`, 'info');

  // Nuke the localStorage cache so showFolderContents treats everything as new
  storage.setFolderIndex(currentFolderId, null);

  // Re-render folder — the newly-picked sheets now have drive.file access
  // so the app can read their content and rebuild the .waymark-index.
  navigate('folder', currentFolderId, currentFolderName);
}

if (folderRefreshBtn) {
  folderRefreshBtn.addEventListener('click', refreshFolderViaPicker);
}

// Directory-view sync buttons dispatch this event
window.addEventListener('waymark:folder-refresh', () => {
  refreshFolderViaPicker();
});

/* ---------- .waymark-index helpers ---------- */

const INDEX_FILE = '.waymark-index';

/**
 * Patch the .waymark-index in a folder to include a newly-created sheet.
 * Fire-and-forget — failures are silently ignored (the next full folder
 * load will rebuild the index anyway).
 *
 * @param {string} folderId   Google Drive folder ID
 * @param {Object} sheet      { id, name, headers, firstRow }
 */
function patchFolderIndex(folderId, sheet) {
  (async () => {
    try {
      // Also update localStorage cache so same-session nav is instant
      const local = storage.getFolderIndex(folderId);
      if (local) {
        const { key, template } = detectTemplate(sheet.headers);
        local[sheet.id] = {
          name: sheet.name,
          headers: sheet.headers,
          firstRow: sheet.firstRow,
          templateKey: key,
          icon: template.icon || '📊',
          modified: new Date().toISOString(),
        };
        storage.setFolderIndex(folderId, local);
      }

      // Find existing index file in Drive
      const indexFile = await api.drive.findFile(INDEX_FILE, folderId);
      if (indexFile) {
        // Read → patch → write
        const idx = await api.drive.readJsonFile(indexFile.id);
        if (idx && idx.sheets) {
          const { key, template } = detectTemplate(sheet.headers);
          idx.sheets[sheet.id] = {
            name: sheet.name,
            headers: sheet.headers,
            firstRow: sheet.firstRow,
            modified: new Date().toISOString(),
            templateKey: key,
            icon: template.icon || '📊',
          };
          await api.drive.updateJsonFile(indexFile.id, idx);
        }
      }
      // If no index file exists yet we skip — the next full folder load
      // will create it.  No point creating one for a folder that may
      // contain only 1-2 sheets.
    } catch { /* best-effort */ }
  })();
}

// Auto-patch the parent folder's .waymark-index whenever a sheet refreshes.
// This keeps folder directory-views current without requiring a full folder visit.
window.addEventListener('waymark:sheet-refreshed', (e) => {
  if (currentFolderId && e.detail) {
    patchFolderIndex(currentFolderId, e.detail);
  }
});

/* Generation counter — incremented on each showFolderContents call so that
   if the user navigates quickly between folders, stale async renders are
   discarded instead of painting over the newer folder's content. */
let _folderGen = 0;

async function showFolderContents(folderId, folderName) {
  const gen = ++_folderGen;           // snapshot for staleness checks
  currentFolderId = folderId;
  currentFolderName = folderName;
  const titleEl      = document.getElementById('folder-title');
  const sheetsEl     = document.getElementById('folder-sheets');
  const noSheetsEl   = document.getElementById('no-sheets');
  const loadingBar   = document.getElementById('folder-loading');

  titleEl.textContent = folderName;
  noSheetsEl.classList.add('hidden');
  if (dirHelpBtn) dirHelpBtn.classList.add('hidden');
  if (folderRefreshBtn) folderRefreshBtn.classList.add('hidden');
  currentDirKey = null;

  // Clear previous content immediately and show loading bar.
  // If we have a cached directory view, render it instantly so the user
  // sees useful content while fresh data loads behind the bar.
  sheetsEl.innerHTML = '';
  loadingBar.classList.remove('hidden');

  // Sync folder pin button state
  if (folderPinBtn) {
    const pinned = userData.isPinned(folderId);
    folderPinBtn.classList.toggle('pinned', pinned);
    folderPinBtn.title = pinned ? 'Unpin folder' : 'Pin folder';
  }

  // --- Instant render from localStorage cache (zero API calls) ---
  // If the folder was previously visited this session and the majority
  // of its sheets are a single template with a directoryView (e.g.
  // cookbook), render the cached version immediately so the user sees
  // content while Drive data verifies in the background.
  const localIdx = storage.getFolderIndex(folderId);
  let hasCachedView = false;
  if (localIdx) {
    const entries = Object.entries(localIdx);
    // Count templates and find dominant one
    const templateCounts = {};
    for (const [, v] of entries) {
      const tk = v.templateKey || 'checklist';
      templateCounts[tk] = (templateCounts[tk] || 0) + 1;
    }
    const dominant = Object.entries(templateCounts)
      .sort((a, b) => b[1] - a[1])[0];
    if (dominant && dominant[1] > entries.length * 0.5) {
      const domKey = dominant[0];
      const domTemplate = TEMPLATES[domKey];
      if (domTemplate?.directoryView) {
        const cachedSheets = entries
          .filter(([, v]) => (v.templateKey || 'checklist') === domKey)
          .map(([id, v]) => {
            const lower = (v.headers || []).map(h => (h || '').toLowerCase().trim());
            return {
              id,
              name: v.name,
              rows: [v.firstRow || []],
              cols: domTemplate.columns(lower),
              dirStats: v.dirStats || null,
            };
          });
        const dirContainer = el('div', {
          className: 'directory-view-container directory-view-cached',
        });
        sheetsEl.append(dirContainer);
        domTemplate.directoryView(dirContainer, cachedSheets, navigate);
        hasCachedView = true;
      }
    }
  }

  try {
    const res = await api.drive.listChildren(folderId);
    if (gen !== _folderGen) return;   // user navigated away — abort
    let items = res.files || [];

    // Apply .waymarkIgnore filtering
    items = await explorer.applyWaymarkIgnore(folderId, items);
    if (gen !== _folderGen) return;   // user navigated away — abort

    const sheets  = items.filter(i => i.mimeType === 'application/vnd.google-apps.spreadsheet');
    const docs    = items.filter(i => i.mimeType === 'application/vnd.google-apps.document');
    const folders = items.filter(i => i.mimeType === 'application/vnd.google-apps.folder');

    if (sheets.length === 0 && folders.length === 0 && docs.length === 0) {
      sheetsEl.innerHTML = '';
      loadingBar.classList.add('hidden');
      noSheetsEl.classList.remove('hidden');
      return;
    }

    // Build folder elements (rendered after sheet-loading resolves so
    // that innerHTML clears don't accidentally wipe them).
    const folderEls = folders.map(f => el('div', {
      className: 'sheet-list-item',
      on: { click() { navigate('folder', f.id, f.name); } },
    }, [
      el('span', { className: 'sheet-emoji' }, ['📁']),
      el('div', { className: 'sheet-list-item-name' }, [f.name]),
    ]));

    // Build doc elements up-front too (same reason).
    const docEls = docs.map(d => el('div', {
      className: 'sheet-list-item',
      on: { click() { navigate('sheet', d.id, d.name); } },
    }, [
      el('span', { className: 'sheet-emoji' }, ['📄']),
      el('div', { className: 'sheet-list-item-name' }, [d.name]),
    ]));

    // If there are no sheets, render folders + docs immediately.
    if (sheets.length === 0) {
      sheetsEl.innerHTML = '';
      for (const fe of folderEls) sheetsEl.append(fe);
      for (const de of docEls)   sheetsEl.append(de);
    }

    // Fetch sheet data to detect templates and enable directory views.
    // Uses a .waymark-index JSON file stored in Google Drive to avoid
    // individual Sheets API calls. Typically loads in 3 Drive API calls
    // (listChildren + findFile + readJsonFile) instead of N Sheets calls.
    if (sheets.length > 0) {
      // Batch size for summary fetches — the global throttle in sheets.js
      // handles concurrency and rate-limiting, so no inter-batch delay needed.
      const BATCH_SIZE = 5;

      // --- Phase 1: Look up and read the folder index ---
      // The index is application/json so listChildren (which filters to
      // folders/sheets/docs) won't return it — use findFile instead.
      let folderIndex = null;   // { v: 1, sheets: { [id]: { name, headers, firstRow, modified } } }
      let indexFileId = null;

      try {
        const indexFile = await api.drive.findFile(INDEX_FILE, folderId);
        if (indexFile) {
          indexFileId = indexFile.id;
          folderIndex = await api.drive.readJsonFile(indexFileId);
        }
      } catch {
        folderIndex = null;  // corrupt or unreadable — rebuild from scratch
      }

      const indexSheets = folderIndex?.sheets || {};

      // --- Phase 2: Diff against modifiedTimes from Drive listing ---
      const cachedSheets = [];
      const toFetch = [];

      for (const s of sheets) {
        const cached = indexSheets[s.id];
        if (cached && cached.modified === s.modifiedTime) {
          // Index hit — data is current
          cachedSheets.push({
            ...s,
            data: { title: cached.name, values: [cached.headers, cached.firstRow] },
          });
        } else {
          toFetch.push(s);
        }
      }

      // --- Phase 3: Fetch only new/modified sheets (batched) ---
      // Global throttle in sheets.js controls concurrency & rate — no
      // inter-batch delay needed here, just avoid queueing everything at once.
      const freshSheets = [];
      const failedSheets = [];

      for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
        const batch = toFetch.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(s => api.sheets.getSpreadsheetSummary(s.id).then(data => ({ ...s, data })))
        );
        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') {
            freshSheets.push(results[j].value);
          } else {
            failedSheets.push(batch[j]);
          }
        }
      }

      if (gen !== _folderGen) return;   // user navigated away — abort
      const loadedSheets = [...cachedSheets, ...freshSheets];

      // --- Phase 4: Write back updated index (non-blocking) ---
      if (freshSheets.length > 0 || Object.keys(indexSheets).length !== sheets.length) {
        const newIndex = { v: 1, sheets: {} };
        for (const s of loadedSheets) {
          const headers = s.data.values?.[0] || [];
          const firstRow = s.data.values?.[1] || [];
          const { key, template } = detectTemplate(headers);
          newIndex.sheets[s.id] = {
            name: s.name || s.data.title,
            headers,
            firstRow,
            modified: s.modifiedTime,
            templateKey: key,
            icon: template.icon || '📊',
          };
        }
        // Fire-and-forget: update or create index file
        (async () => {
          try {
            if (indexFileId) {
              await api.drive.updateJsonFile(indexFileId, newIndex);
            } else {
              await api.drive.createJsonFile(INDEX_FILE, newIndex, [folderId]);
            }
          } catch { /* best-effort — next visit will retry */ }
        })();
      }

      // Also update localStorage cache for instant nav within session
      const localIndex = {};
      for (const s of loadedSheets) {
        const headers = s.data.values?.[0] || [];
        const firstRow = s.data.values?.[1] || [];
        const { key, template } = detectTemplate(headers);
        localIndex[s.id] = {
          name: s.name || s.data.title,
          headers,
          firstRow,
          templateKey: key,
          icon: template.icon || '📊',
          modified: s.modifiedTime,
        };
      }
      storage.setFolderIndex(folderId, localIndex);

      // Detect templates and group sheets
      // Use cached templateKey from .waymark-index when available to skip
      // detectTemplate() regex matching for unchanged sheets.
      const templateGroups = {};
      const sheetIconMap = {};  // sheet ID → template icon
      for (const s of loadedSheets) {
        const headers = s.data.values?.[0] || [];
        const cachedEntry = indexSheets[s.id];
        let key, template;
        if (cachedEntry?.templateKey && TEMPLATES[cachedEntry.templateKey]) {
          key = cachedEntry.templateKey;
          template = TEMPLATES[key];
        } else {
          ({ key, template } = detectTemplate(headers));
        }
        if (!templateGroups[key]) templateGroups[key] = { template, sheets: [] };
        const lower = headers.map(h => (h || '').toLowerCase().trim());
        const cols = template.columns(lower);
        sheetIconMap[s.id] = template.icon || '📊';
        templateGroups[key].sheets.push({
          id: s.id,
          name: s.name || s.data.title,
          headers,
          rows: (s.data.values || []).slice(1),
          cols,
        });
      }

      // Check if a template with directoryView covers majority of sheets
      let usedDirectoryView = false;
      for (const [key, group] of Object.entries(templateGroups)) {
        if (group.template.directoryView && group.sheets.length > loadedSheets.length * 0.5) {

          // Re-fetch full data for directoryView sheets — summaries only
          // have header + first row which gives incorrect aggregates.
          // Skip entirely for templates that only need the first row
          // (e.g. recipe/cookbook) — avoids N×2 wasted API calls.
          if (group.template.needsFullData !== false) {
            // Use cached dirStats from localStorage when available
            // for sheets whose modifiedTime hasn't changed, avoiding
            // full re-fetch when aggregates are already computed.
            const localIdx = storage.getFolderIndex(folderId) || {};
            const sheetsToFetch = group.sheets.filter(s => {
              const cached = localIdx[s.id];
              if (cached?.dirStats && group.template.computeDirStats) {
                // Inject cached stats so directoryView can use them
                s.dirStats = cached.dirStats;
                return false;   // skip API call
              }
              return true;
            });

            // Fetch remaining sheets in small batches.
            // The global throttle in sheets.js gates concurrency, so we
            // just need batches to avoid queueing hundreds at once.
            const DIR_BATCH = 3;
            for (let bi = 0; bi < sheetsToFetch.length; bi += DIR_BATCH) {
              const dirBatch = sheetsToFetch.slice(bi, bi + DIR_BATCH);
              await Promise.allSettled(
                dirBatch.map(async (s) => {
                  try {
                    const full = await api.sheets.getSpreadsheet(s.id);
                    s.rows = (full.values || []).slice(1);
                  } catch { /* keep partial data on failure */ }
                })
              );
            }
          }

          // Cache dirStats in localStorage so instant render is accurate
          if (group.template.computeDirStats) {
            const localIdx = storage.getFolderIndex(folderId);
            if (localIdx) {
              for (const s of group.sheets) {
                if (localIdx[s.id] && s.rows.length > 1) {
                  localIdx[s.id].dirStats = group.template.computeDirStats(s.rows, s.cols);
                }
              }
              storage.setFolderIndex(folderId, localIdx);
            }
          }

          if (gen !== _folderGen) return;   // user navigated away — abort

          // Build the fresh directory view container
          const dirContainer = el('div', {
            className: 'directory-view-container',
          });
          // Replace all content with folders + directory view + extras
          sheetsEl.innerHTML = '';
          for (const fe of folderEls) sheetsEl.append(fe);
          sheetsEl.append(dirContainer);
          group.template.directoryView(dirContainer, group.sheets, navigate);
          loadingBar.classList.add('hidden');
          usedDirectoryView = true;

          // Show directory view help button, refresh button, and trigger first-time tutorial
          currentDirKey = key;
          if (dirHelpBtn) dirHelpBtn.classList.remove('hidden');
          if (folderRefreshBtn) folderRefreshBtn.classList.remove('hidden');
          Tutorial.startTemplateTutorial('dir-' + key);

          // Render remaining non-matching sheets normally
          for (const [otherKey, otherGroup] of Object.entries(templateGroups)) {
            if (otherKey === key) continue;
            for (const s of otherGroup.sheets) {
              sheetsEl.append(el('div', {
                className: 'sheet-list-item',
                on: { click() { navigate('sheet', s.id, s.name); } },
              }, [
                el('span', { className: 'sheet-emoji' }, [otherGroup.template.icon || '📊']),
                el('div', { className: 'sheet-list-item-name' }, [s.name]),
              ]));
            }
          }
          break;
        }
      }

      // If no directory view was used, render all sheets normally
      if (!usedDirectoryView) {
        sheetsEl.innerHTML = '';
        loadingBar.classList.add('hidden');

        // Folders first, then sheets
        for (const fe of folderEls) sheetsEl.append(fe);
        for (const s of loadedSheets) {
          sheetsEl.append(el('div', {
            className: 'sheet-list-item',
            on: { click() { navigate('sheet', s.id, s.name || s.data.title); } },
          }, [
            el('span', { className: 'sheet-emoji' }, [sheetIconMap[s.id] || '📊']),
            el('div', { className: 'sheet-list-item-name' }, [s.name || s.data.title]),
          ]));
        }
      }

      // Render sheets that failed to load as plain items
      for (const s of failedSheets) {
        sheetsEl.append(el('div', {
          className: 'sheet-list-item',
          on: { click() { navigate('sheet', s.id, s.name); } },
        }, [
          el('span', { className: 'sheet-emoji' }, ['📊']),
          el('div', { className: 'sheet-list-item-name' }, [s.name]),
        ]));
      }
    }

    // Append docs (if sheets were present, they weren't added yet)
    if (sheets.length > 0) {
      for (const de of docEls) sheetsEl.append(de);
    }

    // Hide loading bar once all content is rendered
    loadingBar.classList.add('hidden');

    // Register for search context
    collectKnownSheets();
  } catch (err) {
    if (gen !== _folderGen) return;
    loadingBar.classList.add('hidden');
    const is403 = err.status === 403 || (err.message && err.message.includes('Permission denied'));
    if (is403) {
      sheetsEl.innerHTML = `<p class="empty-state">Permission denied. Use the Drive picker to open this folder and grant access.</p>`;
    } else {
      sheetsEl.innerHTML = `<p class="empty-state">Failed to load folder: ${err.message}</p>`;
    }
  }
}

/* ---------- Examples Modal ---------- */

let selectedCategories = new Set();

function initExamplesModal() {
  if (!examplesModal) return;

  // Close modal handlers
  examplesModalClose.addEventListener('click', closeExamplesModal);
  examplesCancelBtn.addEventListener('click', closeExamplesModal);
  examplesModal.addEventListener('click', (e) => {
    if (e.target === examplesModal) closeExamplesModal();
  });

  // Select all / none
  examplesSelectAll.addEventListener('click', () => {
    selectedCategories = new Set(getExampleCategories().map(c => c.name));
    renderCategoryCheckboxes();
  });
  examplesSelectNone.addEventListener('click', () => {
    selectedCategories.clear();
    renderCategoryCheckboxes();
  });

  // Generate button
  examplesGenerateBtn.addEventListener('click', handleModalGenerate);
}

function openExamplesModal() {
  const categories = getExampleCategories();
  selectedCategories = new Set(categories.map(c => c.name)); // all selected by default
  renderCategoryCheckboxes();
  examplesModal.classList.remove('hidden');
  examplesGenerateBtn.disabled = false;
  examplesGenerateBtn.textContent = 'Generate Selected';
  examplesModalProg.classList.add('hidden');
}

function closeExamplesModal() {
  examplesModal.classList.add('hidden');
}

function getCategoryIcon(categoryName) {
  // Build a lookup: lowercase template name → icon (from live TEMPLATES)
  const tpls = Object.values(TEMPLATES);
  const byName = {};
  for (const t of tpls) byName[t.name.toLowerCase()] = t.icon;

  // Map category folder names to their template names
  const CATEGORY_TO_TEMPLATE = {
    'Checklists': 'checklist', 'Trackers': 'progress tracker',
    'Schedules': 'schedule', 'Inventories': 'inventory',
    'Contacts': 'contacts', 'Logs': 'activity log',
    'Test Cases': 'test cases', 'Budgets': 'budget',
    'Kanban': 'kanban board', 'Habits': 'habit tracker',
    'Gradebook': 'gradebook', 'Timesheets': 'timesheet',
    'Polls': 'poll / survey', 'Changelogs': 'changelog',
    'CRM': 'crm', 'Meal Plans': 'meal planner',
    'Travel': 'travel itinerary', 'Rosters': 'roster',
    'Recipes': 'recipe', 'Flows': 'flow diagram',
    'Social': 'social feed', 'Automation': 'automation',
    'Guides': 'instruction guide', 'Knowledge': 'knowledge base',
    'Notifications': 'notifications', 'Monitoring': 'iot sensor log',
    'Projects': 'kanban board', 'Strategy': 'okr / goals',
    'Security': 'password manager',
  };

  const mapped = CATEGORY_TO_TEMPLATE[categoryName];
  if (mapped && byName[mapped]) return byName[mapped];
  // Direct match (e.g. "CRM", "Gradebook")
  if (byName[categoryName.toLowerCase()]) return byName[categoryName.toLowerCase()];
  return '📋';
}

function renderCategoryCheckboxes() {
  const categories = getExampleCategories();
  examplesCategories.innerHTML = '';

  for (const cat of categories) {
    const isChecked = selectedCategories.has(cat.name);
    const icon = getCategoryIcon(cat.name);

    const card = el('label', { className: `example-category-card${isChecked ? ' selected' : ''}` }, [
      el('input', {
        type: 'checkbox',
        className: 'example-category-checkbox',
        ...(isChecked ? { checked: '' } : {}),
        on: {
          change(e) {
            if (e.target.checked) selectedCategories.add(cat.name);
            else selectedCategories.delete(cat.name);
            card.classList.toggle('selected', e.target.checked);
            updateSelectionCount();
          },
        },
      }),
      el('span', { className: 'example-category-icon' }, [icon]),
      el('div', { className: 'example-category-info' }, [
        el('div', { className: 'example-category-name' }, [cat.name]),
        el('div', { className: 'text-muted' }, [`${cat.sheets.length} sheet${cat.sheets.length !== 1 ? 's' : ''}`]),
      ]),
    ]);
    examplesCategories.append(card);
  }

  updateSelectionCount();
}

function updateSelectionCount() {
  const total = getExampleCategories().length;
  examplesCount.textContent = `${selectedCategories.size} of ${total} categories selected`;
  examplesGenerateBtn.disabled = selectedCategories.size === 0;
}

async function handleModalGenerate() {
  if (selectedCategories.size === 0) return;

  examplesGenerateBtn.disabled = true;
  examplesGenerateBtn.textContent = 'Generating…';
  examplesCancelBtn.disabled = true;
  examplesModalProg.classList.remove('hidden');

  try {
    const cats = [...selectedCategories];
    const result = await generateExamples((msg) => {
      examplesModalProg.textContent = msg;
    }, cats);

    // Refresh explorer to show new folders
    await explorer.load();
    collectKnownSheets();
    closeExamplesModal();
  } catch (err) {
    showToast(`Generation failed: ${err.message}`, 'error');
    examplesModalProg.textContent = `Error: ${err.message}`;
  } finally {
    examplesGenerateBtn.disabled = false;
    examplesGenerateBtn.textContent = 'Generate Selected';
    examplesCancelBtn.disabled = false;
  }
}

/* ---------- Legacy generate handler (kept for backwards compat) ---------- */

async function handleGenerateExamples() {
  openExamplesModal();
}

/* ---------- Create Sheet Modal ---------- */

let selectedTemplateKey  = null;
let createSheetParentId   = null;
let createSheetParentName = null;

function initCreateSheetModal() {
  if (!createSheetModal) return;

  // Close modal handlers
  createSheetModalClose.addEventListener('click', closeCreateSheetModal);
  createSheetCancelBtn.addEventListener('click', closeCreateSheetModal);
  createSheetModal.addEventListener('click', (e) => {
    if (e.target === createSheetModal) closeCreateSheetModal();
  });

  // Name input enables/disables create button
  createSheetNameInput.addEventListener('input', updateCreateSheetButton);

  // Template search — filter visible cards as the user types
  if (createSheetSearchInput) {
    createSheetSearchInput.addEventListener('input', () => {
      renderCreateSheetGrid(createSheetSearchInput.value);
    });
  }

  // Choose Folder button — opens Google Picker to select destination
  if (createSheetChooseFolderBtn) {
    createSheetChooseFolderBtn.addEventListener('click', async () => {
      try {
        createSheetChooseFolderBtn.disabled = true;
        createSheetChooseFolderBtn.textContent = 'Opening…';
        if (createSheetStatus) createSheetStatus.textContent = '';
        const folder = await api.picker.pickFolder();
        if (folder) {
          createSheetParentId   = folder.id;
          createSheetParentName = folder.name;
          if (createSheetFolderDisplay) createSheetFolderDisplay.textContent = folder.name;
        }
      } catch (err) {
        if (createSheetStatus) {
          createSheetStatus.textContent = `Could not open folder picker: ${err && err.message ? err.message : 'please try again'}`;
        }
      } finally {
        createSheetChooseFolderBtn.disabled = false;
        createSheetChooseFolderBtn.textContent = '📁 Choose Folder';
      }
    });
  }

  // Create button
  createSheetCreateBtn.addEventListener('click', handleCreateSheet);
}

function openCreateSheetModal() {
  selectedTemplateKey   = null;
  createSheetParentId   = null;
  createSheetParentName = null;
  createSheetNameInput.value = '';
  if (createSheetSearchInput) createSheetSearchInput.value = '';
  createSheetStatus.textContent = '';
  createSheetCreateBtn.disabled = true;
  createSheetCreateBtn.textContent = 'Create Waymark';
  createSheetProgress.classList.add('hidden');
  if (createSheetFolderDisplay) createSheetFolderDisplay.textContent = 'Waymark (default)';
  renderCreateSheetGrid('');
  createSheetModal.classList.remove('hidden');
  // Focus search input so user can immediately type to filter
  if (createSheetSearchInput) createSheetSearchInput.focus();
  else createSheetNameInput.focus();
}

function closeCreateSheetModal() {
  createSheetModal.classList.add('hidden');
}

function renderCreateSheetGrid(query = '') {
  createSheetGrid.innerHTML = '';
  const q = query.trim().toLowerCase();

  // Sort templates alphabetically by name, then filter by search query
  const entries = Object.entries(TEMPLATES)
    .filter(([key, tpl]) => getTemplateHeaders(key, tpl).length > 0)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .filter(([key, tpl]) => {
      if (!q) return true;
      return tpl.name.toLowerCase().includes(q) || key.toLowerCase().includes(q);
    });

  for (const [key, tpl] of entries) {
    const headers = getTemplateHeaders(key, tpl);
    const card = el('div', {
      className: 'create-sheet-card',
      on: {
        click() {
          // Deselect previous
          const prev = createSheetGrid.querySelector('.create-sheet-card.selected');
          if (prev) prev.classList.remove('selected');
          // Select this
          card.classList.add('selected');
          selectedTemplateKey = key;
          // Auto-fill name if empty
          if (!createSheetNameInput.value.trim()) {
            createSheetNameInput.value = `My ${tpl.name}`;
          }
          updateCreateSheetButton();
        },
      },
    }, [
      el('span', { className: 'create-sheet-icon' }, [tpl.icon || '📋']),
      el('div', { className: 'create-sheet-card-info' }, [
        el('div', { className: 'create-sheet-card-name' }, [tpl.name]),
        el('div', { className: 'create-sheet-card-headers' }, [headers.join(', ')]),
      ]),
    ]);
    createSheetGrid.append(card);
  }
}

function updateCreateSheetButton() {
  const hasName = createSheetNameInput.value.trim().length > 0;
  const hasTemplate = selectedTemplateKey !== null;
  createSheetCreateBtn.disabled = !(hasName && hasTemplate);
}

async function handleCreateSheet() {
  if (!selectedTemplateKey || !createSheetNameInput.value.trim()) return;

  const title = createSheetNameInput.value.trim();
  const tpl = TEMPLATES[selectedTemplateKey];
  const headers = getTemplateHeaders(selectedTemplateKey, tpl);
  if (!headers.length) {
    showToast(`Template "${tpl?.name || selectedTemplateKey}" is missing default headers`, 'error');
    return;
  }

  createSheetCreateBtn.disabled = true;
  createSheetCreateBtn.textContent = 'Creating…';
  createSheetCancelBtn.disabled = true;
  createSheetProgress.classList.remove('hidden');
  createSheetProgress.textContent = 'Creating sheet…';

  try {
    // Use selected folder if the user chose one, otherwise default to Waymark root
    let parentId = createSheetParentId;
    if (!parentId) {
      try {
        parentId = await userData.getRootFolderId();
      } catch {
        parentId = null;
      }
    }

    // Create the spreadsheet with just the header row
    const result = await api.sheets.createSpreadsheet(title, [headers], parentId);

    // Patch .waymark-index so the folder view picks up the new sheet instantly
    if (result?.spreadsheetId && parentId) {
      patchFolderIndex(parentId, {
        id: result.spreadsheetId,
        name: title,
        headers,
        firstRow: [],
      });
    }

    // Refresh explorer
    await explorer.load();
    collectKnownSheets();
    closeCreateSheetModal();

    showToast(`Created "${title}"`, 'success');

    // Navigate to the new sheet
    if (result && result.spreadsheetId) {
      window.location.hash = `#/sheet/${result.spreadsheetId}`;
    }
  } catch (err) {
    showToast(`Failed to create sheet: ${err.message}`, 'error');
    createSheetProgress.textContent = `Error: ${err.message}`;
  } finally {
    createSheetCreateBtn.disabled = false;
    createSheetCreateBtn.textContent = 'Create Waymark';
    createSheetCancelBtn.disabled = false;
  }
}

/* ---------- Import Modal ---------- */

let importStep = 0;       // 0 = pick, 1 = configure, 2 = review
let importSheets = [];    // cached list of importable sheets
let selectedImportSheet = null; // { id, name, ... }
let importSheetData = null;     // full sheet data from API
let importAnalysis = null;      // analysis result from code detection
let userColumnMapping = {};     // user's manual column assignments
let userTemplateOverride = null; // explicit user template choice — always overrides auto-detection

function initImportModal() {
  if (!importModal) return;

  // Close
  importModalClose.addEventListener('click', closeImportModal);
  importCancelBtn.addEventListener('click', closeImportModal);
  importModal.addEventListener('click', (e) => {
    if (e.target === importModal) closeImportModal();
  });

  // Navigation
  importBackBtn.addEventListener('click', importGoBack);
  importNextBtn.addEventListener('click', importGoNext);

  // Search
  importSearchInput.addEventListener('input', filterImportSheets);

  // Template picker change — user selection ALWAYS overrides auto-detection
  importTemplatePick.addEventListener('change', () => {
    if (!importSheetData || !importAnalysis) return;
    const chosenKey = importTemplatePick.value;
    if (!chosenKey) return;

    // Record the user's explicit choice — this takes priority over all automation
    userTemplateOverride = chosenKey;
    importAnalysis.suggestedTemplate = chosenKey;
    const templates = importer.getTemplateList();
    const t = templates.find(t => t.key === chosenKey);
    importAnalysis.templateName = t?.name || chosenKey;
    importAnalysis.confidence = 1.0; // user-chosen, full confidence
    importAnalysis.summary = `Manually selected "${importAnalysis.templateName}" template.`;

    renderColumnMapEditor(importAnalysis);
    updateDetectBadge(importAnalysis);
  });

  // Recipe URL import
  if (recipeUrlImportBtn) {
    recipeUrlImportBtn.addEventListener('click', handleRecipeUrlImport);
    recipeUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handleRecipeUrlImport(); }
    });
  }
}

async function openImportModal() {
  importStep = 0;
  selectedImportSheet = null;
  importSheetData = null;
  importAnalysis = null;
  userColumnMapping = {};
  userTemplateOverride = null;
  importSearchInput.value = '';
  if (recipeUrlInput) recipeUrlInput.value = '';
  if (recipeUrlStatus) recipeUrlStatus.classList.add('hidden');

  showImportStep(0);
  importModal.classList.remove('hidden');
  importNextBtn.disabled = true;
  importNextBtn.textContent = 'Next';
  importBackBtn.classList.add('hidden');
  importProgress.classList.add('hidden');

  // Show Picker button instead of full file list
  importSheetList.innerHTML = '';
  const pickerBtn = el('button', {
    className: 'btn btn-google import-picker-btn',
    on: {
      async click() {
        try {
          pickerBtn.disabled = true;
          pickerBtn.textContent = 'Opening Picker…';
          const files = await api.picker.pickFilesForImport();
          pickerBtn.disabled = false;
          pickerBtn.textContent = '📂 Pick from Drive';
          if (!files || files.length === 0) return;

          // Use first selected file
          selectedImportSheet = files[0];
          importNextBtn.disabled = false;

          // Show selected file in the list area
          importSheetList.innerHTML = '';
          importSheetList.append(pickerBtn);
          const selectedEl = el('div', { className: 'import-sheet-item selected' }, [
            el('span', { className: 'import-sheet-item-icon' }, [
              files[0].mimeType === 'application/vnd.google-apps.document' ? '📄' : '📊',
            ]),
            el('div', { className: 'import-sheet-item-info' }, [
              el('div', { className: 'import-sheet-item-name' }, [files[0].name]),
              el('div', { className: 'import-sheet-item-meta' }, ['Selected via file picker']),
            ]),
          ]);
          importSheetList.append(selectedEl);
        } catch (err) {
          pickerBtn.disabled = false;
          pickerBtn.textContent = '📂 Pick from Drive';
          showToast(`Picker error: ${err.message}`, 'error');
        }
      },
    },
  }, ['📂 Pick from Drive']);

  importSheetList.append(
    el('p', { className: 'text-muted' }, ['Select a spreadsheet or document to import.']),
    pickerBtn,
  );
}

/**
 * Handle importing a recipe from an external URL.
 * Uses the frontend-only scraper (CORS proxy + DOMParser),
 * builds sheet-like data, and jumps to the configure step.
 */
async function handleRecipeUrlImport() {
  const url = (recipeUrlInput?.value || '').trim();
  if (!url) {
    showToast('Please enter a recipe URL', 'error');
    return;
  }

  // Validate URL
  try { new URL(url); } catch {
    showToast('Please enter a valid URL (e.g. https://…)', 'error');
    return;
  }

  recipeUrlImportBtn.disabled = true;
  recipeUrlImportBtn.textContent = 'Scraping…';
  recipeUrlStatus.classList.remove('hidden');
  recipeUrlStatus.textContent = 'Fetching recipe from URL — this may take a few seconds…';

  try {
    const recipe = await scrapeRecipe(url);

    // Build sheet-like values — row-per-item so each ingredient/step
    // is its own row, making the sheet easy to edit as a human.
    // Qty and Unit are separate columns for recipe scaling and conversion.
    // Notes column for recipe-level notes.
    // Source column stores the URL for attribution and re-sync.
    const headers = ['Recipe', 'Servings', 'Prep Time', 'Cook Time', 'Category', 'Difficulty', 'Qty', 'Unit', 'Ingredient', 'Step', 'Notes', 'Source'];
    const ingredients = recipe.ingredients || [];
    const steps = recipe.instructions || [];
    const maxRows = Math.max(ingredients.length, steps.length, 1);
    const dataRows = [];
    for (let i = 0; i < maxRows; i++) {
      const ingr = ingredients[i] || { qty: '', unit: '', name: '' };
      dataRows.push([
        i === 0 ? (recipe.name || 'Imported Recipe') : '',
        i === 0 ? (recipe.servings || '') : '',
        i === 0 ? (recipe.prepTime || '') : '',
        i === 0 ? (recipe.cookTime || '') : '',
        i === 0 ? (recipe.category || '') : '',
        i === 0 ? (recipe.difficulty || '') : '',
        ingr.qty || '',
        ingr.unit || '',
        ingr.name || '',
        steps[i] || '',
        i === 0 ? (recipe.description || '') : '',
        i === 0 ? url : '',
      ]);
    }

    importSheetData = {
      id: 'url-import-' + Date.now(),
      title: recipe.name || 'Imported Recipe',
      values: [headers, ...dataRows],
    };

    // Set up analysis as recipe template
    importAnalysis = importer.analyzeWithCode(importSheetData);
    // Force recipe template — user-initiated, so record as explicit override
    userTemplateOverride = 'recipe';
    importAnalysis.suggestedTemplate = 'recipe';
    importAnalysis.templateName = 'Recipe';
    importAnalysis.confidence = 0.9;
    importAnalysis.summary = `Imported from URL using ${recipe.method === 'json-ld' ? 'structured data (JSON-LD)' : 'heuristic parsing'}. Found ${recipe.ingredients?.length || 0} ingredients and ${recipe.instructions?.length || 0} instructions.`;

    recipeUrlStatus.textContent = `✅ Found: "${recipe.name}" — ${recipe.ingredients?.length || 0} ingredients, ${recipe.instructions?.length || 0} steps`;

    // Render preview and jump to configure step
    renderImportPreview(importSheetData);
    populateTemplatePicker(importAnalysis);
    renderColumnMapEditor(importAnalysis);
    updateDetectBadge(importAnalysis);
    showImportStep(1);

    showToast(`Recipe "${recipe.name}" loaded from URL`, 'success');
  } catch (err) {
    recipeUrlStatus.textContent = `❌ ${err.message}`;
    showToast(`Recipe import failed: ${err.message}`, 'error');
  } finally {
    recipeUrlImportBtn.disabled = false;
    recipeUrlImportBtn.textContent = 'Import Recipe';
  }
}

/**
 * Handle re-syncing a recipe from its source URL.
 * Triggered by the 'waymark:recipe-resync' custom event from the
 * recipe template.  Re-scrapes the original URL and replaces the
 * sheet data in place.
 * @param {CustomEvent} e — detail: { url }
 */
async function handleRecipeResync(e) {
  const url = e.detail?.url;
  if (!url) return;

  // Get the current sheet context from the hash route
  const hash = window.location.hash || '';
  const sheetMatch = hash.match(/^#\/sheet\/(.+)/);
  if (!sheetMatch) {
    showToast('Cannot re-sync: no sheet is currently open', 'error');
    return;
  }
  const sheetId = sheetMatch[1];

  showToast('Re-syncing recipe from source…', 'info');

  try {
    const recipe = await scrapeRecipe(url);

    const headers = ['Recipe', 'Servings', 'Prep Time', 'Cook Time', 'Category', 'Difficulty', 'Qty', 'Unit', 'Ingredient', 'Step', 'Notes', 'Source'];
    const ingredients = recipe.ingredients || [];
    const steps = recipe.instructions || [];
    const maxRows = Math.max(ingredients.length, steps.length, 1);
    const dataRows = [];
    for (let i = 0; i < maxRows; i++) {
      const ingr = ingredients[i] || { qty: '', unit: '', name: '' };
      dataRows.push([
        i === 0 ? (recipe.name || 'Imported Recipe') : '',
        i === 0 ? (recipe.servings || '') : '',
        i === 0 ? (recipe.prepTime || '') : '',
        i === 0 ? (recipe.cookTime || '') : '',
        i === 0 ? (recipe.category || '') : '',
        i === 0 ? (recipe.difficulty || '') : '',
        ingr.qty || '',
        ingr.unit || '',
        ingr.name || '',
        steps[i] || '',
        i === 0 ? (recipe.description || '') : '',
        i === 0 ? url : '',
      ]);
    }

    const allRows = [headers, ...dataRows];

    // Get the sheet title from the current loaded data
    const data = await api.sheets.getSpreadsheet(sheetId);
    const sheetTitle = data.sheetTitle || 'Sheet1';

    await api.sheets.replaceSheetData(sheetId, sheetTitle, allRows);

    showToast(`Recipe "${recipe.name}" re-synced successfully`, 'success');

    // Reload the current sheet view
    checklist.show(sheetId);
  } catch (err) {
    showToast(`Re-sync failed: ${err.message}`, 'error');
  }
}

function closeImportModal() {
  importModal.classList.add('hidden');
}

function showImportStep(step) {
  importStep = step;
  importStepPick.classList.toggle('hidden', step !== 0);
  importStepAnalyze.classList.toggle('hidden', step !== 1);
  importStepReview.classList.toggle('hidden', step !== 2);
  importBackBtn.classList.toggle('hidden', step === 0);
  importModalTitle.textContent = ['Import a File', 'Configure Template', 'Review & Import'][step];

  if (step === 0) {
    importNextBtn.textContent = 'Next';
    importNextBtn.disabled = !selectedImportSheet;
  } else if (step === 1) {
    importNextBtn.textContent = 'Review';
    importNextBtn.disabled = false;
  } else if (step === 2) {
    importNextBtn.textContent = 'Import';
    importNextBtn.disabled = false;
  }
}

function importGoBack() {
  if (importStep > 0) {
    showImportStep(importStep - 1);
  }
}

async function importGoNext() {
  if (importStep === 0) {
    // Load the selected file data, auto-detect template, and move to step 1
    if (!selectedImportSheet) return;
    importProgress.classList.remove('hidden');
    importProgress.textContent = 'Loading file data…';
    try {
      const isDoc = selectedImportSheet.mimeType === 'application/vnd.google-apps.document';
      if (isDoc) {
        importSheetData = await importer.fetchDocForImport(selectedImportSheet.id, selectedImportSheet.name);
      } else {
        importSheetData = await importer.fetchSheetForImport(selectedImportSheet.id);
      }
      renderImportPreview(importSheetData);

      // Auto-detect template
      importAnalysis = importer.analyzeWithCode(importSheetData);

      // Populate template picker
      populateTemplatePicker(importAnalysis);
      renderColumnMapEditor(importAnalysis);
      updateDetectBadge(importAnalysis);

      showImportStep(1);
    } catch (err) {
      showToast(`Failed to load file: ${err.message}`, 'error');
    } finally {
      importProgress.classList.add('hidden');
    }
  } else if (importStep === 1) {
    // Collect user column mapping and move to review
    // User selection ALWAYS takes priority over auto-detection
    collectUserMapping();
    importAnalysis.columnMapping = { ...userColumnMapping };
    const effectiveTemplate = userTemplateOverride || importTemplatePick.value || importAnalysis.suggestedTemplate;
    importAnalysis.suggestedTemplate = effectiveTemplate;
    const templates = importer.getTemplateList();
    const t = templates.find(t => t.key === effectiveTemplate);
    if (t) importAnalysis.templateName = t.name;

    renderImportReview(importAnalysis);
    showImportStep(2);
  } else if (importStep === 2) {
    // Execute import
    importNextBtn.disabled = true;
    importNextBtn.textContent = 'Importing…';
    importCancelBtn.disabled = true;
    importProgress.classList.remove('hidden');
    try {
      const options = {
        remap: false,
        // User selection ALWAYS overrides auto-detected template
        template: userTemplateOverride || importAnalysis.suggestedTemplate,
        // When user overrides the template, pass column mapping so headers
        // are renamed to match the chosen template's expected columns.
        columnMapping: userTemplateOverride ? userColumnMapping : null,
        onProgress(msg) { importProgress.textContent = msg; },
      };
      const result = await importer.importSheet(importSheetData, importAnalysis, options);

      // Patch .waymark-index so the folder view picks up the imported sheet
      if (result.sheetId && result.folderId) {
        const importHeaders = importSheetData?.values?.[0] || [];
        const importFirstRow = importSheetData?.values?.[1] || [];
        patchFolderIndex(result.folderId, {
          id: result.sheetId,
          name: importSheetData?.title || 'Imported Sheet',
          headers: importHeaders,
          firstRow: importFirstRow,
        });
      }

      await explorer.load();
      collectKnownSheets();
      closeImportModal();
      // Navigate to the imported sheet
      if (result.sheetId) {
        window.location.hash = `#/sheet/${result.sheetId}`;
      }
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
      importProgress.textContent = `Error: ${err.message}`;
    } finally {
      importNextBtn.disabled = false;
      importNextBtn.textContent = 'Import';
      importCancelBtn.disabled = false;
    }
  }
}

function populateTemplatePicker(analysis) {
  importTemplatePick.innerHTML = '';
  const templates = importer.getTemplateList();
  for (const t of templates) {
    const opt = el('option', { value: t.key }, [`${t.icon} ${t.name}`]);
    if (t.key === analysis.suggestedTemplate) opt.selected = true;
    importTemplatePick.append(opt);
  }
}

function updateDetectBadge(analysis) {
  const conf = Math.round((analysis.confidence || 0) * 100);
  importDetectConf.textContent = `${conf}% match`;
  importDetectConf.className = 'import-confidence-badge ' +
    (conf >= 70 ? 'import-confidence-high' : conf >= 40 ? 'import-confidence-medium' : 'import-confidence-low');
}

function renderColumnMapEditor(analysis) {
  importColMapEditor.innerHTML = '';
  const headers = importSheetData?.values?.[0] || [];
  const mapping = analysis.columnMapping || {};

  // Get available roles for the selected template
  const roles = importer.getTemplateRoles(analysis.suggestedTemplate);

  for (const header of headers) {
    const currentRole = mapping[header] || '';

    const row = el('div', { className: 'import-mapping-row' }, [
      el('span', { className: 'import-mapping-orig' }, [header]),
      el('span', { className: 'import-mapping-arrow' }, ['→']),
    ]);

    const select = document.createElement('select');
    select.className = 'import-mapping-select';
    select.dataset.header = header;

    // Default option
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '(keep as-is)';
    select.append(defaultOpt);

    for (const role of roles) {
      const opt = document.createElement('option');
      opt.value = role.key;
      opt.textContent = role.label;
      // Auto-select if code detection mapped this column to this role
      if (currentRole === role.label || currentRole === role.key) {
        opt.selected = true;
      }
      select.append(opt);
    }

    row.append(select);
    importColMapEditor.append(row);
  }
}

function collectUserMapping() {
  userColumnMapping = {};
  const selects = importColMapEditor.querySelectorAll('.import-mapping-select');
  selects.forEach(select => {
    const header = select.dataset.header;
    const role = select.value;
    if (header) {
      userColumnMapping[header] = role || '(keep as-is)';
    }
  });
}
function renderImportSheets(sheets) {
  importSheetList.innerHTML = '';
  if (sheets.length === 0) {
    importSheetList.innerHTML = '<p class="text-muted">No spreadsheets or documents found in your Drive.</p>';
    return;
  }

  for (const sheet of sheets) {
    const isDoc = sheet.mimeType === 'application/vnd.google-apps.document';
    const icon = isDoc ? '📄' : '📊';
    const typeLabel = isDoc ? 'Document' : 'Spreadsheet';
    const item = el('div', {
      className: 'import-sheet-item',
      dataset: { id: sheet.id },
      on: {
        click() {
          // Deselect previous
          importSheetList.querySelectorAll('.import-sheet-item.selected').forEach(s => s.classList.remove('selected'));
          item.classList.add('selected');
          selectedImportSheet = sheet;
          importNextBtn.disabled = false;
        },
      },
    }, [
      el('span', { className: 'import-sheet-item-icon' }, [icon]),
      el('div', { className: 'import-sheet-item-info' }, [
        el('div', { className: 'import-sheet-item-name' }, [sheet.name]),
        el('div', { className: 'import-sheet-item-meta' }, [
          typeLabel,
          sheet.modifiedTime ? ` · Modified ${new Date(sheet.modifiedTime).toLocaleDateString()}` : '',
          sheet.owners?.[0]?.displayName ? ` · ${sheet.owners[0].displayName}` : '',
        ].filter(Boolean).join('')),
      ]),
    ]);
    importSheetList.append(item);
  }
}

function filterImportSheets() {
  const q = importSearchInput.value.toLowerCase().trim();
  const filtered = q
    ? importSheets.filter(s => s.name.toLowerCase().includes(q))
    : importSheets;
  renderImportSheets(filtered);
  // re-highlight if still selected
  if (selectedImportSheet) {
    const el = importSheetList.querySelector(`[data-id="${selectedImportSheet.id}"]`);
    if (el) el.classList.add('selected');
  }
}

function renderImportPreview(data) {
  importPreviewName.textContent = data.title || 'Untitled';
  const rowCount = Math.max(0, (data.values?.length || 1) - 1);
  importPreviewRows.textContent = `${rowCount} row${rowCount !== 1 ? 's' : ''}`;

  // Render preview table (headers + up to 5 rows)
  importPreviewTable.innerHTML = '';
  const headers = data.values?.[0] || [];
  const rows = (data.values || []).slice(1, 6);

  if (headers.length) {
    const thead = el('thead', {}, [
      el('tr', {}, headers.map(h => el('th', {}, [h || '']))),
    ]);
    importPreviewTable.append(thead);
  }
  if (rows.length) {
    const tbody = el('tbody', {}, rows.map(row =>
      el('tr', {}, headers.map((_, i) => el('td', {}, [row[i] || ''])))
    ));
    importPreviewTable.append(tbody);
  }
}

function renderImportReview(analysis) {
  // Summary
  importAnalysisSummary.textContent = analysis.summary || '';

  // Template
  importResultTemplate.textContent = analysis.templateName || analysis.suggestedTemplate;

  // Confidence badge
  const conf = Math.round((analysis.confidence || 0) * 100);
  importResultConfidence.textContent = `${conf}%`;
  importResultConfidence.className = 'import-confidence-badge ' +
    (conf >= 70 ? 'import-confidence-high' : conf >= 40 ? 'import-confidence-medium' : 'import-confidence-low');

  // Rows
  importResultRows.textContent = analysis.rowCount ?? '—';

  // Column mapping
  importMappingTable.innerHTML = '';
  const mapping = analysis.columnMapping || {};
  for (const [orig, mapped] of Object.entries(mapping)) {
    const row = el('div', { className: 'import-mapping-row' }, [
      el('span', { className: 'import-mapping-orig' }, [orig]),
      el('span', { className: 'import-mapping-arrow' }, ['→']),
      el('span', { className: 'import-mapping-new' }, [mapped]),
    ]);
    importMappingTable.append(row);
  }
}

/* ---------- Theme ---------- */

const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeToggleIcon = document.getElementById('theme-toggle-icon');

function resolveTheme(pref) {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

function applyTheme(pref) {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  if (themeToggleIcon) themeToggleIcon.textContent = resolved === 'dark' ? '☀️' : '🌙';

  // Update settings modal buttons
  document.querySelectorAll('.settings-theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === pref);
  });
}

function initTheme() {
  const saved = storage.getTheme();
  applyTheme(saved);

  // Top-bar quick toggle
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = storage.getTheme();
      const next = resolveTheme(current) === 'dark' ? 'light' : 'dark';
      storage.setTheme(next);
      userData.setTheme(next);
      applyTheme(next);
    });
  }

  // Settings modal theme buttons
  document.querySelectorAll('.settings-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pref = btn.dataset.theme;
      storage.setTheme(pref);
      userData.setTheme(pref);
      applyTheme(pref);
    });
  });

  // Listen for system preference changes when set to 'system'
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (storage.getTheme() === 'system') applyTheme('system');
  });
}

/* ---------- Settings Modal ---------- */

function openSettingsModal() {
  if (!settingsModal) return;

  // Populate profile info
  const avatarEl = document.getElementById('settings-avatar');
  const nameEl = document.getElementById('settings-user-name');
  const emailEl = document.getElementById('settings-user-email');

  if (userAvatarEl.src && !userAvatarEl.classList.contains('hidden')) {
    avatarEl.src = userAvatarEl.src;
    avatarEl.alt = userAvatarEl.alt;
  }
  nameEl.textContent = _userName || '';
  emailEl.textContent = '';

  // Version / hash display
  const versionEl = document.getElementById('settings-version');
  if (versionEl) {
    const hash = window.__WAYMARK_HASH || '';
    const repo = window.__WAYMARK_REPO || '';
    if (hash) {
      versionEl.innerHTML = '';
      if (repo) {
        const link = document.createElement('a');
        link.href = `${repo}/commit/${hash}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = hash;
        link.className = 'settings-hash-link';
        versionEl.append('Build: ', link);
      } else {
        versionEl.textContent = `Build: ${hash}`;
      }
    } else {
      versionEl.textContent = '';
    }
  }

  // Populate current preferences
  settingsAutoRefresh.checked = userData.getAutoRefresh();
  settingsMqttBridge.checked = userData.getMqttBridge();
  settingsMqttUrl.value = userData.getMqttBrokerUrl();
  settingsSortOrder.value = userData.getSortOrder();

  // Sync theme buttons
  const currentTheme = storage.getTheme();
  document.querySelectorAll('.settings-theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);
  });

  // Import folder display
  const customName = userData.getImportFolderName();
  settingsImportFolder.textContent = customName || 'Waymark / Imports';
  settingsResetFolder.classList.toggle('hidden', !customName);
  settingsFolderBrowser.classList.add('hidden');

  // Version picker (only visible when GitHub source is active)
  if (window.__WAYMARK_GITHUB_SOURCE && settingsVersionSection) {
    settingsVersionSection.classList.remove('hidden');
    const savedRef = userData.getGithubRef();
    settingsGithubRef.value = savedRef;
    settingsCurrentRef.textContent = window.__WAYMARK_GITHUB_REF || savedRef;

    // Highlight the active quick-switch button
    settingsRefSuggestions.querySelectorAll('.settings-ref-tag').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ref === savedRef);
    });

    // Fetch available info from backend (best-effort)
    fetchSourceInfo();
  }

  settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.add('hidden');
  if (settingsFolderBrowser) settingsFolderBrowser.classList.add('hidden');
}

/* ---------- Version Picker helpers ---------- */

/**
 * Apply a new GitHub ref: save to Drive, tell the backend, and reload.
 */
async function applyGithubRef() {
  const ref = (settingsGithubRef.value || '').trim();
  if (!ref) {
    showRefStatus('Please enter a branch, tag, or commit SHA.', 'error');
    return;
  }

  showRefStatus('Switching…', 'info');
  settingsApplyRef.disabled = true;

  try {
    // Tell the backend to switch refs
    const base = window.__WAYMARK_BASE || '';
    const res = await fetch(`${base}/api/source/ref`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server responded with ${res.status}`);
    }

    const data = await res.json();

    // Save the ref to Drive so it persists across sessions/devices
    await userData.setGithubRef(data.ref);

    showRefStatus(`Switched to "${data.ref}". Reloading…`, 'success');

    // Update quick-switch highlights
    settingsRefSuggestions.querySelectorAll('.settings-ref-tag').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ref === data.ref);
    });
    settingsCurrentRef.textContent = data.ref;

    // Reload after a brief delay so the user sees the success message
    setTimeout(() => window.location.reload(), 800);
  } catch (err) {
    showRefStatus(`Failed: ${err.message}`, 'error');
  } finally {
    settingsApplyRef.disabled = false;
  }
}

/**
 * Show a status message below the ref input.
 */
function showRefStatus(message, type) {
  if (!settingsRefStatus) return;
  settingsRefStatus.textContent = message;
  settingsRefStatus.className = `settings-ref-status settings-ref-status-${type}`;
  settingsRefStatus.classList.remove('hidden');
}

/**
 * Fetch current source info from the backend and populate suggestions.
 */
async function fetchSourceInfo() {
  try {
    const base = window.__WAYMARK_BASE || '';
    const res = await fetch(`${base}/api/source`);
    if (!res.ok) return;
    const info = await res.json();

    settingsCurrentRef.textContent = info.ref;

    // Add cached refs as quick-switch options
    if (info.cachedRefs && info.cachedRefs.length > 0) {
      // Clear existing tags (except the main one)
      const existing = new Set();
      settingsRefSuggestions.querySelectorAll('.settings-ref-tag').forEach(btn => {
        existing.add(btn.dataset.ref);
      });

      const currentSaved = userData.getGithubRef();
      for (const cachedRef of info.cachedRefs) {
        if (existing.has(cachedRef)) continue;
        const tag = el('button', {
          className: `settings-ref-tag${cachedRef === currentSaved ? ' active' : ''}`,
          dataset: { ref: cachedRef },
          type: 'button',
        }, [cachedRef]);
        settingsRefSuggestions.appendChild(tag);
      }
    }
  } catch { /* best-effort */ }
}

async function loadFolderBrowser() {
  try {
    const folder = await api.picker.pickFolder();
    if (folder) {
      await userData.setImportFolder(folder.id, folder.name);
      settingsImportFolder.textContent = folder.name;
      settingsResetFolder.classList.remove('hidden');
      showToast(`Import folder set to "${folder.name}"`, 'success');
    }
  } catch (err) {
    showToast(`Failed to pick folder: ${err.message}`, 'error');
  }
}

function initSettingsModal() {
  if (!settingsModal) return;

  // Open on avatar or username click
  userAvatarEl.addEventListener('click', openSettingsModal);
  userNameEl.addEventListener('click', openSettingsModal);
  userAvatarEl.style.cursor = 'pointer';
  userNameEl.style.cursor = 'pointer';

  // Close handlers
  settingsModalClose.addEventListener('click', closeSettingsModal);
  settingsDoneBtn.addEventListener('click', closeSettingsModal);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  // Auto-refresh toggle
  settingsAutoRefresh.addEventListener('change', () => {
    userData.setAutoRefresh(settingsAutoRefresh.checked);
  });

  // MQTT debug bridge toggle
  settingsMqttBridge.addEventListener('change', () => {
    const enabled = settingsMqttBridge.checked;
    userData.setMqttBridge(enabled);
    if (enabled) {
      const url = userData.getMqttBrokerUrl() || undefined;
      import('./mqtt-bridge.js').then(m => m.startBridge(url)).catch(() => {});
    } else {
      import('./mqtt-bridge.js').then(m => m.stopBridge()).catch(() => {});
    }
  });

  // MQTT broker URL
  settingsMqttUrlApply.addEventListener('click', async () => {
    const url = settingsMqttUrl.value.trim();
    await userData.setMqttBrokerUrl(url);
    // Reconnect if bridge is active
    if (userData.getMqttBridge()) {
      import('./mqtt-bridge.js').then(m => {
        m.stopBridge();
        m.startBridge(url || undefined);
      }).catch(() => {});
    }
    showToast(url ? `Broker set to ${url}` : 'Broker set to auto-detect', 'success');
  });
  settingsMqttUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') settingsMqttUrlApply.click();
  });

  // Sort order select
  settingsSortOrder.addEventListener('change', () => {
    userData.setSortOrder(settingsSortOrder.value);
  });

  // Import folder — choose button
  settingsChooseFolder.addEventListener('click', () => {
    if (settingsFolderBrowser.classList.contains('hidden')) {
      loadFolderBrowser();
    } else {
      settingsFolderBrowser.classList.add('hidden');
    }
  });

  // Import folder — reset button
  settingsResetFolder.addEventListener('click', async () => {
    await userData.setImportFolder(null, null);
    settingsImportFolder.textContent = 'Waymark / Imports';
    settingsResetFolder.classList.add('hidden');
    settingsFolderBrowser.classList.add('hidden');
    showToast('Import folder reset to default', 'success');
  });

  // Version picker — apply button
  if (settingsApplyRef) {
    settingsApplyRef.addEventListener('click', () => applyGithubRef());
    settingsGithubRef.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyGithubRef();
    });
  }

  // Version picker — quick-switch tag buttons
  if (settingsRefSuggestions) {
    settingsRefSuggestions.addEventListener('click', (e) => {
      const btn = e.target.closest('.settings-ref-tag');
      if (!btn) return;
      settingsGithubRef.value = btn.dataset.ref;
      applyGithubRef();
    });
  }
}

/* ---------- Known sheets for search context ---------- */

async function collectKnownSheets() {
  const sheetNodes = document.querySelectorAll('.sheet-item[data-id], .sheet-list-item[data-id]');
  const sheets = [];
  const seen = new Set();
  sheetNodes.forEach(n => {
    if (!seen.has(n.dataset.id)) {
      seen.add(n.dataset.id);
      sheets.push({ id: n.dataset.id, name: n.textContent.trim(), folder: '' });
    }
  });

  // Add recent and pinned sheets to search context
  const recents = userData.getRecentSheets();
  for (const s of recents) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      sheets.push({ id: s.id, name: s.name, folder: '' });
    }
  }
  const pinned = userData.getPinnedSheets();
  for (const s of pinned) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      sheets.push({ id: s.id, name: s.name, folder: '' });
    }
  }

  search.registerSheets(sheets);
}

/* ---------- Auto-update checker ---------- */

let _bootHash = '';
let _updateToast = null;
let _lastCheckTime = 0;
const UPDATE_CHECK_INTERVAL = 120_000; // 2 minutes
const UPDATE_CHECK_MIN_GAP  = 30_000;  // min 30 s between checks

/** Start polling for app updates (production only). */
function initUpdateChecker() {
  _bootHash = window.__WAYMARK_HASH || '';
  if (!_bootHash || window.__WAYMARK_LOCAL) return;

  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate();
  });
}

/** Check if the server has a newer build hash. */
async function checkForUpdate() {
  if (_updateToast) return;
  const now = Date.now();
  if (now - _lastCheckTime < UPDATE_CHECK_MIN_GAP) return;
  _lastCheckTime = now;

  try {
    const base = window.__WAYMARK_BASE || '';
    const res = await fetch(`${base}/`, { method: 'HEAD', cache: 'no-store' });
    const serverHash = res.headers.get('X-Waymark-Hash');
    if (serverHash && serverHash !== _bootHash) {
      showUpdateBanner();
    }
  } catch { /* network error — retry next cycle */ }
}

/** Show a persistent toast prompting the user to refresh. */
function showUpdateBanner() {
  if (_updateToast) return;
  _updateToast = showToast('\u{1F504} Update available \u2014 tap to refresh', 'update', 0);
  if (_updateToast) {
    _updateToast.addEventListener('click', () => location.reload());
  }
}

/* ---------- Start ---------- */

boot().catch(err => {
  console.error('WayMark boot error:', err);
  hideLoading();
  showToast('Failed to start WayMark', 'error');
});
