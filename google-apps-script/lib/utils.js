/* ============================================================
   utils.js — General Google Apps Script utilities

   GAS-specific helpers for sheet access, property management,
   and structured logging. Requires SpreadsheetApp, Logger,
   and PropertiesService at runtime.

   Include this file in every GAS project alongside waymark-format.js.
   ============================================================ */

/* ---------- Sheet Access ---------- */

/**
 * Get a named sheet from a spreadsheet, throwing if not found.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} name
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function requireSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" not found in "' + ss.getName() + '"');
  return sheet;
}

/**
 * Read all data from a sheet, separating the header row from data rows.
 * All values are converted to trimmed strings.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {{ headers: string[], rows: string[][] }}
 */
function readSheetData(sheet) {
  var all = sheet.getDataRange().getValues();
  if (all.length === 0) return { headers: [], rows: [] };
  var headerRow = all[0].map(function(v) { return String(v); });
  var rows = all.slice(1).map(function(row) {
    return row.map(function(v) { return v == null ? '' : String(v).trim(); });
  });
  return { headers: headerRow, rows: rows };
}

/**
 * Append a single row to the end of a sheet's data range.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {any[]} row
 */
function appendRow(sheet, row) {
  sheet.appendRow(row);
}

/**
 * Write a 2D array to a sheet starting at row 2 (below the header).
 * Clears all existing data rows first.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {any[][]} rows
 */
function writeDataRows(sheet, rows) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  if (rows.length === 0) return;
  var numCols = sheet.getLastColumn() || rows[0].length;
  sheet.getRange(2, 1, rows.length, numCols).setValues(rows);
}

/* ---------- Property Access ---------- */

/**
 * Get a required script property, throwing a descriptive error if absent.
 * @param {string} key
 * @returns {string}
 */
function requireProperty(key) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  if (!val) throw new Error('Script property "' + key + '" is not set. Set it via Project Settings → Script Properties.');
  return val;
}

/**
 * Get a script property with a fallback default.
 * @param {string} key
 * @param {string} defaultValue
 * @returns {string}
 */
function getProperty(key, defaultValue) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  return val != null ? val : (defaultValue || '');
}

/* ---------- Structured Logging ---------- */

/**
 * Log an informational message with an ISO timestamp prefix.
 * Writes to Stackdriver and the GAS Logger.
 * @param {string} message
 */
function logInfo(message) {
  Logger.log('[INFO ' + new Date().toISOString() + '] ' + message);
}

/**
 * Log an error with a context label and ISO timestamp.
 * @param {string}       context  function or operation name
 * @param {Error|string} err
 */
function logError(context, err) {
  var msg = (err instanceof Error) ? err.message : String(err);
  Logger.log('[ERROR ' + new Date().toISOString() + '] ' + context + ': ' + msg);
}

/* ---------- Edit Event Helpers ---------- */

/**
 * Extract the changed value and its 1-based row/column from a GAS edit event.
 * Returns null if the event is missing or incomplete.
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 * @returns {{ value: string, row: number, col: number, sheetName: string }|null}
 */
function parseEditEvent(e) {
  if (!e || !e.range) return null;
  return {
    value:     String(e.value || '').trim(),
    row:       e.range.getRow(),
    col:       e.range.getColumn(),
    sheetName: e.range.getSheet().getName(),
  };
}

/**
 * Return true if an edit event changed a specific column (1-based).
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 * @param {number} colIndex   1-based column number
 * @returns {boolean}
 */
function editedColumn(e, colIndex) {
  var ev = parseEditEvent(e);
  return ev !== null && ev.col === colIndex;
}
