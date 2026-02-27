/* templates/meal.js — Meal Planner: all fields editable inline */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Meal Planner',
  icon: '🍽️',
  color: '#65a30d',
  priority: 22,

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

  render(container, rows, cols) {
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const day = cols.day >= 0 ? cell(row, cols.day) || 'Unplanned' : 'Meals';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push({ row, originalIndex: i });
    }

    for (const [day, dayItems] of groups) {
      let dayCalories = 0, dayProtein = 0;
      for (const { row } of dayItems) {
        dayCalories += parseInt(cell(row, cols.calories)) || 0;
        dayProtein += parseInt(cell(row, cols.protein)) || 0;
      }

      const section = el('div', { className: 'meal-day' });
      section.append(el('div', { className: 'meal-day-header' }, [
        el('span', { className: 'meal-day-label' }, [day]),
        el('span', { className: 'meal-day-macros' }, [
          cols.calories >= 0 ? `🔥 ${dayCalories} cal` : '',
          cols.protein >= 0 ? ` · 💪 ${dayProtein}` : '',
        ]),
      ]));

      for (const { row, originalIndex } of dayItems) {
        const rowIdx = originalIndex + 1;
        const meal = cell(row, cols.meal);
        const recipe = cell(row, cols.recipe) || row[0] || '—';
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
};

registerTemplate('meal', definition);
export default definition;
