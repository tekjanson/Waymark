/* ============================================================
   notifications.js — In-app notification system
   Evaluates sheet data against template-specific conditions
   (overdue tasks, overspending, etc.) and surfaces alerts
   via a notification bell in the top bar.
   ============================================================ */

import { el } from './ui.js';
import * as storage from './storage.js';

/* ---------- Constants ---------- */

const MAX_NOTIFICATIONS = 50;

/** Default notification rule states — all enabled */
const DEFAULT_RULES = {
  kanbanOverdue: true,
  kanbanP0: true,
  budgetOverspend: true,
  checklistOverdue: true,
};

/** Human-readable labels for notification rules */
const RULE_LABELS = {
  kanbanOverdue: { icon: '⏰', label: 'Kanban overdue tasks', desc: 'Alert when kanban tasks pass their due date' },
  kanbanP0: { icon: '🔴', label: 'Kanban critical (P0) tasks', desc: 'Alert for active P0-priority tasks' },
  budgetOverspend: { icon: '💸', label: 'Budget overspending', desc: 'Alert when expenses exceed income' },
  checklistOverdue: { icon: '⏰', label: 'Checklist overdue items', desc: 'Alert when checklist items pass their due date' },
};

/* ---------- State ---------- */

let _notifications = [];
let _bellBtn = null;
let _badge = null;
let _panel = null;

/* ---------- Public API ---------- */

/**
 * Initialise the notification bell in the top bar.
 * Call once during app startup.
 * @param {HTMLElement} topBarRight — the .top-bar-right container
 */
export function init(topBarRight) {
  _notifications = storage.getNotifications();

  _badge = el('span', { className: 'notif-badge hidden' }, ['0']);
  _bellBtn = el('button', {
    className: 'btn-icon notif-bell',
    'aria-label': 'Notifications',
    title: 'Notifications',
    on: { click: _togglePanel },
  }, [
    el('span', { className: 'notif-bell-icon' }, ['🔔']),
    _badge,
  ]);

  // Insert before first child (theme toggle)
  topBarRight.insertBefore(_bellBtn, topBarRight.firstChild);

  _updateBadge();
}

/**
 * Evaluate sheet data for notification-worthy conditions.
 * Called after a sheet is loaded and rendered.
 * @param {string} sheetId
 * @param {string} sheetTitle — human-readable title
 * @param {string} templateKey — detected template key (e.g. 'kanban', 'budget')
 * @param {string[][]} rows — data rows (header excluded)
 * @param {Object} cols — column mapping from template.columns()
 */
export function evaluateSheet(sheetId, sheetTitle, templateKey, rows, cols) {
  const newAlerts = [];
  const rules = { ...DEFAULT_RULES, ...storage.getNotificationSettings() };

  if (templateKey === 'kanban') {
    _checkKanban(sheetId, sheetTitle, rows, cols, newAlerts, rules);
  } else if (templateKey === 'budget') {
    if (rules.budgetOverspend) _checkBudget(sheetId, sheetTitle, rows, cols, newAlerts);
  } else if (templateKey === 'checklist') {
    if (rules.checklistOverdue) _checkChecklist(sheetId, sheetTitle, rows, cols, newAlerts);
  }

  if (newAlerts.length === 0) return;

  // Deduplicate: don't re-add alerts with the same key
  const existingKeys = new Set(_notifications.map(n => n.key));
  const fresh = newAlerts.filter(a => !existingKeys.has(a.key));
  if (fresh.length === 0) return;

  _notifications = [...fresh, ..._notifications].slice(0, MAX_NOTIFICATIONS);
  storage.setNotifications(_notifications);
  _updateBadge();
}

/**
 * Clear all notifications.
 */
export function clearAll() {
  _notifications = [];
  storage.setNotifications([]);
  _updateBadge();
  if (_panel && !_panel.classList.contains('hidden')) {
    _renderPanelContent();
  }
}

/* ---------- Template-specific checks ---------- */

