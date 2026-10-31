
let _shareActionDelegate = null;
function setShareActionDelegate(delegate) {
  _shareActionDelegate = delegate;
}
/* ============================================================
   notifications.js — In-app notification bell, template & custom
   rule evaluation, and two-way Push Notification Sheet sync.
   ============================================================ */

import { el } from './ui.js';
import * as storage from './storage.js';
import { api } from './api-client.js';
import * as userData from './user-data.js';

/* ---------- Constants ---------- */

const MAX_NOTIFICATIONS = 50;

const NOTIF_SHEET_TITLE = 'Waymark Notifications';
const NOTIF_SHEET_HEADERS = [
  'Title', 'Message', 'Type', 'Status', 'Icon', 'Priority', 'Created', 'Expires', 'Source', 'Sheet',
];

/** Default notification rule states — all enabled */
const DEFAULT_RULES = {
  kanbanOverdue: true,
  kanbanP0: true,
  budgetOverspend: true,
  checklistOverdue: true,
};

/** Default collaboration notification preferences — all enabled */
const DEFAULT_COLLAB_PREFS = {
  collabUpdates: true,
  collabShares: true,
  collabChat: true,
};

/** Human-readable labels for built-in notification rules */
const RULE_LABELS = {
  kanbanOverdue: { icon: '⏰', label: 'Kanban overdue tasks', desc: 'Alert when kanban tasks pass their due date' },
  kanbanP0: { icon: '🔴', label: 'Kanban critical (P0) tasks', desc: 'Alert for active P0-priority tasks' },
  budgetOverspend: { icon: '💸', label: 'Budget overspending', desc: 'Alert when expenses exceed income' },
  checklistOverdue: { icon: '⏰', label: 'Checklist overdue items', desc: 'Alert when checklist items pass their due date' },
};

const COLLAB_LABELS = {
  collabUpdates: { icon: '✏️', label: 'Shared Waymark updates', desc: 'Alert when collaborators edit or add items to shared Waymarks' },
  collabShares: { icon: '📤', label: 'New shared Waymarks', desc: 'Alert when a collaborator shares a Waymark with you' },
  collabChat: { icon: '💬', label: 'Wayside chat & calls', desc: 'Alert on new Wayside messages and incoming WebRTC calls' },
};

/* ---------- State ---------- */

let _panel = null;
let _bellInitialized = false;
let _collabBC = null;
let _lastEvaluatedSheet = null;
const _pendingSheetWrites = [];

function _defaultIcon(type) {
  if (type === 'alert') return '🔴';
  if (type === 'warning') return '⚠️';
  if (type === 'success') return '✅';
  if (type === 'chat') return '💬';
  if (type === 'share') return '📤';
  if (type === 'update') return '✏️';
  if (type === 'call') return '📞';
  return '🔔';
}

/* ---------- Notification store (top-bar bell) ---------- */

/**
 * Add a notification to the top-bar bell store, refresh the badge,
 * and append to the connected Push Notification Sheet if configured.
 * Deduplicates by id/key so repeated polls or sheet evaluations don't create duplicates.
 * @param {{ id?: string, key?: string, type?: string, title?: string, body?: string, message?: string, icon?: string, priority?: string, sheetId?: string, from?: string, source?: string, ts?: string, timestamp?: string, read?: boolean, _fromNotifSheet?: boolean }} notif
 */
function addNotification(notif) {
  if (!notif || (!notif.title && !notif.message)) return null;
  const items = storage.getNotifications();
  const title = notif.title || notif.message || '';
  const body = notif.body !== undefined ? notif.body : (notif.title && notif.message && notif.message !== notif.title ? notif.message : '');
  const message = notif.message || (body ? `${title} — ${body}` : title);
  const id = notif.id || notif.key || `${notif.sheetId || ''}:${title}:${Date.now()}`;
  const key = notif.key || id;

  if (items.some(n => (n.id && n.id === id) || (n.key && n.key === key))) return null;
  // A document only ever needs one share prompt — re-polled ledger rows or a
  // re-imported Push Notification Sheet row must not stack duplicates.
  if (String(notif.type || '').toLowerCase() === 'share' && notif.sheetId
      && items.some(n => n.type === 'share' && n.sheetId === notif.sheetId)) return null;

  const ts = notif.ts || notif.timestamp || new Date().toISOString();
  const type = (notif.type || 'info').toLowerCase();
  const sheetIdVal = notif.sheetId || '';
  const defaultDecision = type === 'share'
    ? (sheetIdVal && storage.isShareAccepted(sheetIdVal)
        ? 'accepted'
        : (sheetIdVal && storage.isShareRejected(sheetIdVal) ? 'rejected' : 'pending'))
    : '';
  const entry = {
    id,
    key,
    type,
    icon: notif.icon || _defaultIcon(type),
    title,
    body,
    message,
    priority: notif.priority || (type === 'alert' || type === 'call' ? 'High' : 'Medium'),
    sheetId: sheetIdVal,
    ledgerSheetId: notif.ledgerSheetId || '',
    docTitle: notif.docTitle || '',
    waymarkType: notif.waymarkType || '',
    group: notif.group || '',
    shareDecision: notif.shareDecision || defaultDecision,
    from: notif.from || notif.source || '',
    source: notif.source || notif.from || 'Waymark',
    ts,
    timestamp: ts,
    read: Boolean(notif.read),
  };

  items.unshift(entry);
  if (items.length > MAX_NOTIFICATIONS) items.length = MAX_NOTIFICATIONS;
  storage.setNotifications(items);
  _refreshBellBadge();

  if (!notif._fromNotifSheet) {
    const notifSheetId = storage.getNotifSheetId();
    if (notifSheetId && entry.sheetId !== notifSheetId) {
      const p = _appendAlertsToSheet([entry]);
      _pendingSheetWrites.push(p);
    }
  }

  return entry;
}

