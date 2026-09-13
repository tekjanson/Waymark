/* ============================================================
   calorie/index.js — Calorie & Fitness Tracker (barrel)

   A clean, graphical, mobile-first nutrition + fitness logger rendered
   from a single Google Sheet (row-per-item, §4.7).

   Highlights:
     • Calorie ring + macro rings (graphical, not walls of numbers)
     • Day / Week / Month timeframes with trend charts + averages
     • Prev/next date nav with swipe (Safari/Brave/Chrome friendly)
     • Profile & goal (Mifflin-St Jeor) → recommended calories + macros
     • Living "growth garden" mascot that thrives as you hit your goal
     • Speak-to-log voice pipeline + photo AI + barcode + search
     • Net-calorie model: Remaining = Target − Food + Burned

   Sheet layout (headers):
     Date | Meal | Item | Qty | Unit | Calories | Protein | Carbs | Fat | Burned | Target
   ============================================================ */

import {
  el, showToast, registerTemplate, appendSheetRows, getSheetData,
  updateSheetCell, deleteSheetRow, writeSheetTab, readSheetTab,
  getCalorieProfile, setCalorieProfile, drawLineChart,
} from '../shared.js';
import {
  MEAL_TYPES, DEFAULT_TARGET, parseNum, round1,
  computeDayTotals, computeNet, resolveTarget, groupByDate, latestDate,
  loadFoodDatabase, customFoodsFromRows,
  buildSeries, averageSeries, adherenceScore, growthStage,
  goalFromProfile, computeMacroTargets,
} from './helpers.js';
import { openFoodSearchModal, openExerciseModal } from './modal.js';
import { openBarcodeScanner } from './scanner.js';
import { openAiScanModal } from './ai-vision.js';
import { openVoiceModal } from './voice.js';
import { openProfileModal, buildMascot } from './profile.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------- Module state ---------- */

let _activeDate = null;
let _timeframe = 'day';     // 'day' | 'week' | 'month'
let _collapsed = new Set();
let _container = null;
let _cols = null;
let _sheetTitle = 'Sheet1';
let _numericSheetId = 0;
let _allRows = [];
let _profile = null;
let _tabs = [];             // all workbook tabs (for the Profile tab, etc.)
let _heroPage = 0;          // remembered hero carousel page across reloads

const PROFILE_TAB = 'Profile';
const PROFILE_KEYS = ['sex', 'age', 'heightCm', 'weightKg', 'activityLevel', 'goalType', 'rateKgPerWeek', 'units', 'bestStreak'];

/* ---------- Profile tab (durable persistence) ---------- */

/** Serialize a profile object into human-readable Setting/Value rows. */
function profileToRows(profile) {
  const rows = [['Setting', 'Value']];
  for (const key of PROFILE_KEYS) {
    if (profile[key] != null && profile[key] !== '') rows.push([key, String(profile[key])]);
  }
  return rows;
}

/** Parse Setting/Value rows from a Profile tab back into a typed profile. */
function rowsToProfile(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const numeric = new Set(['age', 'heightCm', 'weightKg', 'rateKgPerWeek', 'bestStreak']);
  const prof = {};
  for (let i = 1; i < values.length; i++) {
    const [key, val] = values[i];
    if (!key) continue;
    prof[key] = numeric.has(key) ? Number(val) || 0 : val;
  }
  return Object.keys(prof).length ? prof : null;
}

/** Read the persisted profile from the workbook's Profile tab, or null. */
function readProfileFromTabs() {
  const tab = readSheetTab(_tabs, PROFILE_TAB);
  return tab ? rowsToProfile(tab.values) : null;
}

/** Persist the profile to the Profile tab (durable) + localStorage (fast cache). */
async function persistProfile(profile) {
  const sid = currentSheetId();
  if (sid) setCalorieProfile(sid, profile);   // fast local cache
  if (!sid) return;
  try {
    await writeSheetTab(sid, PROFILE_TAB, profileToRows(profile));
    // Keep the in-memory tab snapshot fresh so a reload reflects the write.
    const existing = readSheetTab(_tabs, PROFILE_TAB);
    if (existing) existing.values = profileToRows(profile);
    else _tabs = [..._tabs, { title: PROFILE_TAB, numericSheetId: -1, values: profileToRows(profile) }];
  } catch (err) {
    showToast(err.message || 'Could not save profile to sheet', 'error');
  }
}

