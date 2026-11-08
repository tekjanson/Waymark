/* ============================================================
   notification.js — Notification History Viewer template

   Renders a Google Sheet as an interactive notification inbox.
   Columns: Title | Message | Type | Status | Icon | Priority |
            Created | Expires | Source | Sheet
   ============================================================ */

import { getRaw, setRaw, el, emitEdit, registerTemplate, buildDirSyncBtn, delegateEvent } from './shared.js';

/* ---------- Constants ---------- */

const STATUS_CYCLE = ['Active', 'Read', 'Dismissed'];

const TYPE_META = {
  alert:   { bg: '#fef2f2', color: '#dc2626' },
  warning: { bg: '#fffbeb', color: '#d97706' },
  info:    { bg: '#eff6ff', color: '#2563eb' },
  update:  { bg: '#f0fdf4', color: '#16a34a' },
  share:   { bg: '#f5f3ff', color: '#7c3aed' },
  chat:    { bg: '#ecfeff', color: '#0891b2' },
  call:    { bg: '#fefce8', color: '#ca8a04' },
};

const PRIORITY_META = {
  high:   { color: '#dc2626' },
  medium: { color: '#d97706' },
  low:    { color: '#6b7280' },
};

/* ---------- Helpers ---------- */

function normStatus(val) {
  const v = (val || '').trim();
  return STATUS_CYCLE.includes(v) ? v : 'Active';
}

function nextStatus(current) {
  const i = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}

