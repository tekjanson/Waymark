/* ============================================================
   import.js — Import existing Google Sheets into WayMark
   
   Uses code-based template detection from column headers,
   with manual column mapping for user control. Detects
   the best template match and lets users override both
   the template choice and individual column assignments.
   ============================================================ */

import { api } from './api-client.js';
import { showToast } from './ui.js';
import { detectTemplate, TEMPLATES } from './templates/index.js';

/* ---------- Code-based import analysis ---------- */

/**
 * Human-readable descriptions for each template role.
 * Maps "templateKey.roleKey" to a user-friendly label.
 */
const ROLE_LABELS = {
  // Checklist
  'checklist.status': 'Completion Status (done/not done)',
  'checklist.text': 'Item Description',
  'checklist.date': 'Due Date',
  'checklist.notes': 'Notes',
  // Tracker
  'tracker.text': 'Goal / Item Name',
  'tracker.progress': 'Current Progress',
  'tracker.target': 'Target Value',
  'tracker.notes': 'Notes / Status',
  // Schedule
  'schedule.text': 'Activity / Event',
  'schedule.time': 'Time Slot',
  'schedule.day': 'Day / Date',
  'schedule.location': 'Location',
  // Inventory
  'inventory.text': 'Item Name',
  'inventory.quantity': 'Quantity / Stock Count',
  'inventory.category': 'Category / Section',
  'inventory.extra': 'Additional Info (price, notes, etc.)',
  // Contacts
  'contacts.name': 'Contact Name',
  'contacts.email': 'Email Address',
  'contacts.phone': 'Phone Number',
  'contacts.role': 'Role / Relationship',
  // Log
  'log.text': 'Activity / Entry',
  'log.timestamp': 'Date / Timestamp',
  'log.type': 'Category / Type',
  'log.duration': 'Duration',
  // Test Cases
  'testcases.text': 'Test Case Description',
  'testcases.result': 'Pass / Fail Result',
  'testcases.expected': 'Expected Outcome',
  'testcases.actual': 'Actual Outcome',
  'testcases.priority': 'Priority / Severity',
  'testcases.notes': 'Notes / Bug Details',
  // Budget
  'budget.text': 'Description / Item',
  'budget.amount': 'Amount ($)',
  'budget.category': 'Budget Category',
  'budget.date': 'Date',
  'budget.budget': 'Budget Limit',
  // Kanban
  'kanban.text': 'Task / Story',
  'kanban.stage': 'Board Stage (to-do, in progress, done)',
  'kanban.assignee': 'Assignee',
  'kanban.priority': 'Priority Level',
  // Habit
  'habit.text': 'Habit / Routine',
  'habit.streak': 'Streak Count',
  'habit.days': 'Day Tracking (Mon–Sun)',
  // Grading
  'grading.student': 'Student Name',
  'grading.grade': 'Final Grade',
  'grading.assignments': 'Assignment Scores',
  // Timesheet
  'timesheet.text': 'Project / Task',
  'timesheet.hours': 'Hours Worked',
  'timesheet.client': 'Client / Customer',
  'timesheet.rate': 'Hourly Rate',
  'timesheet.billable': 'Billable (yes/no)',
  'timesheet.date': 'Date',
  // Poll
  'poll.text': 'Option / Choice',
  'poll.votes': 'Vote Count',
  'poll.percent': 'Percentage',
  'poll.notes': 'Notes',
  // Changelog
  'changelog.version': 'Version / Release',
  'changelog.date': 'Release Date',
  'changelog.type': 'Change Type (added, fixed, etc.)',
  'changelog.description': 'Change Description',
  // CRM
  'crm.company': 'Company / Lead',
  'crm.contact': 'Contact Person',
  'crm.stage': 'Deal Stage / Pipeline',
  'crm.value': 'Deal Value ($)',
  'crm.notes': 'Notes / Next Steps',
  // Meal
  'meal.meal': 'Meal Type (breakfast, lunch, dinner)',
  'meal.recipe': 'Recipe / Dish Name',
  'meal.day': 'Day / Date',
  'meal.calories': 'Calories',
  'meal.protein': 'Protein (g)',
  // Travel
  'travel.activity': 'Activity / Booking',
  'travel.date': 'Date',
  'travel.location': 'Location / Destination',
  'travel.booking': 'Booking Reference',
  'travel.cost': 'Cost ($)',
  // Roster
  'roster.employee': 'Employee / Team Member',
  'roster.role': 'Role / Position',
  'roster.shift': 'Shift / Schedule',
  'roster.days': 'Day Assignments',
};