/** The best streak recorded so far (from the persisted profile). */
function bestStreak() {
  return (_profile && Number(_profile.bestStreak)) || 0;
}

/**
 * Record a new best streak to the Profile tab when the garden grows past its
 * previous record. Only writes when a profile already exists (user opted in)
 * and the streak strictly improved — so it never spams the backend.
 * @param {number} streak
 */
function persistBestStreak(streak) {
  if (!_profile) return;
  if (!(streak > bestStreak())) return;
  _profile = { ..._profile, bestStreak: streak };
  persistProfile(_profile);
}

function currentSheetId() {
  const m = (window.location.hash || '').match(/#\/(?:sheet|public)\/([^/?#]+)/);
  return m ? m[1] : null;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
  if (dateStr === today()) return 'Today';
  return `${wd}, ${mo} ${d}`;
}

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/* ---------- Targets ---------- */

/** Goal calories + macro targets for the active view (profile-aware). */
function resolveGoals(rowsOnly) {
  const g = goalFromProfile(_profile);
  const fallbackCal = g ? g.calories : DEFAULT_TARGET;
  const target = resolveTarget(rowsOnly, _cols, fallbackCal) || DEFAULT_TARGET;
  const macros = g ? g.macros : computeMacroTargets(target, {});
  return { target, macros };
}

/* ---------- Append + reload ---------- */

async function appendEntry(entry) {
  const sheetId = currentSheetId();
  const date = _activeDate || today();
  const row = new Array(11).fill('');
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
  if (!sheetId) { showToast('Open this sheet from your library to log', 'error'); return; }
  try {
    await appendSheetRows(sheetId, _sheetTitle, [row]);
    showToast(entry.type === 'exercise' ? 'Exercise logged' : 'Logged', 'success');
    await reload();
  } catch (err) {
    showToast(err.message || 'Could not save', 'error');
  }
}

async function reload() {
  const sheetId = currentSheetId();
  if (!sheetId || !_container) return;
  try {
    const data = await getSheetData(sheetId);
    _sheetTitle = data.sheetTitle || _sheetTitle;
    if (data.numericSheetId != null) _numericSheetId = data.numericSheetId;
    if (Array.isArray(data.tabs)) _tabs = data.tabs;
    const rows = (data.values || []).slice(1);
    renderDashboard(_container, rows, _cols);
  } catch { /* keep current view */ }
}

/* ---------- Edit / delete a logged entry ---------- */

/**
 * Update one column of a logged row, then reload.
 * @param {number} dataIndex  0-based index within data rows (header excluded)
 * @param {number} col        0-based column index
 * @param {string} value
 */
async function updateEntryCell(dataIndex, col, value) {
  const sheetId = currentSheetId();
  if (!sheetId || col < 0) return;
  try {
    await updateSheetCell(sheetId, _sheetTitle, dataIndex + 1, col, value); // +1 for header
  } catch (err) {
    showToast(err.message || 'Could not update', 'error');
  }
}

/**
 * Delete a logged row entirely, then reload.
 * @param {number} dataIndex  0-based index within data rows (header excluded)
 */
async function deleteEntry(dataIndex) {
  const sheetId = currentSheetId();
  if (!sheetId) return;
  try {
    await deleteSheetRow(sheetId, _numericSheetId, dataIndex + 1); // +1 for header
    showToast('Deleted', 'success');
    await reload();
  } catch (err) {
    showToast(err.message || 'Could not delete', 'error');
  }
}

/**
 * Open an edit/delete sheet for a single logged entry.
 * @param {{row:string[], index:number}} entry
 * @param {boolean} isExercise
 */
function openEntryEditor(entry, isExercise) {
  const overlay = el('div', { className: 'calorie-modal-overlay' });
  const modal = el('div', { className: 'calorie-modal' });
  const close = () => overlay.remove();
  const name = entry.row[_cols.item] || (isExercise ? 'Activity' : 'Item');

  const header = el('div', { className: 'calorie-modal-header' }, [
    el('span', { className: 'calorie-modal-title' }, [`Edit \u2014 ${name}`]),
    el('button', { className: 'calorie-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  header.querySelector('.calorie-modal-close').addEventListener('click', close);

  const rows = [];
  const inputByCol = new Map();
  const field = (label, col, attrs = {}) => {
    const input = el('input', { className: 'calorie-p-input', value: col >= 0 ? (entry.row[col] || '') : '', ...attrs });
    rows.push({ col, input });
    if (col >= 0) inputByCol.set(col, input);
    return el('div', { className: 'calorie-serving-row' }, [el('label', {}, [label]), input]);
  };

  const body = el('div', { className: 'calorie-modal-body' });
  if (!isExercise && _cols.meal >= 0) {
    const mealSel = el('select', { className: 'calorie-serving-meal' },
      MEAL_TYPES.map(m => el('option', { value: m }, [m])));
    mealSel.value = canon(entry.row[_cols.meal] || 'Snacks');
    rows.push({ col: _cols.meal, input: mealSel });
    body.append(el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Meal']), mealSel]));
  }
  body.append(field('Name', _cols.item, { type: 'text' }));
  if (_cols.qty >= 0) body.append(field('Qty', _cols.qty, { type: 'number', min: '0', step: 'any' }));
  if (isExercise) {
    body.append(field('Calories burned', _cols.burned, { type: 'number', min: '0' }));
  } else {
    if (_cols.calories >= 0) body.append(field('Calories', _cols.calories, { type: 'number', min: '0', step: 'any' }));
    if (_cols.protein >= 0) body.append(field('Protein (g)', _cols.protein, { type: 'number', min: '0', step: 'any' }));
    if (_cols.carbs >= 0) body.append(field('Carbs (g)', _cols.carbs, { type: 'number', min: '0', step: 'any' }));
    if (_cols.fat >= 0) body.append(field('Fat (g)', _cols.fat, { type: 'number', min: '0', step: 'any' }));
  }

  /* ---- Quantity → macro auto-scaling (for food entries) ---- */
  // Editing Qty rescales calories + macros proportionally from the item's
  // per-unit base, so bumping a serving from 1→2 doubles everything. A macro
  // the user types into by hand is "pinned" and no longer auto-scaled.
  if (!isExercise && _cols.qty >= 0) {
    const qtyInput = inputByCol.get(_cols.qty);
    const baseQty = parseNum(entry.row[_cols.qty]) || 1;
    const macroCols = [
      { col: _cols.calories, round: (n) => String(Math.round(n)) },
      { col: _cols.protein, round: (n) => String(round1(n)) },
      { col: _cols.carbs, round: (n) => String(round1(n)) },
      { col: _cols.fat, round: (n) => String(round1(n)) },
    ].filter(m => m.col >= 0);
    // Per-unit base for each macro, captured from the original logged values.
    for (const m of macroCols) {
      m.input = inputByCol.get(m.col);
      m.perUnit = (parseNum(entry.row[m.col]) || 0) / baseQty;
      m.pinned = false;
      // A manual edit pins the field so scaling won't clobber it.
      m.input.addEventListener('input', () => { m.pinned = true; });
    }
    if (qtyInput) {
      const scaleHint = el('div', { className: 'calorie-scale-hint' }, ['Calories & macros scale with quantity']);
      qtyInput.insertAdjacentElement('afterend', scaleHint);
      qtyInput.addEventListener('input', () => {
        const newQty = parseNum(qtyInput.value);
        if (newQty <= 0) return;
        for (const m of macroCols) {
          if (m.pinned) continue;
          m.input.value = m.round(m.perUnit * newQty);
        }
      });
    }
  }

  const saveBtn = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['Save changes']);
  saveBtn.addEventListener('click', async () => {
    for (const { col, input } of rows) {
      if (col < 0) continue;
      const newVal = String(input.value);
      if (newVal !== (entry.row[col] || '')) await updateEntryCell(entry.index, col, newVal);
    }
    close();
    showToast('Updated', 'success');
    await reload();
  });

  const delBtn = el('button', { className: 'calorie-entry-delete', type: 'button' }, ['\uD83D\uDDD1 Delete']);
  delBtn.addEventListener('click', async () => { close(); await deleteEntry(entry.index); });

  body.append(el('div', { className: 'calorie-entry-actions' }, [delBtn]), saveBtn);
  modal.append(header, body);
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
}

/* Confirm handler shared by voice (food + exercise items). */
function logItem(item) {
  if (item.type === 'exercise') return appendEntry({ ...item, type: 'exercise' });
  return appendEntry({ ...item, type: 'food' });
}
const foodConfirm = (entry) => appendEntry({ ...entry, type: 'food' });

/* ---------- Rings ---------- */

function buildRing(consumed, goal, centerTop, centerBottom, cls = '') {
  const r = 52, c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(consumed / goal, 1) : 0;
  const over = goal > 0 && consumed > goal;
  const svg = svgEl('svg', { viewBox: '0 0 120 120', class: `calorie-ring-svg ${cls}` });
  svg.append(svgEl('circle', { cx: '60', cy: '60', r: String(r), class: 'calorie-ring-track', fill: 'none' }));
  svg.append(svgEl('circle', {
    cx: '60', cy: '60', r: String(r), fill: 'none',
    class: `calorie-ring-fill ${over ? 'calorie-ring-over' : ''}`,
    'stroke-dasharray': `${(pct * c).toFixed(1)} ${c.toFixed(1)}`,
    transform: 'rotate(-90 60 60)', 'stroke-linecap': 'round',
  }));
  const txt = svgEl('text', { x: '60', y: '56', class: 'calorie-ring-num', 'text-anchor': 'middle' }, [String(centerTop)]);
  const sub = svgEl('text', { x: '60', y: '74', class: 'calorie-ring-lbl', 'text-anchor': 'middle' }, [centerBottom]);
  svg.append(txt, sub);
  return svg;
}

function buildMacroRing(label, value, goal, color) {
  const r = 26, c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  const svg = svgEl('svg', { viewBox: '0 0 64 64', class: 'calorie-macroring-svg' });
  svg.append(svgEl('circle', { cx: '32', cy: '32', r: String(r), class: 'calorie-ring-track', fill: 'none' }));
  svg.append(svgEl('circle', {
    cx: '32', cy: '32', r: String(r), fill: 'none', stroke: color,
    class: 'calorie-macroring-fill',
    'stroke-dasharray': `${(pct * c).toFixed(1)} ${c.toFixed(1)}`,
    transform: 'rotate(-90 32 32)', 'stroke-linecap': 'round',
  }));
  return el('div', { className: 'calorie-macroring' }, [
    svg,
    el('div', { className: 'calorie-macroring-info' }, [
      el('span', { className: 'calorie-macroring-val' }, [`${Math.round(value)}`]),
      el('span', { className: 'calorie-macroring-goal' }, [goal > 0 ? `/${goal}g` : 'g']),
      el('span', { className: 'calorie-macroring-lbl' }, [label]),
    ]),
  ]);
}

/* ---------- Header: date nav + timeframe ---------- */

function buildHeaderBar(dateMap) {
  /* Timeframe segmented control */
  const seg = el('div', { className: 'calorie-segmented' },
    [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([v, l]) => {
      const b = el('button', { className: `calorie-seg-btn ${_timeframe === v ? 'active' : ''}`, type: 'button' }, [l]);
      b.addEventListener('click', () => { _timeframe = v; reload(); });
      return b;
    }));

  const tools = el('div', { className: 'calorie-tools' }, [
    (() => { const b = el('button', { className: 'calorie-tool-btn', type: 'button', 'aria-label': 'Voice log' }, ['\uD83C\uDF99\uFE0F']);
      b.addEventListener('click', () => openVoiceModal({ onConfirm: logItem })); return b; })(),
    (() => { const b = el('button', { className: 'calorie-tool-btn', type: 'button', 'aria-label': 'Profile & goal' }, ['\u2699\uFE0F']);
      b.addEventListener('click', openProfile); return b; })(),
  ]);

  const top = el('div', { className: 'calorie-topbar' }, [seg, tools]);

  if (_timeframe !== 'day') return el('div', {}, [top]);

  /* Date nav (day view only) */
  const prev = el('button', { className: 'calorie-datenav-btn', type: 'button', 'aria-label': 'Previous day' }, ['\u2039']);
  const next = el('button', { className: 'calorie-datenav-btn', type: 'button', 'aria-label': 'Next day' }, ['\u203A']);
  const label = el('button', { className: 'calorie-datenav-label', type: 'button' }, [prettyDate(_activeDate)]);
  prev.addEventListener('click', () => { _activeDate = shiftDate(_activeDate, -1); reload(); });
  next.addEventListener('click', () => { _activeDate = shiftDate(_activeDate, 1); reload(); });
  label.addEventListener('click', () => { _activeDate = today(); reload(); });
  const nav = el('div', { className: 'calorie-datenav' }, [prev, label, next]);

  return el('div', {}, [top, nav]);
}

/* ---------- Day view ---------- */

function canon(meal) {
  const m = (meal || '').toLowerCase();
  if (/break/.test(m)) return 'Breakfast';
  if (/lunch|midday/.test(m)) return 'Lunch';
  if (/dinner|supper|evening/.test(m)) return 'Dinner';
  return 'Snacks';
}

function openActionSheet(mealType) {
  const overlay = el('div', { className: 'calorie-modal-overlay' });
  const sheet = el('div', { className: 'calorie-actionsheet' });
  const close = () => overlay.remove();
  const mk = (label, handler) => {
    const b = el('button', { className: 'calorie-actionsheet-btn', type: 'button' }, [label]);
    b.addEventListener('click', () => { close(); handler(); });
    return b;
  };
  sheet.append(
    el('div', { className: 'calorie-actionsheet-title' }, [`Add to ${mealType}`]),
    mk('\uD83D\uDD0D  Search foods', async () => {
      const foods = await loadFoodDatabase();
      const customDb = customFoodsFromRows(_allRows, _cols);
      openFoodSearchModal({ mealType, foods, customDb, onConfirm: foodConfirm });
    }),
    mk('\u2016  Scan barcode', () => openBarcodeScanner({ mealType, onConfirm: foodConfirm })),
    mk('\uD83D\uDCF7  Photo AI', () => openAiScanModal({ mealType, onConfirm: foodConfirm })),
    mk('\uD83C\uDF99\uFE0F  Speak', () => openVoiceModal({ onConfirm: logItem })),
  );
  overlay.append(sheet);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
}

function buildMealSection(mealType, dayRows, totals) {
  const bucket = totals.byMeal[mealType];
  const collapsed = _collapsed.has(mealType);

  const addBtn = el('button', { className: 'calorie-meal-add', type: 'button', 'aria-label': `Add to ${mealType}` }, ['+']);
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); openActionSheet(mealType); });

  const header = el('div', { className: 'calorie-meal-header' }, [
    el('span', { className: 'calorie-meal-caret' }, [collapsed ? '\u25B8' : '\u25BE']),
    el('span', { className: 'calorie-meal-name' }, [mealType]),
    el('span', { className: 'calorie-meal-cal' }, [`${bucket.calories}`]),
    addBtn,
  ]);
  header.addEventListener('click', () => {
    if (_collapsed.has(mealType)) _collapsed.delete(mealType); else _collapsed.add(mealType);
    reload();
  });

  const section = el('div', { className: `calorie-meal ${collapsed ? 'calorie-collapsed' : ''}` }, [header]);
  if (collapsed) return section;

  const body = el('div', { className: 'calorie-meal-body' });
  const items = dayRows.filter(({ row }) => {
    const meal = (row[_cols.meal] || '').trim();
    return parseNum(row[_cols.burned]) === 0 && meal.toLowerCase() !== 'exercise' && canon(meal) === mealType;
  });
  if (!items.length) {
    body.append(el('div', { className: 'calorie-empty-row' }, ['Nothing yet — tap +']));
  } else {
    for (const entry of items) {
      const row = entry.row;
      const name = row[_cols.item] || '\u2014';
      const serving = [_cols.qty >= 0 ? row[_cols.qty] : '', _cols.unit >= 0 ? row[_cols.unit] : ''].filter(Boolean).join(' ');
      const rowEl = el('div', { className: 'calorie-food-row calorie-food-row-tap', role: 'button', tabindex: '0', title: 'Edit or delete' }, [
        el('span', { className: 'calorie-food-name' }, [name]),
        serving ? el('span', { className: 'calorie-food-serving' }, [serving]) : null,
        el('span', { className: 'calorie-food-cal' }, [`${parseNum(row[_cols.calories])}`]),
        el('span', { className: 'calorie-food-edit', 'aria-hidden': 'true' }, ['\u203A']),
      ]);
      rowEl.addEventListener('click', () => openEntryEditor(entry, false));
      body.append(rowEl);
    }
  }
  section.append(body);
  return section;
}

function buildExerciseSection(dayRows, totals) {
  const header = el('div', { className: 'calorie-meal-header calorie-exercise-header' }, [
    el('span', { className: 'calorie-meal-name' }, ['\uD83C\uDFC3 Exercise']),
    el('span', { className: 'calorie-meal-cal calorie-burned' }, [`+${totals.burned}`]),
  ]);
  const body = el('div', { className: 'calorie-meal-body' });
  const items = dayRows.filter(({ row }) =>
    parseNum(row[_cols.burned]) > 0 || (row[_cols.meal] || '').trim().toLowerCase() === 'exercise');
  if (!items.length) {
    body.append(el('div', { className: 'calorie-empty-row' }, ['No workouts logged']));
  } else {
    for (const entry of items) {
      const row = entry.row;
      const name = row[_cols.item] || 'Activity';
      const dur = _cols.qty >= 0 && row[_cols.qty] ? ` \u00B7 ${row[_cols.qty]} min` : '';
      const rowEl = el('div', { className: 'calorie-food-row calorie-food-row-tap', role: 'button', tabindex: '0', title: 'Edit or delete' }, [
        el('span', { className: 'calorie-food-name' }, [name + dur]),
        el('span', { className: 'calorie-food-cal calorie-burned' }, [`+${parseNum(row[_cols.burned])}`]),
        el('span', { className: 'calorie-food-edit', 'aria-hidden': 'true' }, ['\u203A']),
      ]);
      rowEl.addEventListener('click', () => openEntryEditor(entry, true));
      body.append(rowEl);
    }
  }
  const addBtn = el('button', { className: 'calorie-action calorie-action-exercise', type: 'button' }, ['+ Log exercise']);
  addBtn.addEventListener('click', () => openExerciseModal({ onConfirm: (e) => appendEntry({ ...e, type: 'exercise' }) }));
  const speakBtn = el('button', { className: 'calorie-action calorie-action-voice', type: 'button' }, ['\uD83C\uDF99\uFE0F Speak']);
  speakBtn.addEventListener('click', () => openVoiceModal({ onConfirm: logItem }));
  body.append(el('div', { className: 'calorie-actions' }, [addBtn, speakBtn]));
  return el('div', { className: 'calorie-meal calorie-exercise' }, [header, body]);
}

/* ---------- Hero carousel ---------- */

/**
 * Build a horizontally swipeable hero carousel from a list of pages.
 * Uses native CSS scroll-snap so touch/trackpad swipes feel native, with a
 * synced dot indicator. Remembers the active page across reloads via _heroPage.
 * @param {{key:string, node:HTMLElement}[]} pages
 * @returns {HTMLElement}
 */
function buildHeroCarousel(pages) {
  const track = el('div', { className: 'calorie-hero-track' },
    pages.map(p => el('div', { className: 'calorie-hero-page', 'data-page': p.key }, [p.node])));

  const dots = el('div', { className: 'calorie-hero-dots' },
    pages.map((p, i) => {
      const dot = el('button', {
        className: `calorie-hero-dot ${i === _heroPage ? 'active' : ''}`,
        type: 'button', 'aria-label': `Show ${p.key}`,
      });
      dot.addEventListener('click', () => {
        const page = track.children[i];
        if (page) track.scrollTo({ left: page.offsetLeft, behavior: 'smooth' });
      });
      return dot;
    }));

  // Sync dots + remember the page as the user scrolls/swipes.
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const idx = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      _heroPage = Math.max(0, Math.min(pages.length - 1, idx));
      [...dots.children].forEach((d, i) => d.classList.toggle('active', i === _heroPage));
    });
  }, { passive: true });

  // Carousel owns horizontal swipes — stop them bubbling to the day-nav swipe.
  track.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  track.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });

  const carousel = el('div', { className: 'calorie-hero calorie-hero-carousel' }, [track, dots]);

  // Restore the remembered page after the element is laid out.
  requestAnimationFrame(() => {
    const page = track.children[_heroPage];
    if (page) track.scrollLeft = page.offsetLeft;
  });

  return carousel;
}

