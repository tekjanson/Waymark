/* templates/recipe.js — Recipe: single-recipe-per-sheet display with
   inline editable ingredients and instructions, plus inline add buttons,
   recipe scaling (½×, 1×, 2×, 3×), unit conversion (metric/imperial),
   notes section, and print-to-PDF.

   Sheet format: one row per ingredient/step. Recipe metadata (name,
   servings, prep, cook, category, difficulty) lives on the first row.
   Continuation rows leave the recipe-name cell blank. Each list item
   occupies its own row.  Qty and Unit are separate columns so scaling
   and unit conversion work cleanly. Notes column holds recipe-level
   or per-row notes.
   ============================================================ */

import { el, cell, editableCell, registerTemplate, emitEdit } from './shared.js';

/* ---------- Quantity parsing & scaling helpers ---------- */

/** Common Unicode fraction map */
const FRAC_MAP = { '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75,
                   '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
                   '⅙': 1/6, '⅚': 5/6, '⅛': 0.125, '⅜': 0.375,
                   '⅝': 0.625, '⅞': 0.875 };

/**
 * Parse a quantity string into { number, unit, extra }.
 * Handles integers, decimals, vulgar fractions (½), slash fractions (1/2),
 * mixed numbers (1 1/2), and optional unit suffix.
 *
 * @param {string} raw — e.g. "400g", "2 tbsp", "1/2 cup", "1 ½ tsp"
 * @returns {{ number: number|null, unit: string, extra: string }}
 */
