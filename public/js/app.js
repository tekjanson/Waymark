/* ============================================================
   app.js — WayMark entry point
   Initialises all modules, manages routing, and orchestrates
   the authentication flow.
   ============================================================ */

import { api }       from './api-client.js';
import * as storage  from './storage.js';
import { el, showView, showLoading, hideLoading, showToast, toggleSidebar } from './ui.js';
import * as explorer from './explorer.js';
import * as checklist from './checklist.js';
import * as search   from './search.js';
import * as records  from './records.js';
import { generateExamples, getExampleCategories } from './examples.js';
import { Tutorial } from './tutorial.js';

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
const generateBtn   = document.getElementById('generate-examples-btn');
const generateProg  = document.getElementById('generate-progress');
const tutorialBtn   = document.getElementById('tutorial-btn');

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

/* ---------- Navigation callback ---------- */

function navigate(type, id, name) {
  if (type === 'sheet') {
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
    storage.setSidebarOpen(open);
  });
  backBtn.addEventListener('click', () => { window.location.hash = '#/'; });
  folderBackBtn.addEventListener('click', () => { window.location.hash = '#/'; });

  // Generate examples — open modal instead of generating directly
  if (generateBtn) {
    generateBtn.addEventListener('click', openExamplesModal);
  }

  // Wire examples modal
  initExamplesModal();

  // Listen for pin changes to re-render home
  window.addEventListener('waymark:pins-changed', renderPinnedFolders);

  // Restore sidebar state
  toggleSidebar(storage.getSidebarOpen());

  // Attempt auth
  const user = await api.auth.init();
  hideLoading();

  if (user) {
    showApp(user);
  } else {
    showLogin();
  }
}

/* ---------- Auth ---------- */

function showLogin() {
  loginScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

function showApp(user) {
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');

  // Update user info in top bar
  userNameEl.textContent = user.name || user.email || '';
  if (user.picture) {
    userAvatarEl.src = user.picture;
    userAvatarEl.alt = user.name || '';
    userAvatarEl.classList.remove('hidden');
  }

  // Load explorer
  explorer.load().then(() => {
    collectKnownSheets();
  });

  // Route to current hash
  handleRoute();
  window.addEventListener('hashchange', handleRoute);

  // Show tutorial for first-time users
  if (!storage.getTutorialCompleted()) {
    setTimeout(() => Tutorial.start(), 600);
  }

  // Tutorial button in top bar
  if (tutorialBtn) {
    tutorialBtn.addEventListener('click', () => Tutorial.start());
  }
}

async function handleLogout() {
  await api.auth.logout();
  storage.clearAll();
  loginScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

/* ---------- Routing ---------- */

function handleRoute() {
  const hash = window.location.hash || '#/';

  // Handle auth callback
  if (hash === '#auth_success') {
    window.location.hash = '#/';
    return;
  }

  checklist.hide(); // stop any running timer

  if (hash.startsWith('#/sheet/')) {
    const sheetId = hash.replace('#/sheet/', '');
    showView('checklist');
    checklist.show(sheetId);
    storage.setLastView(hash);
  } else if (hash.startsWith('#/folder/')) {
    const parts = hash.replace('#/folder/', '').split('/');
    const folderId = parts[0];
    const folderName = decodeURIComponent(parts.slice(1).join('/') || 'Folder');
    showView('folder');
    showFolderContents(folderId, folderName);
    storage.setLastView(hash);
  } else if (hash.startsWith('#/search')) {
    showView('search');
    search.searchFromHash(hash);
    storage.setLastView(hash);
  } else {
    // Home
    showView('home');
    renderPinnedFolders();
    storage.setLastView('#/');
  }
}

/* ---------- Home — Pinned Folders ---------- */

function renderPinnedFolders() {
  const pinned = storage.getPinnedFolders();
  const container = document.getElementById('pinned-folders');
  const emptyMsg  = document.getElementById('no-pinned');

  container.innerHTML = '';

  if (pinned.length === 0) {
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

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

/* ---------- Folder Contents ---------- */

async function showFolderContents(folderId, folderName) {
  const titleEl      = document.getElementById('folder-title');
  const sheetsEl     = document.getElementById('folder-sheets');
  const noSheetsEl   = document.getElementById('no-sheets');

  titleEl.textContent = folderName;
  sheetsEl.innerHTML  = '';
  noSheetsEl.classList.add('hidden');

  try {
    const res = await api.drive.listChildren(folderId);
    const items = res.files || [];
    const sheets  = items.filter(i => i.mimeType === 'application/vnd.google-apps.spreadsheet');
    const folders = items.filter(i => i.mimeType === 'application/vnd.google-apps.folder');

    if (sheets.length === 0 && folders.length === 0) {
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

    // Render sheets
    for (const s of sheets) {
      sheetsEl.append(el('div', {
        className: 'sheet-list-item',
        on: { click() { navigate('sheet', s.id, s.name); } },
      }, [
        el('span', { className: 'sheet-emoji' }, ['📊']),
        el('div', { className: 'sheet-list-item-name' }, [s.name]),
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

/* ---------- Known sheets for search context ---------- */

function collectKnownSheets() {
  const sheetNodes = document.querySelectorAll('.sheet-item[data-id], .sheet-list-item[data-id]');
  const sheets = [];
  sheetNodes.forEach(n => {
    sheets.push({ id: n.dataset.id, name: n.textContent.trim(), folder: '' });
  });

  // Also gather from fixtures in local mode (if available)
  if (window.__WAYMARK_LOCAL && window.__WAYMARK_FIXTURE_SHEETS) {
    sheets.push(...window.__WAYMARK_FIXTURE_SHEETS);
  }

  search.registerSheets(sheets);
}

/* ---------- Start ---------- */

boot().catch(err => {
  console.error('WayMark boot error:', err);
  hideLoading();
  showToast('Failed to start WayMark', 'error');
});
