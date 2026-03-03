/* ============================================================
   templates/shared.js — Shared utilities for template renderers
   
   Provides cell access, edit callbacks, and the template
   registry that individual template modules register into.
   ============================================================ */

import { el } from '../ui.js';

/* ---------- Edit callback (set by checklist.js) ---------- */

let _onCellEdit = null;

/**
 * Register a callback for cell edits.
 * @param {(rowIndex: number, colIndex: number, newValue: string) => void} fn
 */
export function onEdit(fn) { _onCellEdit = fn; }

/**
 * Emit a cell edit event to the registered callback.
 * @param {number} rowIndex
 * @param {number} colIndex
 * @param {string} newValue
 */
export function emitEdit(rowIndex, colIndex, newValue) {
  if (_onCellEdit) _onCellEdit(rowIndex, colIndex, newValue);
}

/**
 * Safely access a cell value from a row.
 * @param {string[]} row
 * @param {number} idx
 * @returns {string}
 */
export function cell(row, idx) {
  return (idx >= 0 && idx < row.length) ? (row[idx] || '') : '';
}

/**
 * Parse a progress value into a percentage (0–100+).
 * Handles: "75%", "3/5", plain numbers with optional target.
 * @param {string} raw
 * @param {string} [rawTarget]
 * @returns {number}
 */
export function parseProgress(raw, rawTarget) {
  if (!raw) return 0;
  const s = raw.trim();
  if (s.endsWith('%')) return parseFloat(s) || 0;
  if (s.includes('/')) {
    const [n, d] = s.split('/').map(Number);
    return d ? (n / d) * 100 : 0;
  }
  const num = parseFloat(s);
  if (!isNaN(num) && rawTarget) {
    const tgt = parseFloat(rawTarget);
    if (tgt) return (num / tgt) * 100;
  }
  if (!isNaN(num)) return num;
  return 0;
}

/* ---------- Template Registry ---------- */

/**
 * All registered templates.
 * Individual template modules call registerTemplate() to add themselves.
 * @type {Record<string, Object>}
 */
export const TEMPLATES = {};

/**
 * Register a template definition.
 * @param {string} key — unique template key (e.g. 'checklist', 'kanban')
 * @param {Object} definition — template definition with name, icon, color, priority, detect, columns, render
 */
export function registerTemplate(key, definition) {
  TEMPLATES[key] = definition;
}

/* ---------- Inline-editable cell ---------- */

/**
 * Create a DOM element whose text content becomes an inline <input> on click.
 * On blur / Enter the edit is committed via emitEdit(); on Escape it is cancelled.
 *
 * @param {string}  tag        — wrapper element tag (e.g. 'span', 'div')
 * @param {Object}  attrs      — attributes forwarded to el() (className, style, etc.)
 * @param {string}  text       — initial display text
 * @param {number}  rowIdx     — 1-based data-row index for emitEdit()
 * @param {number}  colIdx     — 0-based column index for emitEdit()
 * @param {Object}  [opts]     — extra options
 * @param {function} [opts.onCommit]  — called(newValue, element) after a successful edit for custom DOM updates
 * @returns {HTMLElement}
 */
export function editableCell(tag, attrs, text, rowIdx, colIdx, opts = {}) {
  const display = text || '—';
  const wrapper = el(tag, {
    ...attrs,
    className: `${attrs.className || ''} editable-cell`.trim(),
    tabindex: '0',
    title: attrs.title || 'Click to edit',
  });

  // Allow custom visual content (e.g. progress bars) via renderContent
  if (opts.renderContent) {
    opts.renderContent(wrapper);
  } else {
    wrapper.textContent = display;
  }

  wrapper.dataset.rowIdx = String(rowIdx);
  wrapper.dataset.colIdx = String(colIdx);

  function startEdit() {
    if (wrapper.querySelector('input')) return;            // already editing
    const current = text || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'editable-cell-input';
    input.value = current;

    wrapper.textContent = '';
    wrapper.append(input);
    input.focus();
    input.select();

    function commit() {
      const newValue = input.value.trim();
      input.removeEventListener('blur', commit);
      if (opts.renderContent) {
        opts.renderContent(wrapper);
      } else {
        wrapper.textContent = newValue || '—';
      }
      if (newValue !== current && !(current === '' && newValue === '')) {
        emitEdit(rowIdx, colIdx, newValue);
        if (opts.onCommit) opts.onCommit(newValue, wrapper);
      }
    }

    function cancel() {
      input.removeEventListener('blur', commit);
      if (opts.renderContent) {
        opts.renderContent(wrapper);
      } else {
        wrapper.textContent = current || '—';
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
  }

  wrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    startEdit();
  });

  return wrapper;
}

/* Re-export el for convenience — templates only need to import from shared */
export { el };

/* ---------- Add-Row Form Builder ---------- */

/** @type {boolean} Whether the add-row form is currently expanded */
let _addRowExpanded = false;