/** Compact 7-day calorie sparkline for the hero carousel. */
function buildTrendPage(dateMap, target) {
  const series = buildSeries(dateMap, _cols, _activeDate || today(), 7);
  const chart = el('div', { className: 'calorie-hero-spark' });
  drawLineChart(chart, {
    labels: series.labels,
    series: [
      { name: 'Calories', values: series.food, color: '#ef4444' },
      { name: 'Goal', values: series.food.map(() => target), color: '#94a3b8' },
    ],
  }, { height: 150, title: '7-day calories' });
  return el('div', { className: 'calorie-hero-trend' }, [chart]);
}

function renderDayView(container, dateMap) {
  const dayEntries = dateMap.get(_activeDate) || [];
  const rowsOnly = dayEntries.map(e => e.row);
  const totals = computeDayTotals(rowsOnly, _cols);
  const { target, macros } = resolveGoals(rowsOnly);
  const net = computeNet(target, totals.food, totals.burned);

  /* Page 1 — budget ring + equation */
  const remainClass = net.remaining < 0 ? 'calorie-ring-over' : '';
  const ring = buildRing(net.food, target + net.burned,
    Math.abs(net.remaining), net.remaining < 0 ? 'over' : 'left', remainClass);
  const eqLine = el('div', { className: 'calorie-eqline' }, [
    el('span', {}, [`${target} goal`]),
    el('span', { className: 'calorie-eq-op' }, ['\u2212']),
    el('span', {}, [`${net.food} food`]),
    el('span', { className: 'calorie-eq-op' }, ['+']),
    el('span', {}, [`${net.burned} exercise`]),
  ]);
  const ringPage = el('div', { className: 'calorie-hero-ring' }, [ring, eqLine]);

  /* Page 2 — living garden (persists: derived from logged rows + saved goal) */
  const series30 = buildSeries(dateMap, _cols, _activeDate, 30);
  const adh = adherenceScore(series30, target);
  persistBestStreak(adh.streak);
  const mascot = buildMascot(growthStage(adh), { ...adh, bestStreak: bestStreak() });

  /* Page 3 — macro rings */
  const macrorings = el('div', { className: 'calorie-macrorings' }, [
    buildMacroRing('Protein', totals.protein, macros.protein, '#6366f1'),
    buildMacroRing('Carbs', totals.carbs, macros.carbs, '#f59e0b'),
    buildMacroRing('Fat', totals.fat, macros.fat, '#ec4899'),
  ]);

  /* Page 4 — 7-day trend sparkline */
  const trend = buildTrendPage(dateMap, target);

  const carousel = buildHeroCarousel([
    { key: 'Budget', node: ringPage },
    { key: 'Garden', node: mascot },
    { key: 'Macros', node: macrorings },
    { key: 'Trend', node: trend },
  ]);
  container.append(carousel);

  /* Global quick actions (compact) */
  const quick = el('div', { className: 'calorie-quickbar' }, [
    quickBtn('\uD83C\uDF99\uFE0F', 'Speak', () => openVoiceModal({ onConfirm: logItem })),
    quickBtn('\uD83D\uDCF7', 'Photo', () => openAiScanModal({ mealType: 'Snacks', onConfirm: foodConfirm })),
    quickBtn('\u2016', 'Barcode', () => openBarcodeScanner({ mealType: 'Snacks', onConfirm: foodConfirm })),
    quickBtn('\uD83C\uDFC3', 'Exercise', () => openExerciseModal({ onConfirm: (e) => appendEntry({ ...e, type: 'exercise' }) })),
  ]);
  container.append(quick);

  /* Meals — two columns on wide screens via .calorie-meals-grid */
  const mealsGrid = el('div', { className: 'calorie-meals-grid' });
  for (const mealType of MEAL_TYPES) mealsGrid.append(buildMealSection(mealType, dayEntries, totals));
  mealsGrid.append(buildExerciseSection(dayEntries, totals));
  container.append(mealsGrid);
}

