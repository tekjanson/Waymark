/* ============================================================
   checklist.js — Render a Google Sheet using detected templates
   Uses templates.js for deterministic type detection and
   specialised rendering. Auto-refreshes every 60 s.
   ============================================================ */

import { api } from './api-client.js';
import { el, showToast, timeAgo } from './ui.js';
import * as userData from './user-data.js';
import { detectTemplate, onEdit } from './templates/index.js';
import { buildAddRowForm, isAddRowOpen, setUserName, setEditLocked, getMissingMigrations } from './templates/shared.js';

let currentSheetId = null;
let currentSheetTitle = null;
let refreshTimer   = null;
let lastFetchTime  = null;
let currentValues  = null;
let currentDataTitle = null;

/* DOM refs (set in init) */
let titleEl, itemsEl, lastUpdatedEl, refreshBtn, autoToggle, templateBadge, openInSheetsBtn, downloadCsvBtn, sheetPinBtn, duplicateSheetBtn, shareBtn, lockBtn;

/* ---------- Public ---------- */

export function init() {
  titleEl       = document.getElementById('checklist-title');
  itemsEl       = document.getElementById('checklist-items');
  lastUpdatedEl = document.getElementById('last-updated');
  refreshBtn    = document.getElementById('refresh-btn');
  autoToggle    = document.getElementById('auto-refresh-toggle');
  templateBadge = document.getElementById('template-badge');
  openInSheetsBtn = document.getElementById('open-in-sheets-btn');
  downloadCsvBtn  = document.getElementById('download-csv-btn');
  sheetPinBtn     = document.getElementById('sheet-pin-btn');
  duplicateSheetBtn = document.getElementById('duplicate-sheet-btn');
  shareBtn          = document.getElementById('share-btn');
  lockBtn           = document.getElementById('lock-btn');

  autoToggle.checked = userData.getAutoRefresh();

  refreshBtn.addEventListener('click', () => {
    if (currentSheetId) loadSheet(currentSheetId);
  });

  if (openInSheetsBtn) {
    openInSheetsBtn.addEventListener('click', () => {
      if (currentSheetId) {
        window.open(`https://docs.google.com/spreadsheets/d/${currentSheetId}/edit`, '_blank');
      }
    });
  }

  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener('click', () => downloadCsv());
  }

  if (duplicateSheetBtn) {
    duplicateSheetBtn.addEventListener('click', () => duplicateSheet());
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (currentSheetId) {
        window.open(`https://docs.google.com/spreadsheets/d/${currentSheetId}/edit?usp=sharing`, '_blank');
      }
    });
  }

  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      if (!currentSheetId) return;
      const key = `waymark-lock-${currentSheetId}`;
      const isLocked = localStorage.getItem(key) === '1';
      const newState = !isLocked;
      localStorage.setItem(key, newState ? '1' : '0');
      applyLockState(newState);
    });
  }

  if (sheetPinBtn) {
    sheetPinBtn.addEventListener('click', () => {
      if (!currentSheetId) return;
      if (userData.isSheetPinned(currentSheetId)) {
        userData.removePinnedSheet(currentSheetId);
        sheetPinBtn.classList.remove('pinned');
        sheetPinBtn.title = 'Pin sheet';
        showToast('Sheet unpinned', 'success');
      } else {
        const headers = currentValues?.[0] || [];
        const { key: templateKey } = detectTemplate(headers);
        userData.addPinnedSheet({ id: currentSheetId, name: currentDataTitle || 'Untitled', templateKey });
        sheetPinBtn.classList.add('pinned');
        sheetPinBtn.title = 'Unpin sheet';
        showToast('Sheet pinned to home', 'success');
      }
      sheetPinBtn.classList.add('pin-bounce');
      sheetPinBtn.addEventListener('animationend', () => sheetPinBtn.classList.remove('pin-bounce'), { once: true });
      window.dispatchEvent(new CustomEvent('waymark:pins-changed'));
    });
  }

  autoToggle.addEventListener('change', () => {
    userData.setAutoRefresh(autoToggle.checked);
    resetTimer();
  });

  // Wire interactive editing — templates emit edits via this callback
  onEdit(async (rowIndex, colIndex, newValue) => {
    if (!currentSheetId || !currentSheetTitle) return;
    try {
      await api.sheets.updateCell(currentSheetId, currentSheetTitle, rowIndex, colIndex, newValue);
    } catch (err) {
      showToast(`Failed to save: ${err.message}`, 'error');
    }
  });

  // Pause auto-refresh when tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearInterval(refreshTimer); refreshTimer = null; }
    else { resetTimer(); }
  });
}

/* ---------- Lock State ---------- */

