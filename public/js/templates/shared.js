/* ============================================================
   templates/shared.js — Shared utilities for template renderers
   
   Provides cell access, edit callbacks, and the template
   registry that individual template modules register into.
   ============================================================ */

import { el, showToast } from '../ui.js';
export { WaymarkConnect } from '../webrtc.js';

/* ---------- Edit callback (set by checklist.js) ---------- */

let _onCellEdit = null;

/* ---------- Edit Lock (set by checklist.js) ---------- */

let _editLocked = false;

/**
 * Lock or unlock inline editing globally.
 * @param {boolean} locked
 */
export function setEditLocked(locked) { _editLocked = !!locked; }

/**
 * Check whether inline editing is currently locked.
 * @returns {boolean}
 */
export function isEditLocked() { return _editLocked; }

/* ---------- User name (set by checklist.js for note authoring) ---------- */

let _userName = '';

/**
 * Set the display name of the current user (called by checklist.js).
 * @param {string} name
 */
export function setUserName(name) { _userName = name || ''; }

/**
 * Get the display name of the current user.
 * @returns {string}
 */
export function getUserName() { return _userName; }

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

/** Check if a string looks like a URL pointing to an image.
 * @param {string} val
 * @returns {boolean}
 */
export function isImageUrl(val) {
  if (!val || typeof val !== 'string') return false;
  const v = val.trim().toLowerCase();
  return /^https?:\/\/.+\.(jpe?g|png|gif|webp|svg|bmp|avif)(\?.*)?$/i.test(v)
    || /^https?:\/\/(lh[0-9]*\.googleusercontent\.com|drive\.google\.com|.*\.ggpht\.com)\//i.test(v);
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

/* ---------- Cross-Feature Registry ---------- */

/**
 * Cross-features let templates share specialised capabilities.
 *
 * **Provider** — any template can register a reusable data extractor + widget
 *   by calling registerCrossFeature() in its module.
 *
 * **Consumer** — any template can declare `crossFeatures: [{ featureId, label, icon }]`
 *   in its definition to accept linked provider data.
 *
 * checklist.js bridges the two at render-time: it reads the consumer's
 * declarations, looks up the linked provider sheet in localStorage,
 * fetches data, extracts it, and renders the provider's widget.
 *
 * @type {Record<string, {provider:string, name:string, icon:string,
 *        extractData:Function, buildWidget:Function}>}
 */
const CROSS_FEATURES = {};

/**
 * Register a cross-feature provided by a template.
 * @param {string} id — unique feature key (e.g. 'sensor-reading')
 * @param {Object} def
 * @param {string} def.provider — template key that provides this feature
 * @param {string} def.name — human-readable display name
 * @param {string} def.icon — emoji icon
 * @param {function} def.extractData — (rows, cols) → data array
 * @param {function} def.buildWidget — (container, data) → void (renders into container)
 */
export function registerCrossFeature(id, def) {
  CROSS_FEATURES[id] = def;
}

/** Look up a single cross-feature by ID. */
export function getCrossFeature(id) {
  return CROSS_FEATURES[id] || null;
}

/** Return a shallow copy of the entire cross-feature registry. */
export function getCrossFeatures() {
  return { ...CROSS_FEATURES };
}

/**
 * Check a template's migrations array against its detected cols.
 * Returns an array of {header, role, description} for columns the
 * sheet is missing but the template now supports.
 * @param {Object} template
 * @param {Object} cols — result of template.columns(lower)
 * @returns {Array<{header:string, role:string, description?:string}>}
 */
export function getMissingMigrations(template, cols) {
  if (!template.migrations || !Array.isArray(template.migrations)) return [];
  return template.migrations.filter(m => cols[m.role] === -1);
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
    if (_editLocked) return;                               // sheet is locked
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

/* ---------- Combo-editable cell (dropdown + free-text) ---------- */

/**
 * Create a cell that shows a dropdown with existing values on click,
 * but also allows free-text typing for new values.
 * Works like a dropdown + free-text input combo.
 *
 * @param {string}  tag        — wrapper element tag
 * @param {Object}  attrs      — attributes forwarded to el()
 * @param {string}  text       — initial display text
 * @param {number}  rowIdx     — 1-based data-row index
 * @param {number}  colIdx     — 0-based column index
 * @param {string[]} options   — known option values for the dropdown
 * @param {Object}  [opts]     — extra options (onCommit)
 * @returns {HTMLElement}
 */
export function comboCell(tag, attrs, text, rowIdx, colIdx, options, opts = {}) {
  const display = text || '—';
  const wrapper = el(tag, {
    ...attrs,
    className: `${attrs.className || ''} editable-cell combo-cell`.trim(),
    tabindex: '0',
    title: attrs.title || 'Click to edit',
  });
  wrapper.textContent = display;
  wrapper.dataset.rowIdx = String(rowIdx);
  wrapper.dataset.colIdx = String(colIdx);

  function startEdit() {
    if (_editLocked) return;
    if (wrapper.querySelector('input')) return;
    const current = text || '';

    /* Deduplicated option list */
    const comboOptions = [];
    const seen = new Set();
    for (const opt of options) {
      if (!opt || seen.has(opt)) continue;
      seen.add(opt);
      comboOptions.push(opt);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'editable-cell-input combo-cell-input';
    input.value = current;

    const arrow = el('button', {
      type: 'button',
      className: 'combo-cell-arrow',
      tabindex: '-1',
    }, ['\u25BE']);

    const dropdown = el('div', { className: 'combo-cell-dropdown hidden' });

    function buildList(filter) {
      dropdown.innerHTML = '';
      const lower = (filter || '').toLowerCase();
      let count = 0;
      for (const opt of comboOptions) {
        if (lower && !opt.toLowerCase().includes(lower)) continue;
        const item = el('div', { className: 'combo-cell-option' }, [opt]);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = opt;
          commit();
        });
        dropdown.append(item);
        count++;
      }
      if (count === 0 && filter) {
        dropdown.append(el('div', { className: 'combo-cell-empty' }, [
          `"${filter}" (new)`,
        ]));
      }
    }

    function openDropdown() {
      buildList(input.value);
      dropdown.classList.remove('hidden');
    }

    function closeDropdown() {
      dropdown.classList.add('hidden');
    }

    wrapper.textContent = '';
    wrapper.append(input, arrow, dropdown);
    input.focus();
    input.select();
    openDropdown();

    input.addEventListener('input', () => buildList(input.value));

    function commit() {
      const newValue = input.value.trim();
      input.removeEventListener('blur', onBlur);
      closeDropdown();
      wrapper.textContent = newValue || '—';
      if (newValue !== current && !(current === '' && newValue === '')) {
        emitEdit(rowIdx, colIdx, newValue);
        if (opts.onCommit) opts.onCommit(newValue, wrapper);
      }
    }

    function cancel() {
      input.removeEventListener('blur', onBlur);
      closeDropdown();
      wrapper.textContent = current || '—';
    }

    function onBlur() {
      /* Small delay so mousedown on option fires first */
      setTimeout(commit, 150);
    }

    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    arrow.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (dropdown.classList.contains('hidden')) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });
  }

  wrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    startEdit();
  });

  return wrapper;
}

