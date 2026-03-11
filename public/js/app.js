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
const settingsSortOrder   = document.getElementById('settings-sort-order');
const settingsImportFolder = document.getElementById('settings-import-folder');
const settingsChooseFolder = document.getElementById('settings-choose-folder');
const settingsResetFolder  = document.getElementById('settings-reset-folder');
const settingsFolderBrowser = document.getElementById('settings-folder-browser');

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
const createSheetModal      = document.getElementById('create-sheet-modal');
const createSheetModalClose = document.getElementById('create-sheet-modal-close');
const createSheetCancelBtn  = document.getElementById('create-sheet-cancel-btn');
const createSheetCreateBtn  = document.getElementById('create-sheet-create-btn');
const createSheetNameInput  = document.getElementById('create-sheet-name');
const createSheetGrid       = document.getElementById('create-sheet-templates');
const createSheetStatus     = document.getElementById('create-sheet-status');
const createSheetProgress   = document.getElementById('create-sheet-progress');

/* ---------- Template headers for new sheet creation ---------- */
const TEMPLATE_HEADERS = {
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

  // Wire UI events
  loginBtn.addEventListener('click',  () => api.auth.login());
  logoutBtn.addEventListener('click', handleLogout);
  sidebarToggle.addEventListener('click', () => {
    const open = toggleSidebar();
    userData.setSidebarOpen(open);
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

  // Listen for pin changes to re-render home
  window.addEventListener('waymark:pins-changed', renderHome);

  // Listen for recipe re-sync requests from the recipe template
  window.addEventListener('waymark:recipe-resync', handleRecipeResync);

  // Restore sidebar state
  toggleSidebar(userData.getSidebarOpen());

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

  // Load explorer & collect known sheets before routing
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

  wire('home-action-create',   () => { if (createSheetModal) createSheetModal.classList.remove('hidden'); });
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
          ? el('div', { className: 'pinned-card-owner' }, [folder.owner])
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
let currentFolderId  = null;
let currentFolderName = null;

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

async function showFolderContents(folderId, folderName) {
  currentFolderId = folderId;
  currentFolderName = folderName;
  const titleEl      = document.getElementById('folder-title');
  const sheetsEl     = document.getElementById('folder-sheets');
  const noSheetsEl   = document.getElementById('no-sheets');

  titleEl.textContent = folderName;
  sheetsEl.innerHTML  = '';
  noSheetsEl.classList.add('hidden');

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
      }
    }
  }

  try {
    const res = await api.drive.listChildren(folderId);
    let items = res.files || [];

    // Apply .waymarkIgnore filtering
    items = await explorer.applyWaymarkIgnore(folderId, items);

    const sheets  = items.filter(i => i.mimeType === 'application/vnd.google-apps.spreadsheet');
    const docs    = items.filter(i => i.mimeType === 'application/vnd.google-apps.document');
    const folders = items.filter(i => i.mimeType === 'application/vnd.google-apps.folder');

    if (sheets.length === 0 && folders.length === 0 && docs.length === 0) {
      noSheetsEl.classList.remove('hidden');
      return;
    }

    // Render sub-folders
    for (const f of folders) {
      sheetsEl.append(el('div', {
        className: 'sheet-list-item',
        on: { click() { navigate('folder', f.id, f.name); } },
      }, [
        el('span', { className: 'sheet-emoji' }, ['📁']),
        el('div', { className: 'sheet-list-item-name' }, [f.name]),
      ]));
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
          // Remove instant-cached render now that real data is ready
          const cachedDir = sheetsEl.querySelector('.directory-view-cached');
          if (cachedDir) cachedDir.remove();

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

          // Use the template's directory view
          const dirContainer = el('div', { className: 'directory-view-container' });
          sheetsEl.append(dirContainer);
          group.template.directoryView(dirContainer, group.sheets, navigate);
          usedDirectoryView = true;

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
        // Remove instant-cached render if it was shown (folder composition changed)
        const cachedDir = sheetsEl.querySelector('.directory-view-cached');
        if (cachedDir) cachedDir.remove();

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

    // Render docs
    for (const d of docs) {
      sheetsEl.append(el('div', {
        className: 'sheet-list-item',
        on: { click() { navigate('sheet', d.id, d.name); } },
      }, [
        el('span', { className: 'sheet-emoji' }, ['📄']),
        el('div', { className: 'sheet-list-item-name' }, [d.name]),
      ]));
    }

    // Register for search context
    collectKnownSheets();
  } catch (err) {
    sheetsEl.innerHTML = `<p class="empty-state">Failed to load folder: ${err.message}</p>`;
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

function renderCategoryCheckboxes() {
  const categories = getExampleCategories();
  examplesCategories.innerHTML = '';

  const CATEGORY_ICONS = {
    'Checklists': '✅', 'Trackers': '📊', 'Schedules': '📅',
    'Inventories': '📦', 'Contacts': '👥', 'Logs': '📝',
    'Test Cases': '🧪', 'Budgets': '💰', 'Kanban': '📋',
    'Habits': '🔄', 'Gradebook': '🎓', 'Timesheets': '⏱️',
    'Polls': '🗳️', 'Changelogs': '📜', 'CRM': '🤝',
    'Meal Plans': '🍽️', 'Travel': '✈️', 'Rosters': '👨‍👩‍👧‍👦',
  };

  for (const cat of categories) {
    const isChecked = selectedCategories.has(cat.name);
    const icon = CATEGORY_ICONS[cat.name] || '📁';

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

let selectedTemplateKey = null;

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

  // Create button
  createSheetCreateBtn.addEventListener('click', handleCreateSheet);
}

function openCreateSheetModal() {
  selectedTemplateKey = null;
  createSheetNameInput.value = '';
  createSheetStatus.textContent = '';
  createSheetCreateBtn.disabled = true;
  createSheetCreateBtn.textContent = 'Create Sheet';
  createSheetProgress.classList.add('hidden');
  renderCreateSheetGrid();
  createSheetModal.classList.remove('hidden');
  createSheetNameInput.focus();
}

function closeCreateSheetModal() {
  createSheetModal.classList.add('hidden');
}

function renderCreateSheetGrid() {
  createSheetGrid.innerHTML = '';

  // Sort templates alphabetically by name
  const entries = Object.entries(TEMPLATES)
    .filter(([key]) => TEMPLATE_HEADERS[key])
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  for (const [key, tpl] of entries) {
    const headers = TEMPLATE_HEADERS[key];
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
  const headers = TEMPLATE_HEADERS[selectedTemplateKey];
  if (!headers) return;

  createSheetCreateBtn.disabled = true;
  createSheetCreateBtn.textContent = 'Creating…';
  createSheetCancelBtn.disabled = true;
  createSheetProgress.classList.remove('hidden');
  createSheetProgress.textContent = 'Creating sheet…';

  try {
    // Use the Waymark root folder as the parent
    let parentId = null;
    try {
      parentId = await userData.getRootFolderId();
    } catch {
      // Fall back to root if folder lookup fails
      parentId = null;
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
    createSheetCreateBtn.textContent = 'Create Sheet';
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

  // Load sheets
  importSheetList.innerHTML = '<p class="text-muted import-loading">Loading your files…</p>';
  try {
    importSheets = await importer.listImportableSheets();
    renderImportSheets(importSheets);
  } catch (err) {
    importSheetList.innerHTML = `<p class="text-muted">Failed to load files: ${err.message}</p>`;
  }
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
  settingsSortOrder.value = userData.getSortOrder();

  // Import folder display
  const customName = userData.getImportFolderName();
  settingsImportFolder.textContent = customName || 'Waymark / Imports';
  settingsResetFolder.classList.toggle('hidden', !customName);
  settingsFolderBrowser.classList.add('hidden');

  settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.add('hidden');
  if (settingsFolderBrowser) settingsFolderBrowser.classList.add('hidden');
}

async function loadFolderBrowser() {
  const breadcrumbs = [{ id: 'root', name: 'My Drive' }];

  async function renderLevel(folderId) {
    settingsFolderBrowser.innerHTML = '';
    settingsFolderBrowser.classList.remove('hidden');

    /* --- Breadcrumb trail --- */
    const crumbBar = el('div', { className: 'settings-folder-breadcrumbs' });
    for (let i = 0; i < breadcrumbs.length; i++) {
      const bc = breadcrumbs[i];
      if (i > 0) crumbBar.append(el('span', { className: 'settings-breadcrumb-sep' }, ['›']));
      const crumb = el('button', {
        className: 'settings-breadcrumb-btn',
        type: 'button',
        dataset: { idx: String(i) },
      }, [bc.name]);
      crumb.addEventListener('click', () => {
        breadcrumbs.splice(i + 1);
        renderLevel(bc.id);
      });
      crumbBar.append(crumb);
    }
    settingsFolderBrowser.append(crumbBar);

    /* --- Select-current button (not for root) --- */
    if (folderId !== 'root') {
      const currentCrumb = breadcrumbs[breadcrumbs.length - 1];
      const selectCurrentBtn = el('button', {
        className: 'settings-select-current-btn',
        type: 'button',
      }, [`✓ Select "${currentCrumb.name}"`]);
      selectCurrentBtn.addEventListener('click', async () => {
        await userData.setImportFolder(currentCrumb.id, currentCrumb.name);
        settingsImportFolder.textContent = currentCrumb.name;
        settingsResetFolder.classList.remove('hidden');
        settingsFolderBrowser.classList.add('hidden');
        showToast(`Import folder set to "${currentCrumb.name}"`, 'success');
      });
      settingsFolderBrowser.append(selectCurrentBtn);
    }

    /* --- Loading indicator --- */
    const loading = el('div', { className: 'settings-folder-item' }, ['Loading folders…']);
    settingsFolderBrowser.append(loading);

    try {
      let folders;
      if (folderId === 'root') {
        const result = await api.drive.listRootFolders();
        folders = (result.files || []).filter(f =>
          f.mimeType === 'application/vnd.google-apps.folder'
        );
      } else {
        const result = await api.drive.listChildren(folderId);
        folders = (result.files || []).filter(f =>
          f.mimeType === 'application/vnd.google-apps.folder'
        );
      }

      loading.remove();

      if (!folders.length) {
        settingsFolderBrowser.append(
          el('div', { className: 'settings-folder-item settings-folder-empty' }, ['No sub-folders'])
        );
        return;
      }

      for (const folder of folders) {
        const item = el('div', { className: 'settings-folder-item' }, [
          el('span', { className: 'settings-folder-icon' }, ['📁']),
          el('span', { className: 'settings-folder-name' }, [folder.name]),
          el('button', {
            className: 'settings-folder-select-btn',
            type: 'button',
            title: `Select "${folder.name}"`,
          }, ['Select']),
        ]);

        // Click folder name to navigate into it
        item.querySelector('.settings-folder-name').addEventListener('click', () => {
          breadcrumbs.push({ id: folder.id, name: folder.name });
          renderLevel(folder.id);
        });
        item.querySelector('.settings-folder-icon').addEventListener('click', () => {
          breadcrumbs.push({ id: folder.id, name: folder.name });
          renderLevel(folder.id);
        });

        // Click "Select" button to choose this folder
        item.querySelector('.settings-folder-select-btn').addEventListener('click', async () => {
          await userData.setImportFolder(folder.id, folder.name);
          settingsImportFolder.textContent = folder.name;
          settingsResetFolder.classList.remove('hidden');
          settingsFolderBrowser.classList.add('hidden');
          showToast(`Import folder set to "${folder.name}"`, 'success');
        });

        settingsFolderBrowser.append(item);
      }
    } catch {
      loading.remove();
      settingsFolderBrowser.append(
        el('div', { className: 'settings-folder-item' }, ['Failed to load folders'])
      );
    }
  }

  breadcrumbs.length = 1; // Reset to root
  renderLevel('root');
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

  // In local mode, also walk the fixture folder tree to find all sheets
  // (since not all folders may be expanded in the explorer)
  try {
    const allSheets = await api.drive.getAllSheets();
    for (const s of allSheets) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        sheets.push(s);
      }
    }
  } catch { /* ignore — this is a best-effort enrichment */ }

  search.registerSheets(sheets);
}

/* ---------- Start ---------- */

boot().catch(err => {
  console.error('WayMark boot error:', err);
  hideLoading();
  showToast('Failed to start WayMark', 'error');
});
