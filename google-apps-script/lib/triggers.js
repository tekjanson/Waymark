/* ============================================================
   triggers.js — Installable trigger registration helpers

   Run trigger setup functions once from the GAS Script Editor
   (or a one-time menu action) — never on every execution.

   Requires ScriptApp at runtime. Include this file alongside
   utils.js in any project that uses installable triggers.
   ============================================================ */

/* ---------- Registration ---------- */

/**
 * Register an installable onEdit trigger for a specific spreadsheet.
 * Deletes any existing trigger with the same function name first to
 * prevent duplicate firings.
 *
 * @param {string} functionName   the GAS function to call on edit
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function registerOnEditTrigger(functionName, ss) {
  deleteTriggerByName(functionName);
  ScriptApp.newTrigger(functionName)
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  logInfo('onEdit trigger registered for ' + functionName);
}

/**
 * Register an installable onOpen trigger for a specific spreadsheet.
 * Deletes any existing trigger with the same function name first.
 *
 * @param {string} functionName
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function registerOnOpenTrigger(functionName, ss) {
  deleteTriggerByName(functionName);
  ScriptApp.newTrigger(functionName)
    .forSpreadsheet(ss)
    .onOpen()
    .create();
  logInfo('onOpen trigger registered for ' + functionName);
}

/**
 * Register a time-based daily trigger.
 * Fires once per day at the specified hour (script timezone).
 * Deletes any existing trigger with the same function name first.
 *
 * @param {string} functionName
 * @param {number} hourOfDay   0–23 in the project's timezone
 */
function registerDailyTrigger(functionName, hourOfDay) {
  deleteTriggerByName(functionName);
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(hourOfDay)
    .create();
  logInfo('Daily trigger registered for ' + functionName + ' at hour ' + hourOfDay);
}

/**
 * Register a time-based hourly trigger.
 * @param {string} functionName
 * @param {number} everyNHours   interval in hours (1, 2, 4, 6, 8, 12)
 */
function registerHourlyTrigger(functionName, everyNHours) {
  deleteTriggerByName(functionName);
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyHours(everyNHours || 1)
    .create();
  logInfo('Hourly trigger registered for ' + functionName + ' every ' + (everyNHours || 1) + ' hour(s)');
}

/* ---------- Deletion ---------- */

/**
 * Delete all installable triggers for a named handler function.
 * Safe to call even if no trigger exists.
 * @param {string} functionName
 */
function deleteTriggerByName(functionName) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Delete all installable triggers for this project.
 * Use with care — removes all scheduled and event-based triggers.
 */
function deleteAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  logInfo('All project triggers deleted');
}

/* ---------- Inspection ---------- */

/**
 * Log a summary of all current project triggers to the GAS Logger.
 * Useful for debugging trigger registration state.
 */
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  logInfo('Project has ' + triggers.length + ' trigger(s):');
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    logInfo('  [' + i + '] ' + t.getHandlerFunction() + ' | type=' + t.getEventType() + ' | source=' + t.getTriggerSource());
  }
}
