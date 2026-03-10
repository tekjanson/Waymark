/* ============================================================
   recipe/helpers.js — Pure parsing, formatting & conversion helpers

   Quantity parsing (fractions, mixed numbers, Unicode), scaling,
   unit normalisation, metric/imperial conversion, and the inline
   add-item button builder.
   ============================================================ */

import { el } from '../shared.js';

/* ---------- Quantity parsing & scaling helpers ---------- */

/** Common Unicode fraction map */
export const FRAC_MAP = { '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75,
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
export function parseQuantity(raw) {
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
export function formatNumber(n) {
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
export function scaleQuantity(raw, scale) {
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
export function scaleServings(raw, scale) {
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
export function parseQtyNumber(raw) {
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
export const UNIT_ALIASES = {
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
export const TO_ML = {
  ml: 1, l: 1000,
  tsp: 4.929, tbsp: 14.787, cup: 236.588,
  'fl oz': 29.574, pt: 473.176, qt: 946.353, gal: 3785.41,
};

/** Weight units → g conversion factors */
export const TO_G = {
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
export function normaliseUnit(raw) {
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
export function convertUnit(qty, unit, system) {
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
export function inlineAddButton(label, colIndices, totalColumns, onSubmit, placeholders) {
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
