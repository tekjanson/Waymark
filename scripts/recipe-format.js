/* ============================================================
   recipe-format.js — Pure format analysis & transformation logic
   for Waymark recipe sheet migration.

   No I/O — all functions take and return plain JS arrays/objects.
   Shared by both recipe-audit.js and recipe-migrate.js.
   ============================================================ */

'use strict';

/* ---------- Canonical schema ---------- */

/**
 * The canonical column order for a fully up-to-date Waymark recipe sheet.
 * RULE: Qty and Unit are SEPARATE columns. One ingredient/step per row.
 */
const CANONICAL_HEADERS = [
  'Recipe', 'Servings', 'Prep Time', 'Cook Time', 'Category',
  'Difficulty', 'Qty', 'Unit', 'Ingredient', 'Step',
  'Notes', 'Source', 'Status', 'Rating', 'Photo',
];

/**
 * Minimum required headers to be detected as a recipe sheet at all.
 * At least one of these signal pairs must be present.
 */
const DETECTION_RULES = [
  { a: /^(ingredient)/i, b: /^(instructions?|steps?|directions?|method)/i },
  { a: /^(recipe|dish|name)/i, b: /^(ingredient|qty|quantity)/i },
  { a: /^(qty|quantity|amount)/i, b: /^(ingredient)/i },
];

/* ---------- Header role detection ---------- */

/**
 * Map raw header strings to canonical role names.
 * Returns { roleMap: Map<rawHeader, role>, unmapped: string[] }
 */
function detectRoles(rawHeaders) {
  const lower = rawHeaders.map(h => String(h || '').trim().toLowerCase());
  const roleMap = new Map(); // rawHeader → canonicalRole

  const assign = (idx, role) => {
    if (idx >= 0 && !roleMap.has(rawHeaders[idx])) {
      roleMap.set(rawHeaders[idx], role);
    }
  };

  assign(lower.findIndex(h => /^(recipe|dish|name|title)$/.test(h)), 'Recipe');
  assign(lower.findIndex(h => /^(recipe|dish|name|title)/.test(h) && h.length < 20), 'Recipe');
  assign(lower.findIndex(h => /^(servings|serves|yield|portions)/.test(h)), 'Servings');
  assign(lower.findIndex(h => /^(prep)/.test(h)), 'Prep Time');
  assign(lower.findIndex(h => /^(cook)/.test(h)), 'Cook Time');
  assign(lower.findIndex(h => /^(category|cuisine|type)/.test(h)), 'Category');
  assign(lower.findIndex(h => /^(difficulty|level)/.test(h)), 'Difficulty');

  // Split qty/unit (current format)
  assign(lower.findIndex(h => /^qty$/.test(h)), 'Qty');
  assign(lower.findIndex(h => /^units?$/.test(h)), 'Unit');

  // Legacy combined quantity column
  const legacyQtyIdx = lower.findIndex(h => /^(quantity|amount)$/.test(h));
  assign(legacyQtyIdx, 'Quantity_LEGACY');

  assign(lower.findIndex(h => /^(ingredients?)$/.test(h)), 'Ingredient');
  assign(lower.findIndex(h => /^(instructions?|steps?|directions?|method)$/.test(h)), 'Step');
  assign(lower.findIndex(h => /^(notes?)$/.test(h)), 'Notes');
  assign(lower.findIndex(h => /^(source|url|link|origin)$/.test(h)), 'Source');
  assign(lower.findIndex(h => /^(status|approval|approved)$/.test(h)), 'Status');
  assign(lower.findIndex(h => /^(rating|score|stars?)$/.test(h)), 'Rating');
  assign(lower.findIndex(h => /^(photo|image|picture|pic|thumbnail)$/.test(h)), 'Photo');

  // Any header still unmapped
  const unmapped = rawHeaders.filter(h => h && !roleMap.has(h));

  return { roleMap, unmapped };
}