/* ---------- Textarea-editable cell (multiline) ---------- */

/**
 * Create a cell that opens as a multiline textarea on click.
 *
 * @param {string}  tag        — wrapper element tag
 * @param {Object}  attrs      — attributes forwarded to el()
 * @param {string}  text       — initial display text
 * @param {number}  rowIdx     — 1-based data-row index
 * @param {number}  colIdx     — 0-based column index
 * @param {Object}  [opts]     — extra options (onCommit)
 * @returns {HTMLElement}
 */
export function textareaCell(tag, attrs, text, rowIdx, colIdx, opts = {}) {
  const display = text || '—';
  const wrapper = el(tag, {
    ...attrs,
    className: `${attrs.className || ''} editable-cell textarea-cell`.trim(),
    tabindex: '0',
    title: attrs.title || 'Click to edit',
  });
  wrapper.textContent = display;
  wrapper.dataset.rowIdx = String(rowIdx);
  wrapper.dataset.colIdx = String(colIdx);

  function startEdit() {
    if (_editLocked) return;
    if (wrapper.querySelector('textarea')) return;
    const current = text || '';

    const ta = document.createElement('textarea');
    ta.className = 'editable-cell-textarea';
    ta.value = current;
    ta.rows = Math.max(3, current.split('\n').length + 1);

    wrapper.textContent = '';
    wrapper.append(ta);
    ta.focus();
    ta.select();

    function commit() {
      const newValue = ta.value.trim();
      ta.removeEventListener('blur', commit);
      wrapper.textContent = newValue || '—';
      if (newValue !== current && !(current === '' && newValue === '')) {
        emitEdit(rowIdx, colIdx, newValue);
        if (opts.onCommit) opts.onCommit(newValue, wrapper);
      }
    }

    function cancel() {
      ta.removeEventListener('blur', commit);
      wrapper.textContent = current || '—';
    }

    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      /* Ctrl/Cmd + Enter to commit (plain Enter adds newline) */
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.blur(); }
    });
  }

  wrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    startEdit();
  });

  return wrapper;
}

