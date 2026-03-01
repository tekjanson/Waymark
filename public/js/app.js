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
import * as importer from './import.js';

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
const importBtn     = document.getElementById('import-sheet-btn');

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

  // Import sheet — open import modal
  if (importBtn) {
    importBtn.addEventListener('click', openImportModal);
  }

  // Wire examples modal
  initExamplesModal();

  // Wire import modal
  initImportModal();

  // Listen for pin changes to re-render home
  window.addEventListener('waymark:pins-changed', renderPinnedFolders);

  // Restore sidebar state
  toggleSidebar(storage.getSidebarOpen());

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
  userNameEl.textContent = user.name || user.email || '';
  if (user.picture) {
    userAvatarEl.src = user.picture;
    userAvatarEl.alt = user.name || '';
    userAvatarEl.classList.remove('hidden');
  }

  // Load explorer & collect known sheets before routing
  await explorer.load();
  await collectKnownSheets();

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

/* ---------- Import Modal ---------- */

let importStep = 0;       // 0 = pick, 1 = configure, 2 = review
let importSheets = [];    // cached list of importable sheets
let selectedImportSheet = null; // { id, name, ... }
let importSheetData = null;     // full sheet data from API
let importAnalysis = null;      // analysis result from code detection
let userColumnMapping = {};     // user's manual column assignments

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

  // Template picker change — re-run code detection with new template
  importTemplatePick.addEventListener('change', () => {
    if (!importSheetData) return;
    const chosenKey = importTemplatePick.value;
    importAnalysis = importer.analyzeWithCode(importSheetData);
    // Override template if user picked one
    if (chosenKey && chosenKey !== importAnalysis.suggestedTemplate) {
      importAnalysis.suggestedTemplate = chosenKey;
      const templates = importer.getTemplateList();
      const t = templates.find(t => t.key === chosenKey);
      importAnalysis.templateName = t?.name || chosenKey;
      importAnalysis.confidence = 0.5; // user-chosen, medium confidence
      importAnalysis.summary = `Manually selected "${importAnalysis.templateName}" template.`;
    }
    renderColumnMapEditor(importAnalysis);
    updateDetectBadge(importAnalysis);
  });
}

async function openImportModal() {
  importStep = 0;
  selectedImportSheet = null;
  importSheetData = null;
  importAnalysis = null;
  userColumnMapping = {};
  importSearchInput.value = '';

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
    collectUserMapping();
    importAnalysis.columnMapping = { ...userColumnMapping };
    importAnalysis.suggestedTemplate = importTemplatePick.value || importAnalysis.suggestedTemplate;
    const templates = importer.getTemplateList();
    const t = templates.find(t => t.key === importAnalysis.suggestedTemplate);
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
        template: importAnalysis.suggestedTemplate,
        onProgress(msg) { importProgress.textContent = msg; },
      };
      const result = await importer.importSheet(importSheetData, importAnalysis, options);
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
