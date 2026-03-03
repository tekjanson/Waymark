/* templates/recipe.js — Recipe: single-recipe-per-sheet display with
   inline editable ingredients and instructions, plus inline add buttons.

   Sheet format: one row per ingredient/step. Recipe metadata (name,
   servings, prep, cook, category, difficulty) lives on the first row.
   Continuation rows leave the recipe-name cell blank. Each list item
   (ingredient or step) occupies its own row.
   ============================================================ */

import { el, cell, editableCell, registerTemplate, emitEdit } from './shared.js';

/* ---------- Inline add-item helper ---------- */

/**
 * Build a small inline "add" button+input for appending a single row.
 * Used for ingredients and steps within the recipe card.
 *
 * @param {string}   label        — button label, e.g. "Add Ingredient"
 * @param {number}   colIndex     — column index for the new value
 * @param {number}   totalColumns — total columns in the sheet header
 * @param {function} onSubmit     — callback(rows: string[][])
 * @param {string}   [placeholder] — input placeholder
 * @returns {HTMLElement}
 */
function inlineAddButton(label, colIndex, totalColumns, onSubmit, placeholder) {
  const wrap = el('div', { className: 'recipe-inline-add' });

  const trigger = el('button', {
    className: 'recipe-inline-add-btn',
    type: 'button',
  }, [`+ ${label}`]);

  const formWrap = el('div', { className: 'recipe-inline-add-form hidden' });
  const input = el('input', {
    type: 'text',
    className: 'recipe-inline-add-input',
    placeholder: placeholder || '',
  });
  const submitBtn = el('button', {
    className: 'recipe-inline-add-submit',
    type: 'button',
  }, ['Add']);
  const cancelBtn = el('button', {
    className: 'recipe-inline-add-cancel',
    type: 'button',
  }, ['Cancel']);

  formWrap.append(input, submitBtn, cancelBtn);
  wrap.append(trigger, formWrap);

  function expand() {
    trigger.classList.add('hidden');
    formWrap.classList.remove('hidden');
    input.focus();
  }

  function collapse() {
    formWrap.classList.add('hidden');
    trigger.classList.remove('hidden');
    input.value = '';
  }

  function submit() {
    const val = input.value.trim();
    if (!val) { input.classList.add('add-row-required'); return; }
    input.classList.remove('add-row-required');
    const row = new Array(totalColumns).fill('');
    row[colIndex] = val;
    collapse();
    onSubmit([row]);
  }

  trigger.addEventListener('click', expand);
  cancelBtn.addEventListener('click', collapse);
  submitBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); collapse(); }
  });

  return wrap;
}

/* ---------- Definition ---------- */

const definition = {
  name: 'Recipe',
  icon: '📖',
  color: '#ea580c',
  priority: 24,
  itemNoun: 'Ingredient',

  detect(lower) {
    // Detect when headers suggest a recipe sheet
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

  render(container, rows, cols, template) {
    // Single recipe per sheet: all rows belong to one recipe.
    // First data row carries the metadata; all rows carry ingredients/steps.
    const firstRow    = rows[0] || [];
    const firstRowIdx = 1; // 1-based offset from header

    const title      = cell(firstRow, cols.text) || firstRow[0] || '—';
    const servings   = cell(firstRow, cols.servings);
    const prepTime   = cell(firstRow, cols.prepTime);
    const cookTime   = cell(firstRow, cols.cookTime);
    const category   = cell(firstRow, cols.category);
    const difficulty = cell(firstRow, cols.difficulty);

    const diffClass  = (difficulty || '').toLowerCase().replace(/[^a-z]/g, '');

    // Callback for inline add buttons
    const addRow = template && template._onAddRow ? template._onAddRow : () => {};
    const totalCols = (template && template._totalColumns) || 8;

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
      for (let r = 0; r < rows.length; r++) {
        const val = cell(rows[r], cols.ingredient);
        if (val) items.push({ text: val, rowIdx: r + 1 });
      }
      const ul = el('ul', { className: 'recipe-ingredients-list' });
      for (const item of items) {
        ul.append(el('li', {}, [
          editableCell('span', { className: 'recipe-ingredient-text' }, item.text, item.rowIdx, cols.ingredient),
        ]));
      }
      const addIngredient = inlineAddButton(
        'Add Ingredient', cols.ingredient, totalCols, addRow, 'e.g. 2 cups flour'
      );
      ingredSection = el('div', { className: 'recipe-card-ingredients' }, [
        el('h4', {}, ['Ingredients']),
        ul,
        addIngredient,
      ]);
    }

    // --- Instructions / Steps (one per row) ---
    let instrSection = null;
    if (cols.step >= 0) {
      const steps = [];
      for (let r = 0; r < rows.length; r++) {
        const val = cell(rows[r], cols.step);
        if (val) steps.push({ text: val, rowIdx: r + 1 });
      }
      const ol = el('ol', { className: 'recipe-instructions-list' });
      for (const s of steps) {
        ol.append(el('li', {}, [
          editableCell('span', { className: 'recipe-step-text' }, s.text, s.rowIdx, cols.step),
        ]));
      }
      const addStep = inlineAddButton(
        'Add Step', cols.step, totalCols, addRow, 'e.g. Preheat oven to 180°C'
      );
      instrSection = el('div', { className: 'recipe-card-instructions' }, [
        el('h4', {}, ['Instructions']),
        ol,
        addStep,
      ]);
    }

    // --- Assemble single recipe card ---
    const card = el('div', { className: 'recipe-card recipe-single' }, [
      header,
      meta,
      ingredSection,
      instrSection,
    ]);

    container.append(card);
  },
};

registerTemplate('recipe', definition);
export default definition;