/** @param {Array} alerts — push new alerts here */
function _checkKanban(sheetId, title, rows, cols, alerts, rules) {
  const today = new Date().toISOString().slice(0, 10);
  let overdueCount = 0;
  let p0Count = 0;

  for (const row of rows) {
    // Skip sub-rows (empty primary column)
    if (!row[cols.text]) continue;
    // Skip done/archived
    const stage = cols.stage >= 0 ? (row[cols.stage] || '').toLowerCase() : '';
    if (stage === 'done' || stage === 'archived') continue;

    // Overdue check
    if (cols.due >= 0) {
      const due = row[cols.due] || '';
      if (due && due.slice(0, 10) < today) overdueCount++;
    }

    // P0 in non-done state
    if (cols.priority >= 0) {
      const pri = (row[cols.priority] || '').toUpperCase();
      if (pri === 'P0') p0Count++;
    }
  }

  if (overdueCount > 0 && rules.kanbanOverdue) {
    alerts.push({
      key: `kanban-overdue-${sheetId}-${today}`,
      type: 'warning',
      icon: '⏰',
      message: `${overdueCount} overdue task${overdueCount > 1 ? 's' : ''} in "${title}"`,
      sheetId,
      timestamp: new Date().toISOString(),
      read: false,
    });
  }

  if (p0Count > 0 && rules.kanbanP0) {
    alerts.push({
      key: `kanban-p0-${sheetId}-${today}`,
      type: 'alert',
      icon: '🔴',
      message: `${p0Count} critical (P0) task${p0Count > 1 ? 's' : ''} in "${title}"`,
      sheetId,
      timestamp: new Date().toISOString(),
      read: false,
    });
  }
}

function _checkBudget(sheetId, title, rows, cols, alerts) {
  if (cols.amount < 0) return;

  let totalExpense = 0;
  let totalIncome = 0;

  for (const row of rows) {
    const amount = parseFloat(row[cols.amount]) || 0;
    const cat = cols.category >= 0 ? (row[cols.category] || '').toLowerCase() : '';
    if (cat === 'income' || amount > 0) totalIncome += Math.abs(amount);
    else totalExpense += Math.abs(amount);
  }

  if (totalExpense > 0 && totalIncome > 0 && totalExpense > totalIncome) {
    const over = (totalExpense - totalIncome).toFixed(2);
    const today = new Date().toISOString().slice(0, 10);
    alerts.push({
      key: `budget-over-${sheetId}-${today}`,
      type: 'warning',
      icon: '💸',
      message: `Spending exceeds income by $${over} in "${title}"`,
      sheetId,
      timestamp: new Date().toISOString(),
      read: false,
    });
  }
}

function _checkChecklist(sheetId, title, rows, cols, alerts) {
  if (cols.date < 0) return;

  const today = new Date().toISOString().slice(0, 10);
  let overdueCount = 0;

  for (const row of rows) {
    const status = cols.status >= 0 ? (row[cols.status] || '').toLowerCase() : '';
    if (status === 'done' || status === 'true' || status === 'x' || status === '✓') continue;
    const due = row[cols.date] || '';
    if (due && due.slice(0, 10) < today) overdueCount++;
  }

  if (overdueCount > 0) {
    alerts.push({
      key: `checklist-overdue-${sheetId}-${today}`,
      type: 'warning',
      icon: '⏰',
      message: `${overdueCount} overdue item${overdueCount > 1 ? 's' : ''} in "${title}"`,
      sheetId,
      timestamp: new Date().toISOString(),
      read: false,
    });
  }
}

/* ---------- UI ---------- */

function _updateBadge() {
  const unread = _notifications.filter(n => !n.read).length;
  if (_badge) {
    _badge.textContent = String(unread);
    _badge.classList.toggle('hidden', unread === 0);
  }
}

