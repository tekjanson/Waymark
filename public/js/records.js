/* ============================================================
   records.js — Create new records (completion snapshots,
   AI search logs) in the user's Drive.
   
   WayMark is CR-only (Create + Read). This module handles
   the "Create" side: writing immutable log entries to a
   _waymark_logs/ folder.
   ============================================================ */

import { api } from './api-client.js';
import { showToast } from './ui.js';

const LOGS_FOLDER_NAME = '_waymark_logs';

let logsFolderId = null;

/* ---------- Public ---------- */

/**
 * Create a completion snapshot for a checklist.
 * Writes a new spreadsheet to _waymark_logs/ with the current state.
 *
 * @param {string} sheetTitle  name of the source sheet
 * @param {string[][]} values  current cell values
 * @returns {Promise<Object|null>}  created record or null on error
 */
export async function createSnapshot(sheetTitle, values) {
  try {
    const folderId = await ensureLogsFolder();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const title = `snapshot_${sheetTitle}_${timestamp}`;

    const header = [['Source', 'Timestamp', 'Type'], [sheetTitle, new Date().toISOString(), 'completion-snapshot']];
    const rows = [...header, ['---'], ...values];

    const record = await api.sheets.createSpreadsheet(title, rows, folderId);
    showToast('Snapshot created', 'success');
    return record;
  } catch (err) {
    showToast(`Failed to create snapshot: ${err.message}`, 'error');
    return null;
  }
}

/**
 * Log an AI search query and its results.
 *
 * @param {string} query
 * @param {Object} result  { matches, summary }
 * @returns {Promise<Object|null>}
 */
export async function logSearch(query, result) {
  try {
    const folderId = await ensureLogsFolder();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const title = `search_${timestamp}`;

    const rows = [
      ['Query', 'Timestamp', 'Type'],
      [query, new Date().toISOString(), 'search-log'],
      ['---'],
      ['Summary', result.summary || ''],
      ['Matches'],
      ...((result.matches || []).map(m => [m.sheetName || '', m.sheetId || '', m.reason || ''])),
    ];

    return await api.sheets.createSpreadsheet(title, rows, folderId);
  } catch {
    // Search logs are best-effort; don't bother the user
    return null;
  }
}

/* ---------- Internal ---------- */

/**
 * Ensure the _waymark_logs folder exists, creating it if needed.
 * Uses drive.file scope (only sees files created by this app).
 */
async function ensureLogsFolder() {
  if (logsFolderId) return logsFolderId;

  // Try to find the existing folder
  // In local mode, just use a fake ID
  if (window.__WAYMARK_LOCAL) {
    logsFolderId = 'mock-logs-folder';
    return logsFolderId;
  }

  // In production, create via Drive
  const result = await api.drive.createFile(
    LOGS_FOLDER_NAME,
    'application/vnd.google-apps.folder',
    []
  );
  logsFolderId = result.id;
  return logsFolderId;
}
