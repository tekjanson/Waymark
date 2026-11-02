/* ============================================================
   templates/shared.js — Shared utilities for template renderers

   Provides cell access, edit callbacks, and the template
   registry that individual template modules register into.
   ============================================================ */

import { el, showToast, copyToClipboard } from '../ui.js';
import * as agentVault from '../agent/vault.js';
import { captureStillFromCamera, hasUserMedia, getUserMediaStream } from '../camera-capture.js';
export { WaymarkConnect } from '../webrtc.js';
export { buildHandshakePasswordRow } from '../handshake-auth.js';

/* ---------- Edit callback (set by checklist.js) ---------- */

let _onCellEdit = null;

/* ---------- Edit Lock (set by checklist.js) ---------- */

let _editLocked = false;

/**
 * Lock or unlock inline editing globally.
 * @param {boolean} locked
 */
function setEditLocked(locked) { _editLocked = !!locked; }

/**
 * Check whether inline editing is currently locked.
 * @returns {boolean}
 */
function isEditLocked() { return _editLocked; }

/* ---------- Protected rows (populated by checklist.js on sheet load) ---------- */

let _protectedRows = new Set();

/**
 * Replace the set of 0-based sheet-row indices that are server-side protected.
 * Called by checklist.js after fetching protectedRanges metadata.
 * @param {Set<number>} rowIndexSet
 */
function setProtectedRows(rowIndexSet) {
  _protectedRows = rowIndexSet instanceof Set ? rowIndexSet : new Set();
}

/**
 * Return true if the given 0-based sheet-row index is server-side protected.
 * In templates, the 1-based rowIdx used for emitEdit() equals the 0-based
 * sheet rowIndex (header is at 0, first data row at 1).
 * @param {number} rowIndex
 * @returns {boolean}
 */
function isRowProtected(rowIndex) { return _protectedRows.has(rowIndex); }

/* ---------- User name (set by checklist.js for note authoring) ---------- */

let _userName = '';

/**
 * Set the display name of the current user (called by checklist.js).
 * @param {string} name
 */
function setUserName(name) { _userName = name || ''; }

/**
 * Get the display name of the current user.
 * @returns {string}
 */
function getUserName() { return _userName; }

/**
 * Register a callback for cell edits.
 * @param {(rowIndex: number, colIndex: number, newValue: string) => void} fn
 */
function onEdit(fn) { _onCellEdit = fn; }

/**
 * Emit a cell edit event to the registered callback.
 * @param {number} rowIndex
 * @param {number} colIndex
 * @param {string} newValue
 */
function emitEdit(rowIndex, colIndex, newValue) {
  if (_editLocked) return;
  if (_onCellEdit) _onCellEdit(rowIndex, colIndex, newValue);
}

/**
 * Safely access a cell value from a row.
 * @param {string[]} row
 * @param {number} idx
 * @returns {string}
 */
function cell(row, idx) {
  return (idx >= 0 && idx < row.length) ? (row[idx] || '') : '';
}

/**
 * Parse a progress value into a percentage (0–100+).
 * Handles: "75%", "3/5", plain numbers with optional target.
 * @param {string} raw
 * @param {string} [rawTarget]
 * @returns {number}
 */
