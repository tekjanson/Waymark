/* ============================================================
   calorie/index.js — Calorie & Fitness Tracker (barrel)

   A mobile-first nutrition + fitness logger rendered from a single
   Google Sheet (row-per-item, §4.7). Features:
     • Net-calorie banner: Remaining = Target − Food + Burned
       (exercise burned calories refund the daily budget)
     • Collapsible Breakfast/Lunch/Dinner/Snacks with per-meal macros
     • Quick actions: Search DB · Barcode scan · AI photo scan
     • Exercise logging that increases the remaining allowance
     • Date switcher across logged days

   Sheet layout (headers):
     Date | Meal | Item | Qty | Unit | Calories | Protein | Carbs | Fat | Burned | Target
   ============================================================ */

import {
  el, showToast, registerTemplate, appendSheetRows, getSheetData,
} from '../shared.js';
import {
  MEAL_TYPES, DEFAULT_TARGET, parseNum,
  computeDayTotals, computeNet, resolveTarget, groupByDate, latestDate,
  loadFoodDatabase, customFoodsFromRows,
} from './helpers.js';
import { openFoodSearchModal, openExerciseModal } from './modal.js';
import { openBarcodeScanner } from './scanner.js';
import { openAiScanModal } from './ai-vision.js';

/* ---------- Module state ---------- */

let _activeDate = null;
let _collapsed = new Set();
let _container = null;
let _cols = null;
let _sheetTitle = 'Sheet1';

