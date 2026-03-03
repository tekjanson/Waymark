/* templates/recipe.js — Recipe Book: card-based recipe display with
   ingredients and instructions support, inline editable fields.

   Sheet format: one row per ingredient/step. Recipe metadata (name,
   servings, prep, cook, category, difficulty) lives on the first row
   of each recipe group. Continuation rows leave the recipe-name cell
   blank. This makes the sheet easy to edit as a human in Google Sheets.
   ============================================================ */

import { el, cell, editableCell, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

/**
 * Group flat rows into recipe blocks. A new recipe starts whenever the
 * recipe-name column (cols.text) is non-empty.
 * @param {string[][]} rows
 * @param {Object} cols
 * @returns {Array<{ startIdx: number, rows: string[][] }>}
 */
function groupRecipes(rows, cols) {
  const groups = [];
  for (let i = 0; i < rows.length; i++) {
    const name = cell(rows[i], cols.text);
    if (name) {
      groups.push({ startIdx: i, rows: [rows[i]] });
    } else if (groups.length > 0) {
      groups[groups.length - 1].rows.push(rows[i]);
    }
  }
  return groups;
}

/* ---------- Definition ---------- */

const definition = {
  name: 'Recipe Book',
  icon: '📖',
  color: '#ea580c',
  priority: 24,

  detect(lower) {
    // Detect when headers suggest a recipe collection
    const hasRecipeSignal = lower.some(h => /^(recipe|dish|name)/.test(h));
    const hasIngredient   = lower.some(h => /^(ingredients?|ingredient)/.test(h));
    const hasInstruction  = lower.some(h => /^(instructions?|steps?|directions?|method)/.test(h));
    const hasPrepCook     = lower.some(h => /^(prep|cook|servings|cuisine|difficulty|category)/.test(h));

    // Strong signal: ingredient + instruction columns
    if (hasIngredient && hasInstruction) return true;
    // Recipe + at least one supporting column
    if (hasRecipeSignal && (hasIngredient || hasInstruction || hasPrepCook)) return true;

    return false;
  },

  columns(lower) {
    const cols = {
      text: -1, servings: -1, prepTime: -1, cookTime: -1,
      category: -1, difficulty: -1, ingredient: -1, step: -1,
    };
    cols.text       = lower.findIndex(h => /^(recipe|name|title|dish)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.servings   = lower.findIndex(h => /^(servings|serves|yield|portions)/.test(h));
    cols.prepTime   = lower.findIndex(h => /^(prep)/.test(h));
    cols.cookTime   = lower.findIndex(h => /^(cook)/.test(h));
    cols.category   = lower.findIndex(h => /^(category|cuisine|type)/.test(h));
    cols.difficulty = lower.findIndex(h => /^(difficulty|level)/.test(h));
    cols.ingredient = lower.findIndex(h => /^(ingredients?)/.test(h));
    cols.step       = lower.findIndex(h => /^(instructions?|steps?|directions?|method)/.test(h));
    return cols;
  },

  render(container, rows, cols) {
    const grid = el('div', { className: 'recipe-grid' });
    const groups = groupRecipes(rows, cols);

    for (const group of groups) {
      const firstRow = group.rows[0];
      const firstRowIdx = group.startIdx + 1; // 1-based offset from header

      const title      = cell(firstRow, cols.text) || firstRow[0] || '—';
      const servings   = cell(firstRow, cols.servings);
      const prepTime   = cell(firstRow, cols.prepTime);
      const cookTime   = cell(firstRow, cols.cookTime);
      const category   = cell(firstRow, cols.category);
      const difficulty = cell(firstRow, cols.difficulty);

      const diffClass  = (difficulty || '').toLowerCase().replace(/[^a-z]/g, '');

      // --- Header ---
      const header = el('div', { className: 'recipe-card-header' }, [
        editableCell('span', { className: 'recipe-card-title' }, title, firstRowIdx, cols.text),
        difficulty
          ? editableCell('span', {
              className: `recipe-difficulty-badge ${diffClass}`,
            }, difficulty, firstRowIdx, cols.difficulty)
          : null,
      ]);

      // --- Meta badges ---
      const metaItems = [];
      if (cols.servings >= 0 && servings) {
        metaItems.push(el('div', { className: 'recipe-meta-item' }, [
          '🍽️ ',
          editableCell('span', { className: 'meta-label' }, servings, firstRowIdx, cols.servings),
          ' servings',
        ]));
      }
      if (cols.prepTime >= 0 && prepTime) {
        metaItems.push(el('div', { className: 'recipe-meta-item' }, [
          '⏱️ Prep: ',
          editableCell('span', { className: 'meta-label' }, prepTime, firstRowIdx, cols.prepTime),
        ]));
      }
      if (cols.cookTime >= 0 && cookTime) {
        metaItems.push(el('div', { className: 'recipe-meta-item' }, [
          '🔥 Cook: ',
          editableCell('span', { className: 'meta-label' }, cookTime, firstRowIdx, cols.cookTime),
        ]));
      }
      if (cols.category >= 0 && category) {
        metaItems.push(
          editableCell('span', { className: 'recipe-category-badge' }, category, firstRowIdx, cols.category)
        );
      }

      const meta = metaItems.length > 0
        ? el('div', { className: 'recipe-card-meta' }, metaItems)
        : null;

      // --- Ingredients (one per row) ---
      let ingredSection = null;
      if (cols.ingredient >= 0) {
        const items = [];
        for (let r = 0; r < group.rows.length; r++) {
          const val = cell(group.rows[r], cols.ingredient);
          if (val) items.push({ text: val, rowIdx: group.startIdx + r + 1 });
        }
        if (items.length > 0) {
          const ul = el('ul', { className: 'recipe-ingredients-list' });
          for (const item of items) {
            ul.append(el('li', {}, [
              editableCell('span', { className: 'recipe-ingredient-text' }, item.text, item.rowIdx, cols.ingredient),
            ]));
          }
          ingredSection = el('div', { className: 'recipe-card-ingredients' }, [
            el('h4', {}, ['Ingredients']),
            ul,
          ]);
        }
      }

      // --- Instructions / Steps (one per row) ---
      let instrSection = null;
      if (cols.step >= 0) {
        const steps = [];
        for (let r = 0; r < group.rows.length; r++) {
          const val = cell(group.rows[r], cols.step);
          if (val) steps.push({ text: val, rowIdx: group.startIdx + r + 1 });
        }
        if (steps.length > 0) {
          const ol = el('ol', { className: 'recipe-instructions-list' });
          for (const s of steps) {
            ol.append(el('li', {}, [
              editableCell('span', { className: 'recipe-step-text' }, s.text, s.rowIdx, cols.step),
            ]));
          }
          instrSection = el('div', { className: 'recipe-card-instructions' }, [
            el('h4', {}, ['Instructions']),
            ol,
          ]);
        }
      }

      // --- Assemble card ---
      const card = el('div', { className: 'recipe-card' }, [
        header,
        meta,
        ingredSection,
        instrSection,
      ]);

      grid.append(card);
    }

    container.append(grid);
  },
};

registerTemplate('recipe', definition);
export default definition;