function quickBtn(icon, label, handler) {
  const b = el('button', { className: 'calorie-quick', type: 'button' }, [
    el('span', { className: 'calorie-quick-icon' }, [icon]),
    el('span', { className: 'calorie-quick-lbl' }, [label]),
  ]);
  b.addEventListener('click', handler);
  return b;
}

/* ---------- Week / Month view ---------- */

function renderTrendView(container, dateMap) {
  const days = _timeframe === 'week' ? 7 : 30;
  const series = buildSeries(dateMap, _cols, _activeDate || today(), days);
  const avg = averageSeries(series);
  const rowsOnly = (dateMap.get(_activeDate) || []).map(e => e.row);
  const { target, macros } = resolveGoals(rowsOnly);
  const adh = adherenceScore(series, target);

  /* Summary + mascot */
  const summary = el('div', { className: 'calorie-avg-summary' }, [
    el('div', { className: 'calorie-avg-hero' }, [
      el('span', { className: 'calorie-avg-num' }, [String(avg.food)]),
      el('span', { className: 'calorie-avg-lbl' }, [`avg cal/day · goal ${target}`]),
      el('span', { className: `calorie-avg-delta ${avg.food <= target ? 'ok' : 'over'}` },
        [avg.loggedDays ? `${avg.food - target >= 0 ? '+' : ''}${avg.food - target} vs goal` : 'No data yet']),
    ]),
    buildMascot(growthStage(adh), adh),
  ]);
  container.append(summary);

  /* Trend chart + stats — side by side on desktop via .calorie-trend-grid */
  const chartWrap = el('div', { className: 'calorie-chart' });
  drawLineChart(chartWrap, {
    labels: series.labels,
    series: [
      { name: 'Calories', values: series.food, color: '#ef4444' },
      { name: 'Goal', values: series.food.map(() => target), color: '#94a3b8' },
    ],
  }, { height: 220, title: `${_timeframe === 'week' ? '7' : '30'}-day calories` });

  const statsBox = el('div', { className: 'calorie-avg-stats' }, [
    stat('Logged days', `${avg.loggedDays}/${days}`),
    stat('Avg burned', `${avg.burned} cal`),
    stat('Best streak', `${adh.streak} d`),
    stat('On target', `${adh.onTrackDays}/${adh.loggedDays || 0}`),
  ]);
  container.append(el('div', { className: 'calorie-trend-grid' }, [chartWrap, statsBox]));

  /* Average macros */
  container.append(el('div', { className: 'calorie-macrorings' }, [
    buildMacroRing('Protein', avg.protein, macros.protein, '#6366f1'),
    buildMacroRing('Carbs', avg.carbs, macros.carbs, '#f59e0b'),
    buildMacroRing('Fat', avg.fat, macros.fat, '#ec4899'),
  ]));
}