function getCurrentSheetId() {
  const m = (window.location.hash || '').match(/#\/sheet\/([^/?#]+)/);
  return m ? m[1] : '';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Push Notification Rules',
  icon: '📲',
  color: '#7c3aed',
  priority: 22,
  hasDirectoryView: true,

  detect(lower) {
    return (
      lower.some(h => /\btitle\b/.test(h)) &&
      lower.some(h => /\bmessage\b|\bbody\b/.test(h)) &&
      lower.some(h => /\bstatus\b/.test(h)) &&
      lower.some(h => /\btype\b/.test(h))
    );
  },

  columns(lower) {
    return {
      title:    lower.findIndex(h => /\btitle\b/.test(h)),
      message:  lower.findIndex(h => /\bmessage\b|\bbody\b/.test(h)),
      type:     lower.findIndex(h => /\btype\b/.test(h)),
      status:   lower.findIndex(h => /\bstatus\b/.test(h)),
      icon:     lower.findIndex(h => /\bicon\b/.test(h)),
      priority: lower.findIndex(h => /\bpriority\b/.test(h)),
      created:  lower.findIndex(h => /\bcreated\b/.test(h)),
      expires:  lower.findIndex(h => /\bexpires?\b/.test(h)),
      source:   lower.findIndex(h => /\bsource\b/.test(h)),
      sheet:    lower.findIndex(h => /\bsheet\b/.test(h)),
    };
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    /* ---- Parse notifications ---- */
    const notifs = rows.map((row, i) => ({
      rowIndex: i + 1,
      title:    cols.title    >= 0 ? (row[cols.title]    || '') : '',
      message:  cols.message  >= 0 ? (row[cols.message]  || '') : '',
      type:     (cols.type    >= 0 ? (row[cols.type]     || 'info') : 'info').toLowerCase(),
      status:   normStatus(cols.status >= 0 ? row[cols.status] : 'Active'),
      icon:     cols.icon     >= 0 ? (row[cols.icon]     || '') : '',
      priority: (cols.priority >= 0 ? (row[cols.priority] || 'Medium') : 'Medium').toLowerCase(),
      created:  cols.created  >= 0 ? (row[cols.created]  || '') : '',
      expires:  cols.expires  >= 0 ? (row[cols.expires]  || '') : '',
      source:   cols.source   >= 0 ? (row[cols.source]   || '') : '',
      sheet:    cols.sheet    >= 0 ? (row[cols.sheet]    || '') : '',
    })).filter(n => n.title);

    /* ---- State ---- */
    let currentFilter = 'All';

    /* ---- Connection state ---- */
    const sheetId = getCurrentSheetId();
    const configuredId = getRaw('waymark_notif_sheet_id') || '';
    const isConnected = configuredId === sheetId && sheetId;

    /* ---- Count helpers ---- */
    function countByStatus(status) {
      return notifs.filter(n => n.status === status).length;
    }

    /* ---- Build a notification card ---- */
    function buildCard(n) {
      const typeMeta = TYPE_META[n.type] || TYPE_META.info;
      const priMeta  = PRIORITY_META[n.priority] || {};

      /* Status badge — cycles on click */
      const badge = el('span', {
        className: `notification-type-badge notification-badge-${n.status.toLowerCase()}`,
        style: 'cursor:pointer',
        title: `Status: ${n.status} — click to cycle`,
      }, [n.status]);

      badge.addEventListener('click', () => {
        n.status = nextStatus(n.status);
        badge.textContent = n.status;
        badge.className = `notification-type-badge notification-badge-${n.status.toLowerCase()}`;
        emitEdit(n.rowIndex, cols.status, n.status);
        if (isConnected) {
          try {
            const stored = JSON.parse(getRaw('waymark_notifications') || '[]');
            let changed = false;
            for (const item of stored) {
              if (item.title === n.title) {
                item.read = n.status !== 'Active';
                changed = true;
              }
            }
            if (changed) {
              setRaw('waymark_notifications', JSON.stringify(stored));
              document.dispatchEvent(new CustomEvent('waymark:notifications-changed'));
            }
          } catch { /* ignore */ }
        }
        // Update card class
        card.className = `notification-card notification-status-${n.status.toLowerCase()}`;
        // Update summary count
        updateSummary();
        // Re-filter if needed
        if (currentFilter !== 'All') applyFilter(currentFilter);
      });

      /* Type pill */
      const typePill = el('span', {
        className: 'notification-type-pill',
        style: `background:${typeMeta.bg};color:${typeMeta.color}`,
      }, [n.type]);

      /* Header row */
      const header = el('div', { className: 'notification-card-header' }, [
        n.icon ? el('span', { className: 'notification-icon' }, [n.icon]) : null,
        el('span', { className: 'notification-card-title' }, [n.title]),
        typePill,
        badge,
      ].filter(Boolean));

      /* Body */
      const body = el('div', { className: 'notification-card-body' }, [n.message]);

      /* Meta row */
      const metaChildren = [];
      if (n.created) {
        metaChildren.push(el('span', { className: 'notification-meta-date' }, [formatDate(n.created)]));
      }
      if (n.expires) {
        metaChildren.push(el('span', { className: 'notification-expiry' }, [`Expires: ${n.expires}`]));
      }
      if (n.source) {
        metaChildren.push(el('span', { className: 'notification-meta-source' }, [n.source]));
      }
      if (n.sheet) {
        const link = el('a', {
          className: 'notification-meta-link',
          href: `#/sheet/${n.sheet}`,
        }, ['Open Sheet']);
        metaChildren.push(link);
      }
      if (n.priority && n.priority !== 'medium') {
        const priColor = priMeta.color || '#6b7280';
        metaChildren.push(el('span', {
          className: 'notification-priority-tag',
          style: `color:${priColor}`,
        }, [n.priority]));
      }

      const meta = metaChildren.length
        ? el('div', { className: 'notification-card-meta' }, metaChildren)
        : null;

      /* Collaboration action buttons for share / collaborator notifications */
      const actionChildren = [];
      if (n.type === 'share' && n.sheet) {
        const acceptBtn = el('button', {
          className: 'btn btn-sm notification-accept-btn',
          type: 'button',
          title: 'Accept shared Waymark',
        }, ['✓ Accept']);
        const rejectBtn = el('button', {
          className: 'btn btn-sm notification-reject-btn',
          type: 'button',
          title: 'Reject shared Waymark',
        }, ['✕ Reject']);

        acceptBtn.addEventListener('click', async () => {
          if (typeof window !== 'undefined' && window._waymarkShareActionDelegate?.acceptSharedWaymark) {
            await window._waymarkShareActionDelegate.acceptSharedWaymark({
              docId: n.sheet,
              docTitle: n.title,
              from: n.source || '',
            });
          }
          n.status = 'Read';
          badge.textContent = 'Read';
          badge.className = 'notification-type-badge notification-badge-read';
          card.className = 'notification-card notification-status-read';
          if (cols.status >= 0) emitEdit(n.rowIndex, cols.status, 'Read');
          updateSummary();
          if (currentFilter !== 'All') applyFilter(currentFilter);
        });

        rejectBtn.addEventListener('click', async () => {
          if (typeof window !== 'undefined' && window._waymarkShareActionDelegate?.rejectSharedWaymark) {
            await window._waymarkShareActionDelegate.rejectSharedWaymark({
              docId: n.sheet,
              docTitle: n.title,
            });
          }
          n.status = 'Dismissed';
          badge.textContent = 'Dismissed';
          badge.className = 'notification-type-badge notification-badge-dismissed';
          card.className = 'notification-card notification-status-dismissed';
          if (cols.status >= 0) emitEdit(n.rowIndex, cols.status, 'Dismissed');
          updateSummary();
          if (currentFilter !== 'All') applyFilter(currentFilter);
        });

        actionChildren.push(acceptBtn, rejectBtn);
      }

      if (['share', 'update', 'chat', 'call'].includes(n.type) && n.source && n.source !== 'Waymark' && n.source !== 'Notification Sheet') {
        const callBtn = el('button', {
          className: 'btn btn-sm notification-call-btn',
          type: 'button',
          title: `Call ${n.source} in The Wayside`,
        }, [n.type === 'call' ? '📞 Join Call' : '📹 Call']);
        callBtn.addEventListener('click', () => {
          const isEmail = n.source.includes('@');
          window.dispatchEvent(new CustomEvent('waymark:start-wayside-call', {
            detail: {
              contactEmail: isEmail ? n.source : '',
              group: !isEmail ? n.source : '',
              label: isEmail ? n.source.split('@')[0] : n.source,
            },
          }));
        });
        actionChildren.push(callBtn);
      }

      const actionsRow = actionChildren.length
        ? el('div', { className: 'notification-card-actions' }, actionChildren)
        : null;

      const card = el('div', {
        className: `notification-card notification-status-${n.status.toLowerCase()}`,
      }, [header, body, meta, actionsRow].filter(Boolean));

      n._card = card;
      return card;
    }

    /* ---- List container ---- */
    const list = el('div', { className: 'notification-list' });
    notifs.forEach(n => list.appendChild(buildCard(n)));

    /* ---- Summary bar ---- */
    const activeCountEl = el('span', { className: 'notification-active-count' }, [`${countByStatus('Active')}`]);
    const summaryText   = el('span', { className: 'notification-summary-text' }, [' active notifications']);

    /* ---- Connection badge / Use button ---- */
    let connectionEl;
    if (isConnected) {
      connectionEl = el('span', { className: 'notification-connected-badge' }, ['🔔 Connected to Bell']);
    } else {
      const useBtn = el('button', { className: 'notification-use-btn' }, ['Use as Notification Sheet']);
      useBtn.addEventListener('click', () => {
        setRaw('waymark_notif_sheet_id', sheetId);
        const badge = el('span', { className: 'notification-connected-badge' }, ['🔔 Connected to Bell']);
        summary.replaceChild(badge, useBtn);
        connectionEl = badge;
      });
      connectionEl = useBtn;
    }

    const summary = el('div', { className: 'notification-summary' }, [
      el('div', { className: 'notification-summary-left' }, [activeCountEl, summaryText]),
      connectionEl,
    ]);

    /* ---- Filter bar ---- */
    function makePill(label, filter) {
      const countVal = filter === 'All' ? notifs.length : countByStatus(filter);
      const countSpan = el('span', { className: 'notification-pill-count' }, [`${countVal}`]);
      const pill = el('button', {
        className: `notification-filter-pill${currentFilter === filter ? ' active' : ''}`,
        style: 'cursor:pointer',
      }, [label, ' ', countSpan]);
      pill.addEventListener('click', () => {
        currentFilter = filter;
        applyFilter(filter);
        filterBar.querySelectorAll('.notification-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      });
      pill._countSpan = countSpan;
      pill._filter = filter;
      return pill;
    }

    const filterBar = el('div', { className: 'notification-filter-bar' }, [
      makePill('All', 'All'),
      makePill('Active', 'Active'),
      makePill('Read', 'Read'),
      makePill('Dismissed', 'Dismissed'),
    ]);

    /* ---- Filter logic: remove/re-add cards so DOM count matches ---- */
    function applyFilter(filter) {
      list.innerHTML = '';
      notifs
        .filter(n => filter === 'All' || n.status === filter)
        .forEach(n => list.appendChild(n._card));
    }

    /* ---- Update summary active count ---- */
    function updateSummary() {
      const active = countByStatus('Active');
      activeCountEl.textContent = `${active}`;
      // Update pill counts
      filterBar.querySelectorAll('.notification-filter-pill').forEach(pill => {
        const f = pill._filter;
        const n = f === 'All' ? notifs.length : countByStatus(f);
        if (pill._countSpan) pill._countSpan.textContent = `${n}`;
      });
    }

    /* ---- Assemble view ---- */
    const view = el('div', { className: 'notification-view' }, [summary, filterBar, list]);
    container.appendChild(view);
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'notification-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'notification-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'tmpl-dir-icon' }, ['📲']),
      el('span', { className: 'tmpl-dir-title' }, ['Notification Sheets']),
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
        el('div', { className: 'tmpl-dir-card-stat' }, [`${rows.length} notification${rows.length !== 1 ? 's' : ''}`]),
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