/** Wait for any in-flight Push Notification Sheet appends to finish. */
async function flushNotificationSheetWrites() {
  if (_pendingSheetWrites.length === 0) return;
  const batch = _pendingSheetWrites.splice(0, _pendingSheetWrites.length);
  await Promise.allSettled(batch);
}

/** Stable content signature used to recognise a notification across id schemes. */
function _notifSignature(title, body) {
  return `sig:${(title || '').trim()}|${(body || '').trim()}`;
}

/** @returns {number} count of unread notifications */
function getUnreadCount() {
  return storage.getNotifications().filter(n => !n.read).length;
}

/** Mark every notification as read and refresh the badge. */
function markAllRead() {
  const items = storage.getNotifications().map(n => ({ ...n, read: true }));
  storage.setNotifications(items);
  _refreshBellBadge();
}

/** Clear all notifications and refresh the badge and open panel. */
function clearAll() {
  // Remember what was cleared so the Push Notification Sheet sync doesn't
  // re-import the same Active rows on the next poll / page reload.
  const keys = [];
  for (const n of storage.getNotifications()) {
    keys.push(n.id, n.key, _notifSignature(n.title, n.body));
  }
  storage.addClearedNotifKeys(keys);
  storage.setNotifications([]);
  _refreshBellBadge();
  if (_panel && !_panel.classList.contains('hidden')) {
    _renderPanelContent();
  }
}

/** Update the unread-count badge on the bell. */
function _refreshBellBadge() {
  const bell = document.querySelector('.notif-bell');
  if (!bell) return;
  let badge = bell.querySelector('.notif-badge');
  if (!badge) {
    badge = el('span', { className: 'notif-badge notif-bell-badge hidden' }, ['0']);
    bell.appendChild(badge);
  }
  const count = getUnreadCount();
  if (count <= 0) {
    badge.textContent = '0';
    badge.classList.add('hidden');
  } else {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.classList.remove('hidden');
  }
}

/** Public: refresh the bell badge (called after polling). */
function refreshBell() {
  _refreshBellBadge();
}

/* ---------- Connected Push Notification Sheet ---------- */

/**
 * Get the current notification sheet ID (if configured).
 * @returns {string|null}
 */
function getSheetId() {
  return storage.getNotifSheetId();
}

/**
 * Ensure a notification sheet exists in the Waymark directory.
 * In local/test mode this is a no-op unless explicitly invoked.
 * @returns {Promise<string|null>}
 */
async function ensureSheet() {
  if (typeof window !== 'undefined' && window.__WAYMARK_LOCAL) return null;

  const existingId = storage.getNotifSheetId();
  if (existingId) return existingId;

  try {
    const rootFolderId = await userData.getRootFolderId();
    if (!rootFolderId) return null;

    const found = await api.drive.findFile(NOTIF_SHEET_TITLE, rootFolderId);
    if (found) {
      storage.setNotifSheetId(found.id);
      return found.id;
    }

    const created = await api.sheets.createSpreadsheet(
      NOTIF_SHEET_TITLE,
      [NOTIF_SHEET_HEADERS],
      rootFolderId,
    );

    const newId = created.spreadsheetId || created.id;
    storage.setNotifSheetId(newId);
    return newId;
  } catch (err) {
    console.warn('[notifications] Failed to ensure notification sheet:', err);
    return null;
  }
}

/**
 * Append newly generated alerts to the user's configured Push Notification Sheet.
 * @param {Array<Object>} alerts
 */
