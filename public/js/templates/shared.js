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