/**
 * Check whether a set of raw headers appears to be a recipe sheet at all.
 * @param {string[]} rawHeaders
 * @returns {boolean}
 */
function isRecipeSheet(rawHeaders) {
  const lower = rawHeaders.map(h => String(h || '').toLowerCase());
  for (const rule of DETECTION_RULES) {
    const hasA = lower.some(h => rule.a.test(h));
    const hasB = lower.some(h => rule.b.test(h));
    if (hasA && hasB) return true;
  }
  return false;
}

/* ---------- Issue detection ---------- */

/**
 * Analyse a sheet's values (2D array, row 0 = headers) and return
 * a list of issue descriptors. An empty array means the sheet is
 * already in canonical form.
 *
 * @param {string[][]} values   — raw 2D array from Google Sheets API
 * @returns {{
 *   isRecipe: boolean,
 *   issues: Array<{ code: string, description: string, autoFixable: boolean }>,
 *   roleMap: Map<string,string>,
 *   unmapped: string[],
 * }}
 */
function analyseSheet(values) {
  const rawHeaders = (values[0] || []).map(h => String(h || '').trim());
  const isRecipe = isRecipeSheet(rawHeaders);

  if (!isRecipe) {
    return { isRecipe: false, issues: [], roleMap: new Map(), unmapped: [] };
  }

  const { roleMap, unmapped } = detectRoles(rawHeaders);
  const roles = new Set(roleMap.values());
  const issues = [];

  // 1. Legacy combined Quantity column → needs splitting into Qty + Unit
  if (roles.has('Quantity_LEGACY') && !roles.has('Qty')) {
    issues.push({
      code: 'LEGACY_QUANTITY',
      description: 'Has a combined "Quantity" column — needs splitting into "Qty" + "Unit" columns',
      autoFixable: true,
    });
  }

  // 2. Wrong header names (plural/alternate)
  const headerNormMap = {
    'Ingredient': /^ingredients$/i,
    'Step': /^(instructions|directions|method)$/i,
  };
  for (const [canonical, pattern] of Object.entries(headerNormMap)) {
    if (rawHeaders.some(h => pattern.test(h.trim()))) {
      issues.push({
        code: `WRONG_HEADER_${canonical.toUpperCase()}`,
        description: `Header "${rawHeaders.find(h => pattern.test(h.trim()))}" should be "${canonical}"`,
        autoFixable: true,
      });
    }
  }

  // 3. Packed ingredients in a single cell (semicolons or newlines in the Ingredient column)
  const ingredCol = getColIdx(rawHeaders, roleMap, 'Ingredient');
  if (ingredCol >= 0) {
    const packedRows = (values.slice(1) || []).filter(row => {
      const v = String(row[ingredCol] || '');
      return v.includes(';') || (v.includes('\n') && v.split('\n').length > 2);
    });
    if (packedRows.length > 0) {
      issues.push({
        code: 'PACKED_INGREDIENTS',
        description: `${packedRows.length} row(s) have multiple ingredients packed in one cell (separated by ";" or newlines)`,
        autoFixable: true,
      });
    }
  }

  // 4. Packed steps in a single cell
  const stepCol = getColIdx(rawHeaders, roleMap, 'Step');
  if (stepCol >= 0) {
    const packedRows = (values.slice(1) || []).filter(row => {
      const v = String(row[stepCol] || '');
      return (v.includes(';') && v.split(';').length > 2) ||
             (v.includes('\n') && v.split('\n').length > 2);
    });
    if (packedRows.length > 0) {
      issues.push({
        code: 'PACKED_STEPS',
        description: `${packedRows.length} row(s) have multiple steps packed in one cell`,
        autoFixable: true,
      });
    }
  }

  // 5. Missing canonical columns
  const missingCols = [];
  for (const col of ['Status', 'Rating', 'Photo', 'Source', 'Notes']) {
    if (!roles.has(col)) missingCols.push(col);
  }
  if (missingCols.length > 0) {
    issues.push({
      code: 'MISSING_COLUMNS',
      description: `Missing optional canonical columns: ${missingCols.join(', ')}`,
      autoFixable: true,
    });
  }

  // 6. Multi-recipe-per-sheet (old cookbook style: every row has a recipe name,
  //    rather than only the first row per recipe group having one)
  const recipeCol = getColIdx(rawHeaders, roleMap, 'Recipe');
  if (recipeCol >= 0 && ingredCol >= 0) {
    const dataRows = values.slice(1);
    const filledRecipeRows = dataRows.filter(row => String(row[recipeCol] || '').trim() !== '');
    const hasIngredients = dataRows.some(row => String(row[ingredCol] || '').trim() !== '');

    // If every row that has an ingredient also has a recipe name, it might be multi-recipe
    if (hasIngredients && filledRecipeRows.length === dataRows.filter(r => String(r[ingredCol] || '').trim() !== '').length && filledRecipeRows.length > 1) {
      issues.push({
        code: 'MULTI_RECIPE_PER_SHEET',
        description: `All ${filledRecipeRows.length} ingredient rows have a recipe name (old format) — each unique recipe should have its own sheet`,
        autoFixable: false,
      });
    }
  }

  // 7. Headers not in canonical order (cosmetic but worth flagging)
  const presentCanonical = CANONICAL_HEADERS.filter(h =>
    rawHeaders.some(r => r.toLowerCase() === h.toLowerCase() || roleMap.get(r) === h)
  );
  const isOrdered = presentCanonical.every((h, i) => {
    const actual = rawHeaders.findIndex(r => r.toLowerCase() === h.toLowerCase() || roleMap.get(r) === h);
    const prev = i > 0 ? rawHeaders.findIndex(r => r.toLowerCase() === presentCanonical[i - 1].toLowerCase() || roleMap.get(r) === presentCanonical[i - 1]) : -1;
    return actual > prev;
  });
  if (!isOrdered && issues.length > 0) {
    issues.push({
      code: 'COLUMN_ORDER',
      description: 'Columns are not in the canonical order',
      autoFixable: true,
    });
  }

  return { isRecipe: true, issues, roleMap, unmapped };
}