async function _appendAlertsToSheet(alerts) {
  const sheetId = storage.getNotifSheetId();
  if (!sheetId || !alerts || alerts.length === 0) return;

  const rows = alerts
    .filter(a => a && a.sheetId !== sheetId)
    .map(a => [
      a.title || a.message || '',
      a.body || a.message || a.title || '',
      a.type || 'info',
      'Active',
      a.icon || _defaultIcon(a.type),
      a.priority || 'Medium',
      a.ts || a.timestamp || new Date().toISOString(),
      '',
      a.source || a.from || 'Waymark',
      a.sheetId || '',
    ]);

  if (rows.length === 0) return;
  try {
    await api.sheets.appendRows(sheetId, 'Sheet1', rows);
  } catch {
    /* Silently ignore — don't interrupt the user's workflow */
  }
}

/**
 * Poll the connected Push Notification Sheet (`waymark_notif_sheet_id`).
 * - Syncs any `Active` rows from the sheet into the top-bar bell (without re-appending).
 * - Marks matching bell notifications as `read: true` if their sheet row was cycled
 *   to `Read` or `Dismissed`.
 * @returns {Promise<number>} count of new active notifications synced from the sheet
 */
async function pollNotificationSheet() {
  const notifSheetId = storage.getNotifSheetId();
  if (!notifSheetId) return 0;

  try {
    const data = await api.sheets.getSpreadsheet(notifSheetId);
    const values = (data.tabs && data.tabs[0] && data.tabs[0].values) || data.values || [];
    if (values.length < 2) return 0;

    const lower = (values[0] || []).map(h => (h || '').toLowerCase().trim());
    const titleIdx   = lower.findIndex(h => /\btitle\b/.test(h));
    const msgIdx     = lower.findIndex(h => /\bmessage\b|\bbody\b/.test(h));
    const typeIdx    = lower.findIndex(h => /\btype\b/.test(h));
    const statusIdx  = lower.findIndex(h => /\bstatus\b/.test(h));
    const iconIdx    = lower.findIndex(h => /\bicon\b/.test(h));
    const priIdx     = lower.findIndex(h => /\bpriority\b/.test(h));
    const createdIdx = lower.findIndex(h => /\bcreated\b/.test(h));
    const sourceIdx  = lower.findIndex(h => /\bsource\b/.test(h));
    const sheetIdx   = lower.findIndex(h => /\bsheet\b/.test(h));

    if (titleIdx < 0) return 0;

    let added = 0;
    let statusUpdated = false;
    const currentItems = storage.getNotifications();
    const cleared = new Set(storage.getClearedNotifKeys());

    for (let i = 1; i < values.length; i++) {
      const r = values[i] || [];
      const title = (r[titleIdx] || '').trim();
      if (!title) continue;

      const body     = msgIdx >= 0 ? (r[msgIdx] || '').trim() : '';
      const type     = (typeIdx >= 0 ? (r[typeIdx] || 'info').trim() : 'info').toLowerCase();
      const status   = (statusIdx >= 0 ? (r[statusIdx] || 'Active').trim() : 'Active');
      const icon     = iconIdx >= 0 ? (r[iconIdx] || '').trim() : '';
      const priority = priIdx >= 0 ? (r[priIdx] || 'Medium').trim() : 'Medium';
      const created  = createdIdx >= 0 ? (r[createdIdx] || '').trim() : '';
      const source   = sourceIdx >= 0 ? (r[sourceIdx] || '').trim() : '';
      const targetSheet = sheetIdx >= 0 ? (r[sheetIdx] || '').trim() : '';

      const rowKey = `notif-sheet:${notifSheetId}:${i}:${title}`;
      const existing = currentItems.find(n =>
        n.id === rowKey ||
        n.key === rowKey ||
        (n.title === title && (n.body === body || n.message === body || !body))
      );

      const decidedShare = type === 'share' && targetSheet
        && (storage.isShareAccepted(targetSheet) || storage.isShareRejected(targetSheet));

      if (status.toLowerCase() === 'active') {
        const wasCleared = cleared.has(rowKey) || cleared.has(_notifSignature(title, body));
        if (!existing && !decidedShare && !wasCleared) {
          const entry = addNotification({
            id: rowKey,
            key: rowKey,
            title,
            body,
            type,
            icon: icon || _defaultIcon(type),
            priority,
            ts: created || new Date().toISOString(),
            from: source,
            source: source || 'Notification Sheet',
            sheetId: targetSheet,
            _fromNotifSheet: true,
          });
          if (entry) added++;
        }
      } else if (existing && !existing.read) {
        existing.read = true;
        statusUpdated = true;
      }
    }

    if (statusUpdated && added === 0) {
      storage.setNotifications(currentItems);
      _refreshBellBadge();
    }

    return added;
  } catch {
    return 0;
  }
}

