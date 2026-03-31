/* ============================================================
   checklist.js — Render a Google Sheet using detected templates
   Uses templates.js for deterministic type detection and
   specialised rendering. Auto-refreshes every 60 s.
   ============================================================ */

import { api } from './api-client.js';
import { el, showToast, timeAgo } from './ui.js';
import { show as showTemplateAI } from './template-ai.js';
import * as userData from './user-data.js';
import { detectTemplate, onEdit } from './templates/index.js';
import { buildAddRowForm, isAddRowOpen, setUserName, setEditLocked, getMissingMigrations, getCrossFeature } from './templates/shared.js';
import { Tutorial } from './tutorial.js';
import * as notifications from './notifications.js';
import { getCrossLinks, setCrossLinks } from './storage.js';
import * as encryption from './encryption.js';

let currentSheetId = null;
let currentSheetTitle = null;
let refreshTimer   = null;
let lastFetchTime  = null;
let currentValues  = null;
let currentDataTitle = null;

/* DOM refs (set in init) */
let titleEl, itemsEl, lastUpdatedEl, refreshBtn, autoToggle, templateBadge, openInSheetsBtn, downloadCsvBtn, sheetPinBtn, duplicateSheetBtn, shareBtn, lockBtn, templateHelpBtn, printBtn;
let moreActionsBtn, overflowMenu, notifRulesBtn, templateAiBtn, encryptBtn;
let currentTemplateKey = null;
let currentHeaders = null;

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
  printBtn         = document.getElementById('print-btn');
  sheetPinBtn     = document.getElementById('sheet-pin-btn');
  duplicateSheetBtn = document.getElementById('duplicate-sheet-btn');
  shareBtn          = document.getElementById('share-btn');
  lockBtn           = document.getElementById('lock-btn');
  templateHelpBtn   = document.getElementById('template-help-btn');
  moreActionsBtn    = document.getElementById('more-actions-btn');
  overflowMenu      = document.querySelector('.header-overflow-menu');
  notifRulesBtn     = document.getElementById('notif-rules-btn');
  templateAiBtn     = document.getElementById('template-ai-btn');
  encryptBtn        = document.getElementById('encrypt-btn');

  /* Overflow menu: toggle on click, close on outside click */
  if (moreActionsBtn && overflowMenu) {
    moreActionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overflowMenu.classList.toggle('hidden');
    });
    overflowMenu.addEventListener('click', (e) => {
      // Close menu when a button/label item is clicked (but not the toggle checkbox)
      if (e.target.closest('button.overflow-item')) overflowMenu.classList.add('hidden');
    });
    document.addEventListener('click', () => overflowMenu.classList.add('hidden'));
  }

  if (templateHelpBtn) {
    templateHelpBtn.addEventListener('click', () => {
      if (currentTemplateKey) Tutorial.startTemplateTutorial(currentTemplateKey, true);
    });
  }

  if (notifRulesBtn) {
    notifRulesBtn.addEventListener('click', () => {
      if (currentSheetId && currentHeaders) {
        notifications.showRuleBuilder(currentSheetId, currentDataTitle, currentHeaders);
      }
    });
  }

  if (templateAiBtn) {
    templateAiBtn.addEventListener('click', () => {
      if (!currentSheetId) return;
      try {
        showTemplateAI({
          id: currentSheetId,
          title: currentDataTitle || '',
          sheetTitle: currentSheetTitle || 'Sheet1',
          values: currentValues || [],
          templateKey: currentTemplateKey || 'checklist',
          onRefresh: () => loadSheet(currentSheetId),
        });
      } catch (err) {
        showToast('Could not open AI panel', 'error');
      }
    });
  }

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

  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }

  if (duplicateSheetBtn) {
    duplicateSheetBtn.addEventListener('click', () => openDuplicateModal());
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (!currentSheetId) return;
      openShareModal(currentSheetId, titleEl?.textContent || 'Sheet');
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
      showToast(newState ? 'Sheet locked — editing disabled' : 'Sheet unlocked — editing enabled', 'success');
      lockBtn.classList.add('lock-bounce');
      lockBtn.addEventListener('animationend', () => lockBtn.classList.remove('lock-bounce'), { once: true });
    });
  }

  if (encryptBtn) {
    encryptBtn.addEventListener('click', () => {
      if (!currentSheetId) return;
      openEncryptModal();
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
      // Encrypt value if this column is in the encrypted set
      let valueToWrite = newValue;
      const encCols = encryption.getEncryptedColumns(currentSheetId);
      if (encCols.has(colIndex) && encryption.isUnlocked(currentSheetId) && newValue) {
        valueToWrite = await encryption.encrypt(currentSheetId, newValue);
      }
      await api.sheets.updateCell(currentSheetId, currentSheetTitle, rowIndex, colIndex, valueToWrite);
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
    const emojiSpan = lockBtn.querySelector('.overflow-item-emoji');
    const textSpan = lockBtn.querySelector('.overflow-item-emoji + span');
    if (emojiSpan) emojiSpan.textContent = locked ? '\u{1F512}' : '\u{1F513}';
    if (textSpan) textSpan.textContent = locked ? 'Unlock editing' : 'Lock editing';
    lockBtn.classList.toggle('locked', locked);
    lockBtn.title = locked ? 'Unlock editing' : 'Lock editing';
    lockBtn.setAttribute('aria-label', locked ? 'Unlock editing' : 'Lock editing');
  }
  if (itemsEl) {
    itemsEl.classList.toggle('sheet-locked', locked);
  }
}

/* ---------- Encryption Modal ---------- */

function openEncryptModal() {
  const modal = document.getElementById('encrypt-modal');
  const modalTitle = document.getElementById('encrypt-modal-title');
  const passwordInput = document.getElementById('encrypt-password');
  const colConfig = document.getElementById('encrypt-col-config');
  const colList = document.getElementById('encrypt-col-list');
  const statusEl = document.getElementById('encrypt-status');
  const unlockBtn = document.getElementById('encrypt-unlock-btn');
  const lockSheetBtn = document.getElementById('encrypt-lock-btn');
  const setupBtn = document.getElementById('encrypt-setup-btn');
  const cancelBtn = document.getElementById('encrypt-cancel-btn');
  const closeBtn = document.getElementById('encrypt-modal-close');
  const toggleVisBtn = document.getElementById('encrypt-toggle-vis');
  const decryptBtn = document.getElementById('encrypt-decrypt-btn');
  if (!modal || !passwordInput) return;

  const sheetId = currentSheetId;
  const headers = currentHeaders || [];
  const encCols = encryption.getEncryptedColumns(sheetId);
  const isUnlocked = encryption.isUnlocked(sheetId);
  const hasEncryption = encCols.size > 0;

  // Reset state
  passwordInput.value = '';
  passwordInput.type = 'password';
  statusEl.textContent = '';

  if (decryptBtn) decryptBtn.classList.add('hidden');

  if (isUnlocked) {
    // Sheet is already unlocked — show column config and lock option
    modalTitle.textContent = 'Encryption Settings';
    unlockBtn.classList.add('hidden');
    lockSheetBtn.classList.remove('hidden');
    if (decryptBtn) decryptBtn.classList.remove('hidden');
    setupBtn.classList.add('hidden');
    passwordInput.parentElement.parentElement.classList.add('hidden');
    colConfig.classList.remove('hidden');
    renderColCheckboxes(colList, headers, encCols);
  } else if (hasEncryption) {
    // Sheet has encrypted columns but is locked — show password prompt
    modalTitle.textContent = 'Unlock Encrypted Columns';
    unlockBtn.classList.remove('hidden');
    lockSheetBtn.classList.add('hidden');
    if (decryptBtn) decryptBtn.classList.remove('hidden');
    setupBtn.classList.add('hidden');
    passwordInput.parentElement.parentElement.classList.remove('hidden');
    colConfig.classList.add('hidden');
  } else {
    // No encryption set up yet — show setup flow
    modalTitle.textContent = 'Set Up Column Encryption';
    unlockBtn.classList.add('hidden');
    lockSheetBtn.classList.add('hidden');
    setupBtn.classList.remove('hidden');
    passwordInput.parentElement.parentElement.classList.remove('hidden');
    colConfig.classList.remove('hidden');
    renderColCheckboxes(colList, headers, encCols);
  }

  // Show modal
  modal.classList.remove('hidden');
  if (!passwordInput.parentElement.parentElement.classList.contains('hidden')) {
    passwordInput.focus();
  }

  // Close handlers
  const close = () => modal.classList.add('hidden');
  closeBtn.onclick = close;
  cancelBtn.onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  // Password visibility toggle
  toggleVisBtn.onclick = () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    toggleVisBtn.textContent = isHidden ? '🙈' : '👁️';
    toggleVisBtn.title = isHidden ? 'Hide password' : 'Show password';
  };

  // Unlock button — derive key and reload
  unlockBtn.onclick = async () => {
    const pw = passwordInput.value;
    if (!pw) { statusEl.textContent = 'Please enter a password'; return; }
    unlockBtn.disabled = true;
    statusEl.textContent = 'Deriving key…';

    // Find a sample encrypted value to verify the password
    let sample = null;
    if (currentValues) {
      for (let r = 1; r < currentValues.length && !sample; r++) {
        for (const c of encCols) {
          if (c < currentValues[r].length && encryption.isEncrypted(currentValues[r][c])) {
            sample = currentValues[r][c]; break;
          }
        }
      }
    }

    const ok = await encryption.unlock(pw, sheetId, sample);
    unlockBtn.disabled = false;
    if (ok) {
      close();
      showToast('Columns decrypted', 'success');
      await loadSheet(sheetId);
    } else {
      statusEl.textContent = 'Wrong password — could not decrypt';
    }
  };

  // Lock button — clear key and reload
  lockSheetBtn.onclick = async () => {
    // Save any column config changes first
    saveColCheckboxes(colList, sheetId);
    encryption.lock(sheetId);
    close();
    showToast('Encryption locked', 'success');
    await loadSheet(sheetId);
  };

  // Enter key on password input
  passwordInput.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); (unlockBtn.classList.contains('hidden') ? setupBtn : unlockBtn).click(); }
  };

  // Decrypt button — permanently remove encryption
  if (decryptBtn) {
    decryptBtn.onclick = async () => {
      if (!confirm('Remove encryption permanently? All encrypted values will be written back as plaintext. This cannot be undone.')) return;

      // If the sheet is locked, require the password first to unlock
      if (!encryption.isUnlocked(sheetId)) {
        const pw = passwordInput.value;
        if (!pw) { statusEl.textContent = 'Enter the password to remove encryption'; return; }
        decryptBtn.disabled = true;
        statusEl.textContent = 'Verifying password…';

        let sample = null;
        if (currentValues) {
          for (let r = 1; r < currentValues.length && !sample; r++) {
            for (const c of encCols) {
              if (c < currentValues[r].length && encryption.isEncrypted(currentValues[r][c])) {
                sample = currentValues[r][c]; break;
              }
            }
          }
        }
        const ok = await encryption.unlock(pw, sheetId, sample);
        if (!ok) {
          statusEl.textContent = 'Wrong password — could not decrypt';
          decryptBtn.disabled = false;
          return;
        }
      }

      decryptBtn.disabled = true;
      if (lockSheetBtn) lockSheetBtn.disabled = true;
      statusEl.textContent = 'Decrypting all values…';

      try {
        // Re-fetch fresh data to decrypt from the canonical encrypted values
        const freshData = await api.sheets.getSpreadsheet(sheetId);
        const freshValues = freshData.values || [];
        const freshTitle = freshData.sheetTitle || currentSheetTitle;

        for (let r = 1; r < freshValues.length; r++) {
          for (const c of encCols) {
            if (c < freshValues[r].length && encryption.isEncrypted(freshValues[r][c])) {
              const plain = await encryption.decrypt(sheetId, freshValues[r][c]);
              if (plain !== null) {
                await api.sheets.updateCell(sheetId, freshTitle, r, c, plain);
              }
            }
          }
        }
        encryption.setEncryptedColumns(sheetId, new Set());
        encryption.lock(sheetId);
        close();
        showToast('Encryption removed — all values are now plaintext', 'success');
        await loadSheet(sheetId);
      } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
        showToast(`Decryption error: ${err.message}`, 'error');
      } finally {
        decryptBtn.disabled = false;
        if (lockSheetBtn) lockSheetBtn.disabled = false;
      }
    };
  }

  // Setup button — set password and enable encryption
  setupBtn.onclick = async () => {
    const pw = passwordInput.value;
    if (!pw) { statusEl.textContent = 'Please enter a password'; return; }
    if (pw.length < 4) { statusEl.textContent = 'Password must be at least 4 characters'; return; }

    // Collect selected columns
    saveColCheckboxes(colList, sheetId);
    const newEncCols = encryption.getEncryptedColumns(sheetId);
    if (newEncCols.size === 0) {
      statusEl.textContent = 'Select at least one column to encrypt';
      return;
    }

    setupBtn.disabled = true;
    statusEl.textContent = 'Setting up encryption…';

    // Derive key and cache it
    await encryption.unlock(pw, sheetId);

    // Encrypt existing values in the selected columns
    if (currentValues && currentSheetTitle) {
      try {
        for (let r = 1; r < currentValues.length; r++) {
          for (const c of newEncCols) {
            const val = (c < currentValues[r].length) ? currentValues[r][c] : '';
            if (val && !encryption.isEncrypted(val)) {
              const enc = await encryption.encrypt(sheetId, val);
              await api.sheets.updateCell(sheetId, currentSheetTitle, r, c, enc);
            }
          }
        }
      } catch (err) {
        showToast(`Encryption error: ${err.message}`, 'error');
      }
    }

    setupBtn.disabled = false;
    close();
    showToast('Encryption enabled — columns are now protected', 'success');
    await loadSheet(sheetId);
  };
}