/**
 * Score each template against the given headers and return a sorted ranking.
 * Examines both header-name detection and how many column roles can be filled.
 * @param {string[]} headers  original header strings
 * @returns {{ key: string, name: string, score: number, matchCount: number, totalRoles: number, colMap: Object }[]}
 */
function scoreAllTemplates(headers) {
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  const results = [];

  for (const [key, template] of Object.entries(TEMPLATES)) {
    const detected = template.detect(lower);
    let matchCount = 0;
    let totalRoles = 0;
    let colMap = {};

    if (typeof template.columns === 'function') {
      try {
        colMap = template.columns(lower);
        for (const [role, idx] of Object.entries(colMap)) {
          if (Array.isArray(idx)) {
            // Array roles (days, assignments) — count matched entries
            totalRoles += 1;
            if (idx.length > 0) matchCount += 1;
          } else {
            totalRoles += 1;
            if (idx >= 0 && idx < headers.length) matchCount += 1;
          }
        }
      } catch { /* skip */ }
    }

    // Score: 0-1 range
    // - 40% weight: whether detect() returned true
    // - 40% weight: ratio of filled column roles
    // - 20% weight: bonus for higher template priority (more specific patterns)
    const detectScore = detected ? 0.4 : 0;
    const fillRatio = totalRoles > 0 ? (matchCount / totalRoles) * 0.4 : 0;
    const priorityBonus = Math.min(template.priority / 30, 1) * 0.2;
    const score = detectScore + fillRatio + priorityBonus;

    results.push({
      key,
      name: template.name,
      score: Math.round(score * 100) / 100,
      matchCount,
      totalRoles,
      colMap,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Analyze a spreadsheet using the built-in template detection engine.
 * Pure column-header heuristics with comprehensive
 * multi-template scoring and user-friendly column descriptions.
 * @param {Object} sheetData  { id, title, sheetTitle, values }
 * @returns {Object}  analysis result
 */
export function analyzeWithCode(sheetData) {
  const headers = sheetData.values?.[0] || [];
  const lowerHeaders = headers.map(h => (h || '').toLowerCase().trim());
  const dataRows = (sheetData.values || []).slice(1);

  // Score every template and pick the best
  const ranking = scoreAllTemplates(headers);
  const best = ranking[0] || { key: 'checklist', name: 'Checklist', score: 0.3, colMap: {}, matchCount: 0, totalRoles: 1 };

  // Also get the canonical detection result for comparison
  const { key: detectedKey, template: detectedTemplate } = detectTemplate(headers);
  const actualKey = best.score > 0.35 ? best.key : detectedKey;
  const actualTemplate = TEMPLATES[actualKey] || detectedTemplate;

  // Build column mapping with friendly labels
  const columnMapping = {};
  let colMap = best.colMap;

  // If we switched template from scoring, re-compute columns
  if (actualKey !== best.key && typeof actualTemplate.columns === 'function') {
    try { colMap = actualTemplate.columns(lowerHeaders); } catch { /* keep best.colMap */ }
  }

  // Reverse-map: column index → role key
  const indexToRole = {};
  for (const [role, idx] of Object.entries(colMap)) {
    if (Array.isArray(idx)) {
      // Array roles: mark each index
      for (const i of idx) {
        if (i >= 0 && i < headers.length) {
          indexToRole[i] = role;
        }
      }
    } else if (idx >= 0 && idx < headers.length) {
      indexToRole[idx] = role;
    }
  }

  // For each header, provide a user-friendly description
  headers.forEach((h, i) => {
    const role = indexToRole[i];
    if (role) {
      const friendlyLabel = ROLE_LABELS[`${actualKey}.${role}`];
      columnMapping[h] = friendlyLabel || role;
    } else {
      columnMapping[h] = '(unmatched — will be kept as-is)';
    }
  });

  // Calculate confidence based on multiple signals
  const detected = actualTemplate.detect(lowerHeaders);
  let confidence;
  if (!detected) {
    confidence = 0.2 + (best.matchCount > 0 ? 0.1 : 0);
  } else {
    // Base 0.5 for detection, up to +0.35 for column fill, +0.15 for data rows
    const totalRoles = best.totalRoles || 1;
    const fillBonus = (best.matchCount / totalRoles) * 0.35;
    const dataBonus = dataRows.length > 0 ? Math.min(dataRows.length / 10, 1) * 0.15 : 0;
    confidence = Math.min(0.5 + fillBonus + dataBonus, 0.95);
  }

  // Build a helpful summary
  const matchInfo = best.totalRoles > 0
    ? `Matched ${best.matchCount} of ${best.totalRoles} expected column roles.`
    : '';
  const runner = ranking[1];
  const runnerNote = runner && runner.score > 0.3
    ? ` Runner-up: "${runner.name}" (${Math.round(runner.score * 100)}%).`
    : '';
  const summary = `Detected as "${actualTemplate.name}" template using column pattern matching (${Math.round(confidence * 100)}% confidence). ${matchInfo}${runnerNote}`.trim();

  return {
    method: 'code',
    suggestedTemplate: actualKey,
    templateName: actualTemplate.name,
    confidence: Math.round(confidence * 100) / 100,
    columnMapping,
    suggestedHeaders: headers,
    summary,
    originalHeaders: headers,
    rowCount: Math.max(0, (sheetData.values?.length || 1) - 1),
  };
}

/* ---------- Template roles for manual column mapping ---------- */

/**
 * Get the available column roles for a given template.
 * Used by the import UI to let users manually assign columns.
 * @param {string} templateKey
 * @returns {{ key: string, label: string }[]}
 */
export function getTemplateRoles(templateKey) {
  const roles = [];
  const prefix = `${templateKey}.`;
  for (const [fullKey, label] of Object.entries(ROLE_LABELS)) {
    if (fullKey.startsWith(prefix)) {
      roles.push({ key: fullKey.slice(prefix.length), label });
    }
  }
  return roles;
}

/* ---------- Import execution ---------- */

/**
 * Import a spreadsheet into WayMark by copying it into a WayMark-managed folder.
 * Creates a "WayMark Imports" root folder and copies/re-creates the sheet there.
 * @param {Object} sheetData    full sheet data { id, title, values }
 * @param {Object} analysis     analysis result from analyzeWithCode
 * @param {Object} [options]    import options
 * @param {boolean} [options.remap]        whether to remap columns per analysis suggestion (default: false)
 * @param {string}  [options.template]     override template key
 * @param {function} [options.onProgress]  progress callback
 * @returns {Promise<{sheetId: string, folderId: string}>}
 */
export async function importSheet(sheetData, analysis, options = {}) {
  const { remap = false, template, onProgress = () => {} } = options;

  onProgress('Setting up WayMark Imports folder…');

  // Find or create the imports root folder
  let importsFolder = await api.drive.findFolder('WayMark Imports');
  if (!importsFolder) {
    importsFolder = await api.drive.createFile(
      'WayMark Imports',
      'application/vnd.google-apps.folder',
      []
    );
  }

  // Determine the template subfolder name
  const templateKey = template || analysis.suggestedTemplate;
  const templateDef = TEMPLATES[templateKey];
  const subfolderName = templateDef?.name || templateKey;

  // Find or create template subfolder
  onProgress(`Setting up "${subfolderName}" folder…`);
  let subfolder = await api.drive.findFolder(subfolderName, importsFolder.id);
  if (!subfolder) {
    subfolder = await api.drive.createFile(
      subfolderName,
      'application/vnd.google-apps.folder',
      [importsFolder.id]
    );
  }

  // Build the data rows
  let headers = sheetData.values?.[0] || [];
  let dataRows = (sheetData.values || []).slice(1);

  if (remap && analysis.suggestedHeaders && analysis.columnMapping) {
    // Remap columns from original to suggested order
    onProgress('Remapping columns…');
    const remapped = remapData(headers, dataRows, analysis);
    headers = remapped.headers;
    dataRows = remapped.rows;
  }

  // Create the new spreadsheet
  const title = sheetData.title || 'Imported Sheet';
  onProgress(`Creating "${title}"…`);
  const rows = [headers, ...dataRows];
  const created = await api.sheets.createSpreadsheet(title, rows, subfolder.id);

  onProgress(`Imported "${title}" into ${subfolderName} folder.`);
  showToast(`Imported "${title}" successfully`, 'success');

  return {
    sheetId: created.spreadsheetId,
    folderId: subfolder.id,
  };
}

/**
 * Remap data rows according to the suggested column mapping.
 * @param {string[]} origHeaders
 * @param {string[][]} origRows
 * @param {Object} analysis
 * @returns {{ headers: string[], rows: string[][] }}
 */
function remapData(origHeaders, origRows, analysis) {
  const { suggestedHeaders, columnMapping } = analysis;

  // If no meaningful remap, return as-is
  if (!suggestedHeaders || suggestedHeaders.length === 0) {
    return { headers: origHeaders, rows: origRows };
  }

  // Build a reverse map: suggested header → original column index
  const origIndex = {};
  origHeaders.forEach((h, i) => { origIndex[h] = i; });

  // Map: for each suggested header, find the original column
  const reverseMap = {};
  for (const [origCol, mappedName] of Object.entries(columnMapping)) {
    reverseMap[mappedName] = origIndex[origCol];
  }

  // Use suggested headers as the new header row
  const newHeaders = suggestedHeaders;
  const newRows = origRows.map(row => {
    return newHeaders.map(h => {
      // Try reverse map first
      const idx = reverseMap[h];
      if (idx !== undefined && idx < row.length) return row[idx] || '';
      // Try matching original header directly
      const directIdx = origIndex[h];
      if (directIdx !== undefined && directIdx < row.length) return row[directIdx] || '';
      return '';
    });
  });

  return { headers: newHeaders, rows: newRows };
}

/* ---------- Browse & fetch files for import ---------- */

/**
 * List available files (spreadsheets + documents) the user can import.
 * @returns {Promise<Object[]>}
 */
export async function listImportableSheets() {
  const result = await api.drive.listImportableFiles();
  return result.files || [];
}

/**
 * Fetch a sheet's full data for import preview.
 * @param {string} sheetId
 * @returns {Promise<Object>}
 */
export async function fetchSheetForImport(sheetId) {
  return api.sheets.getSpreadsheet(sheetId);
}

/**
 * Fetch a Google Doc's content and convert to sheet-like rows for import.
 * Handles:
 *   - Tab-separated or comma-separated structured tables
 *   - Plain-text lists with section/category headers (lines ending in ":")
 *   - Simple unstructured lists (one item per line)
 *
 * Section headers (e.g. "Dairy & Juice:", "From White Barn Farm:") are detected
 * and turned into a Category column, producing a proper [Item, Category, Status]
 * table so template detection picks "Checklist" correctly.
 *
 * @param {string} docId
 * @param {string} docName
 * @returns {Promise<Object>}  { id, title, values: string[][] }
 */
export async function fetchDocForImport(docId, docName) {
  const text = await api.drive.exportDoc(docId);

  // Try to parse as a table: lines → rows, split by tabs or commas
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) {
    return { id: docId, title: docName, values: [] };
  }

  // Detect delimiter: prefer tabs, then commas, then treat lines as free-text list
  const tabCount = (lines[0].match(/\t/g) || []).length;
  const commaCount = (lines[0].match(/,/g) || []).length;
  let delimiter;
  if (tabCount >= 1) delimiter = '\t';
  else if (commaCount >= 2) delimiter = ',';
  else delimiter = null; // free-text

  let values;
  if (delimiter) {
    values = lines.map(line => line.split(delimiter).map(cell => cell.trim()));
  } else {
    // Free-text: detect section-header pattern (lines ending with ":")
    // e.g. "From White Barn Farm:", "Dairy & Juice:", "And most importantly:"
    values = parseTextList(lines);
  }

  return { id: docId, title: docName, values };
}

/**
 * Parse a plain-text list into a spreadsheet-like 2D array.
 *
 * Recognises:
 *   - **Section headers** — lines ending with `:` (optionally with only capital
 *     letters / short phrases).  These become the Category value for subsequent items.
 *   - **Items with quantity** — e.g. "Bagels x2" → item "Bagels", quantity "x2"
 *   - **Plain items** — one item per remaining line
 *
 * Output always has the header row  ["Item", "Category", "Status"]  so template
 * detection reliably matches Checklist.
 *
 * @param {string[]} lines  trimmed, non-empty lines
 * @returns {string[][]}
 */
function parseTextList(lines) {
  // Heuristic: a line is a section header if it ends with ":" and is
  // reasonably short (≤ 60 chars), OR is ALL-CAPS with no colon.
  const isSectionHeader = (line) => {
    if (/:\s*$/.test(line) && line.length <= 60) return true;
    // ALL-CAPS lines that look like emphasis headers (e.g. "CHOCOLATE")
    // are NOT section headers — they're items.  Only treat all-caps lines
    // that end with ":" as headers.
    return false;
  };

  const rows = [['Item', 'Category', 'Status']];
  let currentCategory = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isSectionHeader(line)) {
      // Strip trailing colon for a clean category name
      currentCategory = line.replace(/:\s*$/, '').trim();
      continue;
    }

    // Extract optional quantity suffix like "x2", "× 3"
    const qtyMatch = line.match(/^(.+?)\s+[x×]\s*(\d+)\s*$/i);
    const item = qtyMatch ? qtyMatch[1].trim() : line;
    // We don't add a Quantity column to keep things simple — the "x2"
    // stays in the item name which is perfectly fine for a shopping list.

    rows.push([item, currentCategory, '']);
  }

  return rows;
}

/* ---------- Template list for UI ---------- */

/**
 * Get all available templates for manual template selection.
 * @returns {{ key: string, name: string, icon: string }[]}
 */
export function getTemplateList() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key,
    name: t.name,
    icon: t.icon || '📋',
  }));
}