/* Re-export el and showToast for convenience — templates only need to import from shared */
export { el, showToast };

/* ---------- Generic Helpers ---------- */

/**
 * Set up delegated event handling on a container element.
 * The handler fires only when the event target (or an ancestor up to container)
 * matches the given CSS selector.
 *
 * @param {HTMLElement} container — ancestor element that owns the listener
 * @param {string}      eventType — DOM event name ('click', 'dragstart', etc.)
 * @param {string}      selector  — CSS selector to match against event target
 * @param {(e: Event, match: HTMLElement) => void} handler — called with the event and matched element
 */
export function delegateEvent(container, eventType, selector, handler) {
  container.addEventListener(eventType, (e) => {
    const match = /** @type {HTMLElement} */ (e.target).closest?.(selector);
    if (match && container.contains(match)) {
      handler(e, match);
    }
  });
}

/**
 * Build a directory-view sync button that triggers folder refresh.
 * Dispatches `waymark:folder-refresh` on click via event delegation.
 *
 * @param {HTMLElement} delegateRoot — ancestor to attach the click listener to
 * @returns {HTMLElement} the sync button element
 */
export function buildDirSyncBtn(delegateRoot) {
  const btn = el('button', {
    className: 'dir-sync-btn',
    type: 'button',
    title: 'Select files from the shared folder to sync with your team',
  }, ['\uD83D\uDD04 Sync']);
  delegateEvent(delegateRoot, 'click', '.dir-sync-btn', () => {
    window.dispatchEvent(new CustomEvent('waymark:folder-refresh'));
  });
  return btn;
}

/**
 * Lazily render a section inside a parent element.
 * On first call, invokes `buildFn` and appends the result.
 * On subsequent calls, removes the `hidden` class to reveal it.
 *
 * @param {HTMLElement} parent   — container to search / append into
 * @param {string}      selector — CSS selector to find existing section
 * @param {() => HTMLElement} buildFn — factory called once to create the section
 * @returns {HTMLElement} the (possibly new) section element
 */
export function lazySection(parent, selector, buildFn) {
  let section = parent.querySelector(selector);
  if (!section) {
    section = buildFn();
    parent.append(section);
  }
  section.classList.remove('hidden');
  return section;
}

/**
 * Parse flat sheet rows into groups using §4.7 contiguous row-grouping.
 * A new group starts whenever the primary column is non-empty;
 * subsequent rows with an empty primary column are children of the
 * preceding group.
 *
 * @param {string[][]} rows          — data rows (header row excluded)
 * @param {number}     primaryColIdx — column index of the group key (e.g. task name, recipe name)
 * @param {Object}     [opts]
 * @param {() => Object}            [opts.initGroup]    — factory for extra properties on each group (e.g. `() => ({ subtasks: [], notes: [] })`)
 * @param {(child: {row: string[], idx: number}, group: Object) => void} [opts.classifyChild] — assign a child row to its group's sub-arrays
 * @returns {Array<{row: string[], idx: number, children: Array<{row: string[], idx: number}>}>}
 */
export function parseGroups(rows, primaryColIdx, opts = {}) {
  const groups = [];
  let current = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const primary = cell(row, primaryColIdx);

    if (primary) {
      current = { row, idx: i, children: [], ...(opts.initGroup ? opts.initGroup() : {}) };
      groups.push(current);
    } else if (current) {
      const child = { row, idx: i };
      if (opts.classifyChild) {
        opts.classifyChild(child, current);
      } else {
        current.children.push(child);
      }
    }
  }
  return groups;
}

/* ---------- Value-Based Grouping ---------- */

/**
 * Group rows by the value in a specific column.
 * Returns a Map<string, {row, originalIndex}[]> preserving insertion order.
 *
 * @param {any[][]} rows       — data rows (header excluded)
 * @param {number}  colIdx     — column index to group by (-1 puts all in one group)
 * @param {string}  [fallback] — label when the cell is empty (default: 'Other')
 * @returns {Map<string, {row: any[], originalIndex: number}[]>}
 */
export function groupByColumn(rows, colIdx, fallback = 'Other') {
  const groups = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = colIdx >= 0 ? (cell(row, colIdx) || fallback) : fallback;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row, originalIndex: i });
  }
  return groups;
}

/* ---------- Status-Cycle Utility ---------- */

/**
 * Cycle a status badge element through an ordered list of states.
 * Returns the next state string so callers can do follow-up work
 * (e.g. update parent card class, emit edit).
 *
 * @param {HTMLElement} badge   — the element whose textContent is the current state
 * @param {string[]}    states  — ordered state labels, e.g. ['Lead','Contacted','Won']
 * @param {function}    classify — maps a state string to a CSS suffix, e.g. 'won' | 'lead'
 * @param {string}      cssPrefix — base class(es) before the suffix, e.g. 'crm-stage-btn crm-stage-'
 * @returns {string} the next state label
 */
