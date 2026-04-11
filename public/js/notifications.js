/* ============================================================
   notifications.js — Per-sheet conditional notification rules
   Provides a rule builder UI so users can define conditions
   that should trigger notifications on any sheet.
   ============================================================ */

import { el } from './ui.js';
import * as storage from './storage.js';

/* ---------- Operators ---------- */

const OPERATORS = {
  equals:        { label: 'equals',           fn: (cell, val) => cell.toLowerCase() === val.toLowerCase() },
  not_equals:    { label: 'does not equal',   fn: (cell, val) => cell.toLowerCase() !== val.toLowerCase() },
  contains:      { label: 'contains',         fn: (cell, val) => cell.toLowerCase().includes(val.toLowerCase()) },
  not_contains:  { label: 'does not contain', fn: (cell, val) => !cell.toLowerCase().includes(val.toLowerCase()) },
  greater_than:  { label: 'greater than',     fn: (cell, val) => parseFloat(cell) > parseFloat(val) },
  less_than:     { label: 'less than',        fn: (cell, val) => parseFloat(cell) < parseFloat(val) },
  before_today:  { label: 'is before today',  fn: (cell) => { const d = cell.slice(0, 10); return d && d < new Date().toISOString().slice(0, 10); } },
  after_today:   { label: 'is after today',   fn: (cell) => { const d = cell.slice(0, 10); return d && d > new Date().toISOString().slice(0, 10); } },
  is_empty:      { label: 'is empty',         fn: (cell) => !cell.trim() },
  is_not_empty:  { label: 'is not empty',     fn: (cell) => !!cell.trim() },
};

/** Operators that don't need a value input */
const NO_VALUE_OPS = new Set(['before_today', 'after_today', 'is_empty', 'is_not_empty']);

/* ---------- Public API ---------- */

/**
 * Show the per-sheet notification rule builder modal.
 * Rules are stored to localStorage and can be used by automations.
 * @param {string} sheetId
 * @param {string} sheetTitle
 * @param {string[]} headers — raw header strings from the sheet
 */