function _togglePanel() {
  if (_panel && !_panel.classList.contains('hidden')) {
    _panel.classList.add('hidden');
    return;
  }

  if (!_panel) {
    _panel = el('div', { className: 'notif-panel hidden' });
    document.body.appendChild(_panel);
  }

  _renderPanelContent();
  _positionPanel();
  _panel.classList.remove('hidden');

  // Mark all as read
  let changed = false;
  for (const n of _notifications) {
    if (!n.read) { n.read = true; changed = true; }
  }
  if (changed) {
    storage.setNotifications(_notifications);
    _updateBadge();
  }

  // Close on outside click
  const closeHandler = (e) => {
    if (!_panel.contains(e.target) && !_bellBtn.contains(e.target)) {
      _panel.classList.add('hidden');
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function _positionPanel() {
  if (!_panel || !_bellBtn) return;
  const rect = _bellBtn.getBoundingClientRect();
  _panel.style.top = `${rect.bottom + 4}px`;
  _panel.style.right = `${window.innerWidth - rect.right}px`;
}

function _renderPanelContent() {
  if (!_panel) return;
  _panel.innerHTML = '';

  const header = el('div', { className: 'notif-panel-header' }, [
    el('span', { className: 'notif-panel-title' }, ['Notifications']),
    el('div', { className: 'notif-panel-actions' }, [
      el('button', {
        className: 'notif-settings-btn',
        title: 'Notification settings',
        on: { click: _showSettings },
      }, ['⚙️']),
      el('button', {
        className: 'notif-clear-btn',
        on: { click: clearAll },
      }, ['Clear all']),
    ]),
  ]);
  _panel.appendChild(header);

  if (_notifications.length === 0) {
    _panel.appendChild(el('div', { className: 'notif-empty' }, [
      el('div', {}, ['No notifications yet']),
      el('div', { className: 'notif-empty-hint' }, [
        'Alerts appear here when sheets have overdue tasks, high-priority items, or budget warnings. Open a sheet to check.',
      ]),
    ]));
    return;
  }

  const list = el('div', { className: 'notif-list' });
  for (const n of _notifications) {
    const timeAgo = _timeAgo(n.timestamp);
    const item = el('div', { className: `notif-item notif-${n.type}` }, [
      el('span', { className: 'notif-item-icon' }, [n.icon]),
      el('div', { className: 'notif-item-content' }, [
        el('div', { className: 'notif-item-message' }, [n.message]),
        el('div', { className: 'notif-item-time' }, [timeAgo]),
      ]),
    ]);
    if (n.sheetId) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        window.location.hash = `#/sheet/${n.sheetId}`;
        _panel.classList.add('hidden');
      });
    }
    list.appendChild(item);
  }
  _panel.appendChild(list);
}

function _timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ---------- Settings Modal ---------- */

function _showSettings() {
  const existing = document.getElementById('notif-settings-modal');
  if (existing) existing.remove();

  // Close the notification panel
  if (_panel) _panel.classList.add('hidden');

  const saved = { ...DEFAULT_RULES, ...storage.getNotificationSettings() };
  const toggles = {};

  const ruleList = el('div', { className: 'notif-settings-rules' });
  for (const [key, meta] of Object.entries(RULE_LABELS)) {
    const toggleAttrs = { type: 'checkbox', className: 'notif-settings-toggle' };
    if (saved[key]) toggleAttrs.checked = 'checked';
    const toggle = el('input', toggleAttrs);
    toggles[key] = toggle;

    ruleList.appendChild(el('label', { className: 'notif-settings-rule' }, [
      toggle,
      el('span', { className: 'notif-settings-rule-icon' }, [meta.icon]),
      el('div', { className: 'notif-settings-rule-text' }, [
        el('div', { className: 'notif-settings-rule-label' }, [meta.label]),
        el('div', { className: 'notif-settings-rule-desc' }, [meta.desc]),
      ]),
    ]));
  }

  const saveBtn = el('button', {
    className: 'notif-settings-save',
    on: {
      click: () => {
        const settings = {};
        for (const [key, toggle] of Object.entries(toggles)) {
          settings[key] = toggle.checked;
        }
        storage.setNotificationSettings(settings);
        overlay.remove();
      },
    },
  }, ['Save']);

  const closeBtn = el('button', {
    className: 'btn-icon notif-settings-close',
    on: { click: () => overlay.remove() },
  }, ['✕']);

  const modal = el('div', { className: 'modal notif-settings-modal' }, [
    el('div', { className: 'modal-header' }, [
      el('h3', {}, ['Notification Settings']),
      closeBtn,
    ]),
    el('div', { className: 'modal-body' }, [
      el('p', { className: 'notif-settings-intro' }, [
        'Choose which alerts appear when you open a sheet.',
      ]),
      ruleList,
      el('div', { className: 'notif-settings-email' }, [
        el('p', {}, [
          'For email notifications, set up notification rules directly in Google Sheets: ',
          el('strong', {}, ['Tools → Notification rules']),
          '.',
        ]),
        el('a', {
          href: 'https://support.google.com/docs/answer/14099459',
          target: '_blank',
          rel: 'noopener',
          className: 'notif-settings-link',
        }, ['Learn about Google Sheets email notifications →']),
      ]),
    ]),
    el('div', { className: 'modal-footer' }, [saveBtn]),
  ]);

  const overlay = el('div', {
    id: 'notif-settings-modal',
    className: 'modal-overlay',
    on: {
      click: (e) => { if (e.target === overlay) overlay.remove(); },
    },
  }, [modal]);

  document.body.appendChild(overlay);
}
