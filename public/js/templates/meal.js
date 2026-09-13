/* ============================================================
   templates/meal.js — Meal Planner

   Upgraded: tied into the shared nutrition engine (food search with
   auto macros), a customizable daily calorie target, and multiple
   views — Days (grouped cards), Week (day × meal grid) and Macros
   (calorie/protein trend chart). All fields remain editable inline.
   ============================================================ */

import {
  el, cell, editableCell, groupByColumn, delegateEvent, registerTemplate,
  buildDirSyncBtn, showToast,
  loadFoodDatabase, searchFoodDatabase, scaleMacros,
  appendSheetRows, getSheetData, drawBarChart,
  getTemplatePref, setTemplatePref,
} from './shared.js';

/** Parse int from strings like "350" or "12g" */
function parseNum(v) { return parseInt(v) || 0; }

const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

/* ---------- Module state (for add + reload) ---------- */

let _container = null;
let _cols = null;
let _rows = [];
let _view = 'days';           // 'days' | 'week' | 'macros'
let _sheetId = null;
let _sheetTitle = 'Sheet1';
let _totalCols = 5;

function currentSheetId() {
  const m = (window.location.hash || '').match(/#\/(?:sheet|public)\/([^/?#]+)/);
  return m ? m[1] : null;
}

function targetKey() { return `meal_target_${_sheetId || 'default'}`; }
function getTarget() { return parseNum(getTemplatePref(targetKey())) || 0; }

async function reloadMeal() {
  if (!_sheetId || !_container) return;
  try {
    const data = await getSheetData(_sheetId);
    _sheetTitle = data.sheetTitle || _sheetTitle;
    const values = data.values || [];
    _totalCols = (values[0] || []).length || _totalCols;
    _rows = values.slice(1);
    renderView();
  } catch { /* keep current view */ }
}

/* ---------- Add meal via food search ---------- */

function openAddMealModal() {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' });
  const close = () => overlay.remove();
  const header = el('div', { className: 'modal-header' }, [
    el('span', { className: 'meal-modal-title' }, ['Add meal']),
    el('button', { className: 'meal-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  header.querySelector('.meal-modal-close').addEventListener('click', close);

  const dayInput = el('input', { className: 'meal-add-day', type: 'text', placeholder: 'Day (e.g. Monday)' });
  const mealSel = el('select', { className: 'meal-select' },
    MEAL_ORDER.map(m => el('option', { value: m }, [m])));
  const search = el('input', { className: 'meal-search-input', type: 'search', placeholder: 'Search foods…', autocomplete: 'off' });
  const results = el('div', { className: 'meal-search-results' });
  const detail = el('div', { className: 'meal-search-detail' });

  let foods = [];
  loadFoodDatabase().then(f => { foods = f; });

  function renderResults() {
    results.innerHTML = ''; detail.innerHTML = '';
    const matches = searchFoodDatabase(search.value, foods, [], 25);
    if (!search.value.trim()) return;
    if (!matches.length) { results.append(el('div', { className: 'meal-search-empty' }, ['No matches'])); return; }
    for (const food of matches) {
      const row = el('button', { className: 'meal-search-item', type: 'button' }, [
        el('span', { className: 'meal-search-item-name' }, [food.name]),
        el('span', { className: 'meal-search-item-cal' }, [`${food.kcal} cal / ${food.qty}${food.unit}`]),
      ]);
      row.addEventListener('click', () => showServing(food));
      results.append(row);
    }
  }

  function showServing(food) {
    detail.innerHTML = '';
    const qty = el('input', { className: 'meal-input meal-qty', type: 'number', min: '0', step: 'any', value: String(food.qty || 1) });
    const preview = el('div', { className: 'meal-serving-preview' });
    const render = () => {
      const m = scaleMacros(food, qty.value);
      preview.innerHTML = '';
      preview.append(
        el('span', { className: 'meal-macro meal-macro-cal' }, [`\uD83D\uDD25 ${m.calories} cal`]),
        el('span', { className: 'meal-macro' }, [`P ${m.protein}g`]),
      );
    };
    qty.addEventListener('input', render); render();
    const add = el('button', { className: 'meal-submit', type: 'button' }, ['Add to plan']);
    add.addEventListener('click', async () => {
      const m = scaleMacros(food, qty.value);
      await appendMealRow({
        day: dayInput.value.trim(), meal: mealSel.value,
        recipe: food.name, calories: m.calories, protein: m.protein,
      });
      close();
    });
    detail.append(
      el('div', { className: 'meal-serving-name' }, [food.name]),
      el('div', { className: 'meal-field-row' }, [el('label', {}, ['Qty']), qty, el('span', { className: 'meal-unit' }, [food.unit || ''])]),
      preview, add,
    );
  }

  search.addEventListener('input', renderResults);
  const manualBtn = el('button', { className: 'meal-search-custom', type: 'button' }, ['+ Custom meal']);
  manualBtn.addEventListener('click', () => { close(); openCustomMealModal(); });

  modal.append(header, el('div', { className: 'modal-body' }, [
    el('div', { className: 'meal-field-row' }, [el('label', {}, ['Day']), dayInput]),
    el('div', { className: 'meal-field-row' }, [el('label', {}, ['Meal']), mealSel]),
    search, manualBtn, results, detail,
  ]));
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  search.focus();
}

function openCustomMealModal() {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' });
  const close = () => overlay.remove();
  const header = el('div', { className: 'modal-header' }, [
    el('span', { className: 'meal-modal-title' }, ['Custom meal']),
    el('button', { className: 'meal-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  header.querySelector('.meal-modal-close').addEventListener('click', close);

  const day = el('input', { className: 'meal-add-day', type: 'text', placeholder: 'Day' });
  const mealSel = el('select', { className: 'meal-select' }, MEAL_ORDER.map(m => el('option', { value: m }, [m])));
  const recipe = el('input', { className: 'meal-input', type: 'text', placeholder: 'Dish name' });
  const cal = el('input', { className: 'meal-input', type: 'number', min: '0', placeholder: 'Calories' });
  const prot = el('input', { className: 'meal-input', type: 'number', min: '0', placeholder: 'Protein g' });
  const add = el('button', { className: 'meal-submit', type: 'button' }, ['Add to plan']);
  add.addEventListener('click', async () => {
    if (!recipe.value.trim()) { showToast('Enter a dish name', 'error'); return; }
    await appendMealRow({ day: day.value.trim(), meal: mealSel.value, recipe: recipe.value.trim(), calories: parseNum(cal.value), protein: parseNum(prot.value) });
    close();
  });
  modal.append(header, el('div', { className: 'modal-body' }, [
    el('div', { className: 'meal-field-row' }, [el('label', {}, ['Day']), day]),
    el('div', { className: 'meal-field-row' }, [el('label', {}, ['Meal']), mealSel]),
    el('div', { className: 'meal-field-row' }, [el('label', {}, ['Dish']), recipe]),
    el('div', { className: 'meal-field-row' }, [el('label', {}, ['Calories']), cal]),
    el('div', { className: 'meal-field-row' }, [el('label', {}, ['Protein']), prot]),
    add,
  ]));
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  recipe.focus();
}

async function appendMealRow({ day, meal, recipe, calories, protein }) {
  if (!_sheetId) { showToast('Open this sheet from your library to add', 'error'); return; }
  const width = Math.max(_totalCols, 5);
  const row = new Array(width).fill('');
  if (_cols.day >= 0) row[_cols.day] = day || '';
  if (_cols.meal >= 0) row[_cols.meal] = meal || '';
  if (_cols.recipe >= 0) row[_cols.recipe] = recipe || '';
  else row[0] = recipe || '';
  if (_cols.calories >= 0) row[_cols.calories] = String(calories || 0);
  if (_cols.protein >= 0) row[_cols.protein] = String(protein || 0);
  try {
    await appendSheetRows(_sheetId, _sheetTitle, [row]);
    showToast('Meal added', 'success');
    await reloadMeal();
  } catch (err) {
    showToast(err.message || 'Could not add', 'error');
  }
}

/* ---------- Target editor ---------- */

function openTargetModal() {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' });
  const close = () => overlay.remove();
  const input = el('input', { className: 'meal-input', type: 'number', min: '0', placeholder: 'e.g. 2000', value: getTarget() ? String(getTarget()) : '' });
  const save = el('button', { className: 'meal-submit', type: 'button' }, ['Save target']);
  save.addEventListener('click', () => {
    setTemplatePref(targetKey(), parseNum(input.value));
    close();
    renderView();
  });
  modal.append(
    el('div', { className: 'modal-header' }, [el('span', { className: 'meal-modal-title' }, ['Daily calorie target'])]),
    el('div', { className: 'modal-body' }, [
      el('div', { className: 'meal-field-row' }, [el('label', {}, ['Target']), input, el('span', { className: 'meal-unit' }, ['cal/day'])]),
      save,
    ]),
  );
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  input.focus();
}

/* ---------- Views ---------- */

function buildChrome() {
  const seg = el('div', { className: 'meal-seg' },
    [['days', 'Days'], ['week', 'Week'], ['macros', 'Macros']].map(([v, l]) => {
      const b = el('button', { className: `meal-seg-btn ${_view === v ? 'active' : ''}`, type: 'button' }, [l]);
      b.addEventListener('click', () => { _view = v; renderView(); });
      return b;
    }));
  const addBtn = el('button', { className: 'meal-add-btn', type: 'button' }, ['+ Add meal']);
  addBtn.addEventListener('click', openAddMealModal);
  return el('div', { className: 'meal-chrome' }, [seg, addBtn]);
}

function buildSummary() {
  let totalCal = 0, totalProt = 0;
  for (const row of _rows) {
    totalCal += parseNum(cell(row, _cols.calories));
    totalProt += parseNum(cell(row, _cols.protein));
  }
  const groups = groupByColumn(_rows, _cols.day, 'Unplanned');
  const dayCount = groups.size || 1;
  const avgCal = Math.round(totalCal / dayCount);
  const target = getTarget();

  const items = [];
  items.push(summaryItem('Total Meals', String(_rows.length)));
  if (_cols.calories >= 0) {
    items.push(summaryItem('Total Calories', `\uD83D\uDD25 ${totalCal.toLocaleString()}`, 'meal-summary-cal'));
    items.push(summaryItem('Daily Average', `${avgCal} cal/day`));
  }
  if (_cols.protein >= 0) items.push(summaryItem('Total Protein', `\uD83D\uDCAA ${totalProt}g`, 'meal-summary-prot'));

  const targetBtn = el('button', { className: 'meal-target-btn', type: 'button' },
    [target ? `\uD83C\uDFAF ${avgCal}/${target} cal` : '\uD83C\uDFAF Set target']);
  targetBtn.addEventListener('click', openTargetModal);
  items.push(el('div', { className: 'meal-summary-item' }, [targetBtn]));

  const bar = el('div', { className: 'meal-summary' }, items);
  if (target > 0) {
    const pct = Math.min(100, Math.round((avgCal / target) * 100));
    bar.append(el('div', { className: 'meal-target-bar' }, [
      el('div', { className: `meal-target-fill ${avgCal > target ? 'over' : ''}`, style: { width: `${pct}%` } }),
    ]));
  }
  return bar;
}

function summaryItem(label, value, valueCls = '') {
  return el('div', { className: 'meal-summary-item' }, [
    el('span', { className: 'meal-summary-label' }, [label]),
    el('span', { className: `meal-summary-value ${valueCls}` }, [value]),
  ]);
}

function renderDaysView(container) {
  const groups = groupByColumn(_rows, _cols.day, 'Unplanned');
  for (const [day, dayItems] of groups) {
    let dayCalories = 0, dayProtein = 0;
    for (const { row } of dayItems) {
      dayCalories += parseNum(cell(row, _cols.calories));
      dayProtein += parseNum(cell(row, _cols.protein));
    }
    const section = el('div', { className: 'meal-day' });
    section.append(el('div', { className: 'meal-day-header' }, [
      el('span', { className: 'meal-day-label' }, [day]),
      el('span', { className: 'meal-day-macros' }, [
        _cols.calories >= 0 ? `\uD83D\uDD25 ${dayCalories} cal` : '',
        _cols.protein >= 0 ? ` \u00B7 \uD83D\uDCAA ${dayProtein}` : '',
      ]),
    ]));
    for (const { row, originalIndex } of dayItems) {
      const rowIdx = originalIndex + 1;
      const meal = cell(row, _cols.meal);
      const recipe = cell(row, _cols.recipe) || row[0] || '\u2014';
      const calv = cell(row, _cols.calories);
      const prot = cell(row, _cols.protein);
      section.append(el('div', { className: 'meal-card' }, [
        _cols.meal >= 0 ? editableCell('span', { className: 'meal-type-badge' }, meal, rowIdx, _cols.meal) : null,
        editableCell('span', { className: 'meal-recipe' }, recipe, rowIdx, _cols.recipe),
        el('div', { className: 'meal-macros' }, [
          _cols.calories >= 0 ? editableCell('span', { className: 'meal-cal' }, calv, rowIdx, _cols.calories) : null,
          _cols.protein >= 0 ? editableCell('span', { className: 'meal-prot' }, prot, rowIdx, _cols.protein) : null,
        ]),
      ]));
    }
    container.append(section);
  }
}

function renderWeekView(container) {
  const groups = groupByColumn(_rows, _cols.day, 'Unplanned');
  const grid = el('div', { className: 'meal-week-grid' });
  // Header row
  grid.append(el('div', { className: 'meal-week-cell meal-week-head' }, ['Day']));
  for (const m of MEAL_ORDER) grid.append(el('div', { className: 'meal-week-cell meal-week-head' }, [m]));
  grid.append(el('div', { className: 'meal-week-cell meal-week-head' }, ['Total']));

  for (const [day, dayItems] of groups) {
    grid.append(el('div', { className: 'meal-week-cell meal-week-day' }, [day]));
    const byMeal = { Breakfast: 0, Lunch: 0, Dinner: 0, Snack: 0 };
    let total = 0;
    for (const { row } of dayItems) {
      const cal = parseNum(cell(row, _cols.calories));
      total += cal;
      const m = (cell(row, _cols.meal) || '').toLowerCase();
      if (/break/.test(m)) byMeal.Breakfast += cal;
      else if (/lunch/.test(m)) byMeal.Lunch += cal;
      else if (/dinner|supper/.test(m)) byMeal.Dinner += cal;
      else byMeal.Snack += cal;
    }
    for (const m of MEAL_ORDER) {
      grid.append(el('div', { className: 'meal-week-cell' }, [byMeal[m] ? String(byMeal[m]) : '\u2014']));
    }
    grid.append(el('div', { className: 'meal-week-cell meal-week-total' }, [String(total)]));
  }
  container.append(grid);
}

function renderMacrosView(container) {
  const groups = groupByColumn(_rows, _cols.day, 'Unplanned');
  const labels = [], calVals = [];
  for (const [day, dayItems] of groups) {
    let cal = 0;
    for (const { row } of dayItems) cal += parseNum(cell(row, _cols.calories));
    labels.push(day.length > 8 ? day.slice(0, 8) : day);
    calVals.push(cal);
  }
  const chart = el('div', { className: 'meal-chart' });
  container.append(chart);
  if (labels.length) {
    drawBarChart(chart, { labels, values: calVals }, { height: 240, title: 'Calories per day', color: '#65a30d' });
  } else {
    chart.append(el('div', { className: 'meal-search-empty' }, ['No data to chart yet.']));
  }
}

function renderView() {
  if (!_container) return;
  _container.innerHTML = '';
  _container.append(buildChrome());
  _container.append(buildSummary());
  if (_view === 'week') renderWeekView(_container);
  else if (_view === 'macros') renderMacrosView(_container);
  else renderDaysView(_container);
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Meal Planner',
  icon: '🍽\uFE0F',
  color: '#65a30d',
  priority: 22,
  itemNoun: 'Meal',
  defaultHeaders: ['Day', 'Meal', 'Recipe', 'Calories', 'Protein'],

  detect(lower) {
    return lower.some(h => /^(meal|recipe|dish|food)/.test(h))
      && lower.some(h => /^(calorie|protein|carb|fat|macro|nutrition)/.test(h) || lower.some(h2 => /^(breakfast|lunch|dinner|snack)/.test(h2)));
  },

  columns(lower) {
    const cols = { meal: -1, day: -1, recipe: -1, calories: -1, protein: -1 };
    cols.meal     = lower.findIndex(h => /^(meal|type|course|time)/.test(h));
    cols.recipe   = lower.findIndex(h => /^(recipe|dish|food|name|description|what)/.test(h));
    if (cols.recipe === -1) cols.recipe = lower.findIndex((_, i) => i !== cols.meal);
    cols.day      = lower.findIndex(h => /^(day|date|when|weekday)/.test(h));
    cols.calories = lower.findIndex(h => /^(calorie|cal|kcal|energy)/.test(h));
    cols.protein  = lower.findIndex(h => /^(protein|prot)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'recipe',   label: 'Recipe',   colIndex: cols.recipe,   type: 'text',   placeholder: 'Dish name', required: true },
      { role: 'meal',     label: 'Meal',     colIndex: cols.meal,     type: 'select', options: ['Breakfast', 'Lunch', 'Dinner', 'Snack'] },
      { role: 'day',      label: 'Day',      colIndex: cols.day,      type: 'text',   placeholder: 'e.g. Monday' },
      { role: 'calories', label: 'Calories', colIndex: cols.calories, type: 'number', placeholder: '0' },
      { role: 'protein',  label: 'Protein',  colIndex: cols.protein,  type: 'number', placeholder: 'grams' },
    ];
  },

  render(container, rows, cols) {
    _container = container;
    _cols = cols;
    _rows = rows;
    _view = 'days';
    _sheetId = currentSheetId();
    _totalCols = Math.max(5, ...rows.map(r => r.length),
      cols.meal + 1, cols.recipe + 1, cols.day + 1, cols.calories + 1, cols.protein + 1);
    renderView();
  },

  directoryView(container, sheets, navigateFn) {
    const titleBar = el('div', { className: 'meal-dir-title-bar' }, [
      el('span', { className: 'meal-dir-title' }, ['\uD83C\uDF7D\uFE0F Meal Plans Overview']),
      buildDirSyncBtn(container),
    ]);
    container.append(titleBar);

    const sheetStats = [];
    let grandCal = 0, grandProt = 0, grandMeals = 0;
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      const calIdx = sheet.cols ? sheet.cols.calories : -1;
      const protIdx = sheet.cols ? sheet.cols.protein : -1;
      let cal = 0, prot = 0;
      for (const row of rows) {
        cal += parseNum(cell(row, calIdx));
        prot += parseNum(cell(row, protIdx));
      }
      grandCal += cal; grandProt += prot; grandMeals += rows.length;
      sheetStats.push({ id: sheet.id, title: sheet.name, meals: rows.length, cal, prot });
    }

    container.append(el('div', { className: 'meal-dir-totals' }, [
      el('span', {}, [`\uD83D\uDD25 ${grandCal.toLocaleString()} cal`]),
      el('span', {}, [`\uD83D\uDCAA ${grandProt}g protein`]),
      el('span', {}, [`${grandMeals} meals`]),
    ]));

    const grid = el('div', { className: 'meal-dir-grid' });
    for (const s of sheetStats) {
      grid.append(el('div', { className: 'meal-dir-card', dataset: { sheetId: s.id, sheetName: s.title } }, [
        el('div', { className: 'meal-dir-card-title' }, [s.title]),
        el('div', { className: 'meal-dir-card-stats' }, [
          el('span', {}, [`${s.meals} meals`]),
          el('span', { className: 'meal-dir-card-cal' }, [`\uD83D\uDD25 ${s.cal}`]),
          el('span', { className: 'meal-dir-card-prot' }, [`\uD83D\uDCAA ${s.prot}g`]),
        ]),
      ]));
    }
    container.append(grid);

    delegateEvent(grid, 'click', '.meal-dir-card', (e, card) => {
      navigateFn('sheet', card.dataset.sheetId, card.dataset.sheetName);
    });
  },
};

registerTemplate('meal', definition);
export default definition;