export function showRuleBuilder(sheetId, sheetTitle, headers) {
  const existing = document.getElementById('notif-rule-builder-modal');
  if (existing) existing.remove();

  let rules = storage.getNotificationRules(sheetId).map(r => ({ ...r }));

  function _save() {
    const valid = rules.filter(r => r.column && r.operator);
    storage.setNotificationRules(sheetId, valid);
    overlay.remove();

    import('./ui.js').then(ui => ui.showToast(
      valid.length ? `${valid.length} notification rule${valid.length > 1 ? 's' : ''} saved` : 'All rules cleared',
      'success',
    ));
  }

  function _buildRuleRow(rule, index) {
    const needsValue = !NO_VALUE_OPS.has(rule.operator);

    const colSelect = el('select', { className: 'notif-rule-col' }, [
      el('option', { value: '' }, ['— Column —']),
      ...headers.filter(h => h && h.trim()).map(h =>
        el('option', { value: h, ...(h === rule.column ? { selected: 'selected' } : {}) }, [h])
      ),
    ]);
    colSelect.addEventListener('change', () => { rule.column = colSelect.value; });

    const opSelect = el('select', { className: 'notif-rule-op' }, [
      el('option', { value: '' }, ['— Condition —']),
      ...Object.entries(OPERATORS).map(([key, meta]) =>
        el('option', { value: key, ...(key === rule.operator ? { selected: 'selected' } : {}) }, [meta.label])
      ),
    ]);

    const valInput = el('input', {
      type: 'text',
      className: 'notif-rule-val',
      placeholder: 'Value…',
      value: rule.value || '',
    });
    if (!needsValue) valInput.style.display = 'none';
    valInput.addEventListener('input', () => { rule.value = valInput.value; });

    opSelect.addEventListener('change', () => {
      rule.operator = opSelect.value;
      valInput.style.display = NO_VALUE_OPS.has(opSelect.value) ? 'none' : '';
    });

    const typeSelect = el('select', { className: 'notif-rule-type' }, [
      el('option', { value: 'info',    ...(rule.notifType === 'info'    || !rule.notifType ? { selected: 'selected' } : {}) }, ['ℹ️ Info']),
      el('option', { value: 'warning', ...(rule.notifType === 'warning' ? { selected: 'selected' } : {}) }, ['⚠️ Warning']),
      el('option', { value: 'alert',   ...(rule.notifType === 'alert'   ? { selected: 'selected' } : {}) }, ['🔴 Alert']),
      el('option', { value: 'success', ...(rule.notifType === 'success' ? { selected: 'selected' } : {}) }, ['✅ Success']),
    ]);
    typeSelect.addEventListener('change', () => { rule.notifType = typeSelect.value; });

    const msgInput = el('input', {
      type: 'text',
      className: 'notif-rule-msg',
      placeholder: 'Notification message… ({count} = matches, {sheet} = title)',
      value: rule.message || '',
    });
    msgInput.addEventListener('input', () => { rule.message = msgInput.value; });

    const enabledCb = el('input', {
      type: 'checkbox',
      className: 'notif-rule-enabled',
      ...(rule.enabled !== false ? { checked: 'checked' } : {}),
    });
    enabledCb.addEventListener('change', () => { rule.enabled = enabledCb.checked; });

    const deleteBtn = el('button', {
      className: 'notif-rule-delete',
      title: 'Remove rule',
      on: {
        click: () => {
          rules.splice(index, 1);
          _renderRules();
        },
      },
    }, ['✕']);

    return el('div', { className: 'notif-rule-row' }, [
      el('div', { className: 'notif-rule-condition' }, [
        enabledCb,
        el('span', { className: 'notif-rule-if' }, ['IF']),
        colSelect,
        opSelect,
        valInput,
      ]),
      el('div', { className: 'notif-rule-action' }, [
        el('span', { className: 'notif-rule-then' }, ['THEN']),
        typeSelect,
        msgInput,
        deleteBtn,
      ]),
    ]);
  }

  const rulesContainer = el('div', { className: 'notif-rules-list' });

  function _renderRules() {
    rulesContainer.innerHTML = '';
    if (rules.length === 0) {
      rulesContainer.appendChild(el('div', { className: 'notif-rules-empty' }, [
        'No rules configured. Add a rule to get notified when conditions are met in this sheet.',
      ]));
    }
    rules.forEach((rule, i) => rulesContainer.appendChild(_buildRuleRow(rule, i)));
  }

  _renderRules();

  const addBtn = el('button', {
    className: 'notif-rule-add',
    on: {
      click: () => {
        rules.push({
          id: Date.now().toString(36),
          column: '',
          operator: '',
          value: '',
          notifType: 'info',
          message: '',
          enabled: true,
        });
        _renderRules();
      },
    },
  }, ['+ Add Rule']);

  const saveBtn  = el('button', { className: 'notif-settings-save',  on: { click: _save } }, ['Save Rules']);
  const closeBtn = el('button', { className: 'btn-icon notif-settings-close', on: { click: () => overlay.remove() } }, ['✕']);

  const modal = el('div', { className: 'modal notif-rule-builder' }, [
    el('div', { className: 'modal-header' }, [
      el('h3', {}, ['🔔 Notification Rules']),
      closeBtn,
    ]),
    el('div', { className: 'modal-body' }, [
      el('p', { className: 'notif-rule-subtitle' }, [
        'Configure conditional alerts for ',
        el('strong', {}, [sheetTitle || 'this sheet']),
        '.',
      ]),
      rulesContainer,
      addBtn,
    ]),
    el('div', { className: 'modal-footer' }, [saveBtn]),
  ]);

  const overlay = el('div', {
    id: 'notif-rule-builder-modal',
    className: 'modal-overlay',
    on: { click: (e) => { if (e.target === overlay) overlay.remove(); } },
  }, [modal]);

  document.body.appendChild(overlay);
}