function parseProgress(raw, rawTarget) {
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
function isImageUrl(val) {
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
const TEMPLATES = {};

/**
 * Register a template definition.
 * @param {string} key — unique template key (e.g. 'checklist', 'kanban')
 * @param {Object} definition — template definition with name, icon, color, priority, detect, columns, render
 */
function registerTemplate(key, definition) {
  // A template MUST provide detect() and render(). Reject malformed definitions
  // (e.g. registry-metadata like detectSignals instead of a real detect()) so a
  // single bad template can never crash detectTemplate() for every sheet.
  if (!definition || typeof definition.detect !== 'function' || typeof definition.render !== 'function') {
    console.error('[templates] Ignoring invalid template "' + key + '": it must export detect() and render() functions.', definition);
    return;
  }
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
function registerCrossFeature(id, def) {
  CROSS_FEATURES[id] = def;
}

/** Look up a single cross-feature by ID. */
function getCrossFeature(id) {
  return CROSS_FEATURES[id] || null;
}

/** Return a shallow copy of the entire cross-feature registry. */
function getCrossFeatures() {
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
function getMissingMigrations(template, cols) {
  if (!template.migrations || !Array.isArray(template.migrations)) return [];
  return template.migrations.filter(m => cols[m.role] === -1);
}

/* ---------- Inline-editable cell ---------- */

/** Character count above which an inline editor opens as a multi-line textarea. */
const LONG_TEXT_THRESHOLD = 70;

/**
 * Whether a value is long enough (or multi-line) to warrant a textarea editor.
 * @param {string} v
 * @returns {boolean}
 */
function _looksLong(v) {
  return typeof v === 'string' && (v.includes('\n') || v.length > LONG_TEXT_THRESHOLD);
}

/**
 * Create a DOM element whose text content becomes an inline input control on click.
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
function editableCell(tag, attrs, text, rowIdx, colIdx, opts = {}) {
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
    if (_protectedRows.has(rowIdx)) {                      // server-side row protection
      showToast('This row is locked — editing is disabled', 'warn');
      return;
    }
    if (wrapper.querySelector('input, textarea')) return;  // already editing

    const current = text || '';
    let control = null;
    let done = false;
    let upgrading = false;

    function paint(value) {
      if (opts.renderContent) opts.renderContent(wrapper);
      else wrapper.textContent = value || '—';
    }

    function commit() {
      if (done) return;
      done = true;
      wrapper.classList.remove('editing-multiline');
      const newValue = control.value.trim();
      paint(newValue);
      if (newValue !== current && !(current === '' && newValue === '')) {
        emitEdit(rowIdx, colIdx, newValue);
        if (opts.onCommit) opts.onCommit(newValue, wrapper);
      }
    }

    function cancel() {
      if (done) return;
      done = true;
      wrapper.classList.remove('editing-multiline');
      paint(current);
    }

    function autoGrow(ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
    }

    /* Mount an input or textarea; re-mountable so a single-line input can
       upgrade to a textarea once its content grows long. */
    function mount(kind, value, caretToEnd) {
      const existing = wrapper.querySelector('input, textarea');
      if (existing) { upgrading = true; existing.remove(); upgrading = false; }

      const isTextarea = kind === 'textarea';
      control = document.createElement(isTextarea ? 'textarea' : 'input');
      control.className = isTextarea ? 'editable-cell-textarea' : 'editable-cell-input';
      if (!isTextarea) control.type = 'text';
      control.value = value;
      wrapper.classList.toggle('editing-multiline', isTextarea);
      wrapper.append(control);
      control.focus();
      if (caretToEnd) {
        const n = value.length;
        try { control.setSelectionRange(n, n); } catch (_) { /* noop */ }
      } else {
        control.select();
      }

      control.addEventListener('blur', () => { if (!upgrading) commit(); });
      control.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
        if (e.key === 'Enter') {
          if (isTextarea) {
            /* Ctrl/Cmd+Enter commits; plain Enter inserts a newline */
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); control.blur(); }
          } else {
            e.preventDefault(); control.blur();
          }
        }
      });

      if (isTextarea) {
        autoGrow(control);
        control.addEventListener('input', () => autoGrow(control));
      } else {
        /* Grow into a textarea automatically once the text gets long */
        control.addEventListener('input', () => {
          if (_looksLong(control.value)) mount('textarea', control.value, true);
        });
      }
    }

    wrapper.textContent = '';
    mount(_looksLong(current) ? 'textarea' : 'input', current, false);
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
function comboCell(tag, attrs, text, rowIdx, colIdx, options, opts = {}) {
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
function textareaCell(tag, attrs, text, rowIdx, colIdx, opts = {}) {
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

/* ---------- Date-picker editable cell ---------- */

const _ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format a stored date value for display. ISO dates (YYYY-MM-DD) render as a
 * friendly "Mon D, YYYY"; any other free-form text (e.g. "2 weeks before") is
 * shown verbatim so existing sheets are never mangled.
 * @param {string} v
 * @returns {string}
 */
function formatDateDisplay(v) {
  if (!v) return '—';
  if (_ISO_DATE.test(v)) {
    const d = new Date(`${v}T00:00:00`);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }
  return v;
}

/**
 * Create a cell that opens a native date picker (`input[type="date"]`) on click.
 * On commit the value is stored as an ISO date (YYYY-MM-DD). Free-form text
 * values are preserved when the picker is left untouched, so mixed date/label
 * columns keep working.
 *
 * @param {string}   tag    — wrapper element tag (e.g. 'span')
 * @param {Object}   attrs  — attributes forwarded to el()
 * @param {string}   text   — initial stored value
 * @param {number}   rowIdx — 1-based data-row index for emitEdit()
 * @param {number}   colIdx — 0-based column index for emitEdit()
 * @param {Object}   [opts] — extra options (onCommit)
 * @returns {HTMLElement}
 */
function dateCell(tag, attrs, text, rowIdx, colIdx, opts = {}) {
  let current = text || '';
  const wrapper = el(tag, {
    ...attrs,
    className: `${attrs.className || ''} editable-cell date-cell`.trim(),
    tabindex: '0',
    title: attrs.title || 'Click to pick a date',
  });
  wrapper.textContent = formatDateDisplay(current);
  wrapper.dataset.rowIdx = String(rowIdx);
  wrapper.dataset.colIdx = String(colIdx);

  function startEdit() {
    if (_editLocked) return;
    if (_protectedRows.has(rowIdx)) {
      showToast('This row is locked — editing is disabled', 'warn');
      return;
    }
    if (wrapper.querySelector('input')) return;

    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'editable-cell-input date-cell-input';
    if (_ISO_DATE.test(current)) input.value = current;

    wrapper.textContent = '';
    wrapper.append(input);
    input.focus();
    /* Best-effort: open the native picker immediately on supported browsers */
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); } catch (_) { /* user gesture / support guard */ }
    }

    function commit() {
      input.removeEventListener('blur', commit);
      const picked = input.value; // '' or 'YYYY-MM-DD'
      let newValue;
      if (picked) newValue = picked;
      else if (_ISO_DATE.test(current)) newValue = ''; // cleared a real date
      else newValue = current;                         // preserve free-form text
      wrapper.textContent = formatDateDisplay(newValue);
      if (newValue !== current) {
        current = newValue;
        emitEdit(rowIdx, colIdx, newValue);
        if (opts.onCommit) opts.onCommit(newValue, wrapper);
      }
    }

    function cancel() {
      input.removeEventListener('blur', commit);
      wrapper.textContent = formatDateDisplay(current);
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

/* Re-export el, showToast, and the clipboard helper for convenience —
   templates only need to import from shared. copyToClipboard is the single safe
   implementation (secure-context Clipboard API + execCommand fallback). */
export { el, showToast, copyToClipboard };

/* Re-export the camera still-capture helper so template sub-modules can access
   it without importing outside their folder (§1.5). */
export { captureStillFromCamera };


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
function delegateEvent(container, eventType, selector, handler) {
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
function buildDirSyncBtn(delegateRoot) {
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
function lazySection(parent, selector, buildFn) {
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
function parseGroups(rows, primaryColIdx, opts = {}) {
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
function groupByColumn(rows, colIdx, fallback = 'Other') {
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
function cycleStatus(badge, states, classify, cssPrefix) {
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
function isAddRowOpen() { return _addRowExpanded; }

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
function buildAddRowForm(templateDef, cols, totalColumns, onSubmit, opts = {}) {
  const fields = typeof templateDef.addRowFields === 'function'
    ? templateDef.addRowFields(cols).filter(f => f.colIndex >= 0)
    : [];
  if (fields.length === 0) return el('span');

  const noun = opts.noun || templateDef.itemNoun || 'Item';
  const color = templateDef.color || 'var(--color-primary)';

  /* Per-instance role overrides — let callers (e.g. per-category and
     new-category checklist forms) hide or require specific roles without
     changing the template's addRowFields() definition. */
  const hiddenRoles = new Set(opts.hiddenRoles || []);
  const requiredRoles = new Set(opts.requiredRoles || []);
  const isHidden = (f) => !!f.hidden || hiddenRoles.has(f.role);
  const isRequired = (f) => !!f.required || requiredRoles.has(f.role);

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
    if (isHidden(field)) continue;

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
      if (isHidden(field)) continue;
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
      if (isHidden(field)) {
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
      if (!isRequired(field) || isHidden(field)) continue;
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

/* ---------- Nutrition & fitness engine re-exports ---------- */

/* Shared by the Calorie Tracker and Meal Planner (§1.5 — templates import
   only from shared.js). See templates/nutrition.js. */
export {
  DEFAULT_WEIGHT_KG,
  parseNum,
  round1,
  scaleMacros,
  searchFoodDatabase,
  loadFoodDatabase,
  expandReference,
  _setFoodDatabase,
  lookupBarcode,
  normalizeOffProduct,
  caloriesFromMet,
  loadExerciseDatabase,
  expandExercises,
  _setExerciseDatabase,
  searchExerciseDatabase,
  ACTIVITY_FACTORS,
  ACTIVITY_LABELS,
  GOAL_LABELS,
  computeBMR,
  computeTDEE,
  computeCalorieGoal,
  computeMacroTargets,
  goalFromProfile,
} from './nutrition.js';

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
  getCalorieProfile,
  setCalorieProfile,
  getTemplatePref,
  setTemplatePref,
  getRaw,
  setRaw,
  removeRaw,
} from '../storage.js';

/* ---------- AI text generation ---------- */

import { routeAI, CAP } from '../ai-router.js';

/**
 * Prepare a template AI action by unlocking the linked keys vault with this
 * device's biometric credential when available.
 * @returns {Promise<boolean>}
 */
async function ensureAIKeyVaultUnlocked() {
  if (!agentVault.isVaultSetUp() || agentVault.isVaultUnlocked()) return true;
  return agentVault.ensureVaultUnlocked();
}

/** Explain how to proceed when the linked AI keys vault could not unlock. */
function getAIKeyVaultUnlockMessage() {
  return agentVault.hasBiometricVault()
    ? 'Biometric unlock was cancelled or failed. Unlock your AI keys and try again.'
    : 'Your AI keys are locked. Unlock them in AI settings and enable biometric unlock for next time.';
}

/** Capture a still image after automatically unlocking the AI keys vault. */
async function captureImageForAI(opts = {}) {
  if (!await ensureAIKeyVaultUnlocked()) throw new Error(getAIKeyVaultUnlockMessage());
  return captureStillFromCamera(opts);
}

/**
 * Generate text via the cost-aware AI router. Routes to the cheapest capable
 * provider (local Ollama / Gemini Free Tier first), falling back automatically.
 * Templates use this for AI-powered features (§1.5-compliant).
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {{ temperature?: number, maxTokens?: number, json?: boolean, provider?: string }} [opts]
 * @returns {Promise<string>}
 */
async function generateText(systemPrompt, userMessage, opts = {}) {
  const capability = opts.json ? CAP.STRUCTURED_JSON : CAP.TEXT_BASIC;
  return routeAI(capability, { systemPrompt, userMessage }, {
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 1024,
    provider: opts.provider,
  });
}

/**
 * Analyse an inline image via the cost-aware router (vision capability).
 * Routes to the cheapest vision-capable provider (Gemini Free Tier first, then
 * OpenAI), with automatic fallback. Templates use this for vision features.
 * @param {string} systemPrompt
 * @param {string} base64Image   raw base64 (no data: prefix)
 * @param {string} [mimeType]
 * @param {{ temperature?: number, maxTokens?: number, userMessage?: string, provider?: string }} [opts]
 * @returns {Promise<string>}
 */
async function generateVision(systemPrompt, base64Image, mimeType = 'image/jpeg', opts = {}) {
  return routeAI(CAP.VISION_ANALYSIS, {
    systemPrompt, base64Image, mimeType, userMessage: opts.userMessage,
  }, {
    temperature: opts.temperature ?? 0.4,
    maxTokens: opts.maxTokens ?? 1024,
    provider: opts.provider,
  });
}

/**
 * Read a File or Blob as raw base64 (without its data URL prefix).
 * @param {Blob} media
 * @returns {Promise<string>}
 */
function blobToBase64(media) {
  return new Promise((resolve, reject) => {
    if (!media || typeof media.size !== 'number') {
      reject(new Error('Expected an image or audio file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read media file.'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(media);
  });
}

async function inlineMedia(media, mimeType, fallbackMimeType) {
  if (typeof media === 'string') {
    const dataUrl = media.match(/^data:([^;,]+)?;base64,([\s\S]*)$/i);
    return {
      base64: dataUrl ? dataUrl[2] : media,
      mimeType: mimeType || (dataUrl && dataUrl[1]) || fallbackMimeType,
    };
  }
  return {
    base64: await blobToBase64(media),
    mimeType: mimeType || media.type || fallbackMimeType,
  };
}

/**
 * Analyze an image File, Blob, data URL, or raw base64 string with a vision model.
 * @param {string} systemPrompt
 * @param {Blob|string} image
 * @param {{ mimeType?: string, temperature?: number, maxTokens?: number, userMessage?: string, provider?: string }} [opts]
 * @returns {Promise<string>}
 */
async function analyzeImageWithAI(systemPrompt, image, opts = {}) {
  if (!await ensureAIKeyVaultUnlocked()) throw new Error(getAIKeyVaultUnlockMessage());
  const media = await inlineMedia(image, opts.mimeType, 'image/jpeg');
  return generateVision(systemPrompt, media.base64, media.mimeType, opts);
}

/**
 * Analyze or transcribe an audio File, Blob, data URL, or raw base64 string.
 * @param {string} systemPrompt
 * @param {Blob|string} audio
 * @param {{ mimeType?: string, temperature?: number, maxTokens?: number, userMessage?: string }} [opts]
 * @returns {Promise<string>}
 */
async function analyzeAudioWithAI(systemPrompt, audio, opts = {}) {
  if (!await ensureAIKeyVaultUnlocked()) throw new Error(getAIKeyVaultUnlockMessage());
  const media = await inlineMedia(audio, opts.mimeType, 'audio/webm');
  return generateAudio(systemPrompt, media.base64, media.mimeType, opts);
}

/** Parse a JSON object or array from plain or fenced model output. */
function parseAIJson(text) {
  const source = String(text || '').trim();
  try { return JSON.parse(source); } catch { /* find a JSON value in surrounding prose */ }

  for (let start = 0; start < source.length; start++) {
    if (source[start] !== '{' && source[start] !== '[') continue;
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let end = start; end < source.length; end++) {
      const char = source[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        const open = stack.pop();
        if ((char === '}' && open !== '{') || (char === ']' && open !== '[')) break;
        if (!stack.length) {
          try { return JSON.parse(source.slice(start, end + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

/** Whether the browser can capture audio with MediaRecorder. */
function isAudioRecordingSupported() {
  return typeof navigator !== 'undefined'
    && hasUserMedia()
    && typeof MediaRecorder !== 'undefined';
}

/**
 * Start a microphone recording. Call stop() to receive its Blob, or cancel()
 * to discard the recording and release the microphone.
 * @param {{ audio?: boolean|MediaTrackConstraints }} [opts]
 * @returns {Promise<{mimeType:string, stop:()=>Promise<Blob|null>, cancel:()=>void}>}
 */
async function startAudioRecording(opts = {}) {
  if (!isAudioRecordingSupported()) {
    throw new Error('Audio recording is not supported in this browser.');
  }

  let stream;
  try {
    stream = await getUserMediaStream({ audio: opts.audio ?? true });
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
      throw new Error('Microphone permission denied.');
    }
    throw new Error(`Could not access microphone${err?.message ? `: ${err.message}` : '.'}`);
  }

  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
    ? candidates.find(type => MediaRecorder.isTypeSupported(type)) || ''
    : '';
  let recorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (err) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error(`Could not start audio recording${err?.message ? `: ${err.message}` : '.'}`);
  }

  const chunks = [];
  let settled = false;
  let cancelled = false;
  let resolveClip;
  let rejectClip;
  const clipPromise = new Promise((resolve, reject) => {
    resolveClip = resolve;
    rejectClip = reject;
  });
  // The caller may cancel before asking for the stop result.
  clipPromise.catch(() => {});
  const releaseMicrophone = () => stream.getTracks().forEach(track => track.stop());

  recorder.addEventListener('dataavailable', event => {
    if (event.data?.size) chunks.push(event.data);
  });
  recorder.addEventListener('error', event => {
    if (settled) return;
    settled = true;
    releaseMicrophone();
    rejectClip(event.error || new Error('Audio recording failed.'));
  });
  recorder.addEventListener('stop', () => {
    if (settled) return;
    settled = true;
    releaseMicrophone();
    resolveClip(cancelled ? null : new Blob(chunks, {
      type: recorder.mimeType || mimeType || 'audio/webm',
    }));
  });

  try {
    recorder.start();
  } catch (err) {
    releaseMicrophone();
    throw new Error(`Could not start audio recording${err?.message ? `: ${err.message}` : '.'}`);
  }

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    stop() {
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (err) {
          if (!settled) {
            settled = true;
            releaseMicrophone();
            rejectClip(err);
          }
        }
      }
      return clipPromise;
    },
    cancel() {
      if (settled) return;
      cancelled = true;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* release tracks below */ }
      }
      settled = true;
      releaseMicrophone();
      resolveClip(null);
    },
  };
}

/** Start an audio recording after automatically unlocking the AI keys vault. */
async function startAIRecording(opts = {}) {
  if (!await ensureAIKeyVaultUnlocked()) throw new Error(getAIKeyVaultUnlockMessage());
  return startAudioRecording(opts);
}

/**
 * Transcribe / analyse an inline audio clip (audio capability — Gemini only).
 * @param {string} systemPrompt
 * @param {string} base64Audio   raw base64 (no data: prefix)
 * @param {string} [mimeType]    e.g. 'audio/webm', 'audio/mp4', 'audio/ogg'
 * @param {{ temperature?: number, maxTokens?: number, userMessage?: string }} [opts]
 * @returns {Promise<string>}
 */
async function generateAudio(systemPrompt, base64Audio, mimeType = 'audio/webm', opts = {}) {
  return routeAI(CAP.AUDIO_ANALYSIS, {
    systemPrompt, base64Audio, mimeType, userMessage: opts.userMessage,
  }, {
    temperature: opts.temperature ?? 0.4,
    maxTokens: opts.maxTokens ?? 1024,
  });
}

/**
 * Generate a photorealistic image from a text prompt, optionally guided by a
 * reference image. Uses GPT Image for both reference edits and text prompts.
 * @param {string} prompt
 * @param {{ size?: string, n?: number, referenceImage?: string }} [opts]
 * @returns {Promise<string>}  image data URL (or remote URL)
 */
async function generateImage(prompt, opts = {}) {
  return routeAI(CAP.IMAGE_GENERATION_PHOTOREAL, {
    prompt, size: opts.size, n: opts.n,
    referenceImage: opts.referenceImage,
  }, {});
}

/* ---------- Sheet data helpers (for lazy-loaded sub-sheets) ---------- */

import { api } from '../api-client.js';

/**
 * Fetch all rows from a Google Sheet by ID.
 * Used by templates to lazy-load sub-sheets (e.g. per-article comment sheets).
 * @param {string} sheetId
 * @returns {Promise<{id: string, title: string, sheetTitle: string, values: string[][]}>}
 */
async function getSheetData(sheetId) {
  return api.sheets.getSpreadsheet(sheetId);
}

/**
 * Append rows to a Google Sheet.
 * Used by templates to post new rows to a sub-sheet (e.g. adding a comment).
 * @param {string} sheetId
 * @param {string} sheetTitle  e.g. 'Sheet1'
 * @param {string[][]} rows    2-D array of cell values
 */
async function appendSheetRows(sheetId, sheetTitle, rows) {
  return api.sheets.appendRows(sheetId, sheetTitle, rows);
}

/**
 * Update a single cell in a Google Sheet.
 * @param {string} sheetId
 * @param {string} sheetTitle  e.g. 'Sheet1'
 * @param {number} row         0-based row index (includes header)
 * @param {number} col         0-based column index
 * @param {string} value
 */
async function updateSheetCell(sheetId, sheetTitle, row, col, value) {
  return api.sheets.updateCell(sheetId, sheetTitle, row, col, value);
}

/**
 * Delete a single row from a Google Sheet.
 * @param {string} sheetId
 * @param {number} numericSheetId  numeric Google Sheets tab ID (0 in mock mode)
 * @param {number} rowIndex        0-based row index including header
 */
async function deleteSheetRow(sheetId, numericSheetId, rowIndex) {
  return api.sheets.deleteRows(sheetId, numericSheetId || 0, rowIndex, rowIndex + 1);
}

/**
 * Create-or-replace a named tab's full contents within a workbook.
 * Used by templates to persist their own metadata as a dedicated tab
 * (e.g. the calorie tracker's "Profile" tab) — the Waymark "everything
 * persists" primitive built on multi-tab support.
 * @param {string}     sheetId
 * @param {string}     tabTitle
 * @param {string[][]} rows       2D array including header row
 */
async function writeSheetTab(sheetId, tabTitle, rows) {
  return api.sheets.writeTab(sheetId, tabTitle, rows);
}

/**
 * Find a tab by title (case-insensitive) within a workbook's tabs[] array.
 * @param {Array<{title:string, values:string[][]}>} tabs
 * @param {string} tabTitle
 * @returns {{title:string, values:string[][]}|null}
 */
function readSheetTab(tabs, tabTitle) {
  if (!Array.isArray(tabs)) return null;
  const want = (tabTitle || '').toLowerCase();
  return tabs.find(t => (t.title || '').toLowerCase() === want) || null;
}

/**
 * Upload an image File to Google Drive and return the sharing URL + permission status.
 * @param {File}   file              Browser File object from file input control
 * @param {string} [parentFolderId]  Optional Drive folder ID
 * @returns {Promise<string>}  Drive view URL for the uploaded file
 */
async function uploadDriveFile(file, parentFolderId) {
  const data = await api.drive.uploadFile(file, parentFolderId);
  return `https://drive.google.com/file/d/${data.id}/view`;
}

/**
 * Extract a Google Drive file ID from any Drive sharing URL.
 * @param {string} url
 * @returns {string|null}
 */
function extractDriveFileId(url) {
  if (!url) return null;
  const trimmed = url.trim();
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  try {
    const u = new URL(trimmed);
    if (u.hostname === 'drive.google.com' &&
        (u.pathname === '/open' || u.pathname === '/uc')) {
      return u.searchParams.get('id');
    }
  } catch { /* not a Drive URL */ }
  return null;
}

/**
 * Asynchronously load a private Google Drive file into an <img> element
 * using the user's OAuth access token. The file stays private — no public
 * sharing is required.
 *
 * Strategy:
 *   1. Fetch the file's thumbnailLink from Drive metadata API. The thumbnailLink
 *      is a lh3.googleusercontent.com URL with auth embedded — loads in <img>
 *      without browser cookies (works cross-origin).
 *   2. Fall back to full-file download (alt=media) for newly uploaded files
 *      that don't yet have a thumbnail.
 *
 * @param {string}           fileId  — Google Drive file ID
 * @param {HTMLImageElement} imgEl   — <img> element to populate
 * @param {function}         [onError] — called (no args) on failure
 * @returns {Promise<void>}
 */
async function loadDriveImage(fileId, imgEl, onError) {
  try {
    const token = await api.auth.getToken();
    // Step 1: thumbnailLink (small, auth embedded, no browser cookies needed)
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta.thumbnailLink) {
        imgEl.src = meta.thumbnailLink;
        return;
      }
    }
    // Step 2: full-file download as blob (newly uploaded files may lack thumbnail)
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Drive ${res.status}`);
    imgEl.src = URL.createObjectURL(await res.blob());
  } catch {
    if (typeof onError === 'function') onError();
  }
}

/**
 * Create a new Google Spreadsheet.
 * Used by templates to auto-create sub-sheets (e.g. per-article comment threads).
 * @param {string}      title     Spreadsheet title
 * @param {string[][]}  rows      Initial rows (header + optional seed data)
 * @param {string}      [parentId] Drive folder to place the file in
 * @returns {Promise<{spreadsheetId: string}>}
 */
async function createSpreadsheet(title, rows, parentId) {
  return api.sheets.createSpreadsheet(title, rows, parentId);
}

/**
 * Create a new Google Doc in Drive.
 * @param {string}   title    Document title
 * @param {string[]} [parents] Drive folder IDs for placement
 * @returns {Promise<{id: string, url: string}>}
 */
async function createGoogleDoc(title, parents = []) {
  const data = await api.drive.createFile(
    title,
    'application/vnd.google-apps.document',
    parents,
  );
  return {
    id: data.id,
    url: `https://docs.google.com/document/d/${data.id}/edit`,
  };
}

/**
 * Export a Google Doc as HTML using the Drive API (OAuth-authenticated).
 * Works for any document the current user has access to, including private docs
 * that are not "published to the web".
 * @param {string} docId
 * @returns {Promise<string>}  full HTML document string
 */
async function exportDocAsHtml(docId) {
  if (!docId) throw new Error('No doc ID provided');
  return api.drive.exportDocAsHtml(docId);
}

/**
 * Export a publicly-shared Google Doc as HTML without OAuth.
 * Uses the server-side /api/fetch-url proxy to bypass CORS.
 * Throws if the doc is not publicly accessible.
 * @param {string} docId
 * @returns {Promise<string>}  full HTML document string
 */
async function exportDocAsHtmlPublic(docId) {
  if (!docId) throw new Error('No doc ID provided');
  return api.drive.exportDocAsHtmlPublic(docId);
}

/**
 * Parse a currency / numeric string to a number.
 * @param {string} raw
 * @returns {number}
 */
function parseAmt(raw) {
  return parseFloat((raw || '0').replace(/[^-\d.]/g, '')) || 0;
}
function svg(tag, attrs = {}) {
  const elem = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    elem.setAttribute(k, String(v));
  }
  return elem;
}
function renderSparkline(values) {
  const nums = values.filter((v) => typeof v === 'number' && v > 0);
  if (nums.length < 2) return null;
  const w = 600, h = 90, pad = 8;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const step = (w - pad * 2) / (nums.length - 1);
  const points = nums
    .map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`)
    .join(' ');
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('preserveAspectRatio', 'none');
  s.setAttribute('style', 'width:100%;height:90px;display:block;');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', '#059669');
  poly.setAttribute('stroke-width', '2.5');
  poly.setAttribute('stroke-linecap', 'round');
  poly.setAttribute('stroke-linejoin', 'round');
  s.appendChild(poly);
  return s;
}

export {
  formatISO,
  nowTimestamp,
  TEMPLATES,
  analyzeAudioWithAI,
  analyzeImageWithAI,
  api,
  appendSheetRows,
  blobToBase64,
  buildAddRowForm,
  buildDirSyncBtn,
  captureImageForAI,
  cell,
  comboCell,
  createGoogleDoc,
  createSpreadsheet,
  cycleStatus,
  dateCell,
  delegateEvent,
  deleteSheetRow,
  editableCell,
  emitEdit,
  ensureAIKeyVaultUnlocked,
  exportDocAsHtml,
  exportDocAsHtmlPublic,
  extractDriveFileId,
  generateAudio,
  generateImage,
  generateText,
  generateVision,
  getAIKeyVaultUnlockMessage,
  getCrossFeature,
  getCrossFeatures,
  getMissingMigrations,
  getSheetData,
  getUserName,
  groupByColumn,
  isAddRowOpen,
  isAudioRecordingSupported,
  isEditLocked,
  isImageUrl,
  isRowProtected,
  lazySection,
  loadDriveImage,
  onEdit,
  parseAIJson,
  parseAmt,
  parseGroups,
  parseProgress,
  readSheetTab,
  registerCrossFeature,
  registerTemplate,
  renderSparkline,
  setEditLocked,
  setProtectedRows,
  setUserName,
  startAIRecording,
  startAudioRecording,
  svg,
  textareaCell,
  updateSheetCell,
  uploadDriveFile,
  writeSheetTab,
};

function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
