/* ============================================================
   workboard-config.js — Resolve dynamic workboard target
   ============================================================
   Supports project-based workboard switching without editing scripts.

   Resolution order:
   1) WAYMARK_WORKBOARD_URL (extract ID)
   2) WAYMARK_WORKBOARD_ID
   3) Project config file (WAYMARK_PROJECT + activeProject)
   4) Provided defaults

   Config file path:
   - WAYMARK_WORKBOARD_CONFIG, or
   - generated/workboard-config.json (repo default)

   Example config:
   {
     "activeProject": "waymark",
     "projects": {
       "waymark": {
         "spreadsheetId": "...",
         "range": "Sheet1!A:I"
       },
       "client-a": {
         "spreadsheetId": "...",
         "range": "Board!A1:I500"
       }
     }
   }
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

// Load .env so WAYMARK_WORKBOARD_ID persisted there survives git branch changes
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../generated/workboard-config.json');

/**
 * Extract spreadsheet ID from a Google Sheets URL, a Waymark app URL, or return raw ID.
 * Handles:
 *   - Google Sheets: https://docs.google.com/spreadsheets/d/{id}/edit
 *   - Waymark app:   https://example.com/waymark/#/sheet/{id}
 * @param {string} value
 * @returns {string}
 */
function parseSpreadsheetId(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  // Google Sheets URL: /spreadsheets/d/{id}
  const fromSheetsUrl = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromSheetsUrl?.[1]) return fromSheetsUrl[1];

  // Waymark app URL: #/sheet/{id} or /sheet/{id}
  const fromWaymarkUrl = input.match(/[/#]sheet\/([a-zA-Z0-9-_]+)/);
  if (fromWaymarkUrl?.[1]) return fromWaymarkUrl[1];

  // Bare ID (no URL)
  if (!input.includes('/') && !input.includes('?')) return input;

  // Unknown URL shape — return as-is and let the caller fail gracefully
  return input;
}

/**
 * Read workboard config JSON if present.
 * @returns {Object|null}
 */
function readConfigFile() {
  const configPath = process.env.WAYMARK_WORKBOARD_CONFIG || DEFAULT_CONFIG_PATH;
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve workboard spreadsheet ID and range.
 * @param {{ defaultSpreadsheetId: string, defaultRange: string }} options
 * @returns {{ spreadsheetId: string, range: string, project: string, source: string }}
 */
function resolveWorkboardConfig(options) {
  const defaultSpreadsheetId = options.defaultSpreadsheetId;
  const defaultRange = options.defaultRange;

  const envUrlId = parseSpreadsheetId(process.env.WAYMARK_WORKBOARD_URL);
  if (envUrlId) {
    return {
      spreadsheetId: envUrlId,
      range: process.env.WAYMARK_WORKBOARD_RANGE || defaultRange,
      project: process.env.WAYMARK_PROJECT || '',
      source: 'env:url',
    };
  }

  const envId = parseSpreadsheetId(process.env.WAYMARK_WORKBOARD_ID);
  if (envId) {
    return {
      spreadsheetId: envId,
      range: process.env.WAYMARK_WORKBOARD_RANGE || defaultRange,
      project: process.env.WAYMARK_PROJECT || '',
      source: 'env:id',
    };
  }

  const config = readConfigFile();
  const project = process.env.WAYMARK_PROJECT || config?.activeProject || '';
  const projectEntry = project ? config?.projects?.[project] : null;
  const projectId = parseSpreadsheetId(projectEntry?.spreadsheetId || projectEntry?.url);

  if (projectId) {
    return {
      spreadsheetId: projectId,
      range: process.env.WAYMARK_WORKBOARD_RANGE || projectEntry.range || defaultRange,
      project,
      source: 'config:project',
    };
  }

  return {
    spreadsheetId: defaultSpreadsheetId,
    range: process.env.WAYMARK_WORKBOARD_RANGE || defaultRange,
    project,
    source: 'default',
  };
}

module.exports = {
  parseSpreadsheetId,
  resolveWorkboardConfig,
};
