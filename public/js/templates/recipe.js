/* templates/recipe.js — Recipe: single-recipe-per-sheet display with
   inline editable ingredients and instructions, plus inline add buttons
   and recipe scaling (½×, 1×, 2×, 3×).

   Sheet format: one row per ingredient/step. Recipe metadata (name,
   servings, prep, cook, category, difficulty) lives on the first row.
   Continuation rows leave the recipe-name cell blank. Each list item
   occupies its own row.  Quantities live in a dedicated column so
   scaling can multiply them mathematically.
   ============================================================ */

import { el, cell, editableCell, registerTemplate, emitEdit } from './shared.js';

/* ---------- Quantity parsing & scaling helpers ---------- */

/** Common Unicode fraction map */
const FRAC_MAP = { '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75,
                   '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
                   '⅙': 1/6, '⅚': 5/6, '⅛': 0.125, '⅜': 0.375,
                   '⅝': 0.625, '⅞': 0.875 };

/**
 * Parse a quantity string into { number, unit, extra }.
 * Handles integers, decimals, vulgar fractions (½), slash fractions (1/2),
 * mixed numbers (1 1/2), and optional unit suffix.
 *
 * @param {string} raw — e.g. "400g", "2 tbsp", "1/2 cup", "1 ½ tsp"
 * @returns {{ number: number|null, unit: string, extra: string }}
 */
