/* ============================================================
   notification.js — Notification template
   
   Renders a Google Sheet as a structured notification log with
   status cycling, filtering, and contextual metadata.
   ============================================================ */

import { el, showToast, editableCell, emitEdit, registerTemplate, buildDirSyncBtn, delegateEvent } from './shared.js';

/* ---------- Constants ---------- */

const STATUS_ORDER = ['Active', 'Read', 'Dismissed'];

const TYPE_META = {
  alert:   { color: '#dc2626', bg: '#fef2f2', label: 'Alert' },
  warning: { color: '#d97706', bg: '#fffbeb', label: 'Warning' },
  info:    { color: '#2563eb', bg: '#eff6ff', label: 'Info' },
  success: { color: '#16a34a', bg: '#f0fdf4', label: 'Success' },
};

const PRIORITY_CLASS = {
  high:   'notification-pri-high',
  medium: 'notification-pri-medium',
  low:    'notification-pri-low',
};

/* ---------- Helpers ---------- */

function classifyType(val) {
  const v = (val || '').toLowerCase().trim();
  if (/^alert/.test(v)) return 'alert';
  if (/^warn/.test(v)) return 'warning';
  if (/^success|^ok/.test(v)) return 'success';
  return 'info';
}

function classifyStatus(val) {
  const v = (val || '').toLowerCase().trim();
  if (/^read/.test(v)) return 'Read';
  if (/^dismiss/.test(v)) return 'Dismissed';
  return 'Active';
}

function classifyPriority(val) {
  const v = (val || '').toLowerCase().trim();
  if (/^high|^urgent|^critical/.test(v)) return 'high';
  if (/^low|^minor/.test(v)) return 'low';
  return 'medium';
}

