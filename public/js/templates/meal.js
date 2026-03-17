/* ============================================================
   templates/meal.js — Meal Planner: all fields editable inline
   ============================================================ */

import { el, cell, editableCell, groupByColumn, delegateEvent, registerTemplate } from './shared.js';

/** Parse int from strings like "350" or "12g" */
function parseNum(v) { return parseInt(v) || 0; }

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
    /* ---------- Weekly totals summary ---------- */
    let totalCal = 0, totalProt = 0;
    for (const row of rows) {
      totalCal  += parseNum(cell(row, cols.calories));
      totalProt += parseNum(cell(row, cols.protein));
    }

    const groups = groupByColumn(rows, cols.day, 'Unplanned');
    const dayCount = groups.size || 1;
    const avgCal = Math.round(totalCal / dayCount);

    const summaryItems = [];
    summaryItems.push(el('div', { className: 'meal-summary-item' }, [
      el('span', { className: 'meal-summary-label' }, ['Total Meals']),
      el('span', { className: 'meal-summary-value' }, [String(rows.length)]),
    ]));
    if (cols.calories >= 0) {
      summaryItems.push(el('div', { className: 'meal-summary-item' }, [
        el('span', { className: 'meal-summary-label' }, ['Total Calories']),
        el('span', { className: 'meal-summary-value meal-summary-cal' }, [`\uD83D\uDD25 ${totalCal.toLocaleString()}`]),
      ]));
      summaryItems.push(el('div', { className: 'meal-summary-item' }, [
        el('span', { className: 'meal-summary-label' }, ['Daily Average']),
        el('span', { className: 'meal-summary-value' }, [`${avgCal} cal/day`]),
      ]));
    }
    if (cols.protein >= 0) {
      summaryItems.push(el('div', { className: 'meal-summary-item' }, [
        el('span', { className: 'meal-summary-label' }, ['Total Protein']),
        el('span', { className: 'meal-summary-value meal-summary-prot' }, [`\uD83D\uDCAA ${totalProt}g`]),
      ]));
    }
    container.append(el('div', { className: 'meal-summary' }, summaryItems));

    /* ---------- Day sections ---------- */
    for (const [day, dayItems] of groups) {
      let dayCalories = 0, dayProtein = 0;
      for (const { row } of dayItems) {
        dayCalories += parseNum(cell(row, cols.calories));
        dayProtein += parseNum(cell(row, cols.protein));
      }

      const section = el('div', { className: 'meal-day' });
      section.append(el('div', { className: 'meal-day-header' }, [
        el('span', { className: 'meal-day-label' }, [day]),
        el('span', { className: 'meal-day-macros' }, [
          cols.calories >= 0 ? `\uD83D\uDD25 ${dayCalories} cal` : '',
          cols.protein >= 0 ? ` \u00B7 \uD83D\uDCAA ${dayProtein}` : '',
        ]),
      ]));

      for (const { row, originalIndex } of dayItems) {
        const rowIdx = originalIndex + 1;
        const meal = cell(row, cols.meal);
        const recipe = cell(row, cols.recipe) || row[0] || '\u2014';
        const cal = cell(row, cols.calories);
        const prot = cell(row, cols.protein);

        section.append(el('div', { className: 'meal-card' }, [
          cols.meal >= 0 ? editableCell('span', { className: 'meal-type-badge' }, meal, rowIdx, cols.meal) : null,
          editableCell('span', { className: 'meal-recipe' }, recipe, rowIdx, cols.recipe),
          el('div', { className: 'meal-macros' }, [
            cols.calories >= 0 ? editableCell('span', { className: 'meal-cal' }, cal, rowIdx, cols.calories) : null,
            cols.protein >= 0  ? editableCell('span', { className: 'meal-prot' }, prot, rowIdx, cols.protein) : null,
          ]),
        ]));
      }

      container.append(section);
    }
  },

  directoryView(container, sheets, navigateFn) {
    container.append(el('div', { className: 'meal-dir-title' }, ['\uD83C\uDF7D\uFE0F Meal Plans Overview']));

    /* Compute per-sheet stats */
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

    /* Grand totals bar */
    container.append(el('div', { className: 'meal-dir-totals' }, [
      el('span', {}, [`\uD83D\uDD25 ${grandCal.toLocaleString()} cal`]),
      el('span', {}, [`\uD83D\uDCAA ${grandProt}g protein`]),
      el('span', {}, [`${grandMeals} meals`]),
    ]));

    /* Per-sheet cards */
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
