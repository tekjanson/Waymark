/* ============================================================
   calorie/helpers.js — Calorie & Fitness Tracker helpers

   Calorie-specific math (net calories, day totals, targets, timeframe
   averages, mascot growth) plus convenience re-exports of the shared
   food/fitness engine (templates/nutrition.js via ../shared.js) so the
   calorie sub-modules keep a single local import surface.
   ============================================================ */

import { parseNum, round1 } from '../shared.js';

/* Re-export the shared nutrition engine for calorie sub-modules. */
export {
  parseNum, round1, scaleMacros,
  searchFoodDatabase, loadFoodDatabase, expandReference, _setFoodDatabase,
  lookupBarcode, normalizeOffProduct,
  caloriesFromMet, loadExerciseDatabase, expandExercises,
  _setExerciseDatabase, searchExerciseDatabase,
  ACTIVITY_FACTORS, ACTIVITY_LABELS, GOAL_LABELS, DEFAULT_WEIGHT_KG,
  computeBMR, computeTDEE, computeCalorieGoal, computeMacroTargets, goalFromProfile,
} from '../shared.js';

/* ---------- Constants ---------- */

export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
export const EXERCISE_MEAL = 'Exercise';
export const DEFAULT_TARGET = 2000;

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
 * The core net-calorie equation: Remaining = Target - Food + Burned.
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
    net: fd - bn,
    remaining: t - fd + bn,
  };
}

/**
 * Find the daily target for a date group. Target lives on the first row
 * that carries it (row-per-item 4.7); falls back to `fallback`.
 * @param {string[][]} rows
 * @param {Object} cols
 * @param {number} [fallback]
 * @returns {number}
 */
export function resolveTarget(rows, cols, fallback = DEFAULT_TARGET) {
  if (cols.target != null && cols.target >= 0) {
    for (const row of rows) {
      const t = parseNum(row[cols.target]);
      if (t > 0) return t;
    }
  }
  return fallback;
}

/**
 * Group all rows by Date, preserving original row indices.
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

/**
 * Convert user-logged food rows into the reference food shape for searching.
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
    if (parseNum(row[cols.burned]) > 0) continue;
    seen.add(name.toLowerCase());
    out.push({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name, brand: '',
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

/* ---------- Timeframe averages & trends ---------- */

/** Parse a YYYY-MM-DD string to a Date (UTC midnight); null when invalid. */
export function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((str || '').trim());
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/**
 * Build a per-day series for a trailing window ending at `endDate`.
 * @param {Map} dateMap
 * @param {Object} cols
 * @param {string} endDate  YYYY-MM-DD (inclusive)
 * @param {number} days
 * @returns {Object}
 */
export function buildSeries(dateMap, cols, endDate, days) {
  const end = parseDate(endDate) || new Date();
  const labels = [], food = [], burned = [], net = [];
  const protein = [], carbs = [], fat = [];
  let loggedDays = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const entries = dateMap.get(key) || [];
    const rows = entries.map(e => e.row);
    const totals = computeDayTotals(rows, cols);
    labels.push(key.slice(5));
    food.push(totals.food);
    burned.push(totals.burned);
    net.push(totals.food - totals.burned);
    protein.push(totals.protein);
    carbs.push(totals.carbs);
    fat.push(totals.fat);
    if (rows.length) loggedDays++;
  }
  return { labels, food, burned, net, protein, carbs, fat, loggedDays };
}

/**
 * Average the logged (non-empty) days of a series.
 * @param {Object} series
 * @returns {Object}
 */
export function averageSeries(series) {
  const n = series.loggedDays || 0;
  if (!n) return { food: 0, burned: 0, net: 0, protein: 0, carbs: 0, fat: 0, loggedDays: 0 };
  let f = 0, b = 0, nt = 0, p = 0, c = 0, ft = 0;
  for (let i = 0; i < series.food.length; i++) {
    if (series.food[i] === 0 && series.burned[i] === 0) continue;
    f += series.food[i]; b += series.burned[i]; nt += series.net[i];
    p += series.protein[i]; c += series.carbs[i]; ft += series.fat[i];
  }
  return {
    food: Math.round(f / n), burned: Math.round(b / n), net: Math.round(nt / n),
    protein: Math.round(p / n), carbs: Math.round(c / n), fat: Math.round(ft / n),
    loggedDays: n,
  };
}

/* ---------- Adherence / mascot growth ---------- */

/**
 * Score how well recent days hit the calorie goal (0..1). Drives the mascot.
 * @param {Object} series
 * @param {number} goal
 * @returns {{score:number, streak:number, onTrackDays:number, loggedDays:number}}
 */
export function adherenceScore(series, goal) {
  const g = parseNum(goal) || 0;
  if (!g) return { score: 0, streak: 0, onTrackDays: 0, loggedDays: 0 };
  const band = g * 0.15;
  let onTrack = 0, logged = 0, streak = 0, running = 0;
  for (let i = 0; i < series.net.length; i++) {
    const hadLog = !(series.food[i] === 0 && series.burned[i] === 0);
    if (!hadLog) { running = 0; continue; }
    logged++;
    const net = series.net[i];
    const ok = net <= g + band && net >= g - g * 0.4;
    if (ok) { onTrack++; running++; streak = Math.max(streak, running); }
    else running = 0;
  }
  const score = logged ? onTrack / logged : 0;
  return { score, streak, onTrackDays: onTrack, loggedDays: logged };
}

/**
 * Map an adherence score + streak to a growth stage 0..5 for the mascot.
 * @param {{score:number, streak:number, loggedDays:number}} adh
 * @returns {number}
 */
export function growthStage(adh) {
  if (!adh || !adh.loggedDays) return 0;
  const s = adh.score;
  const streakBonus = Math.min(2, Math.floor(adh.streak / 3));
  let stage = 0;
  if (s >= 0.85) stage = 5;
  else if (s >= 0.7) stage = 4;
  else if (s >= 0.5) stage = 3;
  else if (s >= 0.3) stage = 2;
  else stage = 1;
  return Math.min(5, Math.max(stage, streakBonus));
}