function stat(label, value) {
  return el('div', { className: 'calorie-stat' }, [
    el('span', { className: 'calorie-stat-val' }, [value]),
    el('span', { className: 'calorie-stat-lbl' }, [label]),
  ]);
}

/* ---------- Profile ---------- */

function openProfile() {
  openProfileModal({
    profile: _profile,
    onSave: async (prof) => {
      // Preserve any existing bestStreak when the user re-saves their profile.
      _profile = { ...(_profile || {}), ...prof };
      const g = goalFromProfile(_profile);
      showToast(g ? `Goal set: ${g.calories} cal/day — saved to your sheet` : 'Profile saved', 'success');
      await persistProfile(_profile);
      reload();
    },
  });
}

/* ---------- Swipe (day nav) ---------- */

function attachSwipe(container) {
  let x0 = null, y0 = null;
  container.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  container.addEventListener('touchend', (e) => {
    if (x0 == null || _timeframe !== 'day') { x0 = null; return; }
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      _activeDate = shiftDate(_activeDate, dx < 0 ? 1 : -1);
      reload();
    }
    x0 = null;
  }, { passive: true });
}

/* ---------- Core render ---------- */

function renderDashboard(container, rows, cols) {
  _container = container;
  _cols = cols;
  _allRows = rows;
  container.innerHTML = '';
  container.classList.add('calorie-root');

  const dateMap = groupByDate(rows, cols);
  if (!_activeDate || (_timeframe === 'day' && !dateMap.has(_activeDate) && _activeDate !== today())) {
    _activeDate = latestDate(dateMap) || today();
  }
  if (!_activeDate) _activeDate = today();

  container.append(buildHeaderBar(dateMap));
  if (_timeframe === 'day') renderDayView(container, dateMap);
  else renderTrendView(container, dateMap);
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
    _activeDate = null;
    _timeframe = 'day';
    _collapsed = new Set();
    _numericSheetId = 0;
    _heroPage = 0;
    // Workbook tabs are injected by checklist.js (renderWithTemplate → _tabs).
    _tabs = Array.isArray(definition._tabs) ? definition._tabs : [];
    // Profile persists in the sheet's "Profile" tab (durable, cross-device).
    // Fall back to the localStorage cache for sheets saved before this feature.
    const sid = currentSheetId();
    _profile = readProfileFromTabs() || getCalorieProfile(sid);
    // If the profile came from the sheet, refresh the local cache so offline
    // reads stay consistent.
    if (_profile && sid) setCalorieProfile(sid, _profile);
    renderDashboard(container, rows, cols);
    attachSwipe(container);
    // Fetch the numeric tab id in the background so row deletion works even
    // before the first append/edit reload (mock mode defaults to 0).
    if (sid) {
      getSheetData(sid).then(d => { if (d && d.numericSheetId != null) _numericSheetId = d.numericSheetId; }).catch(() => {});
    }
  },
};

registerTemplate('calorie', definition);
export default definition;