/* ---------- Migration ---------- */

/**
 * Transform a sheet's 2D values array to canonical format.
 * Returns the migrated 2D array, or null if the sheet is not a recipe sheet
 * or has no auto-fixable issues.
 *
 * @param {string[][]} values
 * @returns {{ newValues: string[][], changeLog: string[] } | null}
 */
function migrateSheet(values) {
  const { isRecipe, issues } = analyseSheet(values);
  if (!isRecipe) return null;

  const fixable = issues.filter(i => i.autoFixable);
  if (fixable.length === 0) return null;

  const rawHeaders = (values[0] || []).map(h => String(h || '').trim());
  const { roleMap } = detectRoles(rawHeaders);
  const changeLog = [];

  let workingValues = values.map(row => [...row.map(c => String(c ?? ''))]);

  // --- Step 1: Normalize header names ---
  workingValues[0] = workingValues[0].map((h, i) => {
    const role = roleMap.get(h);
    if (role === 'Quantity_LEGACY') return h; // handled in Step 2
    if (/^ingredients$/i.test(h)) { changeLog.push(`Renamed header "${h}" → "Ingredient"`); return 'Ingredient'; }
    if (/^(instructions|directions|method)$/i.test(h)) { changeLog.push(`Renamed header "${h}" → "Step"`); return 'Step'; }
    return h;
  });

  // Re-read normalized headers
  const headers = workingValues[0];
  const { roleMap: roleMap2 } = detectRoles(headers);

  // --- Step 2: Split legacy Quantity column → Qty + Unit ---
  const legacyQtyIdx = headers.findIndex((h, i) => roleMap2.get(h) === 'Quantity_LEGACY' || /^(quantity|amount)$/i.test(h));
  if (legacyQtyIdx >= 0 && !headers.some(h => /^qty$/i.test(h))) {
    const origHeader = headers[legacyQtyIdx];
    // Insert Qty and Unit columns at the legacy position
    workingValues = workingValues.map((row, ri) => {
      const newRow = [...row];
      const raw = String(row[legacyQtyIdx] || '').trim();
      if (ri === 0) {
        // Replace header with Qty, insert Unit after it
        newRow.splice(legacyQtyIdx, 1, 'Qty', 'Unit');
      } else {
        const { qty, unit } = splitQuantity(raw);
        newRow.splice(legacyQtyIdx, 1, qty, unit);
      }
      return newRow;
    });
    changeLog.push(`Split "${origHeader}" column into "Qty" + "Unit" columns`);
  }

  // Re-read headers again after column changes
  const headers2 = workingValues[0];
  const { roleMap: roleMap3 } = detectRoles(headers2);
  const ingredCol2 = getColIdx(headers2, roleMap3, 'Ingredient');
  const stepCol2   = getColIdx(headers2, roleMap3, 'Step');
  const totalCols  = headers2.length;

  // --- Step 3: Expand packed ingredients and steps ---
  let needsExpansion = false;
  if (ingredCol2 >= 0 || stepCol2 >= 0) {
    const expandedRows = [workingValues[0]];
    for (let ri = 1; ri < workingValues.length; ri++) {
      const row = workingValues[ri];
      const ingredRaw = ingredCol2 >= 0 ? String(row[ingredCol2] || '') : '';
      const stepRaw   = stepCol2   >= 0 ? String(row[stepCol2]   || '') : '';

      const ingredItems = ingredRaw ? splitPackedText(ingredRaw) : [''];
      const stepItems   = stepRaw   ? splitPackedText(stepRaw)   : [''];
      const maxLen      = Math.max(ingredItems.length, stepItems.length);

      if (maxLen > 1) {
        needsExpansion = true;
        for (let k = 0; k < maxLen; k++) {
          const newRow = new Array(totalCols).fill('');
          // Only first sub-row inherits the recipe metadata (non-ingredient/step columns)
          if (k === 0) {
            for (let c = 0; c < row.length && c < totalCols; c++) {
              if (c !== ingredCol2 && c !== stepCol2) newRow[c] = row[c];
            }
          }
          if (ingredCol2 >= 0) newRow[ingredCol2] = ingredItems[k] || '';
          if (stepCol2   >= 0) newRow[stepCol2]   = stepItems[k]   || '';
          expandedRows.push(newRow);
        }
      } else {
        expandedRows.push([...row]);
      }
    }
    if (needsExpansion) {
      workingValues = expandedRows;
      changeLog.push('Expanded packed ingredients/steps into individual rows');
    }
  }

  // --- Step 4: Add missing canonical columns ---
  const finalHeaders = workingValues[0];
  const { roleMap: roleMap4 } = detectRoles(finalHeaders);
  const roles4 = new Set(roleMap4.values());

  const toAdd = [];
  for (const col of ['Notes', 'Source', 'Status', 'Rating', 'Photo']) {
    if (!roles4.has(col)) toAdd.push(col);
  }
  if (toAdd.length > 0) {
    workingValues = workingValues.map((row, ri) => {
      if (ri === 0) return [...row, ...toAdd];
      return [...row, ...new Array(toAdd.length).fill('')];
    });
    changeLog.push(`Added missing columns: ${toAdd.join(', ')}`);
  }

  // --- Step 5: Reorder to canonical order ---
  const currentHeaders = workingValues[0];
  const { roleMap: roleMap5 } = detectRoles(currentHeaders);

  // Build target column order: canonical first (in canonical order), then leftovers
  const colOrder = [];
  for (const canonical of CANONICAL_HEADERS) {
    const idx = currentHeaders.findIndex(h => {
      const role = roleMap5.get(h);
      return h === canonical || role === canonical;
    });
    if (idx >= 0 && !colOrder.includes(idx)) colOrder.push(idx);
  }
  // Append any columns not in the canonical list
  for (let i = 0; i < currentHeaders.length; i++) {
    if (!colOrder.includes(i)) colOrder.push(i);
  }

  const isAlreadyOrdered = colOrder.every((v, i) => v === i);
  if (!isAlreadyOrdered) {
    workingValues = workingValues.map(row => colOrder.map(i => row[i] ?? ''));
    changeLog.push(`Reordered columns to canonical order: ${workingValues[0].join(', ')}`);
  }

  return { newValues: workingValues, changeLog };
}

