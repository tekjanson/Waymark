/* ============================================================
   flow/inspector.js — Inspector panel (update-in-place)

   Builds the inspector DOM skeleton once per flow group.
   On node selection, swaps textContent / input values
   instead of tearing down and rebuilding, eliminating
   visible flicker on complex diagrams.
   ============================================================ */

import { el, emitEdit, delegateEvent } from '../shared.js';
import { NODE_SHAPES } from './helpers.js';

/* ---------- Inspector Factory ---------- */

/**
 * Create an inspector that updates in place.
 * Call once per group; returns { show(node), hide() }.
 *
 * @param {HTMLElement} inspector — container div
 * @param {Object}      ctx
 * @param {Object}      ctx.cols
 * @param {Object}      ctx.group
 * @param {Object}      ctx.layout
 * @param {Function}    ctx.rerenderEdges
 * @param {Function}    ctx.deselectNode
 * @returns {{ show: (node: Object) => void, hide: () => void }}
 */
export function initInspector(inspector, ctx) {
  const { cols, group, layout, rerenderEdges, deselectNode } = ctx;

  /* Mutable ref — always points at the currently selected node */
  const _cur = { node: null, rowIdx: 0 };

  /* ---------- Header skeleton ---------- */
  const badgeEl = el('span', { className: 'flow-type-badge' });
  const titleEl = el('h4', { className: 'flow-inspector-title' });
  const closeBtn = el('button', {
    className: 'flow-inspector-close',
    on: { click: () => deselectNode() },
  }, ['\u2715']);

  inspector.append(el('div', { className: 'flow-inspector-header' }, [
    badgeEl, titleEl, closeBtn,
  ]));

  /* ---------- Fields skeleton ---------- */
  const stepField  = createField('Step Name', () => cols.step);
  const typeField  = createTypeField();
  const nextField  = createField('Next', () => cols.next, true);
  const condField  = createField('Condition', () => cols.condition);
  const notesField = createField('Notes', () => cols.notes);

  inspector.append(el('div', { className: 'flow-inspector-fields' }, [
    stepField.el, typeField.el, nextField.el, condField.el, notesField.el,
  ]));

  /* ---------- Disconnect button ---------- */
  const disconnectBtn = el('button', {
    className: 'flow-inspector-action hidden',
    on: { click() {
      const node = _cur.node;
      if (!node) return;
      emitEdit(_cur.rowIdx, cols.next, '');
      node.next = '';
      layout.edges = layout.edges.filter(e => e.from !== node);
      rerenderEdges();
      show(node);
    }},
  }, ['\u2298 Remove all connections']);
  inspector.append(disconnectBtn);

  /* ---------- show / hide ---------- */

  function show(node) {
    _cur.node = node;
    _cur.rowIdx = node.idx + 1;
    inspector.classList.remove('hidden');

    /* Header */
    const shape = NODE_SHAPES[node.type] || NODE_SHAPES.process;
    badgeEl.className = `flow-type-badge flow-type-${node.type}`;
    badgeEl.style.cssText = `--flow-type-color: ${shape.color}`;
    badgeEl.textContent = `${shape.icon} ${shape.label}`;
    titleEl.textContent = node.step;

    /* Fields */
    stepField.update(node.step);
    typeField.update(node.type);

    /* Rebuild combo suggestions for Next (depends on selected node) */
    const otherSteps = group.steps
      .filter(s => s.step !== node.step)
      .map(s => s.step);
    nextField.setSuggestions(otherSteps);
    nextField.update(node.next);

    condField.update(node.condition);
    notesField.update(node.notes);

    /* Disconnect button visibility */
    disconnectBtn.classList.toggle('hidden', !node.next);
  }

  function hide() {
    inspector.classList.add('hidden');
    _cur.node = null;
  }

  return { show, hide };

  /* ====================================================
     Field builders (private to this closure)
     ==================================================== */

  /**
   * Create a labelled text field.  When `isCombo` is true the field
   * also renders a combo dropdown whose options can be swapped via
   * `setSuggestions()` without rebuilding the field DOM.
   */
  function createField(label, colFn, isCombo = false) {
    const field = el('div', { className: 'flow-inspector-field' });
    field.append(el('label', { className: 'flow-inspector-label' }, [label]));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'flow-inspector-input';
    input.placeholder = `Enter ${label.toLowerCase()}\u2026`;

    let dropdown = null;
    let comboOptions = [];

    if (isCombo) {
      field.classList.add('flow-inspector-combo');
      input.classList.add('flow-inspector-combo-input');

      const arrow = el('button', {
        type: 'button',
        className: 'flow-inspector-combo-arrow',
        tabindex: '-1',
      }, ['\u25BE']);

      dropdown = el('div', { className: 'flow-inspector-combo-dropdown hidden' });

      function buildList(filter) {
        while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
        const lower = (filter || '').toLowerCase();
        let count = 0;
        for (const opt of comboOptions) {
          if (lower && !opt.toLowerCase().includes(lower)) continue;
          dropdown.append(el('div', {
            className: 'flow-inspector-combo-option',
            dataset: { value: opt },
          }, [opt]));
          count++;
        }
        if (count === 0 && filter) {
          dropdown.append(el('div', { className: 'flow-inspector-combo-empty' }, [
            `"${filter}" (new)`,
          ]));
        }
      }

      function openDropdown() {
        buildList(input.value);
        dropdown.classList.remove('hidden');
      }

      function closeDropdown() { dropdown.classList.add('hidden'); }

      delegateEvent(dropdown, 'mousedown', '.flow-inspector-combo-option', (e, match) => {
        e.preventDefault();
        input.value = match.dataset.value;
        commit();
      });

      input.addEventListener('focus', openDropdown);
      input.addEventListener('input', () => buildList(input.value));
      arrow.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (dropdown.classList.contains('hidden')) { openDropdown(); input.focus(); }
        else closeDropdown();
      });

      const wrap = el('div', { className: 'flow-inspector-combo-wrap' });
      wrap.append(input, arrow, dropdown);
      field.append(wrap);
    } else {
      field.append(input);
    }

    /* Commit logic — reads from _cur so it always targets the current node */
    function commit() {
      if (dropdown) dropdown.classList.add('hidden');
      const v = input.value.trim();
      const orig = (_cur.node && fieldValue()) || '';
      if (v !== orig) emitEdit(_cur.rowIdx, colFn(), v);
    }

    function fieldValue() {
      const n = _cur.node;
      if (!n) return '';
      const ci = colFn();
      if (ci === cols.step)      return n.step;
      if (ci === cols.next)      return n.next;
      if (ci === cols.condition) return n.condition;
      if (ci === cols.notes)     return n.notes;
      return '';
    }

    if (isCombo) {
      input.addEventListener('blur', () => setTimeout(commit, 150));
    } else {
      input.addEventListener('blur', commit);
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        input.value = fieldValue();
        if (dropdown) dropdown.classList.add('hidden');
        input.blur();
      }
    });

    return {
      el: field,
      update(val) { input.value = val || ''; },
      setSuggestions(items) {
        if (!isCombo) return;
        const seen = new Set();
        comboOptions = [];
        for (const s of items) {
          if (!s || seen.has(s)) continue;
          seen.add(s);
          comboOptions.push(s);
        }
      },
    };
  }

  /**
   * Create the Type dropdown field.
   * Reuses the same <select> across node changes.
   */
  function createTypeField() {
    const field = el('div', { className: 'flow-inspector-field' });
    field.append(el('label', { className: 'flow-inspector-label' }, ['Type']));

    const typeSelect = document.createElement('select');
    typeSelect.className = 'flow-inspector-select';
    for (const [key, info] of Object.entries(NODE_SHAPES)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${info.icon} ${info.label}`;
      typeSelect.append(opt);
    }
    field.append(typeSelect);

    delegateEvent(field, 'change', 'select', () => {
      emitEdit(_cur.rowIdx, cols.type, typeSelect.value);
    });

    return {
      el: field,
      update(type) { typeSelect.value = type; },
    };
  }
}
