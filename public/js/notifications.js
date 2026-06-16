/* ============================================================
   notifications.js — Notification bell UI + per-sheet rule builder
   Bell lives in the top-bar; clicking opens a panel with a settings
   modal that manages the connected notification sheet and rules.
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

/* ---------- Bell UI ---------- */

let _panel = null;

/**
 * Build and open the settings modal from the bell panel.
 * Shows the configured notification sheet + custom rules summary.
 */
function _openSettingsModal() {
  const existing = document.getElementById('notif-settings-modal-overlay');
  if (existing) existing.remove();

  // Count total rules across all sheets
  const _countRules = () => {
    try {
      const rulesMap = JSON.parse(localStorage.getItem('waymark_notification_rules') || '{}');
      return Object.values(rulesMap).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    } catch { return 0; }
  };

  /* -- Renders the sheet section content based on current state -- */
  const _buildSheetContent = (container) => {
    container.innerHTML = '';
    const sheetId = storage.getNotifSheetId();
    const labelEl = el('div', { className: 'notif-sheet-label' }, ['Notification Sheet']);
    container.appendChild(labelEl);

    if (sheetId) {
      const statusEl = el('div', { className: 'notif-sheet-status' }, [
        el('span', { className: 'notif-sheet-status-text' }, ['Connected to notification sheet']),
        el('a', {
          className: 'notif-sheet-view-link',
          href: `#/sheet/${sheetId}`,
          on: { click: () => overlay.remove() },
        }, ['Open Sheet']),
        el('button', { className: 'notif-sheet-clear', on: { click: () => {
          storage.setNotifSheetId(null);
          // Refresh in-place so modal stays open with updated state
          _buildSheetContent(container);
        } } }, ['Clear']),
      ]);
      container.appendChild(statusEl);
    } else {
      const introEl = el('p', { className: 'notif-sheet-status-text' }, [
        'No notification sheet configured. Open a Push Notification sheet and click "Use as Notification Sheet".',
      ]);
      container.appendChild(introEl);
    }
  };

  const sheetSection = el('div', { className: 'notif-sheet-section' }, []);
  _buildSheetContent(sheetSection);

  /* -- Custom rules section -- */
  const totalRules = _countRules();
  const rulesSection = el('div', { className: 'notif-custom-rules-section' }, [
    el('div', { className: 'notif-sheet-label' }, ['Custom Rules']),
    el('p', { className: 'notif-settings-intro' }, [
      totalRules > 0
        ? `${totalRules} rule${totalRules !== 1 ? 's' : ''} configured across your sheets.`
        : 'No custom notification rules configured.',
    ]),
  ]);

  const modal = el('div', { className: 'modal notif-settings-modal' }, [
    el('div', { className: 'modal-header' }, [
      el('h3', {}, ['🔔 Notification Settings']),
      el('button', {
        className: 'btn-icon notif-settings-close',
        on: { click: () => overlay.remove() },
      }, ['✕']),
    ]),
    el('div', { className: 'modal-body' }, [sheetSection, rulesSection]),
  ]);

  const overlay = el('div', {
    id: 'notif-settings-modal-overlay',
    className: 'modal-overlay notif-settings-modal-overlay',
    on: { click: (e) => { if (e.target === overlay) overlay.remove(); } },
  }, [modal]);

  document.body.appendChild(overlay);
}

/**
 * Build the floating notification panel anchored to the bell element.
 * @param {HTMLElement} bellEl
 */
function _openPanel(bellEl) {
  if (_panel) { _panel.remove(); _panel = null; return; }

  const sheetId = storage.getNotifSheetId();

  const headerActions = el('div', { className: 'notif-panel-actions' }, [
    el('button', {
      className: 'notif-settings-btn',
      title: 'Notification settings',
      on: { click: () => _openSettingsModal() },
    }, ['⚙']),
  ]);

  const header = el('div', { className: 'notif-panel-header' }, [
    el('span', { className: 'notif-panel-title' }, ['Notifications']),
    headerActions,
  ]);

  const children = [header];

  if (sheetId) {
    children.push(
      el('a', {
        className: 'notif-sheet-link',
        href: `#/sheet/${sheetId}`,
        on: { click: () => { _panel && (_panel.remove(), _panel = null); } },
      }, ['View Notification Sheet'])
    );
  }

  children.push(
    el('div', { className: 'notif-empty' }, [
      '🔔',
      el('div', { className: 'notif-empty-hint' }, ['No recent notifications']),
    ])
  );

  _panel = el('div', { className: 'notif-panel' }, children);

  // Position below bell
  const rect = bellEl.getBoundingClientRect();
  _panel.style.top  = `${rect.bottom + 8}px`;
  _panel.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(_panel);

  // Close on outside click
  const closeOutside = (e) => {
    if (!_panel) { document.removeEventListener('click', closeOutside, true); return; }
    if (!_panel.contains(e.target) && !bellEl.contains(e.target)) {
      _panel.remove(); _panel = null;
      document.removeEventListener('click', closeOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOutside, true), 0);
}

/**
 * Initialize the notification bell in the top-bar.
 * Call once during app boot after auth resolves.
 */
export function initBell() {
  const existing = document.querySelector('.notif-bell');
  if (existing) return;

  const bellBtn = el('button', {
    className: 'notif-bell btn-icon',
    'aria-label': 'Notifications',
    title: 'Notifications',
    on: { click: (e) => { e.stopPropagation(); _openPanel(bellBtn); } },
  }, [
    el('span', { className: 'notif-bell-icon' }, ['🔔']),
  ]);

  const topBarRight = document.querySelector('.top-bar-right');
  if (topBarRight) topBarRight.prepend(bellBtn);
}
