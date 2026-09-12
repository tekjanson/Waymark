/* ============================================================
   calorie/helpers.js — Calorie & Fitness Tracker: pure helpers

   Math (net calories, macro scaling), fast fuzzy food search over
   the seeded USDA/staples dataset + user-saved Food DB rows, and
   an Open Food Facts barcode fallback.

   All functions here are side-effect-free where practical so they
   can be unit-tested directly (see unit-calorie-helpers.spec.js).
   ============================================================ */

/* ---------- Constants ---------- */

export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
export const EXERCISE_MEAL = 'Exercise';
export const DEFAULT_TARGET = 2000;
export const DEFAULT_WEIGHT_KG = 70;

/* Reference DB cache (loaded once from /data/nutrition-reference.json) */
let _refFoods = null;
let _refPromise = null;

/* Exercise DB cache (loaded once from /data/exercise-reference.json) */
let _refExercises = null;
let _exPromise = null;

/* ---------- Number parsing ---------- */

/**
 * Parse a numeric value from a cell that may contain units, e.g.
 * "350", "12g", "1.5 cups", "" → number (0 when unparseable).
 * @param {*} v
 * @returns {number}
 */
export function parseNum(v) {
  if (v == null) return 0;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

/** Round to at most 1 decimal place. */
export function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/* ---------- Serving scaling ---------- */

/**
 * Scale a food's macros from its reference serving to a new quantity.
 * The reference food carries macros per `food.qty` of `food.unit`.
 * @param {{qty:number,kcal:number,protein:number,carbs:number,fat:number}} food
 * @param {number} newQty   quantity the user actually ate (same unit)
 * @returns {{calories:number,protein:number,carbs:number,fat:number}}
 */
export function scaleMacros(food, newQty) {
  const base = parseNum(food.qty) || 1;
  const factor = (parseNum(newQty) || 0) / base;
  return {
    calories: Math.round((parseNum(food.kcal) || 0) * factor),
    protein: round1((parseNum(food.protein) || 0) * factor),
    carbs: round1((parseNum(food.carbs) || 0) * factor),
    fat: round1((parseNum(food.fat) || 0) * factor),
  };
}

/* ---------- Daily aggregation ---------- */

/**
 * Tally a single day's food + exercise rows into totals.
 * @param {string[][]} rows   rows already filtered to one Date
 * @param {Object} cols       column-index map from definition.columns()
 * @returns {{food:number,burned:number,protein:number,carbs:number,fat:number,byMeal:Object}}
 */
export function computeDayTotals(rows, cols) {
  const totals = { food: 0, burned: 0, protein: 0, carbs: 0, fat: 0, byMeal: {} };
  for (const type of MEAL_TYPES) {
    totals.byMeal[type] = { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
  }
  for (const row of rows) {
    const meal = (row[cols.meal] || '').trim();
    const burned = parseNum(row[cols.burned]);
    if (burned > 0 || meal.toLowerCase() === 'exercise') {
      totals.burned += burned;
      continue;
    }
    const cal = parseNum(row[cols.calories]);
    const p = parseNum(row[cols.protein]);
    const c = parseNum(row[cols.carbs]);
    const f = parseNum(row[cols.fat]);
    totals.food += cal;
    totals.protein += p;
    totals.carbs += c;
    totals.fat += f;
    const bucket = totals.byMeal[canonicalMeal(meal)];
    if (bucket) {
      bucket.calories += cal;
      bucket.protein += p;
      bucket.carbs += c;
      bucket.fat += f;
      bucket.count += 1;
    }
  }
  totals.protein = round1(totals.protein);
  totals.carbs = round1(totals.carbs);
  totals.fat = round1(totals.fat);
  return totals;
}

/** Map an arbitrary meal label to one of the 4 canonical buckets. */
export function canonicalMeal(meal) {
  const m = (meal || '').toLowerCase();
  if (/break/.test(m)) return 'Breakfast';
  if (/lunch|midday/.test(m)) return 'Lunch';
  if (/dinner|supper|evening/.test(m)) return 'Dinner';
  return 'Snacks';
}

/**
 * The core net-calorie equation: Remaining = Target − Food + Burned.
 * @param {number} target
 * @param {number} food
 * @param {number} burned
 * @returns {{target:number,food:number,burned:number,net:number,remaining:number}}
 */
export function computeNet(target, food, burned) {
  const t = parseNum(target) || 0;
  const fd = parseNum(food) || 0;
  const bn = parseNum(burned) || 0;
  return {
    target: t,
    food: fd,
    burned: bn,
    net: fd - bn,           // net calories consumed
    remaining: t - fd + bn, // budget left (exercise refunds)
  };
}

/**
 * Find the daily target for a date group. Target lives on the first row
 * that carries it (row-per-item §4.7); falls back to DEFAULT_TARGET.
 * @param {string[][]} rows  rows for one date
 * @param {Object} cols
 * @returns {number}
 */
export function resolveTarget(rows, cols) {
  if (cols.target != null && cols.target >= 0) {
    for (const row of rows) {
      const t = parseNum(row[cols.target]);
      if (t > 0) return t;
    }
  }
  return DEFAULT_TARGET;
}

/**
 * Group all rows by Date, preserving original row indices (0-based within
 * the data rows array passed to render()).
 * @param {string[][]} rows
 * @param {Object} cols
 * @returns {Map<string, {row:string[], index:number}[]>}
 */
export function groupByDate(rows, cols) {
  const map = new Map();
  rows.forEach((row, i) => {
    const date = (row[cols.date] || '').trim() || 'Undated';
    if (!map.has(date)) map.set(date, []);
    map.get(date).push({ row, index: i });
  });
  return map;
}

/** Pick the "active" (latest) date from a grouped map. */
export function latestDate(dateMap) {
  const dates = [...dateMap.keys()].filter(d => d !== 'Undated');
  if (!dates.length) return [...dateMap.keys()][0] || null;
  return dates.sort().at(-1);
}

/* ---------- Fuzzy food search ---------- */

/**
 * Tokenized substring search across the reference dataset + custom rows.
 * Ranked: exact prefix > all-token match > partial. Designed to stay
 * well under 25 ms on mobile for the ~90-item seed + user DB.
 *
 * @param {string} query
 * @param {Array<Object>} foods       reference foods (loadFoodDatabase())
 * @param {Array<Object>} [customDb]  user-saved Food DB rows (same shape)
 * @param {number} [limit]
 * @returns {Array<Object>}
 */
export function searchFoodDatabase(query, foods, customDb = [], limit = 25) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const pool = customDb.length ? customDb.concat(foods) : foods;

  const scored = [];
  for (const food of pool) {
    const hay = (`${food.name} ${food.brand || ''}`).toLowerCase();
    let score = 0;
    if (hay.startsWith(q)) score = 100;
    else if (hay.includes(q)) score = 60;
    else if (tokens.every(t => hay.includes(t))) score = 40;
    else continue;
    // Prefer user (custom) items and shorter names on ties.
    if (food.source === 'custom') score += 10;
    score -= Math.min(hay.length, 40) * 0.1;
    scored.push({ food, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.food);
}

/**
 * Convert user-saved Food_DB-style rows (from the current sheet history)
 * into the reference food shape for searching.
 * @param {string[][]} rows
 * @param {Object} cols
 * @returns {Array<Object>}
 */
export function customFoodsFromRows(rows, cols) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const name = (row[cols.item] || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    if (parseNum(row[cols.burned]) > 0) continue; // skip exercise rows
    seen.add(name.toLowerCase());
    out.push({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      brand: '',
      qty: parseNum(row[cols.qty]) || 1,
      unit: (row[cols.unit] || 'serving').trim() || 'serving',
      kcal: parseNum(row[cols.calories]),
      protein: parseNum(row[cols.protein]),
      carbs: parseNum(row[cols.carbs]),
      fat: parseNum(row[cols.fat]),
      barcode: (row[cols.barcode] != null ? row[cols.barcode] : '') || '',
      source: 'custom',
    });
  }
  return out;
}

/* ---------- Reference DB loader ---------- */

/**
 * Load and cache the seeded nutrition reference dataset. Handles the
 * compact v2 tuple layout (expanded here) and the legacy v1 object layout.
 * @returns {Promise<Array<Object>>}
 */
export async function loadFoodDatabase() {
  if (_refFoods) return _refFoods;
  if (_refPromise) return _refPromise;
  _refPromise = (async () => {
    try {
      const base = (typeof window !== 'undefined' && window.__WAYMARK_BASE) || '';
      const res = await fetch(`${base}/data/nutrition-reference.json`);
      if (!res.ok) throw new Error(`reference ${res.status}`);
      const data = await res.json();
      _refFoods = expandReference(data);
    } catch {
      _refFoods = [];
    }
    return _refFoods;
  })();
  return _refPromise;
}

/**
 * Expand a reference payload into the flat food-object shape used by search.
 * @param {Object} data
 * @returns {Array<Object>}
 */
export function expandReference(data) {
  if (!data) return [];
  // Legacy v1: already an array of objects.
  if (Array.isArray(data.foods) && data.foods.length && !Array.isArray(data.foods[0])) {
    return data.foods;
  }
  const qty = data.qty || 100;
  const unit = data.unit || 'g';
  const out = [];
  for (const t of (data.foods || [])) {
    // [name, kcal, protein, carbs, fat]
    out.push({
      id: slugify(t[0]),
      name: t[0], brand: '', qty, unit,
      kcal: t[1], protein: t[2], carbs: t[3], fat: t[4],
      barcode: '', source: 'usda',
    });
  }
  for (const [code, t] of Object.entries(data.barcodes || {})) {
    // [name, brand, kcal, protein, carbs, fat]
    out.push({
      id: String(code),
      name: t[0], brand: t[1] || '', qty, unit,
      kcal: t[2], protein: t[3], carbs: t[4], fat: t[5],
      barcode: String(code), source: 'off',
    });
  }
  return out;
}

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Test/override hook — inject a reference dataset directly. */
export function _setFoodDatabase(foods) {
  _refFoods = foods;
  _refPromise = null;
}

/* ---------- Open Food Facts barcode lookup ---------- */

/**
 * Look up a barcode in the local dataset first, then fall back to the
 * public Open Food Facts API. Returns a reference-shaped food or null.
 * @param {string} barcode
 * @param {Array<Object>} [foods]  reference dataset (already loaded)
 * @returns {Promise<Object|null>}
 */
export async function lookupBarcode(barcode, foods = null) {
  const code = String(barcode || '').trim();
  if (!code) return null;

  const db = foods || (await loadFoodDatabase());
  const local = db.find(f => f.barcode && f.barcode === code);
  if (local) return local;

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    return normalizeOffProduct(data.product, code);
  } catch {
    return null;
  }
}

/**
 * Convert an Open Food Facts product payload into a reference food.
 * OFF nutriments are per 100 g/ml.
 * @param {Object} product
 * @param {string} barcode
 * @returns {Object|null}
 */
export function normalizeOffProduct(product, barcode) {
  if (!product) return null;
  const n = product.nutriments || {};
  const name = product.product_name || product.generic_name;
  if (!name) return null;
  return {
    id: String(barcode),
    name,
    brand: product.brands || '',
    qty: 100,
    unit: (product.nutrition_data_per === 'serving' ? 'serving' : 'g'),
    kcal: Math.round(parseNum(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0)),
    protein: round1(parseNum(n.proteins_100g ?? n.proteins ?? 0)),
    carbs: round1(parseNum(n.carbohydrates_100g ?? n.carbohydrates ?? 0)),
    fat: round1(parseNum(n.fat_100g ?? n.fat ?? 0)),
    barcode: String(barcode),
    source: 'off',
  };
}

/* ---------- Exercise database + MET calorie math ---------- */

/**
 * Calories burned via the MET formula.
 *   kcal = MET × bodyweight(kg) × duration(hours)
 * @param {number} met
 * @param {number} weightKg
 * @param {number} minutes
 * @returns {number}
 */
export function caloriesFromMet(met, weightKg, minutes) {
  const m = parseNum(met);
  const w = parseNum(weightKg) || DEFAULT_WEIGHT_KG;
  const min = parseNum(minutes);
  return Math.round(m * w * (min / 60));
}

/**
 * Load and cache the compendium exercise reference dataset.
 * @returns {Promise<Array<Object>>}
 */
export async function loadExerciseDatabase() {
  if (_refExercises) return _refExercises;
  if (_exPromise) return _exPromise;
  _exPromise = (async () => {
    try {
      const base = (typeof window !== 'undefined' && window.__WAYMARK_BASE) || '';
      const res = await fetch(`${base}/data/exercise-reference.json`);
      if (!res.ok) throw new Error(`exercise ${res.status}`);
      const data = await res.json();
      _refExercises = expandExercises(data);
    } catch {
      _refExercises = [];
    }
    return _refExercises;
  })();
  return _exPromise;
}

/** Expand the compact exercise payload into activity objects. */
export function expandExercises(data) {
  if (!data) return [];
  if (Array.isArray(data.activities) && data.activities.length && !Array.isArray(data.activities[0])) {
    return data.activities;
  }
  const out = [];
  for (const t of (data.activities || [])) {
    // [name, met, category, intensity]
    out.push({
      id: String(t[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: t[0], met: t[1], category: t[2] || '', intensity: t[3] || '',
    });
  }
  return out;
}

/** Test/override hook — inject an exercise dataset directly. */
export function _setExerciseDatabase(list) {
  _refExercises = list;
  _exPromise = null;
}

/**
 * Fuzzy search across the exercise dataset (same ranking as foods).
 * @param {string} query
 * @param {Array<Object>} activities
 * @param {number} [limit]
 * @returns {Array<Object>}
 */
export function searchExerciseDatabase(query, activities, limit = 25) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const act of activities) {
    const hay = (`${act.name} ${act.category || ''}`).toLowerCase();
    let score = 0;
    if (hay.startsWith(q)) score = 100;
    else if (hay.includes(q)) score = 60;
    else if (tokens.every(t => hay.includes(t))) score = 40;
    else continue;
    score -= Math.min(hay.length, 60) * 0.05;
    scored.push({ act, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.act);
}
