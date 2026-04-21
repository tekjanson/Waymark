/* ============================================================
   waymark-format.js — Waymark sheet data format utilities

   Pure functions for reading and writing sheets that follow
   the Waymark row-per-item group format (AI_LAWS §4.7).

   No GAS-specific APIs — safe to test outside the GAS runtime.
   ============================================================ */

/* ---------- Cell Access ---------- */

/**
 * Safely read a trimmed string value from a row array.
 * Returns '' for out-of-bounds indices, null, or undefined cells.
 * @param {any[]} row
 * @param {number} idx
 * @returns {string}
 */
function cellValue(row, idx) {
  if (idx < 0 || idx >= row.length) return '';
  const v = row[idx];
  return v == null ? '' : String(v).trim();
}

/* ---------- Group Parsing ---------- */

/**
 * Group contiguous rows by a primary identifier column.
 * A new group starts whenever the primary column is non-empty.
 * Continuation rows (primary column blank) belong to the current group.
 *
 * @param {any[][]} rows          2D array — header row already excluded.
 * @param {number}  primaryColIdx column index of the group key.
 * @returns {Array<{key: string, rows: any[][]}>}
 */
function parseGroups(rows, primaryColIdx) {
  const groups = [];
  let current = null;
  for (const row of rows) {
    const key = cellValue(row, primaryColIdx);
    if (key) {
      current = { key, rows: [row] };
      groups.push(current);
    } else if (current) {
      current.rows.push(row);
    }
  }
  return groups;
}

/* ---------- Column Role Mapping ---------- */

/**
 * Map header strings to column indices using regex patterns.
 * Headers are lowercased and trimmed before matching.
 * Each column index can only be assigned to one role (first match wins).
 * Returns -1 for any role whose pattern matches nothing.
 *
 * @param {string[]}              headers      raw header row values
 * @param {Object<string,RegExp>} rolePatterns role-name → RegExp
 * @returns {Object<string,number>}            role-name → column index
 */
function mapColumnRoles(headers, rolePatterns) {
  const lower = headers.map(function(h) { return (h || '').toLowerCase().trim(); });
  const result = {};
  const taken = {};

  var roleNames = Object.keys(rolePatterns);
  for (var i = 0; i < roleNames.length; i++) {
    var role = roleNames[i];
    var pattern = rolePatterns[role];
    var idx = -1;
    for (var j = 0; j < lower.length; j++) {
      if (!taken[j] && pattern.test(lower[j])) {
        idx = j;
        break;
      }
    }
    result[role] = idx;
    if (idx >= 0) taken[idx] = true;
  }
  return result;
}

/* ---------- Row Building ---------- */

/**
 * Build a continuation row for a group.
 * The primary identifier column is left blank.
 * Additional values are written at their specified column indices.
 *
 * @param {number}              totalCols  total number of columns
 * @param {Object<number,any>}  colValues  column index → value
 * @returns {any[]}
 */
function buildContinuationRow(totalCols, colValues) {
  var row = [];
  for (var i = 0; i < totalCols; i++) row.push('');
  var keys = Object.keys(colValues);
  for (var k = 0; k < keys.length; k++) {
    row[Number(keys[k])] = colValues[keys[k]];
  }
  return row;
}

/**
 * Build the first (header) row of a group.
 * Sets the primary identifier column and any additional column values.
 *
 * @param {string}             primaryValue   value for the primary column
 * @param {number}             primaryColIdx  index of the primary column
 * @param {number}             totalCols      total number of columns
 * @param {Object<number,any>} colValues      additional column index → value
 * @returns {any[]}
 */
function buildGroupHeaderRow(primaryValue, primaryColIdx, totalCols, colValues) {
  var row = [];
  for (var i = 0; i < totalCols; i++) row.push('');
  row[primaryColIdx] = primaryValue;
  var extra = colValues || {};
  var keys = Object.keys(extra);
  for (var k = 0; k < keys.length; k++) {
    row[Number(keys[k])] = extra[keys[k]];
  }
  return row;
}

/* ---------- Row Flattening ---------- */

/**
 * Flatten grouped data back into a 2D array ready to write to a sheet.
 * Each group contributes one header row followed by zero or more
 * continuation rows. The primary column is blank on continuation rows.
 *
 * @param {Array<{key: string, rows: any[][]}>} groups
 * @param {number} primaryColIdx
 * @returns {any[][]}
 */
function flattenGroups(groups, primaryColIdx) {
  var output = [];
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    for (var r = 0; r < group.rows.length; r++) {
      var row = group.rows[r].slice(); // copy
      if (r === 0) {
        row[primaryColIdx] = group.key;
      } else {
        row[primaryColIdx] = '';
      }
      output.push(row);
    }
  }
  return output;
}