export function cycleStatus(badge, states, classify, cssPrefix) {
  const current = badge.textContent.trim();
  const idx = states.findIndex(s => s.toLowerCase() === current.toLowerCase());
  const next = states[(idx + 1) % states.length];
  badge.textContent = next;
  badge.className = `${cssPrefix}${classify(next)}`;
  return next;
}

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

    /* Merge dynamic options provided at call-site */
    const fieldOptions = (opts.dynamicOptions && opts.dynamicOptions[field.role])
      ? opts.dynamicOptions[field.role]
      : field.options;

    if (field.type === 'select' && fieldOptions) {
      const select = el('select', { className: 'add-row-field-select' });
      for (const opt of fieldOptions) {
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
    } else if (field.type === 'combo') {
      /* Custom combo: text input + visible dropdown with filter */
      const comboWrap = el('div', { className: 'add-row-combo-wrap' });
      const input = el('input', {
        type: 'text',
        className: 'add-row-field-input add-row-field-combo',
        placeholder: field.placeholder || '',
        value: resolvedDefault,
      });
      const arrow = el('button', {
        type: 'button',
        className: 'add-row-combo-arrow',
        tabindex: '-1',
      }, ['\u25BE']);
      const dropdown = el('div', { className: 'add-row-combo-dropdown hidden' });

      const comboOptions = (fieldOptions || []).filter(o => o !== '');

      function buildList(filter) {
        dropdown.innerHTML = '';
        const lower = (filter || '').toLowerCase();
        let count = 0;
        for (const opt of comboOptions) {
          if (lower && !opt.toLowerCase().includes(lower)) continue;
          const item = el('div', { className: 'add-row-combo-option' }, [opt]);
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = opt;
            closeDropdown();
          });
          dropdown.append(item);
          count++;
        }
        if (count === 0 && filter) {
          dropdown.append(el('div', { className: 'add-row-combo-empty' }, [
            `"${filter}" (new)`,
          ]));
        }
      }

      function openDropdown() {
        buildList(input.value);
        dropdown.classList.remove('hidden');
      }

      function closeDropdown() {
        dropdown.classList.add('hidden');
      }

      input.addEventListener('focus', openDropdown);
      input.addEventListener('input', () => buildList(input.value));
      input.addEventListener('blur', () => {
        /* Small delay so mousedown on option fires first */
        setTimeout(closeDropdown, 150);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
      });
      arrow.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (dropdown.classList.contains('hidden')) {
          input.focus();
        } else {
          closeDropdown();
        }
      });

      comboWrap.append(input, arrow, dropdown);
      inputMap[field.role] = input;
      fieldWrap.append(comboWrap);
    } else if (field.type === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.className = 'add-row-field-input add-row-field-textarea';
      textarea.placeholder = field.placeholder || '';
      textarea.value = resolvedDefault;
      textarea.rows = 3;
      inputMap[field.role] = textarea;
      fieldWrap.append(textarea);
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
    /* Remove existing highlights first so the shake animation re-triggers */
    form.querySelectorAll('.add-row-required').forEach(e => e.classList.remove('add-row-required'));

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
          if (info) requestAnimationFrame(() => info.container.classList.add('add-row-required'));
        }
      } else if (inputMap[field.role]) {
        const val = (inputMap[field.role].value || '').trim();
        if (!val) {
          valid = false;
          const inp = inputMap[field.role];
          requestAnimationFrame(() => inp.classList.add('add-row-required'));
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

/* ---------- Chart engine re-exports ---------- */

/* Templates access these via shared.js (§1.5 — templates import only from shared.js) */
export {
  drawLineChart,
  drawBarChart,
  drawPieChart,
  normalizeValues,
  polarToCartesian,
  computePieAngles,
  formatAxisLabel,
} from './charts.js';

/* ---------- Chat preference re-exports ---------- */

/* Templates access these via shared.js (§1.5 — templates import only from shared.js) */
export {
  getChatSaveHistory,
  setChatSaveHistory,
  getChatSoundEnabled,
  setChatSoundEnabled,
  getEchoCancellation,
  setEchoCancellation,
  getNoiseSuppression,
  setNoiseSuppression,
  getAutoGainControl,
  setAutoGainControl,
  getNoiseGateThreshold,
  setNoiseGateThreshold,
  getHighPassFreq,
  setHighPassFreq,
  getEchoSuppression,
  setEchoSuppression,
} from '../storage.js';
