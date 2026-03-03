/* ============================================================
   checklist.js — Render a Google Sheet using detected templates
   Uses templates.js for deterministic type detection and
   specialised rendering. Auto-refreshes every 60 s.
   ============================================================ */

import { api } from './api-client.js';
import { el, showToast, timeAgo } from './ui.js';
import * as userData from './user-data.js';
import { detectTemplate, onEdit } from './templates/index.js';
import { buildAddRowForm, isAddRowOpen } from './templates/shared.js';

let currentSheetId = null;
let currentSheetTitle = null;
let refreshTimer   = null;
let lastFetchTime  = null;

/* DOM refs (set in init) */
let titleEl, itemsEl, lastUpdatedEl, refreshBtn, autoToggle, templateBadge, openInSheetsBtn;

/* ---------- Public ---------- */

export function init() {
  titleEl       = document.getElementById('checklist-title');
  itemsEl       = document.getElementById('checklist-items');
  lastUpdatedEl = document.getElementById('last-updated');
  refreshBtn    = document.getElementById('refresh-btn');
  autoToggle    = document.getElementById('auto-refresh-toggle');
  templateBadge = document.getElementById('template-badge');
  openInSheetsBtn = document.getElementById('open-in-sheets-btn');

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

  await loadSheet(sheetId);
  resetTimer();
}

/** Stop auto-refresh (called when navigating away). */
export function hide() {
  currentSheetId = null;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

/* ---------- Data loading ---------- */

async function loadSheet(sheetId) {
  try {
    const data = await api.sheets.getSpreadsheet(sheetId);
    titleEl.textContent = data.title;
    currentSheetTitle = data.sheetTitle || 'Sheet1';
    renderWithTemplate(data.values || []);
    lastFetchTime = new Date();
    updateTimestamp();

    // Track as a recently opened sheet
    const headers = data.values?.[0] || [];
    const { key: templateKey } = detectTemplate(headers);
    userData.addRecentSheet({ id: sheetId, name: data.title, templateKey });
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

  // Render using template-specific renderer
  template.render(itemsEl, rows, cols, template);

  // Append add-row form if template declares fields (skip kanban + recipe — they handle inline)
  if (typeof template.addRowFields === 'function' && key !== 'kanban' && key !== 'recipe') {
    const addForm = buildAddRowForm(template, cols, totalCols, addRowCallback);
    itemsEl.append(addForm);
  }
}

/* ---------- Auto-refresh ---------- */

function resetTimer() {
  clearInterval(refreshTimer);
  refreshTimer = null;

  if (currentSheetId && userData.getAutoRefresh() && !document.hidden) {
    refreshTimer = setInterval(() => {
      if (currentSheetId && !isAddRowOpen()) loadSheet(currentSheetId);
    }, 60_000);
  }
}

function updateTimestamp() {
  if (!lastFetchTime) return;
  lastUpdatedEl.textContent = `Updated ${timeAgo(lastFetchTime)}`;
  // keep updating the relative time display
  setTimeout(updateTimestamp, 10_000);
}
