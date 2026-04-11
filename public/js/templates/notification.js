/* ============================================================
   notification.js — Orchestrator Push Notification Rules template

   Renders a Google Sheet as a rules table for the WebRTC-based
   Android push notification system. Each row configures which
   orchestrator events trigger a notification to the phone.
   Columns: Event | Condition | Title | Body | Priority | Enabled
   ============================================================ */

import { el, showToast, editableCell, emitEdit, registerTemplate, buildDirSyncBtn, delegateEvent } from './shared.js';

/* ---------- Constants ---------- */

const PRIORITY_META = {
  urgent: { color: '#dc2626', bg: '#fef2f2' },
  high:   { color: '#d97706', bg: '#fffbeb' },
  normal: { color: '#2563eb', bg: '#eff6ff' },
  low:    { color: '#6b7280', bg: '#f3f4f6' },
};

/* ---------- Helpers ---------- */

function normPriority(val) {
  const v = (val || '').toLowerCase().trim();
  if (/urgent|critical/.test(v)) return 'urgent';
  if (/high/.test(v)) return 'high';
  if (/low|minor/.test(v)) return 'low';
  return 'normal';
}

function normEnabled(val) {
  const v = (val || '').toLowerCase().trim();
  return !['no', 'false', '0', 'disabled'].includes(v);
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Push Notification Rules',
  icon: '📲',
  color: '#7c3aed',
  priority: 22,

  detect(lower) {
    return (
      lower.some(h => /\bevent\b/.test(h)) &&
      lower.some(h => /\bcondition\b/.test(h)) &&
      lower.some(h => /\benabled\b/.test(h))
    );
  },

  columns(lower) {
    const cols = {};
    cols.event     = lower.findIndex(h => /\bevent\b/.test(h));
    cols.condition = lower.findIndex(h => /\bcondition\b/.test(h));
    cols.title     = lower.findIndex(h => /\btitle\b/.test(h));
    cols.body      = lower.findIndex(h => /\bbody\b|\bmessage\b/.test(h));
    cols.priority  = lower.findIndex(h => /\bpriority\b/.test(h));
    cols.enabled   = lower.findIndex(h => /\benabled\b/.test(h));
    return cols;
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    /* ---- Parse rules ---- */
    const rules = rows.map((row, i) => ({
      row,
      rowIndex: i + 1,
      event:     cols.event     >= 0 ? (row[cols.event]     || '') : '',
      condition: cols.condition >= 0 ? (row[cols.condition] || '') : 'always',
      title:     cols.title     >= 0 ? (row[cols.title]     || '') : '',
      body:      cols.body      >= 0 ? (row[cols.body]      || '') : '',
      priority:  normPriority(cols.priority >= 0 ? row[cols.priority] : ''),
      enabled:   normEnabled(cols.enabled >= 0 ? row[cols.enabled] : 'yes'),
    })).filter(r => r.event);

    const enabledCount  = rules.filter(r => r.enabled).length;
    const disabledCount = rules.length - enabledCount;

    /* ---- Summary bar ---- */
    const summary = el('div', { className: 'notifr-summary' }, [
      el('span', { className: 'notifr-summary-title' }, ['📲 Push Notification Rules']),
      el('span', { className: 'notifr-summary-stat' }, [
        el('span', { className: 'notifr-stat-on' }, [`${enabledCount} active`]),
        disabledCount > 0 ? ` · ${disabledCount} disabled` : '',
      ]),
    ]);

    /* ---- Table ---- */
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Event']),
        el('th', {}, ['Condition']),
        el('th', {}, ['Title']),
        el('th', {}, ['Body / Template']),
        el('th', {}, ['Priority']),
        el('th', { title: 'Toggle to enable or disable this rule' }, ['On']),
      ]),
    ]);

    const tbody = el('tbody', {});

    for (const rule of rules) {
      const priMeta = PRIORITY_META[rule.priority] || PRIORITY_META.normal;

      const priBadge = el('span', {
        className: 'notifr-pri-badge',
        style: `background:${priMeta.bg};color:${priMeta.color}`,
      }, [rule.priority]);

      const enabledToggle = el('input', {
        type: 'checkbox',
        className: 'notifr-toggle',
        title: rule.enabled ? 'Click to disable' : 'Click to enable',
      });
      enabledToggle.checked = rule.enabled;
      enabledToggle.addEventListener('change', () => {
        if (cols.enabled >= 0) {
          const newVal = enabledToggle.checked ? 'yes' : 'no';
          emitEdit(rule.rowIndex, cols.enabled, newVal);
          row.classList.toggle('notifr-row-disabled', !enabledToggle.checked);
        }
      });

      const eventCell = cols.event >= 0
        ? editableCell('td', { className: 'notifr-cell-event' }, rule.event, rule.rowIndex, cols.event)
        : el('td', { className: 'notifr-cell-event' }, [rule.event]);

      const condCell = cols.condition >= 0
        ? editableCell('td', { className: 'notifr-cell-condition' }, rule.condition, rule.rowIndex, cols.condition)
        : el('td', { className: 'notifr-cell-condition' }, [rule.condition]);

      const titleCell = cols.title >= 0
        ? editableCell('td', { className: 'notifr-cell-title' }, rule.title, rule.rowIndex, cols.title)
        : el('td', { className: 'notifr-cell-title' }, [rule.title]);

      const bodyCell = cols.body >= 0
        ? editableCell('td', { className: 'notifr-cell-body' }, rule.body, rule.rowIndex, cols.body)
        : el('td', { className: 'notifr-cell-body' }, [rule.body]);

      const row = el('tr', {
        className: `notifr-row${rule.enabled ? '' : ' notifr-row-disabled'}`,
      }, [
        eventCell,
        condCell,
        titleCell,
        bodyCell,
        el('td', { className: 'notifr-cell-priority' }, [priBadge]),
        el('td', { className: 'notifr-cell-enabled' }, [enabledToggle]),
      ]);

      tbody.appendChild(row);
    }

    if (rules.length === 0) {
      tbody.appendChild(
        el('tr', {}, [
          el('td', { colSpan: '6', className: 'notifr-empty' }, [
            'No rules yet. Add rows: Event | Condition | Title | Body | Priority | Enabled',
          ]),
        ])
      );
    }

    const table = el('table', { className: 'notifr-table' }, [thead, tbody]);

    /* ---- Hint footer ---- */
    const hint = el('div', { className: 'notifr-hint' }, [
      el('strong', {}, ['Events: ']),
      'DISPATCH, TASK_QA, TASK_DONE, BLOCKED, WAIT, IDLE, POLL_FAILED, CYCLE_RATE_HIGH',
      el('br', {}),
      el('strong', {}, ['Templates: ']),
      'Use {{agentName}}, {{taskTitle}}, {{task}}, {{reason}}, {{doneCount}}, {{qaCount}}, {{delta}} in Title and Body.',
    ]);

    const view = el('div', { className: 'notifr-view' }, [summary, table, hint]);
    container.appendChild(view);
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'notifr-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'notifr-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'tmpl-dir-icon' }, ['📲']),
      el('span', { className: 'tmpl-dir-title' }, ['Push Notification Rules']),
      el('span', { className: 'tmpl-dir-count' }, [`${sheets.length} sheet${sheets.length !== 1 ? 's' : ''}`]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'tmpl-dir-card-stat' }, [
          `${rows.length} rule${rows.length !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.tmpl-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('notification', definition);
export default definition;