/**
 * Render column checkboxes for the encryption config panel.
 * @param {HTMLElement} container
 * @param {string[]} headers
 * @param {Set<number>} encCols
 */
function renderColCheckboxes(container, headers, encCols) {
  container.innerHTML = '';
  headers.forEach((header, idx) => {
    if (!header) return;
    const id = `enc-col-${idx}`;
    const label = el('label', { className: 'encrypt-col-item' }, [
      el('input', {
        type: 'checkbox',
        id,
        dataset: { colIdx: String(idx) },
        checked: encCols.has(idx) ? true : undefined,
      }),
      el('span', {}, [header]),
    ]);
    if (encCols.has(idx)) label.querySelector('input').checked = true;
    container.append(label);
  });
}

/**
 * Read column checkboxes and save to localStorage.
 * @param {HTMLElement} container
 * @param {string} sheetId
 */
function saveColCheckboxes(container, sheetId) {
  const cols = new Set();
  for (const cb of container.querySelectorAll('input[type="checkbox"]')) {
    if (cb.checked) cols.add(Number(cb.dataset.colIdx));
  }
  encryption.setEncryptedColumns(sheetId, cols);
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

/**
 * Show a publicly shared sheet in read-only mode (no auth required).
 * Uses api.sheets.getPublicSpreadsheet which reads via API key.
 * @param {string} sheetId
 */
export async function showPublic(sheetId) {
  currentSheetId = sheetId;
  titleEl.textContent = 'Loading…';
  itemsEl.innerHTML = '';
  lastUpdatedEl.textContent = '';

  // Lock edits — public view is always read-only
  applyLockState(true);

  // Show public banner
  const banner = document.getElementById('public-banner');
  if (banner) banner.classList.remove('hidden');

  // Hide edit-related controls
  const hideEls = [openInSheetsBtn, downloadCsvBtn, sheetPinBtn, duplicateSheetBtn, shareBtn, lockBtn, templateHelpBtn, moreActionsBtn, printBtn, encryptBtn, templateAiBtn, notifRulesBtn];
  for (const el of hideEls) {
    if (el) el.classList.add('hidden');
  }
  // Hide add-row form area and auto-refresh toggle
  if (autoToggle) autoToggle.parentElement.classList.add('hidden');

  try {
    const data = await api.sheets.getPublicSpreadsheet(sheetId);
    titleEl.textContent = data.title;
    currentDataTitle = data.title;
    currentSheetTitle = data.sheetTitle || 'Sheet1';
    currentValues = data.values || [];
    renderWithTemplate(currentValues);
    lastFetchTime = new Date();
    updateTimestamp();
  } catch (err) {
    const is403 = err.status === 403 || (err.message && err.message.includes('Permission denied'));
    const is429 = err.status === 429 || (err.message && err.message.includes('Rate limit'));
    if (is429) {
      const base = window.__WAYMARK_BASE || '';
      itemsEl.innerHTML =
        '<div class="rate-limit-block">' +
          '<p class="rate-limit-heading">⏳ Rate limit reached</p>' +
          '<p>Public links share a limited pool of requests. Sign in with a free account for uninterrupted access to this sheet.</p>' +
          `<a class="btn btn-primary rate-limit-cta" href="${base}/#/">Sign in / Create account</a>` +
        '</div>';
    } else if (is403) {
      itemsEl.innerHTML = '<p class="empty-state">This sheet is not publicly shared. The owner needs to share it with "Anyone with the link" in Google Sheets.</p>';
    } else {
      showToast(`Failed to load public sheet: ${err.message}`, 'error');
      itemsEl.innerHTML = '<p class="empty-state">Could not load this sheet. It may not be publicly available.</p>';
    }
    if (templateBadge) templateBadge.classList.add('hidden');
  }
}

/** Stop auto-refresh (called when navigating away). */
export function hide() {
  // Notify templates BEFORE clearing state — async cleanup closures
  // still reference currentSheetId and need it to be non-null.
  window.dispatchEvent(new CustomEvent('waymark:sheet-hidden'));

  // Remove public banner if visible
  const banner = document.getElementById('public-banner');
  if (banner) banner.classList.add('hidden');

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
/** Open a duplicate sheet modal with name and folder selection */
function openDuplicateModal() {
  if (!currentSheetId || !currentValues || currentValues.length === 0) {
    showToast('No sheet data to duplicate', 'error');
    return;
  }

  // Remove existing modal if open
  const existing = document.getElementById('duplicate-modal');
  if (existing) existing.remove();

  const defaultTitle = `Copy of ${currentDataTitle || 'Untitled'}`;
  let selectedFolderId = null;
  let selectedFolderName = null;

  const nameInput = el('input', {
    className: 'duplicate-name-input',
    type: 'text',
    value: defaultTitle,
    placeholder: 'Enter sheet name',
  });

  const folderDisplay = el('span', { className: 'duplicate-folder-name' }, ['Default (Waymark)']);
  const folderBrowser = el('div', { className: 'duplicate-folder-browser hidden' });

  const chooseFolderBtn = el('button', {
    className: 'btn btn-secondary duplicate-choose-folder',
    type: 'button',
  }, ['📁 Choose Folder']);

  const createBtn = el('button', {
    className: 'btn btn-primary duplicate-create-btn',
    type: 'button',
  }, ['Create Copy']);

  const modal = el('div', {
    id: 'duplicate-modal',
    className: 'modal-overlay',
  }, [
    el('div', { className: 'modal' }, [
      el('div', { className: 'modal-header' }, [
        el('h3', {}, ['Duplicate Sheet']),
        el('button', { className: 'modal-close', type: 'button', 'aria-label': 'Close' }, ['✕']),
      ]),
      el('div', { className: 'modal-body' }, [
        el('div', { className: 'duplicate-section' }, [
          el('label', { className: 'duplicate-label' }, ['Name']),
          nameInput,
        ]),
        el('div', { className: 'duplicate-section' }, [
          el('label', { className: 'duplicate-label' }, ['Destination']),
          el('div', { className: 'duplicate-folder-row' }, [
            folderDisplay,
            chooseFolderBtn,
          ]),
          folderBrowser,
        ]),
      ]),
      el('div', { className: 'modal-footer' }, [
        el('button', {
          className: 'btn btn-secondary',
          type: 'button',
        }, ['Cancel']),
        createBtn,
      ]),
    ]),
  ]);

  // Close handlers
  const closeModal = () => modal.remove();
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('.modal-footer .btn-secondary').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  chooseFolderBtn.addEventListener('click', async () => {
    try {
      chooseFolderBtn.disabled = true;
      chooseFolderBtn.textContent = 'Opening…';
      const folder = await api.picker.pickFolder();
      chooseFolderBtn.disabled = false;
      chooseFolderBtn.textContent = '📁 Choose Folder';
      if (folder) {
        selectedFolderId = folder.id;
        selectedFolderName = folder.name;
        folderDisplay.textContent = folder.name;
      }
    } catch (err) {
      chooseFolderBtn.disabled = false;
      chooseFolderBtn.textContent = '📁 Choose Folder';
    }
  });

  // Create button
  createBtn.addEventListener('click', async () => {
    const title = nameInput.value.trim() || defaultTitle;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
      const result = await api.sheets.createSpreadsheet(title, currentValues, selectedFolderId);
      showToast(`Created "${title}"`, 'success');
      closeModal();
      if (result && (result.spreadsheetId || result.id)) {
        window.location.hash = `#/sheet/${result.spreadsheetId || result.id}`;
      }
    } catch (err) {
      showToast(`Failed to duplicate: ${err.message}`, 'error');
      createBtn.disabled = false;
      createBtn.textContent = 'Create Copy';
    }
  });

  // Auto-select the name input on open
  document.body.append(modal);
  nameInput.select();
}

/* ---------- Data loading ---------- */

async function loadSheet(sheetId) {
  try {
    const data = await api.sheets.getSpreadsheet(sheetId);
    titleEl.textContent = data.title;
    currentDataTitle = data.title;
    currentSheetTitle = data.sheetTitle || 'Sheet1';
    currentValues = data.values || [];

    // Auto-detect encrypted columns from actual cell data and sync to localStorage
    let encCols = encryption.getEncryptedColumns(sheetId);
    const detectedCols = encryption.detectEncryptedColumns(currentValues);
    if (detectedCols.size > 0 && encCols.size === 0) {
      // Encrypted data found in cells but not tracked in localStorage — sync it
      encryption.setEncryptedColumns(sheetId, detectedCols);
      encCols = detectedCols;
    }

    // Decrypt encrypted columns if the sheet is unlocked
    if (encCols.size > 0 && encryption.isUnlocked(sheetId)) {
      await encryption.decryptSheet(sheetId, currentValues, encCols);
    }

    renderWithTemplate(currentValues);
    lastFetchTime = new Date();
    updateTimestamp();

    // Auto-prompt for password if sheet has encrypted data but is locked
    if (encCols.size > 0 && !encryption.isUnlocked(sheetId)) {
      openEncryptModal();
    }

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
    const is403 = err.status === 403 || (err.message && err.message.includes('Permission denied'));
    if (is403) {
      showToast('Permission denied — open this file with the Drive picker to grant access', 'error');
      itemsEl.innerHTML = `<p class="empty-state">Permission denied. Use the Drive picker to open this sheet.</p>`;
    } else {
      showToast(`Failed to load sheet: ${err.message}`, 'error');
      itemsEl.innerHTML = `<p class="empty-state">Could not load this sheet.</p>`;
    }
    if (templateBadge) templateBadge.classList.add('hidden');
  }
}

/* ---------- Template-aware rendering ---------- */

function renderWithTemplate(values) {
  /* Blur any focused element inside the container before tearing down the DOM.
     This prevents stale inspector blur-handlers from firing commits against
     an already-destroyed node reference during auto-refresh (see F1). */
  if (document.activeElement && itemsEl.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  itemsEl.innerHTML = '';

  if (values.length === 0) {
    itemsEl.innerHTML = '<p class="empty-state">This sheet is empty.</p>';
    if (templateBadge) templateBadge.classList.add('hidden');
    return;
  }

  // First row = header
  const headers = values[0];
  currentHeaders = headers;
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

  // WebRTC signaling callbacks for peer-to-peer communication.
  // Capture IDs by value so async callbacks survive hide() nulling currentSheetId.
  const rtcSheetId = currentSheetId;
  const rtcSheetTitle = currentSheetTitle;
  template._rtcSheetId = rtcSheetId;
  template._rtcUserName = api.auth.getUser()?.name || 'Anonymous';
  template._rtcSignal = {
    cols,
    totalCols,
    readAll: async () => {
      const data = await api.sheets.getSpreadsheet(rtcSheetId);
      return data.values || [];
    },
    writeCell: (row, col, value) =>
      api.sheets.updateCell(rtcSheetId, rtcSheetTitle, row, col, value),
    /** Append chat history as proper post rows to the data sheet. */
    appendChatHistory: (rows) =>
      api.sheets.appendRows(rtcSheetId, rtcSheetTitle, rows),
  };

  // Insert-after-row callback for sub-tasks and notes (kanban)
  // pendingEdits: optional [{rowIdx (0-based), colIdx, value}] applied atomically
  template._onInsertAfterRow = async (afterValuesIdx, newRows, pendingEdits) => {
    try {
      const data = await api.sheets.getSpreadsheet(currentSheetId);
      const values = data.values || [];
      // Apply any pending cell edits BEFORE inserting rows (atomic with write)
      if (pendingEdits && pendingEdits.length > 0) {
        for (const edit of pendingEdits) {
          const row = values[edit.rowIdx];
          if (row && edit.colIdx >= 0) {
            while (row.length <= edit.colIdx) row.push('');
            row[edit.colIdx] = edit.value;
          }
        }
      }
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

  // Notify the app that a sheet was rendered (for notification evaluation)
  document.dispatchEvent(new CustomEvent('waymark:sheet-rendered', {
    detail: { sheetId: currentSheetId, title: currentDataTitle, templateKey: key, rows, cols, headers },
  }));

  // Cross-template feature integration bar (generic — works for all templates)
  if (template.crossFeatures && template.crossFeatures.length > 0 && currentSheetId) {
    buildCrossFeatureBar(itemsEl, template, currentSheetId);
  }

  // Show template help button and trigger first-time tutorial
  currentTemplateKey = key;
  if (templateHelpBtn) {
    templateHelpBtn.classList.remove('hidden');
  }
  Tutorial.startTemplateTutorial(key);

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

/* ---------- Cross-Feature Bar (generic) ---------- */

/**
 * Build the cross-feature integration bar for any consumer template.
 * Iterates over the template's crossFeatures declarations, checks
 * localStorage for existing links, and renders link buttons or
 * data widgets accordingly.
 */
async function buildCrossFeatureBar(container, template, sheetId) {
  const links = getCrossLinks(sheetId);
  const bar = el('div', { className: 'cross-bar' });

  for (const cf of template.crossFeatures) {
    const feature = getCrossFeature(cf.featureId);
    if (!feature) continue;

    const link = links.find(l => l.featureId === cf.featureId);

    if (link) {
      // Linked — show widget with provider data
      const widget = el('div', { className: 'cross-widget' }, [
        el('div', { className: 'cross-widget-header' }, [
          el('span', { className: 'cross-widget-icon' }, [feature.icon]),
          el('span', { className: 'cross-widget-title' }, [link.linkedSheetName || feature.name]),
          el('button', {
            className: 'cross-unlink-btn',
            type: 'button',
            title: 'Unlink',
          }, ['✕']),
        ]),
        el('div', { className: 'cross-widget-body cross-loading' }, ['Loading…']),
      ]);
      bar.append(widget);

      // Unlink handler
      widget.querySelector('.cross-unlink-btn').addEventListener('click', () => {
        const updated = getCrossLinks(sheetId).filter(l => l.featureId !== cf.featureId);
        setCrossLinks(sheetId, updated);
        widget.remove();
        bar.append(buildLinkButton(cf, feature, sheetId, bar));
        if (!bar.querySelector('.cross-widget') && !bar.querySelector('.cross-link-btn')) {
          bar.remove();
        }
      });

      // Fetch and render provider data
      loadCrossWidget(widget, feature, link.linkedSheetId);
    } else {
      bar.append(buildLinkButton(cf, feature, sheetId, bar));
    }
  }

  container.prepend(bar);
}

/**
 * Fetch provider sheet data, extract it through the feature's extractor,
 * and render using the feature's buildWidget.
 */
async function loadCrossWidget(widget, feature, linkedSheetId) {
  const body = widget.querySelector('.cross-widget-body');
  try {
    const data = await api.sheets.getSpreadsheet(linkedSheetId);
    const headers = data.values[0] || [];
    const providerDet = detectTemplate(headers);
    const lower = headers.map(h => (h || '').toLowerCase().trim());
    const providerCols = providerDet.template.columns(lower);
    const extracted = feature.extractData(data.values.slice(1), providerCols);
    body.className = 'cross-widget-body';
    body.textContent = '';
    if (extracted.length > 0) {
      feature.buildWidget(body, extracted);
    } else {
      body.textContent = 'No data available';
    }
  } catch {
    body.className = 'cross-widget-body cross-error';
    body.textContent = 'Failed to load linked data';
  }
}

/** Build the dashed "Link" button for an unlinked cross-feature. */
function buildLinkButton(cf, feature, sheetId, bar) {
  const btn = el('button', {
    className: 'cross-link-btn',
    type: 'button',
  }, [
    el('span', { className: 'cross-link-icon' }, [cf.icon || feature.icon]),
    el('span', {}, [cf.label]),
  ]);
  btn.addEventListener('click', () => openCrossFeaturePicker(cf, feature, sheetId, bar, btn));
  return btn;
}

/**
 * Open a picker overlay listing compatible sheets for linking.
 * Uses getSpreadsheetSummary (header-only fetch) to detect which
 * sheets match the provider template. Efficient — no full data load.
 */
async function openCrossFeaturePicker(cf, feature, sheetId, bar, triggerBtn) {
  try {
    const files = await api.picker.pickSpreadsheets({ includeSharedDrives: true });
    if (!files || files.length === 0) return; // user cancelled

    const picked = files[0];
    if (picked.id === sheetId) {
      showToast('Cannot link a sheet to itself', 'error');
      return;
    }

    // Verify template compatibility
    try {
      const summary = await api.sheets.getSpreadsheetSummary(picked.id);
      const detected = detectTemplate(summary.values[0] || []);
      if (detected.key !== feature.provider) {
        showToast(`"${picked.name}" is not a compatible ${feature.name} sheet`, 'error');
        return;
      }
    } catch {
      showToast(`Could not verify "${picked.name}" — linking anyway`, 'info');
    }

    const links = getCrossLinks(sheetId);
    links.push({ featureId: cf.featureId, linkedSheetId: picked.id, linkedSheetName: picked.name });
    setCrossLinks(sheetId, links);
    showToast(`Linked ${picked.name}`, 'success');
    loadSheet(currentSheetId);
  } catch (err) {
    showToast(`Failed to pick sheet: ${err.message}`, 'error');
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

/* ---------- Share Modal ---------- */

/** Open a share modal with copy-link, Google sharing, and Waymark link */
function openShareModal(sheetId, sheetName) {
  // Remove existing modal if open
  const existing = document.getElementById('share-modal');
  if (existing) existing.remove();

  const base = window.__WAYMARK_BASE || '';
  const waymarkLink = `${window.location.origin}${base}/#/sheet/${sheetId}`;
  const publicLink = `${window.location.origin}${base}/#/public/${sheetId}`;
  const googleEditLink = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=sharing`;

  const modal = el('div', {
    id: 'share-modal',
    className: 'modal-overlay',
  }, [
    el('div', { className: 'modal' }, [
      el('div', { className: 'modal-header' }, [
        el('h3', {}, [`Share "${sheetName}"`]),
        el('button', {
          className: 'modal-close',
          type: 'button',
          'aria-label': 'Close',
        }, ['✕']),
      ]),
      el('div', { className: 'modal-body' }, [
        el('div', { className: 'share-section' }, [
          el('label', { className: 'share-label' }, ['Waymark Link']),
          el('div', { className: 'share-link-row' }, [
            el('input', {
              className: 'share-link-input',
              type: 'text',
              value: waymarkLink,
              readOnly: true,
            }),
            el('button', {
              className: 'btn btn-primary share-copy-btn',
              type: 'button',
              dataset: { link: waymarkLink },
            }, ['📋 Copy']),
          ]),
        ]),
        el('div', { className: 'share-section' }, [
          el('label', { className: 'share-label' }, ['🌐 Public Link (no sign-in required)']),
          el('p', { className: 'share-hint' }, ['Anyone with this link can view the sheet — make sure the Google Sheet is shared as "Anyone with the link" first.']),
          el('div', { className: 'share-link-row' }, [
            el('input', {
              className: 'share-link-input share-public-link',
              type: 'text',
              value: publicLink,
              readOnly: true,
            }),
            el('button', {
              className: 'btn btn-primary share-copy-btn',
              type: 'button',
              dataset: { link: publicLink },
            }, ['📋 Copy']),
          ]),
        ]),
        el('div', { className: 'share-section' }, [
          el('label', { className: 'share-label' }, ['Google Sheets Link']),
          el('div', { className: 'share-link-row' }, [
            el('input', {
              className: 'share-link-input',
              type: 'text',
              value: googleEditLink,
              readOnly: true,
            }),
            el('button', {
              className: 'btn btn-primary share-copy-btn',
              type: 'button',
              dataset: { link: googleEditLink },
            }, ['📋 Copy']),
          ]),
        ]),
        el('div', { className: 'share-section share-actions' }, [
          el('a', {
            className: 'btn btn-share-google',
            href: googleEditLink,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, ['📤 Manage Sharing in Google Sheets']),
        ]),
      ]),
    ]),
  ]);

  // Close handlers
  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Copy button handlers
  modal.querySelectorAll('.share-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const link = btn.dataset.link;
      try {
        await navigator.clipboard.writeText(link);
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
      } catch {
        // Fallback: select the input
        const input = btn.parentElement.querySelector('.share-link-input');
        if (input) { input.select(); document.execCommand('copy'); }
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
      }
    });
  });

  document.body.append(modal);
}