/* ---------- Sheet Evaluation (Built-in + Custom Rules) ---------- */

/**
 * Evaluate sheet data for notification-worthy conditions.
 * Called after a sheet is loaded and rendered.
 * @param {string} sheetId
 * @param {string} sheetTitle
 * @param {string} templateKey
 * @param {string[][]} rows
 * @param {Object} cols
 * @param {string[]} [headers]
 */
function evaluateSheet(sheetId, sheetTitle, templateKey, rows, cols, headers) {
  if (!sheetId || !Array.isArray(rows)) return;
  _lastEvaluatedSheet = { sheetId, sheetTitle, templateKey, rows, cols, headers };

  // Do not evaluate a Push Notification Sheet against itself
  if (templateKey === 'notification' || sheetId === storage.getNotifSheetId()) return;

  const newAlerts = [];
  const rules = { ...DEFAULT_RULES, ...storage.getNotificationSettings() };

  if (templateKey === 'kanban' && cols) {
    _checkKanban(sheetId, sheetTitle, rows, cols, newAlerts, rules);
  } else if (templateKey === 'budget' && cols) {
    if (rules.budgetOverspend) _checkBudget(sheetId, sheetTitle, rows, cols, newAlerts);
  } else if (templateKey === 'checklist' && cols) {
    if (rules.checklistOverdue) _checkChecklist(sheetId, sheetTitle, rows, cols, newAlerts);
  }

  if (headers) {
    _checkCustomRules(sheetId, sheetTitle, rows, headers, newAlerts);
  }

  for (const alert of newAlerts) {
    addNotification(alert);
  }
}

