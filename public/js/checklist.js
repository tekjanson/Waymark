/* ============================================================
   checklist.js — Render a Google Sheet using detected templates
   Uses templates.js for deterministic type detection and
   specialised rendering. Auto-refreshes every 60 s.
   ============================================================ */

import { api } from './api-client.js';
import { el, showToast, timeAgo } from './ui.js';
import * as storage from './storage.js';
import { detectTemplate, onEdit } from './templates/index.js';

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

  autoToggle.checked = storage.getAutoRefresh();

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
    storage.setAutoRefresh(autoToggle.checked);
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

  // Render using template-specific renderer
  template.render(itemsEl, rows, cols, template);
}

/* ---------- Auto-refresh ---------- */

function resetTimer() {
  clearInterval(refreshTimer);
  refreshTimer = null;

  if (currentSheetId && storage.getAutoRefresh() && !document.hidden) {
    refreshTimer = setInterval(() => {
      if (currentSheetId) loadSheet(currentSheetId);
    }, 60_000);
  }
}

function updateTimestamp() {
  if (!lastFetchTime) return;
  lastUpdatedEl.textContent = `Updated ${timeAgo(lastFetchTime)}`;
  // keep updating the relative time display
  setTimeout(updateTimestamp, 10_000);
}