function parseQuantity(raw) {
  if (!raw) return { number: null, unit: '', extra: '' };
  let s = raw.trim();

  // Replace Unicode fractions with decimal
  for (const [ch, val] of Object.entries(FRAC_MAP)) {
    if (s.includes(ch)) {
      // Handle mixed number: "1½" or "1 ½"
      const mixRe = new RegExp(`(\\d+)\\s*${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      const mixM = s.match(mixRe);
      if (mixM) {
        s = s.replace(mixRe, String(Number(mixM[1]) + val));
      } else {
        s = s.replace(ch, String(val));
      }
    }
  }

  // Try: number (possibly with slash fraction) then unit
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(.*)/);
  if (m) return { number: Number(m[1]) / Number(m[2]), unit: m[3].trim(), extra: '' };

  // Mixed number with slash fraction: "1 1/2 cups"
  const mx = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*(.*)/);
  if (mx) return { number: Number(mx[1]) + Number(mx[2]) / Number(mx[3]), unit: mx[4].trim(), extra: '' };

  // Simple number (int or decimal) possibly glued to unit: "400g", "2 tbsp"
  const simple = s.match(/^(\d+(?:\.\d+)?)\s*(.*)/);
  if (simple) return { number: Number(simple[1]), unit: simple[2].trim(), extra: '' };

  // No number found — treat entire string as extra text
  return { number: null, unit: '', extra: s };
}

/**
 * Format a scaled number back to a tidy string.
 * Prefers whole numbers, common fractions, or one-decimal.
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
  if (n === 0) return '0';
  const whole = Math.floor(n);
  const frac = n - whole;

  // Map common fractions back to Unicode
  const fracThresh = [
    [1/8, '⅛'], [1/6, '⅙'], [1/4, '¼'], [1/3, '⅓'],
    [3/8, '⅜'], [2/5, '⅖'], [1/2, '½'], [3/5, '⅗'],
    [5/8, '⅝'], [2/3, '⅔'], [3/4, '¾'], [5/6, '⅚'], [7/8, '⅞'],
  ];
  for (const [val, sym] of fracThresh) {
    if (Math.abs(frac - val) < 0.02) {
      return whole > 0 ? `${whole} ${sym}` : sym;
    }
  }

  if (Math.abs(n - Math.round(n)) < 0.01) return String(Math.round(n));
  // One decimal place
  const rounded = Math.round(n * 10) / 10;
  return rounded === Math.floor(rounded) ? String(Math.floor(rounded)) : String(rounded);
}

/**
 * Scale a raw quantity string by a multiplier.
 * @param {string} raw   — original quantity, e.g. "2 tbsp"
 * @param {number} scale — multiplier (0.5, 1, 2, 3, etc.)
 * @returns {string}
 */
function scaleQuantity(raw, scale) {
  if (scale === 1) return raw;
  const { number, unit, extra } = parseQuantity(raw);
  if (number === null) return raw;              // no numeric part — return as-is
  const scaled = formatNumber(number * scale);
  // Preserve original spacing: if "400g" had no space, keep "800g"
  if (unit) {
    const hasSpace = /^\d/.test(raw) && /\d\s/.test(raw.replace(/[^\d\s].*$/, () => ''));
    // Check if original raw had a space before the unit
    const numStr = raw.match(/^[\d./\s\u00BC-\u00BE\u2150-\u215E]+/);
    const afterNum = numStr ? raw.slice(numStr[0].length) : '';
    const originalHadSpace = numStr ? /\s$/.test(numStr[0]) || /^\s/.test(afterNum) : true;
    return originalHadSpace ? `${scaled} ${unit}` : `${scaled}${unit}`;
  }
  if (extra) return `${scaled} ${extra}`;
  return scaled;
}

/**
 * Scale a servings string by a multiplier.
 * @param {string} raw   — e.g. "4"
 * @param {number} scale
 * @returns {string}
 */
function scaleServings(raw, scale) {
  if (scale === 1) return raw;
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  return formatNumber(n * scale);
}

/* ---------- Qty number parser for split mode ---------- */

/**
 * Parse a qty cell value into a number.
 * Handles decimals, slash fractions ("1/2"), Unicode fractions, and mixed numbers.
 * @param {string} raw
 * @returns {number|null}
 */
function parseQtyNumber(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  const unicodeFracs = {
    '\u00BC': 0.25, '\u00BD': 0.5, '\u00BE': 0.75,
    '\u2153': 0.333, '\u2154': 0.667,
    '\u215B': 0.125, '\u215C': 0.375, '\u215D': 0.625, '\u215E': 0.875,
  };
  // Pure Unicode fraction: "½"
  if (unicodeFracs[trimmed] !== undefined) return unicodeFracs[trimmed];
  // Integer + Unicode fraction: "1½"
  const mixedUni = trimmed.match(/^(\d+)\s*([\u00BC\u00BD\u00BE\u2153\u2154\u215B-\u215E])$/);
  if (mixedUni) return parseInt(mixedUni[1]) + (unicodeFracs[mixedUni[2]] || 0);
  // Slash fraction: "1/2"
  const slashFrac = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (slashFrac) { const d = parseInt(slashFrac[2]); return d ? parseInt(slashFrac[1]) / d : null; }
  // Mixed number: "1 1/2"
  const mixedSlash = trimmed.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedSlash) { const d = parseInt(mixedSlash[3]); return d ? parseInt(mixedSlash[1]) + parseInt(mixedSlash[2]) / d : null; }
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

/* ---------- Unit conversion system ---------- */

/**
 * Canonical unit aliases — map user-facing abbreviations to a normalised key.
 * All keys are lowercase.
 */
const UNIT_ALIASES = {
  // Volume — metric
  ml: 'ml', milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', litre: 'l', liters: 'l', litres: 'l',
  // Volume — imperial
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  'fl oz': 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz', floz: 'fl oz',
  pt: 'pt', pint: 'pt', pints: 'pt',
  qt: 'qt', quart: 'qt', quarts: 'qt',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  // Weight — metric
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  // Weight — imperial
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
};

/** Volume units → ml conversion factors */
const TO_ML = {
  ml: 1, l: 1000,
  tsp: 4.929, tbsp: 14.787, cup: 236.588,
  'fl oz': 29.574, pt: 473.176, qt: 946.353, gal: 3785.41,
};

/** Weight units → g conversion factors */
const TO_G = {
  g: 1, kg: 1000,
  oz: 28.3495, lb: 453.592,
};

/** Metric units are ml, l, g, kg */
const METRIC_UNITS = new Set(['ml', 'l', 'g', 'kg']);

/** Imperial units are tsp, tbsp, cup, fl oz, pt, qt, gal, oz, lb */
const IMPERIAL_UNITS = new Set(['tsp', 'tbsp', 'cup', 'fl oz', 'pt', 'qt', 'gal', 'oz', 'lb']);

/**
 * Normalise a unit string to its canonical key [or null if unknown].
 * @param {string} raw
 * @returns {string|null}
 */
function normaliseUnit(raw) {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  return UNIT_ALIASES[lower] || null;
}

/**
 * Pick the best metric output unit for a given volume in ml or weight in g.
 * @param {number} value — amount in base unit (ml or g)
 * @param {'volume'|'weight'} type
 * @returns {{ value: number, unit: string }}
 */
function bestMetricUnit(value, type) {
  if (type === 'volume') {
    if (value >= 1000) return { value: value / 1000, unit: 'l' };
    return { value, unit: 'ml' };
  }
  // weight
  if (value >= 1000) return { value: value / 1000, unit: 'kg' };
  return { value, unit: 'g' };
}

/**
 * Pick the best imperial output unit for a given volume in ml or weight in g.
 * @param {number} value — amount in base unit (ml or g)
 * @param {'volume'|'weight'} type
 * @returns {{ value: number, unit: string }}
 */
function bestImperialUnit(value, type) {
  if (type === 'volume') {
    // Large → gal → qt → pt → cup → fl oz → tbsp → tsp
    if (value >= 3785.41) return { value: value / 3785.41, unit: 'gal' };
    if (value >= 946.353) return { value: value / 946.353, unit: 'qt' };
    if (value >= 473.176) return { value: value / 473.176, unit: 'pt' };
    if (value >= 236.588) return { value: value / 236.588, unit: 'cup' };
    if (value >= 29.574) return { value: value / 29.574, unit: 'fl oz' };
    if (value >= 14.787) return { value: value / 14.787, unit: 'tbsp' };
    return { value: value / 4.929, unit: 'tsp' };
  }
  // weight
  if (value >= 453.592) return { value: value / 453.592, unit: 'lb' };
  return { value: value / 28.3495, unit: 'oz' };
}

/**
 * Convert a quantity from one unit to a target measurement system.
 *
 * @param {number} qty    — numeric amount
 * @param {string} unit   — original unit string (raw, will be normalised)
 * @param {'original'|'metric'|'imperial'} system — target system
 * @returns {{ qty: number, unit: string }|null} — null if no conversion possible
 */
function convertUnit(qty, unit, system) {
  if (system === 'original') return null; // signal: use original values
  const canon = normaliseUnit(unit);
  if (!canon) return null; // unknown unit — leave as-is

  // Already in the target system?
  if (system === 'metric' && METRIC_UNITS.has(canon)) return null;
  if (system === 'imperial' && IMPERIAL_UNITS.has(canon)) return null;

  // Determine type (volume or weight) and convert to base
  if (TO_ML[canon] !== undefined) {
    const ml = qty * TO_ML[canon];
    const result = system === 'metric'
      ? bestMetricUnit(ml, 'volume')
      : bestImperialUnit(ml, 'volume');
    return { qty: result.value, unit: result.unit };
  }
  if (TO_G[canon] !== undefined) {
    const g = qty * TO_G[canon];
    const result = system === 'metric'
      ? bestMetricUnit(g, 'weight')
      : bestImperialUnit(g, 'weight');
    return { qty: result.value, unit: result.unit };
  }

  return null; // not a convertible unit (e.g. "cloves", "pinch")
}

/* ---------- Inline add-item helper ---------- */

/**
 * Build a small inline "add" button+input for appending a single row.
 * Used for ingredients and steps within the recipe card.
 *
 * @param {string}     label        — button label, e.g. "Add Ingredient"
 * @param {number[]}   colIndices   — column indices for the new values
 * @param {number}     totalColumns — total columns in the sheet header
 * @param {function}   onSubmit     — callback(rows: string[][])
 * @param {string[]}   placeholders — input placeholders per colIndex
 * @returns {HTMLElement}
 */
function inlineAddButton(label, colIndices, totalColumns, onSubmit, placeholders) {
  const wrap = el('div', { className: 'recipe-inline-add' });

  const trigger = el('button', {
    className: 'recipe-inline-add-btn',
    type: 'button',
  }, [`+ ${label}`]);

  const formWrap = el('div', { className: 'recipe-inline-add-form hidden' });
  const inputs = colIndices.map((_, i) => el('input', {
    type: 'text',
    className: 'recipe-inline-add-input',
    placeholder: (placeholders && placeholders[i]) || '',
  }));
  const submitBtn = el('button', {
    className: 'recipe-inline-add-submit',
    type: 'button',
  }, ['Add']);
  const cancelBtn = el('button', {
    className: 'recipe-inline-add-cancel',
    type: 'button',
  }, ['Cancel']);

  formWrap.append(...inputs, submitBtn, cancelBtn);
  wrap.append(trigger, formWrap);

  function expand() {
    trigger.classList.add('hidden');
    formWrap.classList.remove('hidden');
    inputs[0].focus();
  }

  function collapse() {
    formWrap.classList.add('hidden');
    trigger.classList.remove('hidden');
    inputs.forEach(inp => { inp.value = ''; });
  }

  function submit() {
    // At least one input must have a value
    const vals = inputs.map(inp => inp.value.trim());
    if (vals.every(v => !v)) { inputs[0].classList.add('add-row-required'); return; }
    inputs.forEach(inp => inp.classList.remove('add-row-required'));
    const row = new Array(totalColumns).fill('');
    colIndices.forEach((col, i) => { row[col] = vals[i]; });
    collapse();
    onSubmit([row]);
  }

  trigger.addEventListener('click', expand);
  cancelBtn.addEventListener('click', collapse);
  submitBtn.addEventListener('click', submit);
  inputs.forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); collapse(); }
    });
  });

  return wrap;
}

/* ---------- Definition ---------- */

const definition = {
  name: 'Recipe',
  icon: '📖',
  color: '#ea580c',
  priority: 24,
  itemNoun: 'Ingredient',

  detect(lower) {
    // Detect when headers suggest a recipe sheet
    const hasRecipeSignal = lower.some(h => /^(recipe|dish|name)/.test(h));
    const hasIngredient   = lower.some(h => /^(ingredients?|ingredient)/.test(h));
    const hasInstruction  = lower.some(h => /^(instructions?|steps?|directions?|method)/.test(h));
    const hasPrepCook     = lower.some(h => /^(prep|cook|servings|cuisine|difficulty|category)/.test(h));
    const hasQuantity     = lower.some(h => /^(qty|quantity|amount|units?)/.test(h));

    // Strong signal: ingredient + instruction columns
    if (hasIngredient && hasInstruction) return true;
    // Recipe + at least one supporting column
    if (hasRecipeSignal && (hasIngredient || hasInstruction || hasPrepCook)) return true;
    // Quantity + ingredient is a strong recipe signal
    if (hasQuantity && hasIngredient) return true;

    return false;
  },

  columns(lower) {
    const cols = {
      text: -1, servings: -1, prepTime: -1, cookTime: -1,
      category: -1, difficulty: -1,
      qty: -1, unit: -1, quantity: -1,
      ingredient: -1, step: -1, notes: -1, source: -1,
    };
    cols.text       = lower.findIndex(h => /^(recipe|name|title|dish)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.servings   = lower.findIndex(h => /^(servings|serves|yield|portions)/.test(h));
    cols.prepTime   = lower.findIndex(h => /^(prep)/.test(h));
    cols.cookTime   = lower.findIndex(h => /^(cook)/.test(h));
    cols.category   = lower.findIndex(h => /^(category|cuisine|type)/.test(h));
    cols.difficulty = lower.findIndex(h => /^(difficulty|level)/.test(h));
    // Split qty/unit columns (new format)
    cols.qty        = lower.findIndex(h => /^qty$/.test(h));
    cols.unit       = lower.findIndex(h => /^units?$/.test(h));
    // Legacy combined quantity column
    cols.quantity   = lower.findIndex(h => /^(quantity|amount)/.test(h));
    cols.ingredient = lower.findIndex(h => /^(ingredients?)/.test(h));
    cols.step       = lower.findIndex(h => /^(instructions?|steps?|directions?|method)/.test(h));
    cols.notes      = lower.findIndex(h => /^(notes?)/.test(h));
    cols.source     = lower.findIndex(h => /^(source|url|link|origin)/.test(h));
    return cols;
  },

  render(container, rows, cols, template) {
    // Single recipe per sheet: all rows belong to one recipe.
    // First data row carries the metadata; all rows carry ingredients/steps.
    const firstRow    = rows[0] || [];
    const firstRowIdx = 1; // 1-based offset from header

    const title      = cell(firstRow, cols.text) || firstRow[0] || '\u2014';
    const servingsRaw = cell(firstRow, cols.servings) || '';
    const prepTime   = cell(firstRow, cols.prepTime);
    const cookTime   = cell(firstRow, cols.cookTime);
    const category   = cell(firstRow, cols.category);
    const difficulty = cell(firstRow, cols.difficulty);

    const diffClass  = (difficulty || '').toLowerCase().replace(/[^a-z]/g, '');

    // Determine whether we're in split (qty+unit) or legacy (quantity) mode
    const useSplitQty = cols.qty >= 0;
    // The column index for the numeric quantity
    const qtyColIdx  = useSplitQty ? cols.qty : cols.quantity;

    // Callback for inline add buttons
    const addRow = template && template._onAddRow ? template._onAddRow : () => {};
    const totalCols = (template && template._totalColumns) || 12;

    // --- Scaling state ---
    let currentScale = 1;

    // --- Header ---
    const header = el('div', { className: 'recipe-card-header' }, [
      editableCell('span', { className: 'recipe-card-title' }, title, firstRowIdx, cols.text),
      difficulty
        ? editableCell('span', {
            className: `recipe-difficulty-badge ${diffClass}`,
          }, difficulty, firstRowIdx, cols.difficulty)
        : null,
    ]);

    // --- Print button ---
    const printBtn = el('button', {
      className: 'recipe-print-btn',
      type: 'button',
      title: 'Print recipe as PDF',
    }, ['\uD83D\uDDA8\uFE0F Print']);
    printBtn.addEventListener('click', () => {
      window.print();
    });

    // --- Scale controls ---
    const SCALES = [
      { label: '\u00BD\u00D7', value: 0.5 },
      { label: '1\u00D7', value: 1 },
      { label: '2\u00D7', value: 2 },
      { label: '3\u00D7', value: 3 },
    ];
    const scaleButtons = [];
    const scaleBar = el('div', { className: 'recipe-scale-bar' }, [
      el('span', { className: 'recipe-scale-label' }, ['Scale:']),
    ]);
    for (const s of SCALES) {
      const btn = el('button', {
        className: `recipe-scale-btn${s.value === 1 ? ' active' : ''}`,
        type: 'button',
      }, [s.label]);
      btn.dataset.scale = String(s.value);
      scaleButtons.push(btn);
      scaleBar.append(btn);
    }

    // Custom scale input
    const customScaleInput = el('input', {
      type: 'number',
      className: 'recipe-scale-custom',
      placeholder: 'Custom',
      min: '0.1',
      step: '0.1',
      title: 'Enter a custom scale multiplier',
    });
    scaleBar.append(customScaleInput);
    scaleBar.append(printBtn);

    // --- Unit conversion controls (split mode only) ---
    let currentConversion = 'original';
    let convertBar = null;
    const CONVERSIONS = [
      { label: 'Original', value: 'original' },
      { label: 'Metric',   value: 'metric'   },
      { label: 'Imperial', value: 'imperial'  },
    ];
    const convertButtons = [];

    if (useSplitQty) {
      convertBar = el('div', { className: 'recipe-convert-bar' }, [
        el('span', { className: 'recipe-convert-label' }, ['Units:']),
      ]);
      for (const c of CONVERSIONS) {
        const btn = el('button', {
          className: `recipe-convert-btn${c.value === 'original' ? ' active' : ''}`,
          type: 'button',
        }, [c.label]);
        btn.dataset.conversion = c.value;
        convertButtons.push(btn);
        convertBar.append(btn);
      }
    }

    // --- Meta badges ---
    const metaItems = [];
    let servingsSpan = null;
    if (cols.servings >= 0 && servingsRaw) {
      servingsSpan = el('span', { className: 'meta-label' }, [servingsRaw]);
      metaItems.push(el('div', { className: 'recipe-meta-item' }, [
        '\uD83C\uDF7D\uFE0F ',
        servingsSpan,
        ' servings',
      ]));
    }
    if (cols.prepTime >= 0 && prepTime) {
      metaItems.push(el('div', { className: 'recipe-meta-item' }, [
        '\u23F1\uFE0F Prep: ',
        editableCell('span', { className: 'meta-label' }, prepTime, firstRowIdx, cols.prepTime),
      ]));
    }
    if (cols.cookTime >= 0 && cookTime) {
      metaItems.push(el('div', { className: 'recipe-meta-item' }, [
        '\uD83D\uDD25 Cook: ',
        editableCell('span', { className: 'meta-label' }, cookTime, firstRowIdx, cols.cookTime),
      ]));
    }
    if (cols.category >= 0 && category) {
      metaItems.push(
        editableCell('span', { className: 'recipe-category-badge' }, category, firstRowIdx, cols.category)
      );
    }

    const meta = metaItems.length > 0
      ? el('div', { className: 'recipe-card-meta' }, metaItems)
      : null;

    // --- Source URL (shown as link + re-sync button) ---
    let sourceSection = null;
    const sourceUrl = cols.source >= 0 ? (cell(firstRow, cols.source) || '') : '';
    if (sourceUrl) {
      const sourceLink = el('a', {
        className: 'recipe-source-link',
        href: sourceUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: sourceUrl,
      }, [sourceUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]]);

      const resyncBtn = el('button', {
        className: 'recipe-resync-btn',
        type: 'button',
        title: 'Re-sync recipe from source URL',
      }, ['\uD83D\uDD04 Re-sync']);

      resyncBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('waymark:recipe-resync', {
          detail: { url: sourceUrl },
        }));
      });

      sourceSection = el('div', { className: 'recipe-source-bar' }, [
        el('span', { className: 'recipe-source-label' }, ['Source: ']),
        sourceLink,
        resyncBtn,
      ]);
    }

    // --- Ingredients (one per row, with separate qty + unit columns) ---
    let ingredSection = null;
    const quantitySpans = [];    // track for scaling updates
    const unitSpans = [];        // track for display
    if (cols.ingredient >= 0) {
      const items = [];
      for (let r = 0; r < rows.length; r++) {
        const val = cell(rows[r], cols.ingredient);
        let qty = '';
        let unitVal = '';
        if (useSplitQty) {
          qty = cols.qty >= 0 ? (cell(rows[r], cols.qty) || '') : '';
          unitVal = cols.unit >= 0 ? (cell(rows[r], cols.unit) || '') : '';
        } else {
          qty = qtyColIdx >= 0 ? (cell(rows[r], qtyColIdx) || '') : '';
        }
        if (val || qty) items.push({ text: val, qty, unit: unitVal, rowIdx: r + 1 });
      }
      const ul = el('ul', { className: 'recipe-ingredients-list' });
      for (const item of items) {
        // Qty span — shows numeric value only (no unit)
        const qtySpan = el('span', {
          className: 'recipe-ingredient-qty editable-cell',
          tabindex: '0',
          title: 'Click to edit',
        }, [item.qty || '']);
        qtySpan.dataset.originalQty = item.qty;
        qtySpan.dataset.originalUnit = item.unit || '';
        qtySpan.dataset.rowIdx = String(item.rowIdx);
        qtySpan.dataset.colIdx = String(qtyColIdx);

        // Inline-edit qty — activates only at 1\u00D7 scale + original units
        if (qtyColIdx >= 0) {
          qtySpan.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentScale !== 1 || currentConversion !== 'original') return;
            if (qtySpan.querySelector('input')) return;
            const current = qtySpan.dataset.originalQty || '';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'editable-cell-input';
            input.value = current;
            qtySpan.textContent = '';
            qtySpan.append(input);
            input.focus();
            input.select();

            function commit() {
              const nv = input.value.trim();
              input.removeEventListener('blur', commit);
              qtySpan.textContent = nv || '';
              qtySpan.dataset.originalQty = nv;
              if (nv !== current && !(current === '' && nv === '')) {
                emitEdit(item.rowIdx, qtyColIdx, nv);
              }
            }
            function cancel() {
              input.removeEventListener('blur', commit);
              qtySpan.textContent = current || '';
            }
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
              if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
            });
          });
        }

        quantitySpans.push(qtySpan);

        // Unit span — manually managed for conversion control (not editableCell)
        let unitSpanEl = null;
        if (useSplitQty && cols.unit >= 0) {
          unitSpanEl = el('span', {
            className: `recipe-ingredient-unit${item.unit ? ' editable-cell' : ''}`,
            tabindex: item.unit ? '0' : undefined,
            title: item.unit ? 'Click to edit' : undefined,
          }, [item.unit || '']);
          unitSpanEl.dataset.originalUnit = item.unit || '';
          unitSpanEl.dataset.rowIdx = String(item.rowIdx);
          unitSpanEl.dataset.colIdx = String(cols.unit);

          // Inline-edit unit — only at 1\u00D7 scale + original
          unitSpanEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentScale !== 1 || currentConversion !== 'original') return;
            if (unitSpanEl.querySelector('input')) return;
            const current = unitSpanEl.dataset.originalUnit || '';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'editable-cell-input';
            input.value = current;
            unitSpanEl.textContent = '';
            unitSpanEl.append(input);
            input.focus();
            input.select();

            function commit() {
              const nv = input.value.trim();
              input.removeEventListener('blur', commit);
              unitSpanEl.textContent = nv || '';
              unitSpanEl.dataset.originalUnit = nv;
              qtySpan.dataset.originalUnit = nv;
              if (nv !== current && !(current === '' && nv === '')) {
                emitEdit(item.rowIdx, cols.unit, nv);
              }
            }
            function cancel() {
              input.removeEventListener('blur', commit);
              unitSpanEl.textContent = current || '';
            }
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
              if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
            });
          });

          unitSpans.push(unitSpanEl);
        }

        const li = el('li', {}, [
          qtySpan,
          unitSpanEl,
          editableCell('span', { className: 'recipe-ingredient-text' }, item.text, item.rowIdx, cols.ingredient),
        ]);
        ul.append(li);
      }

      // Add ingredient button
      const addCols = useSplitQty
        ? (cols.unit >= 0 ? [cols.qty, cols.unit, cols.ingredient] : [cols.qty, cols.ingredient])
        : (qtyColIdx >= 0 ? [qtyColIdx, cols.ingredient] : [cols.ingredient]);
      const addPlaceholders = useSplitQty
        ? (cols.unit >= 0 ? ['e.g. 2', 'e.g. cups', 'e.g. flour'] : ['e.g. 2', 'e.g. flour'])
        : (qtyColIdx >= 0 ? ['e.g. 2 cups', 'e.g. flour'] : ['e.g. flour']);
      const addIngredient = inlineAddButton(
        'Add Ingredient', addCols, totalCols, addRow, addPlaceholders
      );
      ingredSection = el('div', { className: 'recipe-card-ingredients' }, [
        el('h4', {}, ['Ingredients']),
        ul,
        addIngredient,
      ]);
    }

    // --- Instructions / Steps (one per row) ---
    let instrSection = null;
    if (cols.step >= 0) {
      const steps = [];
      for (let r = 0; r < rows.length; r++) {
        const val = cell(rows[r], cols.step);
        if (val) steps.push({ text: val, rowIdx: r + 1 });
      }
      const ol = el('ol', { className: 'recipe-instructions-list' });
      for (const s of steps) {
        ol.append(el('li', {}, [
          editableCell('span', { className: 'recipe-step-text' }, s.text, s.rowIdx, cols.step),
        ]));
      }
      const addStep = inlineAddButton(
        'Add Step', [cols.step], totalCols, addRow, ['e.g. Preheat oven to 180\u00B0C']
      );
      instrSection = el('div', { className: 'recipe-card-instructions' }, [
        el('h4', {}, ['Instructions']),
        ol,
        addStep,
      ]);
    }

    // --- Notes section ---
    let notesSection = null;
    if (cols.notes >= 0) {
      const noteItems = [];
      for (let r = 0; r < rows.length; r++) {
        const val = cell(rows[r], cols.notes);
        if (val) noteItems.push({ text: val, rowIdx: r + 1 });
      }
      // Show notes: first row note is the "recipe note", others are per-item
      const notesList = el('div', { className: 'recipe-notes-list' });
      for (const n of noteItems) {
        notesList.append(
          editableCell('p', { className: 'recipe-note-item' }, n.text, n.rowIdx, cols.notes)
        );
      }
      const addNote = inlineAddButton(
        'Add Note', [cols.notes], totalCols, addRow, ['e.g. Best served with fresh garlic bread']
      );
      notesSection = el('div', { className: 'recipe-card-notes' }, [
        el('h4', {}, ['Notes']),
        notesList,
        addNote,
      ]);
    }

    // --- Scale & conversion handler ---
    function updateIngredientDisplay() {
      const scale = currentScale;
      const system = currentConversion;
      const editable = scale === 1 && system === 'original';

      for (let i = 0; i < quantitySpans.length; i++) {
        const qtySpan = quantitySpans[i];
        const unitSpanEl = unitSpans[i] || null;
        const origQty = qtySpan.dataset.originalQty || '';
        const origUnit = qtySpan.dataset.originalUnit || '';

        if (useSplitQty) {
          const num = parseQtyNumber(origQty);
          if (num !== null && origQty) {
            let scaledNum = num * scale;
            let displayUnit = origUnit;

            // Apply unit conversion if not 'original'
            if (system !== 'original' && origUnit) {
              const converted = convertUnit(scaledNum, origUnit, system);
              if (converted) {
                scaledNum = converted.qty;
                displayUnit = converted.unit;
              }
            }

            qtySpan.textContent = formatNumber(scaledNum);
            if (unitSpanEl) unitSpanEl.textContent = displayUnit;
          } else {
            // Non-numeric qty — show original values unchanged
            qtySpan.textContent = origQty || '';
            if (unitSpanEl) unitSpanEl.textContent = origUnit;
          }
        } else {
          // Legacy mode: combined quantity string
          qtySpan.textContent = origQty ? scaleQuantity(origQty, scale) : '';
        }

        // Toggle editability on qty span
        if (editable) {
          qtySpan.classList.add('editable-cell');
          qtySpan.setAttribute('tabindex', '0');
          qtySpan.title = 'Click to edit';
        } else {
          qtySpan.classList.remove('editable-cell');
          qtySpan.removeAttribute('tabindex');
          qtySpan.title = '';
        }

        // Toggle editability on unit span
        if (unitSpanEl) {
          if (editable) {
            unitSpanEl.classList.add('editable-cell');
            unitSpanEl.setAttribute('tabindex', '0');
            unitSpanEl.title = 'Click to edit';
          } else {
            unitSpanEl.classList.remove('editable-cell');
            unitSpanEl.removeAttribute('tabindex');
            unitSpanEl.title = '';
          }
        }
      }

      // Scale servings display
      if (servingsSpan) {
        servingsSpan.textContent = scaleServings(servingsRaw, scale);
      }
    }

    function applyScale(scale, fromPreset = false) {
      currentScale = scale;
      // Update button active states
      const matchesPreset = SCALES.some(s => s.value === scale);
      for (const btn of scaleButtons) {
        btn.classList.toggle('active', Number(btn.dataset.scale) === scale);
      }
      // Sync custom input: clear it when a preset is clicked, populate when custom
      if (fromPreset) {
        customScaleInput.value = '';
        customScaleInput.classList.remove('recipe-scale-custom-active');
      } else if (!matchesPreset) {
        customScaleInput.classList.add('recipe-scale-custom-active');
      }
      updateIngredientDisplay();
    }

    function applyConversion(system) {
      currentConversion = system;
      for (const btn of convertButtons) {
        btn.classList.toggle('active', btn.dataset.conversion === system);
      }
      updateIngredientDisplay();
    }
    for (const btn of scaleButtons) {
      btn.addEventListener('click', () => applyScale(Number(btn.dataset.scale), true));
    }
    // Custom scale input events
    function handleCustomScale() {
      const val = parseFloat(customScaleInput.value);
      if (!isNaN(val) && val > 0) {
        applyScale(val, false);
      }
    }
    customScaleInput.addEventListener('input', handleCustomScale);
    customScaleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handleCustomScale(); }
    });
    // Conversion button events
    for (const btn of convertButtons) {
      btn.addEventListener('click', () => applyConversion(btn.dataset.conversion));
    }

    // --- Assemble single recipe card ---
    const card = el('div', { className: 'recipe-card recipe-single' }, [
      header,
      scaleBar,
      convertBar,
      meta,
      sourceSection,
      ingredSection,
      instrSection,
      notesSection,
    ]);

    container.append(card);

    // Run once to normalise the initial display through formatNumber()
    // so it matches exactly what updateIngredientDisplay produces on every
    // subsequent scale / conversion change (no visual jump).
    updateIngredientDisplay();
  },

  /**
   * Render a cookbook-style directory view for a folder of recipe sheets.
   * Shows a sortable table with Recipe, Servings, Prep Time, Cook Time, Category, Difficulty.
   *
   * @param {HTMLElement} container — target element
   * @param {{ id: string, name: string, rows: string[][], cols: Object }[]} sheets — pre-fetched sheet data
   * @param {function} navigateFn — callback(type, id, name)
   */
  directoryView(container, sheets, navigateFn) {
    // Extract metadata from each sheet's first data row
    const allEntries = sheets.map(s => {
      const firstRow = s.rows[0] || [];
      return {
        id: s.id,
        name: s.name,
        recipe: cell(firstRow, s.cols.text) || s.name,
        servings: cell(firstRow, s.cols.servings),
        prepTime: cell(firstRow, s.cols.prepTime),
        cookTime: cell(firstRow, s.cols.cookTime),
        category: cell(firstRow, s.cols.category),
        difficulty: cell(firstRow, s.cols.difficulty),
      };
    });

    // Sort state
    let sortKey = 'recipe';
    let sortAsc = true;

    // Filter state
    let searchText = '';
    const activeFilters = {
      category: '',
      difficulty: '',
      servings: '',
      prepTime: '',
      cookTime: '',
    };

    // Collect unique values for filterable columns
    function uniqueVals(key) {
      const set = new Set();
      for (const e of allEntries) { if (e[key]) set.add(e[key]); }
      return [...set].sort();
    }

    const sortOptions = [
      { key: 'recipe', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'difficulty', label: 'Difficulty' },
      { key: 'servings', label: 'Servings' },
      { key: 'prepTime', label: 'Prep Time' },
      { key: 'cookTime', label: 'Cook Time' },
    ];

    const filterColumns = [
      { key: 'category', label: 'Category' },
      { key: 'difficulty', label: 'Difficulty' },
      { key: 'servings', label: 'Servings' },
      { key: 'prepTime', label: 'Prep Time' },
      { key: 'cookTime', label: 'Cook Time' },
    ];

    function getFilteredEntries() {
      let list = allEntries;
      const q = searchText.toLowerCase();
      if (q) {
        list = list.filter(e =>
          e.recipe.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.difficulty.toLowerCase().includes(q)
        );
      }
      for (const [key, val] of Object.entries(activeFilters)) {
        if (val) list = list.filter(e => e[key] === val);
      }
      return list;
    }

    function sortList(list) {
      return list.slice().sort((a, b) => {
        let va = a[sortKey] || '';
        let vb = b[sortKey] || '';
        if (sortKey === 'servings') {
          const na = parseFloat(va) || 0;
          const nb = parseFloat(vb) || 0;
          return sortAsc ? na - nb : nb - na;
        }
        va = va.toLowerCase();
        vb = vb.toLowerCase();
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
      });
    }

    const hasActiveFilters = () =>
      searchText || Object.values(activeFilters).some(v => v);

    function render() {
      const filtered = sortList(getFilteredEntries());
      container.innerHTML = '';

      const wrapper = el('div', { className: 'cookbook-directory' });

      // --- Title bar ---
      const titleBar = el('div', { className: 'cookbook-title-bar' }, [
        el('span', { className: 'cookbook-title-icon' }, ['\ud83d\udcd6']),
        el('span', { className: 'cookbook-title' }, ['Cookbook']),
        el('span', { className: 'cookbook-count' }, [
          filtered.length === allEntries.length
            ? `${allEntries.length} recipe${allEntries.length !== 1 ? 's' : ''}`
            : `${filtered.length} of ${allEntries.length}`,
        ]),
      ]);
      wrapper.append(titleBar);

      // --- Toolbar: search + sort + filters ---
      const toolbar = el('div', { className: 'cookbook-toolbar' });

      // Search
      const searchInput = el('input', {
        type: 'text',
        className: 'cookbook-search',
        placeholder: 'Search recipes\u2026',
        value: searchText,
      });
      searchInput.addEventListener('input', () => {
        searchText = searchInput.value.trim();
        render();
      });
      toolbar.append(searchInput);

      // Sort dropdown
      const sortSelect = el('select', {
        className: 'cookbook-sort-select',
        title: 'Sort by',
      });
      for (const opt of sortOptions) {
        const label = opt.label + (sortKey === opt.key ? (sortAsc ? ' \u2191' : ' \u2193') : '');
        const optEl = el('option', { value: opt.key }, [label]);
        if (sortKey === opt.key) optEl.selected = true;
        sortSelect.append(optEl);
      }
      sortSelect.addEventListener('change', () => {
        if (sortKey === sortSelect.value) {
          sortAsc = !sortAsc;
        } else {
          sortKey = sortSelect.value;
          sortAsc = true;
        }
        render();
      });

      const sortDir = el('button', {
        className: 'cookbook-sort-dir',
        type: 'button',
        title: sortAsc ? 'Ascending' : 'Descending',
      }, [sortAsc ? '\u2191' : '\u2193']);
      sortDir.addEventListener('click', () => { sortAsc = !sortAsc; render(); });

      toolbar.append(el('div', { className: 'cookbook-sort-group' }, [sortSelect, sortDir]));

      // Filter dropdowns
      for (const col of filterColumns) {
        const opts = uniqueVals(col.key);
        if (opts.length < 2) continue;
        const select = el('select', {
          className: `cookbook-filter-select${activeFilters[col.key] ? ' active' : ''}`,
          title: `Filter by ${col.label}`,
        });
        select.append(el('option', { value: '' }, [col.label]));
        for (const opt of opts) {
          const optEl = el('option', { value: opt }, [opt]);
          if (activeFilters[col.key] === opt) optEl.selected = true;
          select.append(optEl);
        }
        select.addEventListener('change', () => {
          activeFilters[col.key] = select.value;
          render();
        });
        toolbar.append(select);
      }

      // Clear all
      if (hasActiveFilters()) {
        const clearBtn = el('button', {
          className: 'cookbook-filter-clear',
          type: 'button',
          title: 'Clear all filters',
        }, ['Clear']);
        clearBtn.addEventListener('click', () => {
          searchText = '';
          for (const k of Object.keys(activeFilters)) activeFilters[k] = '';
          render();
        });
        toolbar.append(clearBtn);
      }

      wrapper.append(toolbar);

      // --- Recipe cards ---
      const grid = el('div', { className: 'cookbook-grid' });

      for (const entry of filtered) {
        const diffClass = (entry.difficulty || '').toLowerCase().replace(/[^a-z]/g, '');

        // Build meta pills
        const pills = [];
        if (entry.servings) {
          pills.push(el('span', { className: 'cookbook-pill' }, ['\uD83C\uDF7D\uFE0F ' + entry.servings]));
        }
        if (entry.prepTime) {
          pills.push(el('span', { className: 'cookbook-pill' }, ['\u23F1\uFE0F ' + entry.prepTime]));
        }
        if (entry.cookTime) {
          pills.push(el('span', { className: 'cookbook-pill' }, ['\uD83D\uDD25 ' + entry.cookTime]));
        }

        const card = el('div', {
          className: 'cookbook-card',
          on: { click() { navigateFn('sheet', entry.id, entry.name); } },
        }, [
          el('div', { className: 'cookbook-card-top' }, [
            el('span', { className: 'cookbook-card-name' }, [entry.recipe]),
            entry.difficulty
              ? el('span', { className: `cookbook-card-diff ${diffClass}` }, [entry.difficulty])
              : null,
          ]),
          pills.length > 0
            ? el('div', { className: 'cookbook-card-meta' }, pills)
            : null,
          entry.category
            ? el('div', { className: 'cookbook-card-category' }, [entry.category])
            : null,
        ]);
        grid.append(card);
      }

      if (filtered.length === 0) {
        grid.append(el('p', { className: 'cookbook-empty' }, [
          hasActiveFilters() ? 'No recipes match your filters.' : 'No recipes found.',
        ]));
      }

      wrapper.append(grid);
      container.append(wrapper);

      // Restore search focus
      if (searchText) {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
    }

    render();
  },
};

registerTemplate('recipe', definition);
export default definition;
