/* ============================================================
   notify-on-status-change.js — Email notification on status change

   Example installable trigger: sends an email when a "Status"
   or "Stage" column in a Waymark-managed sheet changes value.

   Setup:
     1. Set script properties (run setProperties() from the editor):
          TARGET_SHEET_ID — the spreadsheet to watch
          STATUS_COL_NAME — header of the status column (e.g. "Status")
          NOTIFY_EMAIL    — recipient address for notifications
     2. Run setupTriggers() once from the editor to install the onEdit trigger.
     3. Edit any status cell in the sheet to verify the notification.

   Files required: waymark-format.js, utils.js, triggers.js
   ============================================================ */

/* ---------- Setup (run once from editor) ---------- */

/**
 * Set required script properties before installing triggers.
 * Edit the values here and run once; then delete or comment this out.
 */
function setProperties() {
  PropertiesService.getScriptProperties().setProperties({
    TARGET_SHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
    STATUS_COL_NAME: 'Status',
    NOTIFY_EMAIL:    'your-email@example.com',
  });
  logInfo('Script properties set');
}

/**
 * Install the onEdit trigger for the target sheet.
 * Run once from the editor after setProperties().
 */
function setupTriggers() {
  var sheetId = requireProperty('TARGET_SHEET_ID');
  var ss = SpreadsheetApp.openById(sheetId);
  registerOnEditTrigger('onWaymarkStatusEdit', ss);
  logInfo('Triggers installed for sheet: ' + ss.getName());
}

/* ---------- Trigger handler ---------- */

/**
 * Installable onEdit trigger handler.
 * Fires when any cell in the spreadsheet is edited.
 * Sends an email if the edited cell is in the status column.
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 */
function onWaymarkStatusEdit(e) {
  try {
    var ev = parseEditEvent(e);
    if (!ev) return;

    // Find the status column for this sheet
    var ss     = e.source;
    var sheet  = ev.sheetName ? ss.getSheetByName(ev.sheetName) : ss.getActiveSheet();
    if (!sheet) return;

    var statusColName = getProperty('STATUS_COL_NAME', 'Status');
    var data          = readSheetData(sheet);
    var cols          = mapColumnRoles(data.headers, {
      status: new RegExp('^' + statusColName + '$', 'i'),
      name:   /^(name|title|task|item|recipe|project)$/,
    });

    // Only act if the edited column is the status column (1-based vs 0-based)
    if (cols.status < 0 || ev.col !== cols.status + 1) return;

    // Find the group key (name) for the edited row
    var dataRowIndex = ev.row - 2; // header is row 1, data starts at row 2
    var groups       = parseGroups(data.rows, cols.name >= 0 ? cols.name : 0);
    var groupName    = resolveGroupName(groups, dataRowIndex, cols.name);

    var notifyEmail = requireProperty('NOTIFY_EMAIL');
    var subject     = '[Waymark] Status changed: ' + (groupName || 'Row ' + ev.row);
    var body        = [
      'Sheet:  ' + sheet.getName(),
      'Item:   ' + (groupName || 'Unknown'),
      'Status: ' + ev.value,
      'Row:    ' + ev.row,
      'Time:   ' + new Date().toLocaleString(),
    ].join('\n');

    MailApp.sendEmail(notifyEmail, subject, body);
    logInfo('Notification sent for "' + groupName + '" → ' + ev.value);
  } catch (err) {
    logError('onWaymarkStatusEdit', err);
  }
}

/* ---------- Helpers ---------- */

/**
 * Given a flat row index (0-based, within data rows), find the group key
 * for that row. Traverses groups to find which group owns the row.
 *
 * @param {Array<{key: string, rows: any[][]}>} groups
 * @param {number} dataRowIndex   0-based index into the flat data rows
 * @param {number} nameColIdx     column index of the name/primary column
 * @returns {string}
 */
function resolveGroupName(groups, dataRowIndex, nameColIdx) {
  var rowCursor = 0;
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    var end   = rowCursor + group.rows.length;
    if (dataRowIndex >= rowCursor && dataRowIndex < end) {
      return group.key;
    }
    rowCursor = end;
  }
  return '';
}