function isExpired(val) {
  if (!val || typeof val !== 'string') return false;
  const d = new Date(val);
  if (isNaN(d.getTime())) return false;
  return d < new Date();
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Notifications',
  icon: '🔔',
  color: '#7c3aed',
  priority: 22,

  detect(lower) {
    return (
      lower.some(h => /\btitle\b/.test(h)) &&
      lower.some(h => /\bstatus\b/.test(h)) &&
      lower.some(h => /\bmessage\b/.test(h))
    );
  },

  columns(lower) {
    const cols = {};
    cols.title    = lower.findIndex(h => /\btitle\b/.test(h));
    cols.message  = lower.findIndex(h => /\bmessage\b/.test(h));
    cols.type     = lower.findIndex(h => /\btype\b/.test(h));
    cols.status   = lower.findIndex(h => /\bstatus\b/.test(h));
    cols.icon     = lower.findIndex(h => /\bicon\b/.test(h));
    cols.priority = lower.findIndex(h => /\bpriority\b/.test(h));
    cols.created  = lower.findIndex(h => /\bcreated\b|\bdate\b/.test(h));
    cols.expires  = lower.findIndex(h => /\bexpires?\b|\bexpiry\b/.test(h));
    cols.source   = lower.findIndex(h => /\bsource\b/.test(h));
    cols.sheetRef = lower.findIndex(h => /\bsheet\b/.test(h));
    return cols;
  },

  render(container, rows, cols, template) {
    container.innerHTML = '';

    /* ---- Parse notifications ---- */
    const notifs = rows.map((row, rowOffset) => ({
      row,
      rowIndex: rowOffset + 1,
      title:    cols.title >= 0    ? (row[cols.title] || '')    : '',
      message:  cols.message >= 0  ? (row[cols.message] || '')  : '',
      type:     classifyType(cols.type >= 0 ? row[cols.type] : ''),
      status:   classifyStatus(cols.status >= 0 ? row[cols.status] : ''),
      icon:     cols.icon >= 0     ? (row[cols.icon] || '🔔')   : '🔔',
      priority: classifyPriority(cols.priority >= 0 ? row[cols.priority] : ''),
      created:  cols.created >= 0  ? (row[cols.created] || '')  : '',
      expires:  cols.expires >= 0  ? (row[cols.expires] || '')  : '',
      source:   cols.source >= 0   ? (row[cols.source] || '')   : '',
      sheetRef: cols.sheetRef >= 0 ? (row[cols.sheetRef] || '') : '',
    })).filter(n => n.title);

    /* ---- Active filter state ---- */
    let activeFilter = 'All';

    const counts = {
      All:       notifs.length,
      Active:    notifs.filter(n => n.status === 'Active').length,
      Read:      notifs.filter(n => n.status === 'Read').length,
      Dismissed: notifs.filter(n => n.status === 'Dismissed').length,
    };

    /* ---- Render helper ---- */
    function renderList() {
      list.innerHTML = '';
      const visible = activeFilter === 'All'
        ? notifs
        : notifs.filter(n => n.status === activeFilter);

      if (visible.length === 0) {
        list.appendChild(el('div', { className: 'notification-empty' }, [
          el('div', { className: 'notification-empty-icon' }, ['🔕']),
          el('div', {}, ['No notifications in this view']),
        ]));
        return;
      }

      for (const n of visible) {
        const expired = isExpired(n.expires);
        const typeMeta = TYPE_META[n.type] || TYPE_META.info;

        const typeBtn = el('button', {
          className: `notification-type-badge notification-type-${n.type}`,
          title: `Status: ${n.status} — click to cycle`,
          style: `background:${typeMeta.bg};color:${typeMeta.color}`,
          on: {
            click: () => {
              const nextStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(n.status) + 1) % STATUS_ORDER.length];
              n.status = nextStatus;
              if (cols.status >= 0) emitEdit(n.rowIndex, cols.status, nextStatus);
              // Update counts
              counts.Active    = notifs.filter(x => x.status === 'Active').length;
              counts.Read      = notifs.filter(x => x.status === 'Read').length;
              counts.Dismissed = notifs.filter(x => x.status === 'Dismissed').length;
              counts.All       = notifs.length;
              _updatePills();
              _updateSummary();
              renderList();
            },
          },
        }, [n.status]);

        const priBadge = n.priority !== 'medium'
          ? el('span', { className: `notification-pri-badge ${PRIORITY_CLASS[n.priority]}` }, [
              n.priority === 'high' ? '▲' : '▼',
              ' ',
              n.priority.charAt(0).toUpperCase() + n.priority.slice(1),
            ])
          : null;

        const metaParts = [];
        if (n.source) {
          metaParts.push(el('span', { className: 'notification-meta-source' }, [n.source]));
        }
        if (n.created) {
          metaParts.push(el('span', { className: 'notification-meta-time' }, [timeAgo(n.created)]));
        }
        if (expired && n.expires) {
          metaParts.push(el('span', { className: 'notification-meta-expired' }, ['Expired']));
        }
        if (!expired && n.expires) {
          const d = new Date(n.expires);
          const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          metaParts.push(el('span', { className: 'notification-meta-expires' }, [`Expires ${dateStr}`]));
        }
        if (n.sheetRef) {
          metaParts.push(el('a', {
            className: 'notification-meta-link',
            href: `#/sheet/${n.sheetRef}`,
          }, ['Open Sheet →']));
        }

        const titleCell = cols.title >= 0
          ? editableCell('div', { className: 'notification-card-title' }, n.title, n.rowIndex, cols.title)
          : el('div', { className: 'notification-card-title' }, [n.title]);

        const card = el('div', {
          className: `notification-card notification-status-${n.status.toLowerCase()}${expired ? ' notification-expired' : ''}`,
        }, [
          el('div', { className: 'notification-card-icon' }, [n.icon]),
          el('div', { className: 'notification-card-body' }, [
            el('div', { className: 'notification-card-header' }, [
              titleCell,
              el('div', { className: 'notification-card-badges' }, [
                typeBtn,
                ...(priBadge ? [priBadge] : []),
              ]),
            ]),
            el('div', { className: 'notification-card-message' }, [n.message]),
            metaParts.length > 0
              ? el('div', { className: 'notification-card-meta' }, metaParts)
              : null,
          ].filter(Boolean)),
        ]);

        list.appendChild(card);
      }
    }

    /* ---- Summary bar ---- */
    const activeCount = el('span', { className: 'notification-active-count' }, 
      [String(counts.Active)]
    );
    const summaryText = el('span', { className: 'notification-summary-text' }, [
      activeCount,
      ' active notification',
      counts.Active !== 1 ? 's' : '',
    ]);

    // Check if this sheet is already the configured notification sheet
    const currentSheetId = window.location.hash.match(/sheet\/([^/?#]+)/)?.[1];
    const configuredId = localStorage.getItem('waymark_notif_sheet_id');
    const isConnected = currentSheetId && currentSheetId === configuredId;

    const useAsSheetBtn = isConnected
      ? el('span', { className: 'notification-connected-badge' }, ['✓ Connected to Bell'])
      : el('button', {
          className: 'notification-use-btn',
          title: 'Set this sheet as your Waymark notification log',
          on: {
            click: () => {
              if (currentSheetId) {
                localStorage.setItem('waymark_notif_sheet_id', currentSheetId);
                showToast('This sheet is now your notification log', 'success');
                useAsSheetBtn.replaceWith(
                  el('span', { className: 'notification-connected-badge' }, ['✓ Connected to Bell'])
                );
              }
            },
          },
        }, ['📌 Use as Notification Sheet']);

    const summaryBar = el('div', { className: 'notification-summary' }, [
      summaryText,
      useAsSheetBtn,
    ]);

    function _updateSummary() {
      activeCount.textContent = String(counts.Active);
      summaryText.lastChild.textContent = counts.Active !== 1 ? 's' : '';
    }

    /* ---- Filter pills ---- */
    const pills = {};
    const pillBar = el('div', { className: 'notification-filter-bar' });

    for (const label of ['All', 'Active', 'Read', 'Dismissed']) {
      const pill = el('button', {
        className: `notification-filter-pill${label === 'All' ? ' active' : ''}`,
        on: {
          click: () => {
            activeFilter = label;
            for (const [k, p] of Object.entries(pills)) {
              p.classList.toggle('active', k === label);
            }
            renderList();
          },
        },
      }, [
        label,
        ' ',
        el('span', { className: 'notification-pill-count' }, [String(counts[label])]),
      ]);
      pills[label] = pill;
      pillBar.appendChild(pill);
    }

    function _updatePills() {
      for (const [label, pill] of Object.entries(pills)) {
        pill.querySelector('.notification-pill-count').textContent = String(counts[label]);
      }
    }

    /* ---- Notification list container ---- */
    const list = el('div', { className: 'notification-list' });

    /* ---- Assemble ---- */
    const view = el('div', { className: 'notification-view' }, [
      summaryBar,
      pillBar,
      list,
    ]);
    container.appendChild(view);
    renderList();
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'notification-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'notification-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'notification-dir-icon tmpl-dir-icon' }, ['\uD83D\uDD14']),
      el('span', { className: 'notification-dir-title tmpl-dir-title' }, ['Notification Centers']),
      el('span', { className: 'notification-dir-count tmpl-dir-count' }, [
        `${sheets.length} source${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'notification-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'notification-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'notification-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'notification-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} notification${rows.length !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.notification-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('notification', definition);
export default definition;
