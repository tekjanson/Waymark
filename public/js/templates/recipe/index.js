/* ============================================================
   recipe/index.js — Recipe template (barrel)

   Single-recipe-per-sheet display with inline editing,
   recipe scaling (½×–3× + custom), unit conversion
   (metric/imperial), inline add buttons, notes, and print.

   Sub-modules:
     helpers.js  — parsing, formatting, unit conversion
     cookbook.js  — directory view (cookbook grid)
   ============================================================ */

import {
  el, cell, editableCell, registerTemplate, emitEdit, delegateEvent,
  getUserName, isImageUrl, showToast,
} from '../shared.js';
import {
  formatNumber, scaleQuantity, scaleServings, parseQtyNumber,
  convertUnit, inlineAddButton,
} from './helpers.js';
import { cookbookDirectoryView } from './cookbook.js';

/* ---------- Definition ---------- */

const definition = {
  name: 'Recipe',
  icon: '\uD83D\uDCD6',
  color: '#ea580c',
  priority: 24,
  itemNoun: 'Ingredient',

  /** Columns this template supports but that may be missing from older sheets */
  migrations: [
    { role: 'status',  header: 'Status',  description: 'Chef approval status (Untested/Approved/Needs Work)' },
    { role: 'rating',  header: 'Rating',  description: 'Per-person star ratings' },
    { role: 'source',  header: 'Source',  description: 'Recipe source URL for re-sync' },
    { role: 'notes',   header: 'Notes',   description: 'Recipe notes section' },
  ],

  detect(lower) {
    // Detect when headers suggest a recipe sheet
    const hasRecipeSignal = lower.some(h => /^(recipe|dish|name)/.test(h));
    const hasIngredient   = lower.some(h => /^(ingredients?|ingredient)/.test(h));
    const hasInstruction  = lower.some(h => /^(instructions?|steps?|directions?|method)/.test(h));
    const hasPrepCook     = lower.some(h => /^(prep|cook|servings|cuisine|difficulty|category)/.test(h));
    const hasQuantity     = lower.some(h => /^(qty|quantity|amount|units?)/.test(h));

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
      category: -1, difficulty: -1,
      qty: -1, unit: -1, quantity: -1,
      ingredient: -1, step: -1, notes: -1, source: -1,
      status: -1, rating: -1, photo: -1,
    };
    cols.text       = lower.findIndex(h => /^(recipe|name|title|dish)/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.servings   = lower.findIndex(h => /^(servings|serves|yield|portions)/.test(h));
    cols.prepTime   = lower.findIndex(h => /^(prep)/.test(h));
    cols.cookTime   = lower.findIndex(h => /^(cook)/.test(h));
    cols.category   = lower.findIndex(h => /^(category|cuisine|type)/.test(h));
    cols.difficulty = lower.findIndex(h => /^(difficulty|level)/.test(h));
    // Split qty/unit columns (new format)
    cols.qty        = lower.findIndex(h => /^qty$/.test(h));
    cols.unit       = lower.findIndex(h => /^units?$/.test(h));
    // Legacy combined quantity column
    cols.quantity   = lower.findIndex(h => /^(quantity|amount)/.test(h));
    cols.ingredient = lower.findIndex(h => /^(ingredients?)/.test(h));
    cols.step       = lower.findIndex(h => /^(instructions?|steps?|directions?|method)/.test(h));
    cols.notes      = lower.findIndex(h => /^(notes?)/.test(h));
    cols.source     = lower.findIndex(h => /^(source|url|link|origin)/.test(h));
    cols.status     = lower.findIndex(h => /^(status|approval|approved)/.test(h));
    cols.rating     = lower.findIndex(h => /^(rating|score|stars?)/.test(h));
    cols.photo      = lower.findIndex(h => /^(photo|image|picture|pic|thumbnail)/.test(h));
    return cols;
  },

  render(container, rows, cols, template) {
    // Single recipe per sheet: all rows belong to one recipe.
    // First data row carries the metadata; all rows carry ingredients/steps.
    const firstRow    = rows[0] || [];
    const firstRowIdx = 1; // 1-based offset from header

    const title      = cell(firstRow, cols.text) || firstRow[0] || '\u2014';
    const servingsRaw = cell(firstRow, cols.servings) || '';
    const prepTime   = cell(firstRow, cols.prepTime);
    const cookTime   = cell(firstRow, cols.cookTime);
    const category   = cell(firstRow, cols.category);
    const difficulty = cell(firstRow, cols.difficulty);

    const diffClass  = (difficulty || '').toLowerCase().replace(/[^a-z]/g, '');

    // Determine whether we're in split (qty+unit) or legacy (quantity) mode
    const useSplitQty = cols.qty >= 0;
    // The column index for the numeric quantity
    const qtyColIdx  = useSplitQty ? cols.qty : cols.quantity;

    // Callback for inline add buttons
    const addRow = template && template._onAddRow ? template._onAddRow : () => {};
    const totalCols = (template && template._totalColumns) || 12;

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

    // --- Photo ---
    let photoSection = null;
    const photoUrl = cols.photo >= 0 ? (cell(firstRow, cols.photo) || '') : '';
    if (cols.photo >= 0 && isImageUrl(photoUrl)) {
      const img = el('img', {
        className: 'recipe-photo-img',
        src: photoUrl,
        alt: title,
        loading: 'lazy',
      });
      img.addEventListener('error', () => { img.style.display = 'none'; });
      photoSection = el('div', { className: 'recipe-photo' }, [img]);
    }

    // --- Print button ---
    const printBtn = el('button', {
      className: 'recipe-print-btn',
      type: 'button',
      title: 'Print recipe as PDF',
    }, ['\uD83D\uDDA8\uFE0F Print']);
    printBtn.addEventListener('click', () => {
      window.print();
    });

    // --- Scale controls ---
    const SCALES = [
      { label: '\u00BD\u00D7', value: 0.5 },
      { label: '1\u00D7', value: 1 },
      { label: '2\u00D7', value: 2 },
      { label: '3\u00D7', value: 3 },
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
    scaleBar.append(printBtn);

    // --- Unit conversion controls (split mode only) ---
    let currentConversion = 'original';
    let convertBar = null;
    const CONVERSIONS = [
      { label: 'Original', value: 'original' },
      { label: 'Metric',   value: 'metric'   },
      { label: 'Imperial', value: 'imperial'  },
    ];
    const convertButtons = [];

    if (useSplitQty) {
      convertBar = el('div', { className: 'recipe-convert-bar' }, [
        el('span', { className: 'recipe-convert-label' }, ['Units:']),
      ]);
      for (const c of CONVERSIONS) {
        const btn = el('button', {
          className: `recipe-convert-btn${c.value === 'original' ? ' active' : ''}`,
          type: 'button',
        }, [c.label]);
        btn.dataset.conversion = c.value;
        convertButtons.push(btn);
        convertBar.append(btn);
      }
    }

    // --- Meta badges ---
    const metaItems = [];
    let servingsSpan = null;
    if (cols.servings >= 0 && servingsRaw) {
      servingsSpan = el('span', { className: 'meta-label' }, [servingsRaw]);
      metaItems.push(el('div', { className: 'recipe-meta-item' }, [
        '\uD83C\uDF7D\uFE0F ',
        servingsSpan,
        ' servings',
      ]));
    }
    if (cols.prepTime >= 0 && prepTime) {
      metaItems.push(el('div', { className: 'recipe-meta-item' }, [
        '\u23F1\uFE0F Prep: ',
        editableCell('span', { className: 'meta-label' }, prepTime, firstRowIdx, cols.prepTime),
      ]));
    }
    if (cols.cookTime >= 0 && cookTime) {
      metaItems.push(el('div', { className: 'recipe-meta-item' }, [
        '\uD83D\uDD25 Cook: ',
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
      }, ['\uD83D\uDD04 Re-sync']);

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

    // --- Status + Rating section ---
    const STATUSES = ['Untested', 'Approved', 'Needs Work'];
    const STATUS_ICONS = { 'Untested': '\uD83D\uDD0D', 'Approved': '\u2705', 'Needs Work': '\u26A0\uFE0F' };
    let statusRatingSection = null;
    const statusRaw = cols.status >= 0 ? (cell(firstRow, cols.status) || 'Untested') : '';
    const ratingRaw = cols.rating >= 0 ? (cell(firstRow, cols.rating) || '') : '';

    if (cols.status >= 0 || cols.rating >= 0) {
      const items = [];

      /* --- Status badge --- */
      if (cols.status >= 0) {
        const statusText = STATUSES.includes(statusRaw) ? statusRaw : 'Untested';
        const statusClass = statusText.toLowerCase().replace(/\s+/g, '-');
        const badge = el('button', {
          className: `recipe-status-badge recipe-status-${statusClass}`,
          type: 'button',
          title: 'Click to change status',
        }, [`${STATUS_ICONS[statusText] || ''} ${statusText}`]);
        badge.addEventListener('click', () => {
          const cur = badge.textContent.replace(/^[^\w]*/, '').trim();
          const idx = STATUSES.indexOf(cur);
          const next = STATUSES[(idx + 1) % STATUSES.length];
          const nextClass = next.toLowerCase().replace(/\s+/g, '-');
          badge.textContent = `${STATUS_ICONS[next] || ''} ${next}`;
          badge.className = `recipe-status-badge recipe-status-${nextClass}`;
          emitEdit(firstRowIdx, cols.status, next);
        });
        items.push(badge);
      }

      /* --- Rating --- */
      if (cols.rating >= 0) {
        // Parse "Name:N,Name:N" format
        const ratings = new Map();
        if (ratingRaw) {
          for (const part of ratingRaw.split(',')) {
            const [name, val] = part.split(':').map(s => s.trim());
            if (name && val) ratings.set(name, Math.min(5, Math.max(1, parseInt(val, 10) || 0)));
          }
        }

        const avg = ratings.size > 0
          ? [...ratings.values()].reduce((a, b) => a + b, 0) / ratings.size
          : 0;

        // Average display
        const avgStars = el('span', { className: 'recipe-rating-avg' });
        for (let s = 1; s <= 5; s++) {
          avgStars.append(el('span', {
            className: `recipe-star ${s <= Math.round(avg) ? 'recipe-star-filled' : 'recipe-star-empty'}`,
          }, ['\u2605']));
        }
        if (ratings.size > 0) {
          avgStars.append(el('span', { className: 'recipe-rating-count' }, [
            ` ${avg.toFixed(1)} (${ratings.size})`,
          ]));
        }

        // Individual ratings
        const breakdown = el('div', { className: 'recipe-rating-breakdown' });
        for (const [name, val] of ratings) {
          const stars = [];
          for (let s = 1; s <= 5; s++) {
            stars.push(el('span', {
              className: s <= val ? 'recipe-star recipe-star-filled' : 'recipe-star recipe-star-empty',
            }, ['\u2605']));
          }
          breakdown.append(el('span', { className: 'recipe-rating-person' }, [
            el('span', { className: 'recipe-rating-name' }, [name]),
            ...stars,
          ]));
        }

        // Your rating (interactive stars)
        const userName = getUserName() || 'You';
        const yourRating = ratings.get(userName) || 0;
        const yourRow = el('div', { className: 'recipe-your-rating' }, [
          el('span', { className: 'recipe-rating-label' }, ['Your rating:']),
        ]);
        for (let s = 1; s <= 5; s++) {
          const star = el('button', {
            className: `recipe-rate-star ${s <= yourRating ? 'recipe-star-filled' : 'recipe-star-empty'}`,
            type: 'button',
            dataset: { star: String(s) },
            title: `Rate ${s} star${s > 1 ? 's' : ''}`,
          }, ['\u2605']);
          yourRow.append(star);
        }

        // delegated click on rate stars
        delegateEvent(yourRow, 'click', '.recipe-rate-star', (_e, btn) => {
          const val = parseInt(btn.dataset.star, 10);
          ratings.set(userName, val);
          // Serialize back to "Name:N,Name:N"
          const serialized = [...ratings].map(([n, v]) => `${n}:${v}`).join(',');
          emitEdit(firstRowIdx, cols.rating, serialized);
          // Update star visuals
          yourRow.querySelectorAll('.recipe-rate-star').forEach(b => {
            const bv = parseInt(b.dataset.star, 10);
            b.classList.toggle('recipe-star-filled', bv <= val);
            b.classList.toggle('recipe-star-empty', bv > val);
          });
          // Update average display
          const newAvg = [...ratings.values()].reduce((a, b) => a + b, 0) / ratings.size;
          avgStars.querySelectorAll('.recipe-star').forEach((sp, i) => {
            sp.classList.toggle('recipe-star-filled', (i + 1) <= Math.round(newAvg));
            sp.classList.toggle('recipe-star-empty', (i + 1) > Math.round(newAvg));
          });
          const countEl = avgStars.querySelector('.recipe-rating-count');
          if (countEl) countEl.textContent = ` ${newAvg.toFixed(1)} (${ratings.size})`;
        });

        const ratingWrap = el('div', { className: 'recipe-rating-section' }, [
          avgStars,
          breakdown,
          yourRow,
        ]);
        items.push(ratingWrap);
      }

      statusRatingSection = el('div', { className: 'recipe-status-rating' }, items);
    }

    // --- Ingredients (one per row, with separate qty + unit columns) ---
    let ingredSection = null;
    let shoppingBtn = null;
    const quantitySpans = [];    // track for scaling updates
    const unitSpans = [];        // track for display
    if (cols.ingredient >= 0) {
      const items = [];
      for (let r = 0; r < rows.length; r++) {
        const val = cell(rows[r], cols.ingredient);
        let qty = '';
        let unitVal = '';
        if (useSplitQty) {
          qty = cols.qty >= 0 ? (cell(rows[r], cols.qty) || '') : '';
          unitVal = cols.unit >= 0 ? (cell(rows[r], cols.unit) || '') : '';
        } else {
          qty = qtyColIdx >= 0 ? (cell(rows[r], qtyColIdx) || '') : '';
        }
        if (val || qty) items.push({ text: val, qty, unit: unitVal, rowIdx: r + 1 });
      }

      // Sort: unitless items first (preserving relative order within each group)
      items.sort((a, b) => {
        const aHas = !!a.unit;
        const bHas = !!b.unit;
        if (aHas === bHas) return 0;
        return aHas ? 1 : -1;
      });

      const ul = el('ul', { className: 'recipe-ingredients-list' });
      for (const item of items) {
        // Qty span — shows numeric value only (no unit)
        const qtySpan = el('span', {
          className: 'recipe-ingredient-qty editable-cell',
          tabindex: '0',
          title: 'Click to edit',
        }, [item.qty || '']);
        qtySpan.dataset.originalQty = item.qty;
        qtySpan.dataset.originalUnit = item.unit || '';
        qtySpan.dataset.rowIdx = String(item.rowIdx);
        qtySpan.dataset.colIdx = String(qtyColIdx);

        quantitySpans.push(qtySpan);

        // Unit span — manually managed for conversion control (not editableCell)
        let unitSpanEl = null;
        if (useSplitQty && cols.unit >= 0) {
          unitSpanEl = el('span', {
            className: `recipe-ingredient-unit${item.unit ? ' editable-cell' : ''}`,
            tabindex: item.unit ? '0' : undefined,
            title: item.unit ? 'Click to edit' : undefined,
          }, [item.unit || '']);
          unitSpanEl.dataset.originalUnit = item.unit || '';
          unitSpanEl.dataset.rowIdx = String(item.rowIdx);
          unitSpanEl.dataset.colIdx = String(cols.unit);

          unitSpans.push(unitSpanEl);
        } else {
          // Create empty spacer to maintain consistent ingredient alignment
          unitSpanEl = el('span', { className: 'recipe-ingredient-unit' });
        }

        const li = el('li', {}, [
          qtySpan,
          unitSpanEl,
          editableCell('span', { className: 'recipe-ingredient-text' }, item.text, item.rowIdx, cols.ingredient),
        ]);
        ul.append(li);
      }

      // Delegated inline-edit for qty spans (one listener instead of N)
      if (qtyColIdx >= 0) {
        delegateEvent(ul, 'click', '.recipe-ingredient-qty', (e, qtySpan) => {
          e.stopPropagation();
          if (currentScale !== 1 || currentConversion !== 'original') return;
          if (qtySpan.querySelector('input')) return;
          const current = qtySpan.dataset.originalQty || '';
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'editable-cell-input';
          input.value = current;
          qtySpan.textContent = '';
          qtySpan.append(input);
          input.focus();
          input.select();

          const rowIdx = Number(qtySpan.dataset.rowIdx);
          function commit() {
            const nv = input.value.trim();
            input.removeEventListener('blur', commit);
            qtySpan.textContent = nv || '';
            qtySpan.dataset.originalQty = nv;
            if (nv !== current && !(current === '' && nv === '')) {
              emitEdit(rowIdx, qtyColIdx, nv);
            }
          }
          function cancel() {
            input.removeEventListener('blur', commit);
            qtySpan.textContent = current || '';
          }
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
          });
        });
      }

      // Delegated inline-edit for unit spans (one listener instead of N)
      if (useSplitQty && cols.unit >= 0) {
        delegateEvent(ul, 'click', '.recipe-ingredient-unit', (e, unitSpanEl) => {
          e.stopPropagation();
          if (currentScale !== 1 || currentConversion !== 'original') return;
          if (unitSpanEl.querySelector('input')) return;
          const current = unitSpanEl.dataset.originalUnit || '';
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'editable-cell-input';
          input.value = current;
          unitSpanEl.textContent = '';
          unitSpanEl.append(input);
          input.focus();
          input.select();

          const rowIdx = Number(unitSpanEl.dataset.rowIdx);
          // Find sibling qty span to keep its originalUnit in sync
          const li = unitSpanEl.closest('li');
          const qtySpan = li ? li.querySelector('.recipe-ingredient-qty') : null;
          function commit() {
            const nv = input.value.trim();
            input.removeEventListener('blur', commit);
            unitSpanEl.textContent = nv || '';
            unitSpanEl.dataset.originalUnit = nv;
            if (qtySpan) qtySpan.dataset.originalUnit = nv;
            if (nv !== current && !(current === '' && nv === '')) {
              emitEdit(rowIdx, cols.unit, nv);
            }
          }
          function cancel() {
            input.removeEventListener('blur', commit);
            unitSpanEl.textContent = current || '';
          }
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
          });
        });
      }

      // Add ingredient button
      const addCols = useSplitQty
        ? (cols.unit >= 0 ? [cols.qty, cols.unit, cols.ingredient] : [cols.qty, cols.ingredient])
        : (qtyColIdx >= 0 ? [qtyColIdx, cols.ingredient] : [cols.ingredient]);
      const addPlaceholders = useSplitQty
        ? (cols.unit >= 0 ? ['e.g. 2', 'e.g. cups', 'e.g. flour'] : ['e.g. 2', 'e.g. flour'])
        : (qtyColIdx >= 0 ? ['e.g. 2 cups', 'e.g. flour'] : ['e.g. flour']);
      const addIngredient = inlineAddButton(
        'Add Ingredient', addCols, totalCols, addRow, addPlaceholders
      );

      /* Mode toggle buttons: Cooking + Shopping List + Reset */
      shoppingBtn = el('button', {
        className: 'recipe-mode-btn recipe-shopping-btn',
        title: 'Shopping list view',
      }, ['\uD83D\uDED2 Shopping List']);

      const resetBtn = el('button', {
        className: 'recipe-mode-btn recipe-reset-btn',
        title: 'Reset all checkmarks',
      }, ['\u21BA Reset']);

      const modeBar = el('div', { className: 'recipe-mode-bar' }, [shoppingBtn, resetBtn]);

      ingredSection = el('div', { className: 'recipe-card-ingredients' }, [
        el('h4', {}, ['Ingredients']),
        modeBar,
        ul,
        addIngredient,
      ]);

      /* Cooking mode — tap ingredient to strike through */
      delegateEvent(ul, 'click', 'li', (e, li) => {
        // Don't toggle when clicking editable cells or inputs
        if (e.target.closest('.editable-cell') || e.target.closest('input')) return;
        li.classList.toggle('recipe-ingredient-checked');
      });

      /* Reset all checkmarks */
      resetBtn.addEventListener('click', () => {
        ul.querySelectorAll('.recipe-ingredient-checked').forEach(li => {
          li.classList.remove('recipe-ingredient-checked');
        });
        // Also reset any step checkmarks if instructions exist
        const stepsUl = card?.querySelector('.recipe-instructions-list');
        if (stepsUl) {
          stepsUl.querySelectorAll('.recipe-step-checked').forEach(li => {
            li.classList.remove('recipe-step-checked');
          });
        }
        showToast('Checkmarks cleared', 'success');
      });
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
        'Add Step', [cols.step], totalCols, addRow, ['e.g. Preheat oven to 180\u00B0C']
      );
      instrSection = el('div', { className: 'recipe-card-instructions' }, [
        el('h4', {}, ['Instructions']),
        ol,
        addStep,
      ]);
    }

    // --- Notes section ---
    let notesSection = null;
    if (cols.notes >= 0) {
      const noteItems = [];
      for (let r = 0; r < rows.length; r++) {
        const val = cell(rows[r], cols.notes);
        if (val) noteItems.push({ text: val, rowIdx: r + 1 });
      }
      // Show notes: first row note is the "recipe note", others are per-item
      const notesList = el('div', { className: 'recipe-notes-list' });
      for (const n of noteItems) {
        notesList.append(
          editableCell('p', { className: 'recipe-note-item' }, n.text, n.rowIdx, cols.notes)
        );
      }
      const addNote = inlineAddButton(
        'Add Note', [cols.notes], totalCols, addRow, ['e.g. Best served with fresh garlic bread']
      );
      notesSection = el('div', { className: 'recipe-card-notes' }, [
        el('h4', {}, ['Notes']),
        notesList,
        addNote,
      ]);
    }

    // --- Scale & conversion handler ---
    function updateIngredientDisplay() {
      const scale = currentScale;
      const system = currentConversion;
      const editable = scale === 1 && system === 'original';

      for (let i = 0; i < quantitySpans.length; i++) {
        const qtySpan = quantitySpans[i];
        const unitSpanEl = unitSpans[i] || null;
        const origQty = qtySpan.dataset.originalQty || '';
        const origUnit = qtySpan.dataset.originalUnit || '';

        if (useSplitQty) {
          const num = parseQtyNumber(origQty);
          if (num !== null && origQty) {
            let scaledNum = num * scale;
            let displayUnit = origUnit;

            // Apply unit conversion if not 'original'
            if (system !== 'original' && origUnit) {
              const converted = convertUnit(scaledNum, origUnit, system);
              if (converted) {
                scaledNum = converted.qty;
                displayUnit = converted.unit;
              }
            }

            qtySpan.textContent = formatNumber(scaledNum);
            if (unitSpanEl) unitSpanEl.textContent = displayUnit;
          } else {
            // Non-numeric qty — show original values unchanged
            qtySpan.textContent = origQty || '';
            if (unitSpanEl) unitSpanEl.textContent = origUnit;
          }
        } else {
          // Legacy mode: combined quantity string
          qtySpan.textContent = origQty ? scaleQuantity(origQty, scale) : '';
        }

        // Toggle editability on qty span
        if (editable) {
          qtySpan.classList.add('editable-cell');
          qtySpan.setAttribute('tabindex', '0');
          qtySpan.title = 'Click to edit';
        } else {
          qtySpan.classList.remove('editable-cell');
          qtySpan.removeAttribute('tabindex');
          qtySpan.title = '';
        }

        // Toggle editability on unit span
        if (unitSpanEl) {
          if (editable) {
            unitSpanEl.classList.add('editable-cell');
            unitSpanEl.setAttribute('tabindex', '0');
            unitSpanEl.title = 'Click to edit';
          } else {
            unitSpanEl.classList.remove('editable-cell');
            unitSpanEl.removeAttribute('tabindex');
            unitSpanEl.title = '';
          }
        }
      }

      // Scale servings display
      if (servingsSpan) {
        servingsSpan.textContent = scaleServings(servingsRaw, scale);
      }
    }

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
      updateIngredientDisplay();
    }

    function applyConversion(system) {
      currentConversion = system;
      for (const btn of convertButtons) {
        btn.classList.toggle('active', btn.dataset.conversion === system);
      }
      updateIngredientDisplay();
    }
    // Delegated scale-button clicks (one listener instead of N)
    delegateEvent(scaleBar, 'click', '.recipe-scale-btn', (_e, btn) => {
      applyScale(Number(btn.dataset.scale), true);
    });
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
    // Delegated conversion-button clicks (one listener instead of N)
    if (convertBar) {
      delegateEvent(convertBar, 'click', '.recipe-convert-btn', (_e, btn) => {
        applyConversion(btn.dataset.conversion);
      });
    }

    // --- Assemble single recipe card ---
    const card = el('div', { className: 'recipe-card recipe-single' }, [
      header,
      photoSection,
      scaleBar,
      convertBar,
      meta,
      statusRatingSection,
      sourceSection,
      ingredSection,
      instrSection,
      notesSection,
    ]);

    /* Shopping list mode — hides everything except title + ingredients */
    if (ingredSection) {
      shoppingBtn.addEventListener('click', () => {
        card.classList.toggle('recipe-shopping-mode');
        const active = card.classList.contains('recipe-shopping-mode');
        shoppingBtn.textContent = active ? '\u2715 Exit Shopping List' : '\uD83D\uDED2 Shopping List';
      });
    }

    container.append(card);

    // Run once to normalise the initial display through formatNumber()
    // so it matches exactly what updateIngredientDisplay produces on every
    // subsequent scale / conversion change (no visual jump).
    updateIngredientDisplay();
  },

  directoryView: cookbookDirectoryView,

  // Cookbook directory view only uses the first data row per sheet
  // (recipe name, servings, prep/cook time, category, difficulty).
  // The summary fetch already provides header + first row, so no
  // full re-fetch is needed — saves N×2 Sheets API calls.
  needsFullData: false,
};

registerTemplate('recipe', definition);
export default definition;
