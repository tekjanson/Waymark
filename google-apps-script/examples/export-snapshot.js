/* ============================================================
   export-snapshot.js — Write a _waymark_logs compatible snapshot

   Example automation: exports a copy of a sheet's current data
   to a new spreadsheet in _waymark_logs/, matching the format
   that Waymark's records.js uses (AI_LAWS §2.1).

   Setup:
     1. Run setProperties() once to set SOURCE_SHEET_ID.
     2. Run setupTriggers() to install a daily export at 8 AM.
     3. Run exportSnapshot() manually to test immediately.

   Files required: waymark-format.js, utils.js, triggers.js
   ============================================================ */

var LOGS_FOLDER_NAME = '_waymark_logs';

/* ---------- Setup (run once from editor) ---------- */

/**
 * Set required script properties.
 */
function setSnapshotProperties() {
  PropertiesService.getScriptProperties().setProperties({
    SOURCE_SHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
    SOURCE_SHEET_TAB: 'Sheet1',
  });
  logInfo('Snapshot properties set');
}

/**
 * Install a daily trigger to run exportSnapshot at 8 AM.
 */
function setupSnapshotTriggers() {
  registerDailyTrigger('exportSnapshot', 8);
}

/* ---------- Main Export ---------- */

/**
 * Create a snapshot of the source sheet's current data and write it
 * to a new spreadsheet in _waymark_logs/.
 *
 * The snapshot format matches Waymark's records.js:
 *   Row 1: ['Source', 'Timestamp', 'Type']
 *   Row 2: [sheetTitle, isoTimestamp, 'completion-snapshot']
 *   Row 3: ['---']
 *   Row 4+: original data (headers + rows)
 */
function exportSnapshot() {
  try {
    var sheetId  = requireProperty('SOURCE_SHEET_ID');
    var tabName  = getProperty('SOURCE_SHEET_TAB', 'Sheet1');

    var ss    = SpreadsheetApp.openById(sheetId);
    var sheet = requireSheet(ss, tabName);
    var all   = sheet.getDataRange().getValues();

    var timestamp = new Date().toISOString();
    var title     = 'snapshot_' + sheet.getName() + '_' + timestamp.replace(/[:.]/g, '-');

    // Build snapshot rows: meta header + separator + original data
    var snapshotRows = [
      ['Source', 'Timestamp', 'Type'],
      [sheet.getName(), timestamp, 'completion-snapshot'],
      ['---'],
    ].concat(all);

    // Ensure _waymark_logs folder exists (create if needed)
    var logsFolder = ensureLogsFolder();

    // Create a new spreadsheet in that folder
    var newSs = SpreadsheetApp.create(title);
    var newSheet = newSs.getActiveSheet();

    newSheet.getRange(1, 1, snapshotRows.length, snapshotRows[0].length)
      .setValues(snapshotRows);

    // Move the file into the logs folder
    var file = DriveApp.getFileById(newSs.getId());
    logsFolder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);

    logInfo('Snapshot created: ' + title + ' (' + newSs.getId() + ')');
  } catch (err) {
    logError('exportSnapshot', err);
  }
}

/* ---------- Helpers ---------- */

/**
 * Return the _waymark_logs Drive folder, creating it if it does not exist.
 * Searches only files owned by the running user (drive.file scope).
 *
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function ensureLogsFolder() {
  var folders = DriveApp.getFoldersByName(LOGS_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  var folder = DriveApp.createFolder(LOGS_FOLDER_NAME);
  logInfo('Created logs folder: ' + LOGS_FOLDER_NAME);
  return folder;
}