/** Apply lock/unlock visual + shared flag */
function applyLockState(locked) {
  setEditLocked(locked);
  if (lockBtn) {
    lockBtn.textContent = locked ? '\u{1F512}' : '\u{1F513}';
    lockBtn.classList.toggle('locked', locked);
    lockBtn.title = locked ? 'Unlock editing' : 'Lock editing';
    lockBtn.setAttribute('aria-label', locked ? 'Unlock editing' : 'Lock editing');
  }
  if (itemsEl) {
    itemsEl.classList.toggle('sheet-locked', locked);
  }
}

/**
 * Show a sheet as a checklist.
 * @param {string} sheetId
 * @param {string} [sheetName]  optional display name
 */
export async function show(sheetId, sheetName) {
  currentSheetId = sheetId;
  titleEl.textContent = sheetName || 'Loading…';
  itemsEl.innerHTML = '';
  lastUpdatedEl.textContent = '';
  // Restore per-sheet lock state
  const locked = localStorage.getItem(`waymark-lock-${sheetId}`) === '1';
  applyLockState(locked);
  await loadSheet(sheetId);
  resetTimer();
}

/** Stop auto-refresh (called when navigating away). */
export function hide() {
  currentSheetId = null;
  currentValues = null;
  currentDataTitle = null;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

/* ---------- CSV Download ---------- */

/**
 * Convert a cell value to a properly escaped CSV field.
 * @param {string} value
 * @returns {string}
 */
function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Download the current sheet data as a CSV file.
 */
function downloadCsv() {
  if (!currentValues || currentValues.length === 0) {
    showToast('No data to download', 'error');
    return;
  }
  const csvContent = currentValues
    .map(row => row.map(csvEscape).join(','))
    .join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const filename = (currentDataTitle || 'waymark-sheet')
    .replace(/[^a-z0-9_\- ]/gi, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  const a = el('a', { href: url, download: `${filename}.csv` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV downloaded', 'success');
}

/* ---------- Duplicate sheet ---------- */

/**
 * Duplicate the current sheet by reading its data and creating
 * a new spreadsheet with the same content.
 */
async function duplicateSheet() {
  if (!currentSheetId || !currentValues || currentValues.length === 0) {
    showToast('No sheet data to duplicate', 'error');
    return;
  }
  const title = `Copy of ${currentDataTitle || 'Untitled'}`;
  try {
    showToast('Duplicating sheet…', 'info');
    const result = await api.sheets.createSpreadsheet(title, currentValues);
    showToast(`Created "${title}"`, 'success');
    // Navigate to the new sheet
    if (result && (result.spreadsheetId || result.id)) {
      window.location.hash = `#/sheet/${result.spreadsheetId || result.id}`;
    }
  } catch (err) {
    showToast(`Failed to duplicate: ${err.message}`, 'error');
  }
}

/* ---------- Data loading ---------- */

async function loadSheet(sheetId) {
  try {
    const data = await api.sheets.getSpreadsheet(sheetId);
    titleEl.textContent = data.title;
    currentDataTitle = data.title;
    currentSheetTitle = data.sheetTitle || 'Sheet1';
    currentValues = data.values || [];
    renderWithTemplate(currentValues);
    lastFetchTime = new Date();
    updateTimestamp();

    // Expose current user name so templates can auto-fill author fields
    const user = api.auth.getUser();
    setUserName(user?.name || user?.email || '');

    // Track as a recently opened sheet
    const headers = data.values?.[0] || [];
    const { key: templateKey } = detectTemplate(headers);
    userData.addRecentSheet({ id: sheetId, name: data.title, templateKey });

    // Sync sheet pin button state
    if (sheetPinBtn) {
      const pinned = userData.isSheetPinned(sheetId);
      sheetPinBtn.classList.toggle('pinned', pinned);
      sheetPinBtn.title = pinned ? 'Unpin sheet' : 'Pin sheet';
    }

    // Notify app.js so the parent folder's .waymark-index stays fresh
    window.dispatchEvent(new CustomEvent('waymark:sheet-refreshed', {
      detail: {
        id: sheetId,
        name: data.title,
        headers,
        firstRow: data.values?.[1] || [],
      },
    }));
  } catch (err) {
    showToast(`Failed to load sheet: ${err.message}`, 'error');
    itemsEl.innerHTML = `<p class="empty-state">Could not load this sheet.</p>`;
    if (templateBadge) templateBadge.classList.add('hidden');
  }
}

/* ---------- Template-aware rendering ---------- */

function renderWithTemplate(values) {
  itemsEl.innerHTML = '';

  if (values.length === 0) {
    itemsEl.innerHTML = '<p class="empty-state">This sheet is empty.</p>';
    if (templateBadge) templateBadge.classList.add('hidden');
    return;
  }

  // First row = header
  const headers = values[0];
  const rows = values.slice(1);

  // Detect template type deterministically from headers
  const { key, template } = detectTemplate(headers);

  // Show template badge
  if (templateBadge) {
    templateBadge.textContent = `${template.icon} ${template.name}`;
    templateBadge.style.background = template.color + '18';
    templateBadge.style.color = template.color;
    templateBadge.classList.remove('hidden');
  }

  // Detect columns for this template
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  const cols = template.columns(lower);

  // Wire up add-row callback so templates can embed per-lane forms
  const totalCols = headers.length;
  const addRowCallback = async (newRows) => {
    try {
      await api.sheets.appendRows(currentSheetId, currentSheetTitle, newRows);
      showToast(`${template.itemNoun || 'Item'} added`, 'success');
      await loadSheet(currentSheetId);
    } catch (err) {
      showToast(`Failed to add: ${err.message}`, 'error');
    }
  };
  template._onAddRow = addRowCallback;
  template._totalColumns = totalCols;

  // Insert-after-row callback for sub-tasks and notes (kanban)
  template._onInsertAfterRow = async (afterValuesIdx, newRows) => {
    try {
      const data = await api.sheets.getSpreadsheet(currentSheetId);
      const values = data.values || [];
      const insertAt = afterValuesIdx + 1;
      values.splice(insertAt, 0, ...newRows);
      await api.sheets.replaceSheetData(currentSheetId, currentSheetTitle, values);
      showToast('Added', 'success');
      await loadSheet(currentSheetId);
    } catch (err) {
      showToast(`Failed to add: ${err.message}`, 'error');
    }
  };

  // Render using template-specific renderer
  template.render(itemsEl, rows, cols, template);

  // Migration banner: suggest adding missing columns the template now supports
  const missing = getMissingMigrations(template, cols);
  if (missing.length > 0) {
    const names = missing.map(m => m.header).join(', ');
    const banner = el('div', { className: 'migration-banner' }, [
      el('span', { className: 'migration-text' }, [
        `\u2728 This ${template.name} sheet can be upgraded with new columns: ${names}`,
      ]),
      el('button', {
        className: 'migration-btn',
        type: 'button',
      }, ['Add Columns']),
      el('button', {
        className: 'migration-dismiss',
        type: 'button',
        title: 'Dismiss',
      }, ['\u2715']),
    ]);
    banner.querySelector('.migration-btn').addEventListener('click', async () => {
      try {
        const data = await api.sheets.getSpreadsheet(currentSheetId);
        const vals = data.values || [];
        const headerRow = vals[0] || [];
        for (const m of missing) headerRow.push(m.header);
        // Pad all data rows to match new header length
        for (let i = 1; i < vals.length; i++) {
          while (vals[i].length < headerRow.length) vals[i].push('');
        }
        await api.sheets.replaceSheetData(currentSheetId, currentSheetTitle, vals);
        showToast(`Added columns: ${names}`, 'success');
        await loadSheet(currentSheetId);
      } catch (err) {
        showToast(`Migration failed: ${err.message}`, 'error');
      }
    });
    banner.querySelector('.migration-dismiss').addEventListener('click', () => {
      banner.remove();
    });
    itemsEl.prepend(banner);
  }

  // Append add-row form if template declares fields (skip kanban + recipe — they handle inline)
  if (typeof template.addRowFields === 'function' && key !== 'kanban' && key !== 'recipe') {
    const addForm = buildAddRowForm(template, cols, totalCols, addRowCallback);
    itemsEl.append(addForm);
  }
}

/* ---------- Auto-refresh ---------- */

let customRefreshRate = 0; // 0 = use default 60 s

window.addEventListener('waymark:set-refresh-rate', (e) => {
  customRefreshRate = e.detail || 0;
  resetTimer();
});

function resetTimer() {
  clearInterval(refreshTimer);
  refreshTimer = null;

  const interval = customRefreshRate || 60_000;
  if (currentSheetId && userData.getAutoRefresh() && !document.hidden) {
    refreshTimer = setInterval(() => {
      if (currentSheetId && !isAddRowOpen()) loadSheet(currentSheetId);
    }, interval);
  }
}

function updateTimestamp() {
  if (!lastFetchTime) return;
  lastUpdatedEl.textContent = `Updated ${timeAgo(lastFetchTime)}`;
  // Freshness indicator: green <1m, amber 1-5m, dim >5m
  const ageMs = Date.now() - lastFetchTime.getTime();
  const fresh = ageMs < 90_000; // within ~1.5 refresh cycles
  const stale = ageMs > 300_000; // >5 min
  lastUpdatedEl.classList.toggle('freshness-fresh', fresh);
  lastUpdatedEl.classList.toggle('freshness-stale', stale);
  lastUpdatedEl.classList.toggle('freshness-aging', !fresh && !stale);
  // keep updating the relative time display
  setTimeout(updateTimestamp, 10_000);
}
