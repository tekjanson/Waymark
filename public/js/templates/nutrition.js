/* ============================================================
   templates/nutrition.js — Shared food & fitness engine

   A template-agnostic utility module (like charts.js) that powers
   both the Calorie & Fitness Tracker and the Meal Planner:

     • Fuzzy search over the seeded USDA food database (7,900+ foods)
     • Serving/macro scaling
     • Open Food Facts barcode lookup
     • Compendium exercise database + MET calorie math
     • BMR / TDEE / calorie-goal / macro-target formulas

   Templates access these via re-exports in shared.js (§1.5).
   No Google API access happens here — only static /data fetches
   and pure math — so it stays outside api-client.js by design.
   ============================================================ */

export const DEFAULT_WEIGHT_KG = 70;

/* Reference DB caches (loaded once from /data/*.json). */
let _refFoods = null;
let _refPromise = null;
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

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* ---------- Serving scaling ---------- */

/**
 * Scale a food's macros from its reference serving to a new quantity.
 * @param {{qty:number,kcal:number,protein:number,carbs:number,fat:number}} food
 * @param {number} newQty
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

/* ---------- Fuzzy food search ---------- */

/**
 * Tokenized substring search across the reference dataset + custom rows.
 * Ranked: exact prefix > substring > all-token match. Stays well under
 * 25 ms on mobile even over the full USDA dataset.
 * @param {string} query
 * @param {Array<Object>} foods
 * @param {Array<Object>} [customDb]
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
    if (food.source === 'custom') score += 10;
    score -= Math.min(hay.length, 40) * 0.1;
    scored.push({ food, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.food);
}

/* ---------- Reference food DB loader ---------- */

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
  if (Array.isArray(data.foods) && data.foods.length && !Array.isArray(data.foods[0])) {
    return data.foods;
  }
  const qty = data.qty || 100;
  const unit = data.unit || 'g';
  const out = [];
  for (const t of (data.foods || [])) {
    out.push({
      id: slugify(t[0]),
      name: t[0], brand: '', qty, unit,
      kcal: t[1], protein: t[2], carbs: t[3], fat: t[4],
      barcode: '', source: 'usda',
    });
  }
  for (const [code, t] of Object.entries(data.barcodes || {})) {
    out.push({
      id: String(code),
      name: t[0], brand: t[1] || '', qty, unit,
      kcal: t[2], protein: t[3], carbs: t[4], fat: t[5],
      barcode: String(code), source: 'off',
    });
  }
  return out;
}

/** Test/override hook — inject a reference dataset directly. */
export function _setFoodDatabase(foods) {
  _refFoods = foods;
  _refPromise = null;
}

/* ---------- Open Food Facts barcode lookup ---------- */

/**
 * Look up a barcode locally first, then via Open Food Facts.
 * @param {string} barcode
 * @param {Array<Object>} [foods]
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
    out.push({
      id: slugify(t[0]),
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
 * Fuzzy search across the exercise dataset.
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

/* ---------- Profile: BMR / TDEE & goal targets ---------- */

/** Activity multipliers applied to BMR to estimate TDEE. */
export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

export const ACTIVITY_LABELS = {
  sedentary: 'Sedentary (little exercise)',
  light: 'Light (1–3 days/week)',
  moderate: 'Moderate (3–5 days/week)',
  active: 'Active (6–7 days/week)',
  athlete: 'Athlete (2x/day)',
};

export const GOAL_LABELS = {
  lose: 'Lose weight',
  maintain: 'Maintain',
  gain: 'Gain muscle',
};

/** kcal per kg of body mass (approx 7700 kcal ≈ 1 kg). */
const KCAL_PER_KG = 7700;

/**
 * Mifflin-St Jeor basal metabolic rate.
 * @param {{sex:string, age:number, heightCm:number, weightKg:number}} p
 * @returns {number} kcal/day (0 when inputs are incomplete)
 */
export function computeBMR(p) {
  if (!p) return 0;
  const w = parseNum(p.weightKg);
  const h = parseNum(p.heightCm);
  const a = parseNum(p.age);
  if (w <= 0 || h <= 0 || a <= 0) return 0;
  const base = 10 * w + 6.25 * h - 5 * a;
  const sex = (p.sex || '').toLowerCase();
  if (sex === 'female' || sex === 'f') return Math.round(base - 161);
  if (sex === 'male' || sex === 'm') return Math.round(base + 5);
  return Math.round(base - 78);
}

/**
 * Total daily energy expenditure = BMR × activity factor.
 * @param {number} bmr
 * @param {string} activityLevel
 * @returns {number}
 */
export function computeTDEE(bmr, activityLevel) {
  const factor = ACTIVITY_FACTORS[activityLevel] || ACTIVITY_FACTORS.moderate;
  return Math.round((parseNum(bmr) || 0) * factor);
}

/**
 * Daily calorie goal from TDEE and desired weekly weight change.
 * @param {number} tdee
 * @param {string} goalType         'lose' | 'maintain' | 'gain'
 * @param {number} rateKgPerWeek
 * @returns {number}
 */
export function computeCalorieGoal(tdee, goalType, rateKgPerWeek = 0.5) {
  const t = parseNum(tdee) || 0;
  if (!t) return 0;
  const dailyDelta = Math.round((parseNum(rateKgPerWeek) * KCAL_PER_KG) / 7);
  let goal = t;
  if (goalType === 'lose') goal = t - dailyDelta;
  else if (goalType === 'gain') goal = t + dailyDelta;
  return Math.max(1200, goal);
}

/**
 * Split a calorie goal into macro gram targets.
 * @param {number} calories
 * @param {{weightKg?:number, goalType?:string}} [opts]
 * @returns {{protein:number, carbs:number, fat:number}}
 */
export function computeMacroTargets(calories, opts = {}) {
  const cal = parseNum(calories) || 0;
  if (!cal) return { protein: 0, carbs: 0, fat: 0 };
  const weight = parseNum(opts.weightKg) || DEFAULT_WEIGHT_KG;
  const proteinPerKg = opts.goalType === 'lose' ? 2.0 : opts.goalType === 'gain' ? 1.8 : 1.6;
  const protein = Math.round(weight * proteinPerKg);
  const fatCals = cal * 0.27;
  const fat = Math.round(fatCals / 9);
  const proteinCals = protein * 4;
  const carbCals = Math.max(0, cal - proteinCals - fatCals);
  const carbs = Math.round(carbCals / 4);
  return { protein, carbs, fat };
}

/**
 * Derive goal calories + macros from a profile in one call.
 * @param {Object} profile
 * @returns {{bmr:number, tdee:number, calories:number, macros:Object}|null}
 */
export function goalFromProfile(profile) {
  if (!profile) return null;
  const bmr = computeBMR(profile);
  if (!bmr) return null;
  const tdee = computeTDEE(bmr, profile.activityLevel);
  const calories = computeCalorieGoal(tdee, profile.goalType, profile.rateKgPerWeek);
  const macros = computeMacroTargets(calories, {
    weightKg: profile.weightKg, goalType: profile.goalType,
  });
  return { bmr, tdee, calories, macros };
}