function _checkKanban(sheetId, title, rows, cols, alerts, rules) {
  const today = new Date().toISOString().slice(0, 10);
  let overdueCount = 0;
  let p0Count = 0;

  for (const row of rows) {
    if (!row[cols.text]) continue;
    const stage = cols.stage >= 0 ? (row[cols.stage] || '').toLowerCase() : '';
    if (stage === 'done' || stage === 'archived') continue;

    if (cols.due >= 0) {
      const due = row[cols.due] || '';
      if (due && due.slice(0, 10) < today) overdueCount++;
    }

    if (cols.priority >= 0) {
      const pri = (row[cols.priority] || '').toUpperCase();
      if (pri === 'P0') p0Count++;
    }
  }

  if (overdueCount > 0 && rules.kanbanOverdue) {
    const msg = `${overdueCount} overdue task${overdueCount > 1 ? 's' : ''} in "${title}"`;
    alerts.push({
      id: `kanban-overdue-${sheetId}-${today}`,
      key: `kanban-overdue-${sheetId}-${today}`,
      type: 'warning',
      icon: '⏰',
      title: msg,
      body: '',
      message: msg,
      source: 'Kanban',
      priority: 'Medium',
      sheetId,
      ts: new Date().toISOString(),
      read: false,
    });
  }

  if (p0Count > 0 && rules.kanbanP0) {
    const msg = `${p0Count} critical (P0) task${p0Count > 1 ? 's' : ''} in "${title}"`;
    alerts.push({
      id: `kanban-p0-${sheetId}-${today}`,
      key: `kanban-p0-${sheetId}-${today}`,
      type: 'alert',
      icon: '🔴',
      title: msg,
      body: '',
      message: msg,
      source: 'Kanban',
      priority: 'High',
      sheetId,
      ts: new Date().toISOString(),
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
    const msg = `Spending exceeds income by $${over} in "${title}"`;
    alerts.push({
      id: `budget-over-${sheetId}-${today}`,
      key: `budget-over-${sheetId}-${today}`,
      type: 'warning',
      icon: '💸',
      title: msg,
      body: '',
      message: msg,
      source: 'Budget',
      priority: 'High',
      sheetId,
      ts: new Date().toISOString(),
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
    const msg = `${overdueCount} overdue item${overdueCount > 1 ? 's' : ''} in "${title}"`;
    alerts.push({
      id: `checklist-overdue-${sheetId}-${today}`,
      key: `checklist-overdue-${sheetId}-${today}`,
      type: 'warning',
      icon: '⏰',
      title: msg,
      body: '',
      message: msg,
      source: 'Checklist',
      priority: 'Medium',
      sheetId,
      ts: new Date().toISOString(),
      read: false,
    });
  }
}

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

function _checkCustomRules(sheetId, sheetTitle, rows, headers, alerts) {
  const rules = storage.getNotificationRules(sheetId);
  if (!rules || rules.length === 0) return;

  const lowerHeaders = headers.map(h => (h || '').toLowerCase().trim());
  const today = new Date().toISOString().slice(0, 10);

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!rule.column || !rule.operator) continue;
    const colIdx = lowerHeaders.indexOf(rule.column.toLowerCase().trim());
    if (colIdx < 0) continue;

    const op = OPERATORS[rule.operator];
    if (!op) continue;

    let matchCount = 0;
    for (const row of rows) {
      const cell = (row[colIdx] || '').toString();
      if (op.fn(cell, rule.value || '')) matchCount++;
    }

    if (matchCount > 0) {
      const msg = (rule.message || `${matchCount} row(s) match "${rule.column} ${op.label}${NO_VALUE_OPS.has(rule.operator) ? '' : ' ' + rule.value}"`)
        .replace(/\{count\}/g, String(matchCount))
        .replace(/\{sheet\}/g, sheetTitle || '');

      const key = `custom-${sheetId}-${rule.id}-${today}`;
      alerts.push({
        id: key,
        key,
        type: rule.notifType || 'info',
        icon: _defaultIcon(rule.notifType || 'info'),
        title: rule.name || msg,
        body: rule.name ? msg : '',
        message: msg,
        source: 'Custom Rule',
        sheetId,
        ts: new Date().toISOString(),
        read: false,
        priority: rule.notifType === 'alert' ? 'High' : 'Medium',
      });
    }
  }
}

/* ---------- Rule Builder Modal ---------- */

/**
 * Show the per-sheet notification rule builder modal.
 * Rules are stored to localStorage and evaluated on sheet load.
 * @param {string} sheetId
 * @param {string} sheetTitle
 * @param {string[]} headers — raw header strings from the sheet
 */
function showRuleBuilder(sheetId, sheetTitle, headers) {
  const existing = document.getElementById('notif-rule-builder-modal');
  if (existing) existing.remove();

  let rules = storage.getNotificationRules(sheetId).map(r => ({ ...r }));

  function _save() {
    const valid = rules.filter(r => r.column && r.operator);
    storage.setNotificationRules(sheetId, valid);
    overlay.remove();

    if (_lastEvaluatedSheet && _lastEvaluatedSheet.sheetId === sheetId) {
      evaluateSheet(
        _lastEvaluatedSheet.sheetId,
        _lastEvaluatedSheet.sheetTitle,
        _lastEvaluatedSheet.templateKey,
        _lastEvaluatedSheet.rows,
        _lastEvaluatedSheet.cols,
        _lastEvaluatedSheet.headers
      );
    }

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

/* ---------- Settings Modal & Bell UI ---------- */

/**
 * Build and open the settings modal from the bell panel.
 * Includes built-in rule toggles, Google Sheets email notification link,
 * custom rules count, and the connected Push Notification Sheet status.
 */
function _openSettingsModal() {
  const existing = document.getElementById('notif-settings-modal');
  if (existing) existing.remove();

  if (_panel) _panel.classList.add('hidden');

  /* -- Built-in rule toggles -- */
  const saved = { ...DEFAULT_RULES, ...DEFAULT_COLLAB_PREFS, ...storage.getNotificationSettings() };
  const toggles = {};
  const collabToggles = {};
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

  /* -- Collaboration & Social notification toggles -- */
  const collabList = el('div', { className: 'notif-collab-rules' });
  for (const [key, meta] of Object.entries(COLLAB_LABELS)) {
    const toggleAttrs = { type: 'checkbox', className: 'notif-collab-toggle', dataset: { collabKey: key } };
    if (saved[key] !== false) toggleAttrs.checked = 'checked';
    const toggle = el('input', toggleAttrs);
    collabToggles[key] = toggle;

    collabList.appendChild(el('label', { className: 'notif-collab-rule' }, [
      toggle,
      el('span', { className: 'notif-settings-rule-icon' }, [meta.icon]),
      el('div', { className: 'notif-settings-rule-text' }, [
        el('div', { className: 'notif-settings-rule-label' }, [meta.label]),
        el('div', { className: 'notif-settings-rule-desc' }, [meta.desc]),
      ]),
    ]));
  }
  const collabSection = el('div', { className: 'notif-collab-section' }, [
    el('div', { className: 'notif-sheet-label' }, ['Collaboration & Wayside']),
    collabList,
  ]);

  /* -- Email notifications section -- */
  const emailSection = el('div', { className: 'notif-settings-email' }, [
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
  ]);

  /* -- Connected Notification Sheet section -- */
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
        el('button', {
          className: 'notif-sheet-clear',
          on: {
            click: () => {
              storage.setNotifSheetId(null);
              _buildSheetContent(container);
            },
          },
        }, ['Clear']),
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

  /* -- Custom rules summary section -- */
  const allRules = storage.getAllNotificationRules();
  const totalRules = Object.values(allRules).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  const rulesSection = el('div', { className: 'notif-custom-rules-section' }, [
    el('div', { className: 'notif-sheet-label' }, ['Custom Rules']),
    el('p', { className: 'notif-settings-intro' }, [
      totalRules > 0
        ? `${totalRules} rule${totalRules !== 1 ? 's' : ''} configured across your sheets.`
        : 'No custom notification rules configured.',
    ]),
  ]);

  const saveBtn = el('button', {
    className: 'notif-settings-save',
    on: {
      click: () => {
        const settings = {};
        for (const [key, toggle] of Object.entries(toggles)) {
          settings[key] = toggle.checked;
        }
        for (const [key, toggle] of Object.entries(collabToggles)) {
          settings[key] = toggle.checked;
        }
        storage.setNotificationSettings(settings);
        overlay.remove();
      },
    },
  }, ['Save']);

  const modal = el('div', { className: 'modal notif-settings-modal' }, [
    el('div', { className: 'modal-header' }, [
      el('h3', {}, ['🔔 Notification Settings']),
      el('button', {
        className: 'btn-icon notif-settings-close',
        on: { click: () => overlay.remove() },
      }, ['✕']),
    ]),
    el('div', { className: 'modal-body' }, [
      el('p', { className: 'notif-settings-intro' }, [
        'Choose which alerts appear when you open a sheet.',
      ]),
      ruleList,
      collabSection,
      emailSection,
      sheetSection,
      rulesSection,
    ]),
    el('div', { className: 'modal-footer' }, [saveBtn]),
  ]);

  const overlay = el('div', {
    id: 'notif-settings-modal',
    className: 'modal-overlay notif-settings-modal-overlay',
    on: { click: (e) => { if (e.target === overlay) overlay.remove(); } },
  }, [modal]);

  document.body.appendChild(overlay);
}

/**
 * Accept or reject a share from the bell panel. Disables both buttons while the
 * request runs, always reports the outcome, and never leaves an unhandled
 * rejection (previously a failure made the buttons look dead).
 * @param {MouseEvent} e
 * @param {Object} n notification entry
 * @param {'accept'|'reject'} action
 */
async function _handleShareDecision(e, n, action) {
  e.stopPropagation();
  const bar = e.currentTarget?.parentElement;
  const buttons = bar ? [...bar.querySelectorAll('button')] : [];
  if (buttons.some(b => b.disabled)) return;
  buttons.forEach(b => { b.disabled = true; });
  const ui = await import('./ui.js');
  try {
    const collab = _shareActionDelegate || (typeof window !== 'undefined' && window.__WAYMARK_COLLAB); if (!collab) throw new Error('Collaboration subsystem not initialized');
    if (action === 'accept') {
      const ok = await collab.acceptSharedWaymark({
        docId: n.sheetId,
        docTitle: n.docTitle || '',
        waymarkType: n.waymarkType || '',
        ledgerSheetId: n.ledgerSheetId || '',
        from: n.from || '',
      });
      if (ok) ui.showToast('Shared Waymark accepted', 'success');
      else ui.showToast('Accept cancelled — authorize the sheet in Google Picker to continue', 'info');
    } else {
      await collab.rejectSharedWaymark({
        docId: n.sheetId,
        docTitle: n.docTitle || '',
        ledgerSheetId: n.ledgerSheetId || '',
      });
      ui.showToast('Shared Waymark rejected and muted', 'info');
    }
  } catch (err) {
    ui.showToast(`Could not ${action} share: ${err?.message || err}`, 'error');
  } finally {
    if (_panel && !_panel.classList.contains('hidden')) _renderPanelContent();
    else buttons.forEach(b => { b.disabled = false; });
  }
}

/**
 * Render the content of `_panel` in-place.
 */
function _renderPanelContent() {
  if (!_panel) return;
  _panel.innerHTML = '';

  const sheetId = storage.getNotifSheetId();

  const headerActions = el('div', { className: 'notif-panel-actions' }, [
    el('button', {
      className: 'notif-settings-btn',
      title: 'Notification settings',
      on: {
        click: (e) => {
          e.stopPropagation();
          _openSettingsModal();
        },
      },
    }, ['⚙️']),
    el('button', {
      className: 'notif-clear-btn',
      on: {
        click: (e) => {
          e.stopPropagation();
          clearAll();
        },
      },
    }, ['Clear all']),
  ]);

  const header = el('div', { className: 'notif-panel-header' }, [
    el('span', { className: 'notif-panel-title' }, ['Notifications']),
    headerActions,
  ]);
  _panel.appendChild(header);

  if (sheetId) {
    _panel.appendChild(
      el('a', {
        className: 'notif-sheet-link',
        href: `#/sheet/${sheetId}`,
        on: { click: () => { if (_panel) _panel.classList.add('hidden'); } },
      }, ['📋 View Notification Sheet'])
    );
  }

  const notifs = storage.getNotifications();
  if (notifs.length) {
    const list = el('div', { className: 'notif-list' },
      notifs.slice(0, 20).map(n => {
        const titleText = n.title || n.message || '';
        const bodyText = n.body && n.body !== titleText ? n.body : '';
        const actionNodes = [];

        if (n.type === 'share' && n.sheetId) {
          const decision = n.shareDecision
            || (storage.isShareAccepted(n.sheetId) ? 'accepted' : (storage.isShareRejected(n.sheetId) ? 'rejected' : 'pending'));
          if (decision === 'accepted') {
            actionNodes.push(el('span', { className: 'notif-decision-badge notif-decision-accepted' }, ['✓ Accepted']));
          } else if (decision === 'rejected') {
            actionNodes.push(el('span', { className: 'notif-decision-badge notif-decision-rejected' }, ['✕ Rejected']));
          } else {
            actionNodes.push(
              el('button', {
                className: 'btn btn-sm notif-accept-btn',
                type: 'button',
                title: 'Accept shared Waymark',
                on: {
                  click: (e) => _handleShareDecision(e, n, 'accept'),
                },
              }, ['✓ Accept']),
              el('button', {
                className: 'btn btn-sm notif-reject-btn',
                type: 'button',
                title: 'Reject and mute this shared Waymark',
                on: {
                  click: (e) => _handleShareDecision(e, n, 'reject'),
                },
              }, ['✕ Reject'])
            );
          }
        }

        const isCollabNotif = ['share', 'update', 'chat', 'call'].includes(n.type);
        const peerRef = (n.from || n.group || '').trim();
        if (isCollabNotif && peerRef && peerRef !== 'Waymark' && peerRef !== 'Notification Sheet') {
          const callLabel = n.type === 'call' ? '📞 Join Call' : '📹 Call';
          actionNodes.push(
            el('button', {
              className: 'btn btn-sm notif-call-btn',
              type: 'button',
              title: `Call ${peerRef} in The Wayside`,
              on: {
                click: (e) => {
                  e.stopPropagation();
                  if (_panel) _panel.classList.add('hidden');
                  const isEmail = peerRef.includes('@');
                  window.dispatchEvent(new CustomEvent('waymark:start-wayside-call', {
                    detail: {
                      contactEmail: isEmail ? peerRef : '',
                      group: n.group || (!isEmail ? peerRef : ''),
                      label: n.group || (isEmail ? peerRef.split('@')[0] : peerRef),
                    },
                  }));
                },
              },
            }, [callLabel])
          );
        }

        const actionsBar = actionNodes.length
          ? el('div', { className: 'notif-item-actions' }, actionNodes)
          : null;

        const card = el('div', {
          className: `notif-item notif-${n.type || 'info'}` + (n.read ? '' : ' notif-item-unread'),
        }, [
          el('div', { className: 'notif-item-title' }, [titleText]),
          bodyText ? el('div', { className: 'notif-item-body' }, [bodyText]) : null,
          actionsBar,
        ].filter(Boolean));
        if (n.sheetId) {
          card.classList.add('notif-item-link');
          card.style.cursor = 'pointer';
          card.addEventListener('click', () => {
            window.location.hash = `#/sheet/${n.sheetId}`;
            if (_panel) _panel.classList.add('hidden');
          });
        }
        return card;
      })
    );
    _panel.appendChild(list);
  } else {
    _panel.appendChild(
      el('div', { className: 'notif-empty' }, [
        el('div', {}, ['No notifications yet']),
        el('div', { className: 'notif-empty-hint' }, [
          'Alerts appear here when collaborators share Waymarks, message you in The Wayside, or sheet rules match.',
        ]),
      ])
    );
  }
}

/**
 * Toggle the floating notification panel anchored to the bell element.
 * @param {HTMLElement} bellEl
 */
function _openPanel(bellEl) {
  if (_panel && !_panel.classList.contains('hidden')) {
    _panel.classList.add('hidden');
    return;
  }

  if (!_panel || !document.body.contains(_panel)) {
    _panel = el('div', { className: 'notif-panel hidden' });
    document.body.appendChild(_panel);
  }

  _renderPanelContent();

  const rect = bellEl.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 375;
  _panel.style.top = `${Math.max(8, rect.bottom + 8)}px`;
  if (vw <= 640) {
    _panel.style.left = '8px';
    _panel.style.right = '8px';
    _panel.style.width = 'auto';
    _panel.style.maxWidth = 'calc(100vw - 16px)';
  } else {
    _panel.style.left = '';
    _panel.style.width = '';
    _panel.style.maxWidth = '';
    const panelWidth = 340;
    const desiredRight = Math.max(8, vw - rect.right);
    const maxRight = Math.max(8, vw - panelWidth - 8);
    _panel.style.right = `${Math.min(desiredRight, maxRight)}px`;
  }
  _panel.classList.remove('hidden');

  // Opening the panel marks all notifications as read and hides the unread badge.
  markAllRead();

  // Close on outside click
  const closeOutside = (e) => {
    if (!_panel || _panel.classList.contains('hidden')) {
      document.removeEventListener('click', closeOutside);
      return;
    }
    if (!_panel.contains(e.target) && !bellEl.contains(e.target)) {
      _panel.classList.add('hidden');
      document.removeEventListener('click', closeOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOutside), 0);
}

/**
 * Initialize the notification bell in the top-bar and wire sheet/peer listeners.
 * Call once during app boot.
 */
function initBell() {
  if (!_bellInitialized && typeof document !== 'undefined') {
    _bellInitialized = true;

    document.addEventListener('waymark:sheet-rendered', (e) => {
      const { sheetId, title, templateKey, rows, cols, headers } = e.detail || {};
      if (sheetId && rows) {
        evaluateSheet(sheetId, title || '', templateKey || '', rows, cols, headers);
      }
    });

    document.addEventListener('waymark:peer-notification', (e) => {
      const m = e.detail || {};
      addNotification({
        title: m.title || 'Peer Alert',
        body: m.body || m.message || '',
        type: m.notifType || 'info',
        from: m.name || 'Peer',
        source: m.name || 'Peer',
        sheetId: m.sheetId || '',
      });
    });

    const handlePeerSheetUpdate = (m) => {
      if (!m || !m.sheetId) return;
      const prefs = storage.getNotificationSettings();
      if (prefs.collabUpdates === false) return;
      if (storage.isShareRejected(m.sheetId)) return;
      const me = (api.auth.getUser?.()?.email || '').trim().toLowerCase();
      const actor = String(m.from || m.name || '').trim().toLowerCase();
      if (me && actor && actor === me) return;

      const who = m.from || m.name || 'A collaborator';
      const docTitle = m.docTitle || 'Shared Waymark';
      const summary = m.summary || 'Updated this Waymark';
      addNotification({
        id: m.id || `peer-update:${m.sheetId}:${m.ts || Date.now()}`,
        type: 'update',
        icon: '✏️',
        title: `${who} updated "${docTitle}"`,
        body: summary,
        sheetId: m.sheetId,
        docTitle,
        waymarkType: m.waymarkType || '',
        from: who,
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('waymark:remote-sheet-updated', {
          detail: { sheetId: m.sheetId, title: docTitle, summary, from: who },
        }));
      }
    };

    document.addEventListener('waymark:peer-sheet-update', (e) => {
      handlePeerSheetUpdate(e.detail || {});
    });

    if (typeof BroadcastChannel !== 'undefined' && !_collabBC) {
      try {
        _collabBC = new BroadcastChannel('waymark-collab-updates');
        _collabBC.onmessage = (e) => {
          if (e.data?.type === 'waymark-sheet-update') {
            handlePeerSheetUpdate(e.data);
          }
        };
      } catch {
        /* ignore BroadcastChannel errors */
      }
    }

    document.addEventListener('waymark:notifications-changed', () => {
      _refreshBellBadge();
    });
  }

  const existing = document.querySelector('.notif-bell');
  if (existing) {
    _refreshBellBadge();
    return;
  }

  const badge = el('span', { className: 'notif-badge notif-bell-badge hidden' }, ['0']);
  const bellBtn = el('button', {
    className: 'notif-bell btn-icon',
    'aria-label': 'Notifications',
    title: 'Notifications',
    on: { click: (e) => { e.stopPropagation(); _openPanel(bellBtn); } },
  }, [
    el('span', { className: 'notif-bell-icon' }, ['🔔']),
    badge,
  ]);

  const topBarRight = document.querySelector('.top-bar-right');
  if (topBarRight) topBarRight.prepend(bellBtn);

  _refreshBellBadge();
}
const init = initBell;

export {
  NOTIF_SHEET_HEADERS,
  addNotification,
  clearAll,
  ensureSheet,
  evaluateSheet,
  flushNotificationSheetWrites,
  getSheetId,
  getUnreadCount,
  init,
  initBell,
  markAllRead,
  pollNotificationSheet,
  refreshBell,
  setShareActionDelegate,
  showRuleBuilder,
};