/* ---------- Utility helpers ---------- */

/**
 * Split a packed quantity string like "2 cups" into { qty, unit }.
 * Handles: "2 cups", "1/2 tsp", "400g", "2", "pinch of salt"
 * @param {string} raw
 * @returns {{ qty: string, unit: string }}
 */
function splitQuantity(raw) {
  if (!raw) return { qty: '', unit: '' };
  raw = raw.trim();

  // Pattern: number (int, decimal, fraction) then optional space then unit
  const m = raw.match(/^([\d\/\.\u00BC-\u00BE\u2150-\u215E]+(?:\s+[\d\/]+)?)\s*(.*)$/);
  if (!m) return { qty: '', unit: raw }; // all text, no number

  const numPart  = m[1].trim();
  const unitPart = m[2].trim();

  // Known unit list (abbreviated - full list in helpers.js)
  const KNOWN_UNITS = /^(g|kg|ml|l|oz|lb|lbs|tsp|tbsp|cup|cups|fl\s*oz|pt|qt|gal|cloves?|pinch|dash|bunch|can|cans|slice|slices|piece|pieces|handful|sprig|sprigs|head|heads|stick|sticks|sheet|sheets|bag|bags|bottle|bottles|jar|jars|package|packages|pkg|lb|lbs|whole|medium|large|small|extra)$/i;

  if (!unitPart || KNOWN_UNITS.test(unitPart) || unitPart.length <= 15) {
    return { qty: numPart, unit: unitPart };
  }

  // Unit part looks like ingredient text ("cups flour") — only take the first word as unit
  const words = unitPart.split(/\s+/);
  if (KNOWN_UNITS.test(words[0])) {
    // "2 cups flour" → qty:"2", unit:"cups"  (flour stays in ingredient column)
    return { qty: numPart, unit: words[0] };
  }

  // No recognisable unit — return raw number with empty unit
  return { qty: numPart, unit: '' };
}

/**
 * Split a packed multi-item string into individual items.
 * Splits on semicolons or newlines, trims each item, removes empty/numbering prefixes.
 * @param {string} raw
 * @returns {string[]}
 */
function splitPackedText(raw) {
  if (!raw) return [''];
  let sep = '\n';
  if (raw.includes(';') && !raw.includes('\n')) sep = ';';
  else if (raw.includes(';') && raw.split(';').length > raw.split('\n').length) sep = ';';

  return raw.split(sep)
    .map(s => s.trim())
    .map(s => s.replace(/^\d+[\.\)]\s*/, '')) // remove "1. " or "1) " numbering
    .filter(s => s.length > 0);
}

/**
 * Get a column index from headers using the role map.
 * @param {string[]} headers
 * @param {Map<string,string>} roleMap
 * @param {string} role
 * @returns {number}
 */
function getColIdx(headers, roleMap, role) {
  return headers.findIndex(h => roleMap.get(h) === role || h === role);
}

/* ---------- Exports ---------- */

module.exports = {
  CANONICAL_HEADERS,
  isRecipeSheet,
  detectRoles,
  analyseSheet,
  migrateSheet,
  splitQuantity,
  splitPackedText,
};