function currentSheetId() {
  const m = (window.location.hash || '').match(/#\/(?:sheet|public)\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** Today's date as YYYY-MM-DD (local). */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- Append + reload ---------- */

/**
 * Append a food or exercise row for the active date, then re-render.
 * Row shape matches the header column order.
 */
async function appendEntry(entry) {
  const sheetId = currentSheetId();
  const date = _activeDate || today();
  const width = 11;
  const row = new Array(width).fill('');
  row[_cols.date] = date;
  if (entry.type === 'exercise') {
    row[_cols.meal] = 'Exercise';
    row[_cols.item] = entry.name;
    if (_cols.qty >= 0) row[_cols.qty] = entry.duration ? String(entry.duration) : '';
    if (_cols.unit >= 0) row[_cols.unit] = entry.duration ? 'min' : '';
    row[_cols.burned] = String(entry.burned);
  } else {
    row[_cols.meal] = entry.mealType;
    row[_cols.item] = entry.name;
    if (_cols.qty >= 0) row[_cols.qty] = String(entry.qty);
    if (_cols.unit >= 0) row[_cols.unit] = entry.unit;
    row[_cols.calories] = String(entry.calories);
    if (_cols.protein >= 0) row[_cols.protein] = String(entry.protein);
    if (_cols.carbs >= 0) row[_cols.carbs] = String(entry.carbs);
    if (_cols.fat >= 0) row[_cols.fat] = String(entry.fat);
  }

  if (!sheetId) {
    showToast('Cannot log — open this sheet from your library', 'error');
    return;
  }
  try {
    await appendSheetRows(sheetId, _sheetTitle, [row]);
    showToast(entry.type === 'exercise' ? 'Exercise logged' : 'Food logged', 'success');
    await reload();
  } catch (err) {
    showToast(err.message || 'Could not save', 'error');
  }
}

/** Re-fetch the sheet and re-render the dashboard in place. */
async function reload() {
  const sheetId = currentSheetId();
  if (!sheetId || !_container) return;
  try {
    const data = await getSheetData(sheetId);
    _sheetTitle = data.sheetTitle || _sheetTitle;
    const rows = (data.values || []).slice(1);
    renderDashboard(_container, rows, _cols);
  } catch { /* keep current view on failure */ }
}

/* ---------- Rendering ---------- */

function macroPill(label, value, cls = '') {
  return el('div', { className: `calorie-macro-pill ${cls}` }, [
    el('span', { className: 'calorie-macro-pill-val' }, [String(value)]),
    el('span', { className: 'calorie-macro-pill-label' }, [label]),
  ]);
}

function buildBanner(net, macros) {
  const remainClass = net.remaining < 0 ? 'calorie-remaining-over' : 'calorie-remaining-ok';
  const eq = el('div', { className: 'calorie-equation' }, [
    el('span', { className: 'calorie-eq-part' }, [
      el('span', { className: 'calorie-eq-num' }, [String(net.target)]),
      el('span', { className: 'calorie-eq-lbl' }, ['Goal']),
    ]),
    el('span', { className: 'calorie-eq-op' }, ['\u2212']),
    el('span', { className: 'calorie-eq-part' }, [
      el('span', { className: 'calorie-eq-num' }, [String(net.food)]),
      el('span', { className: 'calorie-eq-lbl' }, ['Food']),
    ]),
    el('span', { className: 'calorie-eq-op' }, ['+']),
    el('span', { className: 'calorie-eq-part' }, [
      el('span', { className: 'calorie-eq-num' }, [String(net.burned)]),
      el('span', { className: 'calorie-eq-lbl' }, ['Exercise']),
    ]),
    el('span', { className: 'calorie-eq-op' }, ['=']),
    el('span', { className: `calorie-eq-part calorie-eq-remaining ${remainClass}` }, [
      el('span', { className: 'calorie-eq-num' }, [String(net.remaining)]),
      el('span', { className: 'calorie-eq-lbl' }, ['Remaining']),
    ]),
  ]);

  const macroRow = el('div', { className: 'calorie-macro-row' }, [
    macroPill('Protein', `${macros.protein}g`, 'calorie-macro-prot'),
    macroPill('Carbs', `${macros.carbs}g`, 'calorie-macro-carb'),
    macroPill('Fat', `${macros.fat}g`, 'calorie-macro-fat'),
  ]);

  return el('div', { className: 'calorie-banner' }, [eq, macroRow]);
}

function buildQuickActions(mealType) {
  const mk = (label, cls, handler) => {
    const b = el('button', { className: `calorie-action ${cls}`, type: 'button' }, [label]);
    b.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
    return b;
  };
  const onConfirm = (entry) => appendEntry({ ...entry, type: 'food' });
  return el('div', { className: 'calorie-actions' }, [
    mk('+ Search', 'calorie-action-search', async () => {
      const foods = await loadFoodDatabase();
      const customDb = customFoodsFromRows(collectAllRows(), _cols);
      openFoodSearchModal({ mealType, foods, customDb, onConfirm });
    }),
    mk('\u2016 Barcode', 'calorie-action-barcode', () => {
      openBarcodeScanner({ mealType, onConfirm });
    }),
    mk('\uD83D\uDCF8 AI Scan', 'calorie-action-ai', () => {
      openAiScanModal({ mealType, onConfirm });
    }),
  ]);
}

/* Keep a reference to the currently rendered rows for custom-DB search. */
let _allRows = [];
function collectAllRows() { return _allRows; }

function buildMealSection(mealType, dayRows, totals) {
  const bucket = totals.byMeal[mealType];
  const collapsed = _collapsed.has(mealType);

  const header = el('div', { className: 'calorie-meal-header' }, [
    el('span', { className: 'calorie-meal-caret' }, [collapsed ? '\u25B8' : '\u25BE']),
    el('span', { className: 'calorie-meal-name' }, [mealType]),
    el('span', { className: 'calorie-meal-cal' }, [`${bucket.calories} cal`]),
  ]);
  header.addEventListener('click', () => {
    if (_collapsed.has(mealType)) _collapsed.delete(mealType);
    else _collapsed.add(mealType);
    reload();
  });

  const body = el('div', { className: 'calorie-meal-body' });
  const items = dayRows.filter(({ row }) => {
    const meal = (row[_cols.meal] || '').trim();
    return parseNum(row[_cols.burned]) === 0 && meal.toLowerCase() !== 'exercise'
      && canon(meal) === mealType;
  });

  if (!items.length) {
    body.append(el('div', { className: 'calorie-empty-row' }, ['No items yet']));
  } else {
    for (const { row } of items) {
      const name = row[_cols.item] || '\u2014';
      const qty = _cols.qty >= 0 ? (row[_cols.qty] || '') : '';
      const unit = _cols.unit >= 0 ? (row[_cols.unit] || '') : '';
      const serving = [qty, unit].filter(Boolean).join(' ');
      body.append(el('div', { className: 'calorie-food-row' }, [
        el('span', { className: 'calorie-food-name' }, [name]),
        serving ? el('span', { className: 'calorie-food-serving' }, [serving]) : null,
        el('span', { className: 'calorie-food-cal' }, [`${parseNum(row[_cols.calories])} cal`]),
      ]));
    }
  }

  body.append(buildQuickActions(mealType));

  const section = el('div', { className: `calorie-meal ${collapsed ? 'calorie-collapsed' : ''}` }, [header]);
  if (!collapsed) section.append(body);
  return section;
}

function canon(meal) {
  const m = (meal || '').toLowerCase();
  if (/break/.test(m)) return 'Breakfast';
  if (/lunch|midday/.test(m)) return 'Lunch';
  if (/dinner|supper|evening/.test(m)) return 'Dinner';
  return 'Snacks';
}

function buildExerciseSection(dayRows, totals) {
  const header = el('div', { className: 'calorie-meal-header calorie-exercise-header' }, [
    el('span', { className: 'calorie-meal-name' }, ['\uD83C\uDFC3 Exercise']),
    el('span', { className: 'calorie-meal-cal calorie-burned' }, [`+${totals.burned} cal`]),
  ]);
  const body = el('div', { className: 'calorie-meal-body' });

  const items = dayRows.filter(({ row }) =>
    parseNum(row[_cols.burned]) > 0 || (row[_cols.meal] || '').trim().toLowerCase() === 'exercise');
  if (!items.length) {
    body.append(el('div', { className: 'calorie-empty-row' }, ['No workouts logged']));
  } else {
    for (const { row } of items) {
      const name = row[_cols.item] || 'Activity';
      const dur = _cols.qty >= 0 && row[_cols.qty] ? ` \u00B7 ${row[_cols.qty]} min` : '';
      body.append(el('div', { className: 'calorie-food-row' }, [
        el('span', { className: 'calorie-food-name' }, [name + dur]),
        el('span', { className: 'calorie-food-cal calorie-burned' }, [`+${parseNum(row[_cols.burned])} cal`]),
      ]));
    }
  }

  const addBtn = el('button', { className: 'calorie-action calorie-action-exercise', type: 'button' }, ['+ Log exercise']);
  addBtn.addEventListener('click', () => {
    openExerciseModal({ onConfirm: (e) => appendEntry({ ...e, type: 'exercise' }) });
  });
  body.append(el('div', { className: 'calorie-actions' }, [addBtn]));

  return el('div', { className: 'calorie-meal calorie-exercise' }, [header, body]);
}

function buildDateSwitcher(dateMap) {
  const dates = [...dateMap.keys()].sort().reverse();
  const select = el('select', { className: 'calorie-date-select' },
    dates.map(d => el('option', { value: d }, [d])));
  select.value = _activeDate;
  select.addEventListener('change', () => {
    _activeDate = select.value;
    reload();
  });
  return el('div', { className: 'calorie-date-bar' }, [
    el('span', { className: 'calorie-date-label' }, ['Day']),
    select,
  ]);
}

/**
 * Core dashboard renderer — reused by render() and reload().
 * @param {HTMLElement} container
 * @param {string[][]} rows
 * @param {Object} cols
 */
function renderDashboard(container, rows, cols) {
  _container = container;
  _cols = cols;
  _allRows = rows;
  container.innerHTML = '';

  const dateMap = groupByDate(rows, cols);
  if (!_activeDate || !dateMap.has(_activeDate)) {
    _activeDate = latestDate(dateMap) || today();
  }
  const dayEntries = dateMap.get(_activeDate) || [];
  const dayRows = dayEntries;
  const rowsOnly = dayRows.map(e => e.row);

  const totals = computeDayTotals(rowsOnly, cols);
  const target = resolveTarget(rowsOnly, cols) || DEFAULT_TARGET;
  const net = computeNet(target, totals.food, totals.burned);

  container.append(buildDateSwitcher(dateMap));
  container.append(buildBanner(net, totals));

  for (const mealType of MEAL_TYPES) {
    container.append(buildMealSection(mealType, dayRows, totals));
  }
  container.append(buildExerciseSection(dayRows, totals));
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Calorie & Fitness Tracker',
  icon: '\uD83D\uDD25',
  color: '#ef4444',
  priority: 24,
  itemNoun: 'Entry',
  defaultHeaders: ['Date', 'Meal', 'Item', 'Qty', 'Unit', 'Calories', 'Protein', 'Carbs', 'Fat', 'Burned', 'Target'],

  detect(lower) {
    const hasCal = lower.some(h => /^(calorie|calories|cal|kcal)/.test(h));
    const hasBurned = lower.some(h => /(burn|burned|calories_burned)/.test(h));
    const hasExercise = lower.some(h => /(exercise|workout|activity)/.test(h));
    const hasMealItem = lower.some(h => /^(meal|food|item)/.test(h));
    // Requires calories AND a fitness signal (burned/exercise) to avoid
    // colliding with the Meal Planner template.
    return hasCal && (hasBurned || (hasExercise && hasMealItem));
  },

  columns(lower) {
    const cols = {
      date: -1, meal: -1, item: -1, qty: -1, unit: -1,
      calories: -1, protein: -1, carbs: -1, fat: -1, burned: -1, target: -1,
    };
    cols.date = lower.findIndex(h => /^(date|day|when)/.test(h));
    cols.meal = lower.findIndex(h => /^(meal|meal_type|type|category)/.test(h));
    cols.item = lower.findIndex(h => /^(item|food|food_name|name|description)/.test(h));
    cols.qty = lower.findIndex(h => /^(qty|quantity|serving_qty|serving|amount)/.test(h));
    cols.unit = lower.findIndex(h => /^(unit|serving_unit|measure)/.test(h));
    cols.burned = lower.findIndex(h => /(burn|burned)/.test(h));
    cols.calories = lower.findIndex((h, i) => /^(calorie|calories|cal|kcal|consumed)/.test(h) && i !== cols.burned);
    cols.protein = lower.findIndex(h => /^(protein)/.test(h));
    cols.carbs = lower.findIndex(h => /^(carb|carbs|carbohydrate)/.test(h));
    cols.fat = lower.findIndex(h => /^(fat)/.test(h));
    cols.target = lower.findIndex(h => /^(target|goal|budget)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'item', label: 'Item', colIndex: cols.item, type: 'text', placeholder: 'Food or activity', required: true },
      { role: 'meal', label: 'Meal', colIndex: cols.meal, type: 'select', options: [...MEAL_TYPES, 'Exercise'] },
      { role: 'date', label: 'Date', colIndex: cols.date, type: 'text', placeholder: 'YYYY-MM-DD' },
      { role: 'calories', label: 'Calories', colIndex: cols.calories, type: 'number', placeholder: '0' },
      { role: 'burned', label: 'Burned', colIndex: cols.burned, type: 'number', placeholder: '0' },
    ];
  },

  render(container, rows, cols) {
    // Reset volatile view state on a fresh full render.
    _activeDate = null;
    _collapsed = new Set();
    renderDashboard(container, rows, cols);
  },
};

registerTemplate('calorie', definition);
export default definition;