/**
 * Check whether the add-row form is currently expanded.
 * Used by the orchestrator to suppress auto-refresh.
 * @returns {boolean}
 */
export function isAddRowOpen() { return _addRowExpanded; }

/**
 * Build the add-row UI: a trigger button that expands into an inline form.
 *
 * @param {Object}   templateDef   the full template definition object
 * @param {Object}   cols          column index map from template.columns()
 * @param {number}   totalColumns  total number of columns in the sheet header
 * @param {function} onSubmit      callback(rowsToAppend: string[][])
 * @param {Object}   [opts]
 * @param {Object}   [opts.defaults]  pre-fill values keyed by role name
 * @returns {HTMLElement}
 */
export function buildAddRowForm(templateDef, cols, totalColumns, onSubmit, opts = {}) {
  const fields = typeof templateDef.addRowFields === 'function'
    ? templateDef.addRowFields(cols).filter(f => f.colIndex >= 0)
    : [];
  if (fields.length === 0) return el('span');

  const noun = templateDef.itemNoun || 'Item';
  const color = templateDef.color || 'var(--color-primary)';

  const root = el('div', { className: 'add-row-root' });

  /* ---- Collapsed trigger ---- */
  const trigger = el('button', {
    className: 'add-row-trigger',
    style: `--add-row-accent: ${color}`,
  }, [`+ Add ${noun}`]);

  /* ---- Expanded form ---- */
  const form = el('div', { className: 'add-row-form hidden', style: `--add-row-accent: ${color}` });

  // Track inputs/selects keyed by role
  const inputMap = {};
  // Track list containers for type:'list'
  const listMap = {};

  for (const field of fields) {
    if (field.hidden) continue;

    const fieldWrap = el('div', { className: 'add-row-field' });
    const label = el('label', { className: 'add-row-field-label' }, [field.label]);
    fieldWrap.append(label);

    const defaultVal = (opts.defaults && opts.defaults[field.role]) || field.defaultValue || '';
    const resolvedDefault = defaultVal === '__TODAY__'
      ? new Date().toISOString().slice(0, 10)
      : defaultVal;

    if (field.type === 'select' && field.options) {
      const select = el('select', { className: 'add-row-field-select' });
      for (const opt of field.options) {
        const optEl = el('option', { value: opt }, [opt || '(none)']);
        if (opt === resolvedDefault) optEl.selected = true;
        select.append(optEl);
      }
      inputMap[field.role] = select;
      fieldWrap.append(select);
    } else if (field.type === 'list') {
      // Dynamic list for recipe-style multi-row fields
      const listContainer = el('div', { className: 'add-row-list' });
      const items = [];

      function addListItem(value) {
        const itemWrap = el('div', { className: 'add-row-list-item' });
        const input = el('input', {
          type: 'text',
          className: 'add-row-field-input',
          placeholder: field.placeholder || '',
          value: value || '',
        });
        const removeBtn = el('button', {
          className: 'add-row-list-remove',
          type: 'button',
          title: 'Remove',
        }, ['\u00d7']);
        removeBtn.addEventListener('click', () => {
          const idx = items.indexOf(itemWrap);
          if (idx >= 0) items.splice(idx, 1);
          itemWrap.remove();
        });
        itemWrap.append(input, removeBtn);
        items.push(itemWrap);
        listContainer.insertBefore(itemWrap, addBtn);
        input.focus();
      }

      const addBtn = el('button', {
        className: 'add-row-list-add',
        type: 'button',
      }, [`+ Add ${field.label.replace(/s$/, '')}`]);
      addBtn.addEventListener('click', () => addListItem(''));
      listContainer.append(addBtn);

      // Start with one empty item
      addListItem('');

      listMap[field.role] = { container: listContainer, items };
      fieldWrap.append(listContainer);
    } else {
      const inputType = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text';
      const input = el('input', {
        type: inputType,
        className: 'add-row-field-input',
        placeholder: field.placeholder || '',
        value: resolvedDefault,
      });
      inputMap[field.role] = input;
      fieldWrap.append(input);
    }

    form.append(fieldWrap);
  }

  /* ---- Actions ---- */
  const actions = el('div', { className: 'add-row-actions' });
  const cancelBtn = el('button', {
    className: 'btn btn-secondary add-row-cancel',
    type: 'button',
  }, ['Cancel']);
  const submitBtn = el('button', {
    className: 'btn btn-primary add-row-submit',
    type: 'button',
    style: `background: ${color}`,
  }, [`Add ${noun}`]);
  actions.append(cancelBtn, submitBtn);
  form.append(actions);

  /* ---- Behavior ---- */
  function expand() {
    trigger.classList.add('hidden');
    form.classList.remove('hidden');
    _addRowExpanded = true;
    // Focus first visible input
    const first = form.querySelector('input, select');
    if (first) first.focus();
  }

  function collapse() {
    form.classList.add('hidden');
    trigger.classList.remove('hidden');
    _addRowExpanded = false;
    clearForm();
  }

  function clearForm() {
    for (const field of fields) {
      if (field.hidden) continue;
      const defaultVal = (opts.defaults && opts.defaults[field.role]) || field.defaultValue || '';
      const resolved = defaultVal === '__TODAY__'
        ? new Date().toISOString().slice(0, 10)
        : defaultVal;
      if (field.type === 'list') {
        // Reset to one empty item
        const info = listMap[field.role];
        if (info) {
          info.items.length = 0;
          const inputs = info.container.querySelectorAll('.add-row-list-item');
          inputs.forEach(i => i.remove());
          // Re-add one blank
          const itemWrap = el('div', { className: 'add-row-list-item' });
          const input = el('input', {
            type: 'text',
            className: 'add-row-field-input',
            placeholder: field.placeholder || '',
          });
          const removeBtn = el('button', {
            className: 'add-row-list-remove',
            type: 'button',
            title: 'Remove',
          }, ['\u00d7']);
          removeBtn.addEventListener('click', () => {
            const idx = info.items.indexOf(itemWrap);
            if (idx >= 0) info.items.splice(idx, 1);
            itemWrap.remove();
          });
          itemWrap.append(input, removeBtn);
          info.items.push(itemWrap);
          const addBtn = info.container.querySelector('.add-row-list-add');
          info.container.insertBefore(itemWrap, addBtn);
        }
      } else if (inputMap[field.role]) {
        if (field.type === 'select') {
          inputMap[field.role].value = resolved;
        } else {
          inputMap[field.role].value = resolved;
        }
      }
    }
    // Clear required highlights
    form.querySelectorAll('.add-row-required').forEach(e => e.classList.remove('add-row-required'));
  }

  function getValues() {
    const values = {};
    for (const field of fields) {
      if (field.hidden) {
        const defaultVal = (opts.defaults && opts.defaults[field.role]) || field.defaultValue || '';
        values[field.role] = defaultVal === '__TODAY__'
          ? new Date().toISOString().slice(0, 10)
          : defaultVal;
        continue;
      }
      if (field.type === 'list') {
        const info = listMap[field.role];
        if (info) {
          values[field.role] = info.items
            .map(item => item.querySelector('input')?.value?.trim() || '')
            .filter(v => v !== '');
        } else {
          values[field.role] = [];
        }
      } else if (inputMap[field.role]) {
        values[field.role] = (inputMap[field.role].value || '').trim();
      }
    }
    return values;
  }

  function validate() {
    let valid = true;
    for (const field of fields) {
      if (!field.required || field.hidden) continue;
      if (field.type === 'list') {
        const info = listMap[field.role];
        const hasItems = info && info.items.some(item => {
          const v = item.querySelector('input')?.value?.trim();
          return v && v.length > 0;
        });
        if (!hasItems) {
          valid = false;
          if (info) info.container.classList.add('add-row-required');
        } else {
          if (info) info.container.classList.remove('add-row-required');
        }
      } else if (inputMap[field.role]) {
        const val = (inputMap[field.role].value || '').trim();
        if (!val) {
          valid = false;
          inputMap[field.role].classList.add('add-row-required');
        } else {
          inputMap[field.role].classList.remove('add-row-required');
        }
      }
    }
    return valid;
  }

  function buildRows(values) {
    // Find any list-type fields
    const listFields = fields.filter(f => f.type === 'list');
    const scalarFields = fields.filter(f => f.type !== 'list');

    if (listFields.length === 0) {
      // Simple case: one row
      const row = new Array(totalColumns).fill('');
      for (const field of fields) {
        if (field.colIndex >= 0 && field.colIndex < totalColumns) {
          row[field.colIndex] = values[field.role] || '';
        }
      }
      return [row];
    }

    // Multi-row case (recipe): number of rows = max list length
    const maxLen = Math.max(1, ...listFields.map(f => (values[f.role] || []).length));
    const rows = [];
    for (let r = 0; r < maxLen; r++) {
      const row = new Array(totalColumns).fill('');
      // Scalar fields only on first row
      if (r === 0) {
        for (const field of scalarFields) {
          if (field.colIndex >= 0 && field.colIndex < totalColumns) {
            row[field.colIndex] = values[field.role] || '';
          }
        }
      }
      // List fields on every row
      for (const field of listFields) {
        const list = values[field.role] || [];
        if (r < list.length && field.colIndex >= 0 && field.colIndex < totalColumns) {
          row[field.colIndex] = list[r];
        }
      }
      rows.push(row);
    }
    return rows;
  }

  trigger.addEventListener('click', expand);
  cancelBtn.addEventListener('click', collapse);

  submitBtn.addEventListener('click', () => {
    if (!validate()) return;
    const values = getValues();
    const rows = buildRows(values);
    collapse();
    onSubmit(rows);
  });

  // Escape to cancel
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); collapse(); }
  });

  root.append(trigger, form);
  return root;
}
