/* ============================================================
   calorie/modal.js — Food search, serving adjustment & manual builder

   Modal dialogs for the Calorie & Fitness Tracker. Each dialog resolves
   by invoking an onConfirm callback with a fully-scaled food entry so the
   caller (index.js) can append it to the sheet.
   ============================================================ */

import { el, showToast } from '../shared.js';
import {
  searchFoodDatabase, scaleMacros, parseNum, round1, MEAL_TYPES,
  loadExerciseDatabase, searchExerciseDatabase, caloriesFromMet, DEFAULT_WEIGHT_KG,
} from './helpers.js';

/* ---------- Modal shell ---------- */

function buildShell(titleText) {
  const overlay = el('div', { className: 'calorie-modal-overlay' });
  const modal = el('div', { className: 'calorie-modal' });
  const header = el('div', { className: 'calorie-modal-header' }, [
    el('span', { className: 'calorie-modal-title' }, [titleText]),
    el('button', { className: 'calorie-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  const body = el('div', { className: 'calorie-modal-body' });
  modal.append(header, body);
  overlay.append(modal);

  const close = () => overlay.remove();
  header.querySelector('.calorie-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  document.body.appendChild(overlay);
  return { overlay, body, close };
}

/* ---------- Serving adjustment form ---------- */

/**
 * Build a serving-size editor for a chosen food. Live-updates the scaled
 * macro preview. Calls onConfirm({ name, qty, unit, calories, protein, carbs, fat }).
 */
function buildServingForm(food, mealType, onConfirm, close) {
  const wrap = el('div', { className: 'calorie-serving' });

  const mealSelect = el('select', { className: 'calorie-serving-meal' },
    MEAL_TYPES.map(m => el('option', { value: m }, [m])));
  mealSelect.value = mealType;

  const qtyInput = el('input', {
    className: 'calorie-serving-qty', type: 'number', min: '0', step: 'any',
    value: String(food.qty || 1),
  });
  const unitLabel = el('span', { className: 'calorie-serving-unit' }, [food.unit || 'serving']);

  const preview = el('div', { className: 'calorie-serving-preview' });
  const nameEl = el('div', { className: 'calorie-serving-name' }, [
    food.name, food.brand ? el('span', { className: 'calorie-serving-brand' }, [` \u00B7 ${food.brand}`]) : null,
  ]);

  function render() {
    const m = scaleMacros(food, parseNum(qtyInput.value));
    preview.innerHTML = '';
    preview.append(
      el('span', { className: 'calorie-macro calorie-macro-cal' }, [`\uD83D\uDD25 ${m.calories} cal`]),
      el('span', { className: 'calorie-macro' }, [`P ${m.protein}g`]),
      el('span', { className: 'calorie-macro' }, [`C ${m.carbs}g`]),
      el('span', { className: 'calorie-macro' }, [`F ${m.fat}g`]),
    );
  }
  qtyInput.addEventListener('input', render);
  render();

  const addBtn = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['Add to log']);
  addBtn.addEventListener('click', () => {
    const qty = parseNum(qtyInput.value);
    if (qty <= 0) { showToast('Enter a serving size', 'error'); return; }
    const m = scaleMacros(food, qty);
    onConfirm({
      name: food.name + (food.brand ? ` (${food.brand})` : ''),
      qty, unit: food.unit || 'serving',
      calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
      barcode: food.barcode || '',
      mealType: mealSelect.value,
    });
    close();
  });

  wrap.append(
    nameEl,
    el('div', { className: 'calorie-serving-row' }, [
      el('label', {}, ['Meal']), mealSelect,
    ]),
    el('div', { className: 'calorie-serving-row' }, [
      el('label', {}, ['Quantity']), qtyInput, unitLabel,
    ]),
    preview,
    addBtn,
  );
  return wrap;
}

/* ---------- Public: food search modal ---------- */

/**
 * @param {{ mealType:string, foods:Array, customDb?:Array, onConfirm:Function }} opts
 */
export function openFoodSearchModal({ mealType, foods, customDb = [], onConfirm }) {
  const { body, close } = buildShell(`Search food \u2014 ${mealType}`);

  const input = el('input', {
    className: 'calorie-search-input', type: 'search',
    placeholder: 'Search foods (e.g. chicken, banana)…', autocomplete: 'off',
  });
  const results = el('div', { className: 'calorie-search-results' });
  const detail = el('div', { className: 'calorie-search-detail' });

  function renderResults() {
    const matches = searchFoodDatabase(input.value, foods, customDb, 30);
    results.innerHTML = '';
    detail.innerHTML = '';
    if (!input.value.trim()) return;
    if (!matches.length) {
      results.append(el('div', { className: 'calorie-search-empty' }, ['No matches. Try “+ Custom food”.']));
      return;
    }
    for (const food of matches) {
      const row = el('button', {
        className: 'calorie-search-item', type: 'button',
      }, [
        el('span', { className: 'calorie-search-item-name' }, [
          food.name, food.brand ? el('span', { className: 'calorie-search-item-brand' }, [` ${food.brand}`]) : null,
        ]),
        el('span', { className: 'calorie-search-item-cal' }, [`${food.kcal} cal / ${food.qty}${food.unit}`]),
      ]);
      row.addEventListener('click', () => {
        detail.innerHTML = '';
        detail.append(buildServingForm(food, mealType, onConfirm, close));
        detail.scrollIntoView({ block: 'nearest' });
      });
      results.append(row);
    }
  }
  input.addEventListener('input', renderResults);

  const customBtn = el('button', { className: 'calorie-search-custom', type: 'button' }, ['+ Custom food']);
  customBtn.addEventListener('click', () => {
    close();
    openManualFoodModal({ mealType, onConfirm });
  });

  body.append(input, customBtn, results, detail);
  input.focus();
}

/* ---------- Public: direct serving modal (barcode / AI result) ---------- */

/**
 * @param {{ food:Object, mealType:string, onConfirm:Function }} opts
 */
export function openServingModal({ food, mealType, onConfirm }) {
  const { body, close } = buildShell('Add item');
  body.append(buildServingForm(food, mealType, onConfirm, close));
}

/* ---------- Public: manual food builder ---------- */

/**
 * @param {{ mealType:string, onConfirm:Function }} opts
 */
export function openManualFoodModal({ mealType, onConfirm }) {
  const { body, close } = buildShell(`Custom food \u2014 ${mealType}`);

  const mkField = (label, attrs) => {
    const inp = el('input', attrs);
    return { row: el('div', { className: 'calorie-serving-row' }, [el('label', {}, [label]), inp]), inp };
  };

  const name = mkField('Name', { className: 'calorie-manual-name', type: 'text', placeholder: 'e.g. Homemade chili' });
  const qty = mkField('Quantity', { className: 'calorie-manual-qty', type: 'number', min: '0', step: 'any', value: '1' });
  const unit = mkField('Unit', { className: 'calorie-manual-unit', type: 'text', value: 'serving' });
  const cal = mkField('Calories', { className: 'calorie-manual-cal', type: 'number', min: '0', step: 'any', placeholder: '0' });
  const prot = mkField('Protein (g)', { className: 'calorie-manual-prot', type: 'number', min: '0', step: 'any', placeholder: '0' });
  const carb = mkField('Carbs (g)', { className: 'calorie-manual-carb', type: 'number', min: '0', step: 'any', placeholder: '0' });
  const fat = mkField('Fat (g)', { className: 'calorie-manual-fat', type: 'number', min: '0', step: 'any', placeholder: '0' });

  const mealSelect = el('select', { className: 'calorie-serving-meal' },
    MEAL_TYPES.map(m => el('option', { value: m }, [m])));
  mealSelect.value = mealType;

  const submit = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['Add to log']);
  submit.addEventListener('click', () => {
    const nm = name.inp.value.trim();
    if (!nm) { showToast('Enter a food name', 'error'); return; }
    onConfirm({
      name: nm,
      qty: parseNum(qty.inp.value) || 1,
      unit: unit.inp.value.trim() || 'serving',
      calories: Math.round(parseNum(cal.inp.value)),
      protein: round1(parseNum(prot.inp.value)),
      carbs: round1(parseNum(carb.inp.value)),
      fat: round1(parseNum(fat.inp.value)),
      barcode: '',
      mealType: mealSelect.value,
    });
    close();
  });

  body.append(
    name.row,
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Meal']), mealSelect]),
    qty.row, unit.row, cal.row, prot.row, carb.row, fat.row,
    submit,
  );
  name.inp.focus();
}

/* ---------- Public: exercise logger ---------- */

/**
 * Exercise logger with searchable compendium (MET-based calorie estimate).
 * Selecting an activity auto-computes burned calories from
 * MET × bodyweight × duration; the user can still override the value.
 * @param {{ onConfirm:Function }} opts  onConfirm({ name, duration, burned })
 */
export function openExerciseModal({ onConfirm }) {
  const { body, close } = buildShell('Log exercise');

  let selectedMet = 0;

  const searchInput = el('input', {
    className: 'calorie-search-input', type: 'search', autocomplete: 'off',
    placeholder: 'Search activities (e.g. running, yoga, cycling)…',
  });
  const results = el('div', { className: 'calorie-search-results' });

  const name = el('input', { className: 'calorie-manual-name', type: 'text', placeholder: 'Activity name' });
  const weight = el('input', { className: 'calorie-manual-qty', type: 'number', min: '0', step: 'any', value: String(DEFAULT_WEIGHT_KG) });
  const duration = el('input', { className: 'calorie-manual-qty', type: 'number', min: '0', step: 'any', placeholder: 'minutes' });
  const burned = el('input', { className: 'calorie-manual-cal', type: 'number', min: '0', step: 'any', placeholder: 'calories burned' });

  const metNote = el('div', { className: 'calorie-ai-status' }, ['Search an activity or enter details manually.']);

  function recompute() {
    if (selectedMet > 0) {
      const kcal = caloriesFromMet(selectedMet, weight.value, duration.value);
      if (kcal > 0) {
        burned.value = String(kcal);
        metNote.textContent = `${selectedMet} MET × ${weight.value || DEFAULT_WEIGHT_KG} kg × ${duration.value || 0} min = ${kcal} cal`;
      }
    }
  }
  weight.addEventListener('input', recompute);
  duration.addEventListener('input', recompute);
  burned.addEventListener('input', () => { /* manual override — stop auto recompute */ selectedMet = 0; });

  let activities = [];
  loadExerciseDatabase().then(list => { activities = list; });

  searchInput.addEventListener('input', () => {
    const matches = searchExerciseDatabase(searchInput.value, activities, 25);
    results.innerHTML = '';
    if (!searchInput.value.trim()) return;
    if (!matches.length) {
      results.append(el('div', { className: 'calorie-search-empty' }, ['No matches — enter manually below.']));
      return;
    }
    for (const act of matches) {
      const row = el('button', { className: 'calorie-search-item', type: 'button' }, [
        el('span', { className: 'calorie-search-item-name' }, [
          act.name,
          act.category ? el('span', { className: 'calorie-search-item-brand' }, [` ${act.category}`]) : null,
        ]),
        el('span', { className: 'calorie-search-item-cal' }, [`${act.met} MET`]),
      ]);
      row.addEventListener('click', () => {
        name.value = act.name;
        selectedMet = act.met;
        results.innerHTML = '';
        searchInput.value = '';
        if (!duration.value) duration.focus();
        recompute();
      });
      results.append(row);
    }
  });

  const submit = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['Log & refund calories']);
  submit.addEventListener('click', () => {
    const nm = name.value.trim();
    const bn = Math.round(parseNum(burned.value));
    if (!nm) { showToast('Enter an activity name', 'error'); return; }
    if (bn <= 0) { showToast('Enter calories burned', 'error'); return; }
    onConfirm({ name: nm, duration: parseNum(duration.value), burned: bn });
    close();
  });

  body.append(
    searchInput,
    results,
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Activity']), name]),
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Body weight (kg)']), weight]),
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Duration (min)']), duration]),
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Calories burned']), burned]),
    metNote,
    submit,
  );
  searchInput.focus();
}