function parseQuantity(raw) {
  if (!raw) return { number: null, unit: '', extra: '' };
  let s = raw.trim();

  // Replace Unicode fractions with decimal
  for (const [ch, val] of Object.entries(FRAC_MAP)) {
    if (s.includes(ch)) {
      // Handle mixed number: "1½" or "1 ½"
      const mixRe = new RegExp(`(\\d+)\\s*${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      const mixM = s.match(mixRe);
      if (mixM) {
        s = s.replace(mixRe, String(Number(mixM[1]) + val));
      } else {
        s = s.replace(ch, String(val));
      }
    }
  }

  // Try: number (possibly with slash fraction) then unit
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(.*)/);
  if (m) return { number: Number(m[1]) / Number(m[2]), unit: m[3].trim(), extra: '' };

  // Mixed number with slash fraction: "1 1/2 cups"
  const mx = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*(.*)/);
  if (mx) return { number: Number(mx[1]) + Number(mx[2]) / Number(mx[3]), unit: mx[4].trim(), extra: '' };

  // Simple number (int or decimal) possibly glued to unit: "400g", "2 tbsp"
  const simple = s.match(/^(\d+(?:\.\d+)?)\s*(.*)/);
  if (simple) return { number: Number(simple[1]), unit: simple[2].trim(), extra: '' };

  // No number found — treat entire string as extra text
  return { number: null, unit: '', extra: s };
}

/**
 * Format a scaled number back to a tidy string.
 * Prefers whole numbers, common fractions, or one-decimal.
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
  if (n === 0) return '0';
  const whole = Math.floor(n);
  const frac = n - whole;

  // Map common fractions back to Unicode
  const fracThresh = [
    [1/8, '⅛'], [1/6, '⅙'], [1/4, '¼'], [1/3, '⅓'],
    [3/8, '⅜'], [2/5, '⅖'], [1/2, '½'], [3/5, '⅗'],
    [5/8, '⅝'], [2/3, '⅔'], [3/4, '¾'], [5/6, '⅚'], [7/8, '⅞'],
  ];
  for (const [val, sym] of fracThresh) {
    if (Math.abs(frac - val) < 0.02) {
      return whole > 0 ? `${whole} ${sym}` : sym;
    }
  }

  if (Math.abs(n - Math.round(n)) < 0.01) return String(Math.round(n));
  // One decimal place
  const rounded = Math.round(n * 10) / 10;
  return rounded === Math.floor(rounded) ? String(Math.floor(rounded)) : String(rounded);
}

/**
 * Scale a raw quantity string by a multiplier.
 * @param {string} raw   — original quantity, e.g. "2 tbsp"
 * @param {number} scale — multiplier (0.5, 1, 2, 3, etc.)
 * @returns {string}
 */
function scaleQuantity(raw, scale) {
  if (scale === 1) return raw;
  const { number, unit, extra } = parseQuantity(raw);
  if (number === null) return raw;              // no numeric part — return as-is
  const scaled = formatNumber(number * scale);
  // Preserve original spacing: if "400g" had no space, keep "800g"
  if (unit) {
    const hasSpace = /^\d/.test(raw) && /\d\s/.test(raw.replace(/[^\d\s].*$/, () => ''));
    // Check if original raw had a space before the unit
    const numStr = raw.match(/^[\d./\s\u00BC-\u00BE\u2150-\u215E]+/);
    const afterNum = numStr ? raw.slice(numStr[0].length) : '';
    const originalHadSpace = numStr ? /\s$/.test(numStr[0]) || /^\s/.test(afterNum) : true;
    return originalHadSpace ? `${scaled} ${unit}` : `${scaled}${unit}`;
  }
  if (extra) return `${scaled} ${extra}`;
  return scaled;
}

/**
 * Scale a servings string by a multiplier.
 * @param {string} raw   — e.g. "4"
 * @param {number} scale
 * @returns {string}
 */
function scaleServings(raw, scale) {
  if (scale === 1) return raw;
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  return formatNumber(n * scale);
}

/* ---------- Inline add-item helper ---------- */

/**
 * Build a small inline "add" button+input for appending a single row.
 * Used for ingredients and steps within the recipe card.
 *
 * @param {string}     label        — button label, e.g. "Add Ingredient"
 * @param {number[]}   colIndices   — column indices for the new values
 * @param {number}     totalColumns — total columns in the sheet header
 * @param {function}   onSubmit     — callback(rows: string[][])
 * @param {string[]}   placeholders — input placeholders per colIndex
 * @returns {HTMLElement}
 */
function inlineAddButton(label, colIndices, totalColumns, onSubmit, placeholders) {
  const wrap = el('div', { className: 'recipe-inline-add' });

  const trigger = el('button', {
    className: 'recipe-inline-add-btn',
    type: 'button',
  }, [`+ ${label}`]);

  const formWrap = el('div', { className: 'recipe-inline-add-form hidden' });
  const inputs = colIndices.map((_, i) => el('input', {
    type: 'text',
    className: 'recipe-inline-add-input',
    placeholder: (placeholders && placeholders[i]) || '',
  }));
  const submitBtn = el('button', {
    className: 'recipe-inline-add-submit',
    type: 'button',
  }, ['Add']);
  const cancelBtn = el('button', {
    className: 'recipe-inline-add-cancel',
    type: 'button',
  }, ['Cancel']);

  formWrap.append(...inputs, submitBtn, cancelBtn);
  wrap.append(trigger, formWrap);

  function expand() {
    trigger.classList.add('hidden');
    formWrap.classList.remove('hidden');
    inputs[0].focus();
  }

  function collapse() {
    formWrap.classList.add('hidden');
    trigger.classList.remove('hidden');
    inputs.forEach(inp => { inp.value = ''; });
  }

  function submit() {
    // At least one input must have a value
    const vals = inputs.map(inp => inp.value.trim());
    if (vals.every(v => !v)) { inputs[0].classList.add('add-row-required'); return; }
    inputs.forEach(inp => inp.classList.remove('add-row-required'));
    const row = new Array(totalColumns).fill('');
    colIndices.forEach((col, i) => { row[col] = vals[i]; });
    collapse();
    onSubmit([row]);
  }

  trigger.addEventListener('click', expand);
  cancelBtn.addEventListener('click', collapse);
  submitBtn.addEventListener('click', submit);
  inputs.forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); collapse(); }
    });
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
    const hasQuantity     = lower.some(h => /^(qty|quantity|amount)/.test(h));

    // Strong signal: ingredient + instruction columns
    if (hasIngredient && hasInstruction) return true;
    // Recipe + at least one supporting column
    if (hasRecipeSignal && (hasIngredient || hasInstruction || hasPrepCook)) return true;
    // Quantity + ingredient is a strong recipe signal
    if (hasQuantity && hasIngredient) return true;

    return false;
  },

  columns(lower) {
    const cols = {
      text: -1, servings: -1, prepTime: -1, cookTime: -1,
      category: -1, difficulty: -1, quantity: -1, ingredient: -1, step: -1,
      source: -1,
    };
    cols.text       = lower.findIndex(h => /^(recipe|name|title|dish)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.servings   = lower.findIndex(h => /^(servings|serves|yield|portions)/.test(h));
    cols.prepTime   = lower.findIndex(h => /^(prep)/.test(h));
    cols.cookTime   = lower.findIndex(h => /^(cook)/.test(h));
    cols.category   = lower.findIndex(h => /^(category|cuisine|type)/.test(h));
    cols.difficulty = lower.findIndex(h => /^(difficulty|level)/.test(h));
    cols.quantity   = lower.findIndex(h => /^(qty|quantity|amount)/.test(h));
    cols.ingredient = lower.findIndex(h => /^(ingredients?)/.test(h));
    cols.step       = lower.findIndex(h => /^(instructions?|steps?|directions?|method)/.test(h));
    cols.source     = lower.findIndex(h => /^(source|url|link|origin)/.test(h));
    return cols;
  },

  render(container, rows, cols, template) {
    // Single recipe per sheet: all rows belong to one recipe.
    // First data row carries the metadata; all rows carry ingredients/steps.
    const firstRow    = rows[0] || [];
    const firstRowIdx = 1; // 1-based offset from header

    const title      = cell(firstRow, cols.text) || firstRow[0] || '—';
    const servingsRaw = cell(firstRow, cols.servings) || '';
    const prepTime   = cell(firstRow, cols.prepTime);
    const cookTime   = cell(firstRow, cols.cookTime);
    const category   = cell(firstRow, cols.category);
    const difficulty = cell(firstRow, cols.difficulty);

    const diffClass  = (difficulty || '').toLowerCase().replace(/[^a-z]/g, '');

    // Callback for inline add buttons
    const addRow = template && template._onAddRow ? template._onAddRow : () => {};
    const totalCols = (template && template._totalColumns) || 9;

    // --- Scaling state ---
    let currentScale = 1;

    // --- Header ---
    const header = el('div', { className: 'recipe-card-header' }, [
      editableCell('span', { className: 'recipe-card-title' }, title, firstRowIdx, cols.text),
      difficulty
        ? editableCell('span', {
            className: `recipe-difficulty-badge ${diffClass}`,
          }, difficulty, firstRowIdx, cols.difficulty)
        : null,
    ]);

    // --- Scale controls ---
    const SCALES = [
      { label: '½×', value: 0.5 },
      { label: '1×', value: 1 },
      { label: '2×', value: 2 },
      { label: '3×', value: 3 },
    ];
    const scaleButtons = [];
    const scaleBar = el('div', { className: 'recipe-scale-bar' }, [
      el('span', { className: 'recipe-scale-label' }, ['Scale:']),
    ]);
    for (const s of SCALES) {
      const btn = el('button', {
        className: `recipe-scale-btn${s.value === 1 ? ' active' : ''}`,
        type: 'button',
      }, [s.label]);
      btn.dataset.scale = String(s.value);
      scaleButtons.push(btn);
      scaleBar.append(btn);
    }

    // Custom scale input
    const customScaleInput = el('input', {
      type: 'number',
      className: 'recipe-scale-custom',
      placeholder: 'Custom',
      min: '0.1',
      step: '0.1',
      title: 'Enter a custom scale multiplier',
    });
    scaleBar.append(customScaleInput);

    // --- Meta badges ---
    const metaItems = [];
    let servingsSpan = null;
    if (cols.servings >= 0 && servingsRaw) {
      servingsSpan = el('span', { className: 'meta-label' }, [servingsRaw]);
      metaItems.push(el('div', { className: 'recipe-meta-item' }, [
        '🍽️ ',
        servingsSpan,
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

    // --- Source URL (shown as link + re-sync button) ---
    let sourceSection = null;
    const sourceUrl = cols.source >= 0 ? (cell(firstRow, cols.source) || '') : '';
    if (sourceUrl) {
      const sourceLink = el('a', {
        className: 'recipe-source-link',
        href: sourceUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: sourceUrl,
      }, [sourceUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]]);

      const resyncBtn = el('button', {
        className: 'recipe-resync-btn',
        type: 'button',
        title: 'Re-sync recipe from source URL',
      }, ['🔄 Re-sync']);

      resyncBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('waymark:recipe-resync', {
          detail: { url: sourceUrl },
        }));
      });

      sourceSection = el('div', { className: 'recipe-source-bar' }, [
        el('span', { className: 'recipe-source-label' }, ['Source: ']),
        sourceLink,
        resyncBtn,
      ]);
    }

    // --- Ingredients (one per row, with separate quantity column) ---
    let ingredSection = null;
    const quantitySpans = [];    // track for scaling updates
    if (cols.ingredient >= 0) {
      const items = [];
      for (let r = 0; r < rows.length; r++) {
        const val = cell(rows[r], cols.ingredient);
        const qty = cols.quantity >= 0 ? (cell(rows[r], cols.quantity) || '') : '';
        if (val || qty) items.push({ text: val, qty, rowIdx: r + 1 });
      }
      const ul = el('ul', { className: 'recipe-ingredients-list' });
      for (const item of items) {
        const qtySpan = el('span', { className: 'recipe-ingredient-qty' }, [item.qty || '']);
        qtySpan.dataset.originalQty = item.qty;
        quantitySpans.push(qtySpan);

        const li = el('li', {}, [
          qtySpan,
          editableCell('span', { className: 'recipe-ingredient-text' }, item.text, item.rowIdx, cols.ingredient),
        ]);
        ul.append(li);
      }

      // Add ingredient button — accepts quantity + ingredient
      const addCols = cols.quantity >= 0
        ? [cols.quantity, cols.ingredient]
        : [cols.ingredient];
      const addPlaceholders = cols.quantity >= 0
        ? ['e.g. 2 cups', 'e.g. flour']
        : ['e.g. flour'];
      const addIngredient = inlineAddButton(
        'Add Ingredient', addCols, totalCols, addRow, addPlaceholders
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
        'Add Step', [cols.step], totalCols, addRow, ['e.g. Preheat oven to 180°C']
      );
      instrSection = el('div', { className: 'recipe-card-instructions' }, [
        el('h4', {}, ['Instructions']),
        ol,
        addStep,
      ]);
    }

    // --- Scale handler ---
    function applyScale(scale, fromPreset = false) {
      currentScale = scale;
      // Update button active states
      const matchesPreset = SCALES.some(s => s.value === scale);
      for (const btn of scaleButtons) {
        btn.classList.toggle('active', Number(btn.dataset.scale) === scale);
      }
      // Sync custom input: clear it when a preset is clicked, populate when custom
      if (fromPreset) {
        customScaleInput.value = '';
        customScaleInput.classList.remove('recipe-scale-custom-active');
      } else if (!matchesPreset) {
        customScaleInput.classList.add('recipe-scale-custom-active');
      }
      // Scale quantity spans
      for (const span of quantitySpans) {
        const orig = span.dataset.originalQty || '';
        span.textContent = orig ? scaleQuantity(orig, scale) : '';
      }
      // Scale servings display
      if (servingsSpan) {
        servingsSpan.textContent = scaleServings(servingsRaw, scale);
      }
    }
    for (const btn of scaleButtons) {
      btn.addEventListener('click', () => applyScale(Number(btn.dataset.scale), true));
    }
    // Custom scale input events
    function handleCustomScale() {
      const val = parseFloat(customScaleInput.value);
      if (!isNaN(val) && val > 0) {
        applyScale(val, false);
      }
    }
    customScaleInput.addEventListener('input', handleCustomScale);
    customScaleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handleCustomScale(); }
    });

    // --- Assemble single recipe card ---
    const card = el('div', { className: 'recipe-card recipe-single' }, [
      header,
      scaleBar,
      meta,
      sourceSection,
      ingredSection,
      instrSection,
    ]);

    container.append(card);
  },
};

registerTemplate('recipe', definition);
export default definition;
