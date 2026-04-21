/* ============================================================
   templates/cms.js — CMS: Content Scheduling and Publishing
   
   Renders a Google Sheet as a content calendar with scheduling
   and publishing workflow. Status cycles: Draft → Scheduled →
   Published → Archived. Highlights upcoming and overdue posts.
   ============================================================ */

import {
  el, cell, editableCell, emitEdit, registerTemplate,
  delegateEvent, cycleStatus, buildDirSyncBtn,
} from './shared.js';

/* ---------- Constants ---------- */

const STATUSES = ['Draft', 'Scheduled', 'Published', 'Archived'];

const STATUS_META = {
  draft:     { emoji: '✏️',  label: 'Draft',     color: '#64748b' },
  scheduled: { emoji: '📅',  label: 'Scheduled', color: '#d97706' },
  published: { emoji: '✅',  label: 'Published', color: '#16a34a' },
  archived:  { emoji: '📦',  label: 'Archived',  color: '#94a3b8' },
};

const TYPE_OPTIONS = [
  'Blog Post', 'Newsletter', 'Social Post', 'Page', 'Announcement', 'Video', 'Podcast', 'Other',
];

/** Number of days ahead considered "publishing soon" */
const SOON_DAYS = 7;

/* ---------- Pure helpers ---------- */

/**
 * Normalise a status string to a lowercase key.
 * @param {string} v
 * @returns {'draft'|'scheduled'|'published'|'archived'}
 */
export function cmsStatusKey(v) {
  const s = (v || '').toLowerCase().trim();
  if (/^sched/.test(s)) return 'scheduled';
  if (/^pub/.test(s)) return 'published';
  if (/^arch/.test(s)) return 'archived';
  return 'draft';
}

/**
 * Classify a status string to a CSS suffix.
 * @param {string} v
 * @returns {string}
 */
export function cmsStageClass(v) {
  return cmsStatusKey(v);
}

/**
 * Parse a date string, returning a Date or null.
 * @param {string} v
 * @returns {Date|null}
 */
export function parseScheduledDate(v) {
  if (!v) return null;
  try {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch (_) { return null; }
}

/**
 * Format a date value as "MMM D, YYYY".
 * @param {string} v
 * @returns {string}
 */
export function formatCmsDate(v) {
  if (!v) return '';
  const d = parseScheduledDate(v);
  if (!d) return v;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Return a scheduling status for a post row:
 *   'overdue'  — status=Scheduled but scheduled date is in the past
 *   'soon'     — status=Scheduled and within SOON_DAYS days
 *   'upcoming' — status=Scheduled and beyond SOON_DAYS days
 *   null       — not scheduled
 * @param {string} statusVal
 * @param {string} scheduledVal
 * @returns {'overdue'|'soon'|'upcoming'|null}
 */
export function scheduleState(statusVal, scheduledVal) {
  if (cmsStatusKey(statusVal) !== 'scheduled') return null;
  const d = parseScheduledDate(scheduledVal);
  if (!d) return null;
  const now = new Date();
  const diffMs = d - now;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= SOON_DAYS) return 'soon';
  return 'upcoming';
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'CMS',
  icon: '📝',
  color: '#0ea5e9',
  priority: 21,
  itemNoun: 'Post',
  defaultHeaders: ['Title', 'Type', 'Status', 'Scheduled', 'Published', 'Author', 'Category', 'Notes'],

  detect(lower) {
    const hasScheduled = lower.some(h => /^scheduled?\s*(date|publish|at)?$/.test(h));
    const hasPublished = lower.some(h => /^published?\s*(date|at|on)?$/.test(h));
    const hasTitle     = lower.some(h => /^title/.test(h));
    const hasStatus    = lower.some(h => /^status/.test(h));
    const hasType      = lower.some(h => /^(type|content.?type|format)$/.test(h));
    // Needs at least scheduling + title, or scheduling + published signals
    return (hasScheduled || hasPublished) && (hasTitle || hasStatus) && hasType;
  },

  columns(lower) {
    const cols = {
      title: -1, type: -1, status: -1,
      scheduled: -1, published: -1,
      author: -1, category: -1, notes: -1,
    };
    cols.title     = lower.findIndex(h => /^title/.test(h));
    cols.type      = lower.findIndex(h => /^(type|content.?type|format)$/.test(h));
    cols.status    = lower.findIndex(h => /^status/.test(h));
    cols.scheduled = lower.findIndex(h => /^scheduled?\s*(date|publish|at)?$/.test(h));
    cols.published = lower.findIndex(h => /^published?\s*(date|at|on)?$/.test(h));
    cols.author    = lower.findIndex(h => /^(author|writer|by|created by)$/.test(h));
    cols.category  = lower.findIndex(h => /^(category|tag|topic|section)$/.test(h));
    cols.notes     = lower.findIndex(h => /^(notes?|description|details?)$/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'title',     label: 'Title',    colIndex: cols.title,     type: 'text',   placeholder: 'Post title', required: true },
      { role: 'type',      label: 'Type',     colIndex: cols.type,      type: 'select', options: TYPE_OPTIONS },
      { role: 'status',    label: 'Status',   colIndex: cols.status,    type: 'select', options: STATUSES, defaultValue: 'Draft' },
      { role: 'scheduled', label: 'Scheduled',colIndex: cols.scheduled, type: 'text',   placeholder: 'YYYY-MM-DD' },
      { role: 'author',    label: 'Author',   colIndex: cols.author,    type: 'text',   placeholder: 'Your name' },
      { role: 'category',  label: 'Category', colIndex: cols.category,  type: 'text',   placeholder: 'Category' },
      { role: 'notes',     label: 'Notes',    colIndex: cols.notes,     type: 'text',   placeholder: 'Notes' },
    ];
  },

  /** @type {string[]} */
  publishStates: STATUSES,

  stageClass: cmsStageClass,

  render(container, rows, cols) {
    container.innerHTML = '';

    /* ---------- Filter state ---------- */
    let activeFilter = 'all';

    /* ---------- Compute summary counts ---------- */
    const counts = { all: rows.length, draft: 0, scheduled: 0, published: 0, archived: 0 };
    let soonCount = 0;
    let overdueCount = 0;

    for (const row of rows) {
      const status = cell(row, cols.status);
      const scheduled = cell(row, cols.scheduled);
      const key = cmsStatusKey(status);
      counts[key]++;
      const state = scheduleState(status, scheduled);
      if (state === 'soon') soonCount++;
      if (state === 'overdue') overdueCount++;
    }

    /* ---------- Alerts banner ---------- */
    const alerts = el('div', { className: 'cms-alerts' });
    if (overdueCount > 0) {
      alerts.append(el('div', { className: 'cms-alert cms-alert-overdue' }, [
        `⚠️ ${overdueCount} post${overdueCount !== 1 ? 's' : ''} past scheduled date — review and publish or reschedule.`,
      ]));
    }
    if (soonCount > 0) {
      alerts.append(el('div', { className: 'cms-alert cms-alert-soon' }, [
        `📅 ${soonCount} post${soonCount !== 1 ? 's' : ''} scheduled to publish in the next ${SOON_DAYS} days.`,
      ]));
    }

    /* ---------- Header ---------- */
    const filterBtns = [];
    const FILTERS = [
      { key: 'all',       label: `All (${counts.all})` },
      { key: 'draft',     label: `✏️ Draft (${counts.draft})` },
      { key: 'scheduled', label: `📅 Scheduled (${counts.scheduled})` },
      { key: 'published', label: `✅ Published (${counts.published})` },
      { key: 'archived',  label: `📦 Archived (${counts.archived})` },
    ];

    for (const f of FILTERS) {
      const btn = el('button', {
        className: 'cms-filter-btn' + (f.key === 'all' ? ' cms-filter-active' : ''),
        dataset: { filter: f.key },
      }, [f.label]);
      filterBtns.push(btn);
    }

    const toolbar = el('div', { className: 'cms-toolbar' }, filterBtns);
    const header  = el('div', { className: 'cms-header' }, [
      el('div', { className: 'cms-title-row' }, [
        el('span', { className: 'cms-icon' }, ['📝']),
        el('span', { className: 'cms-title' }, ['Content Calendar']),
        buildDirSyncBtn(container),
      ]),
      toolbar,
    ]);

    /* ---------- Table ---------- */
    const tbody = el('tbody');

    function buildRows() {
      tbody.innerHTML = '';
      const filtered = activeFilter === 'all'
        ? rows.map((row, i) => ({ row, i }))
        : rows.map((row, i) => ({ row, i })).filter(({ row }) =>
            cmsStatusKey(cell(row, cols.status)) === activeFilter
          );

      if (filtered.length === 0) {
        tbody.append(el('tr', {}, [
          el('td', { className: 'cms-empty', colspan: '8' }, [
            activeFilter === 'all'
              ? 'No posts yet. Use "+ Add Post" to get started.'
              : `No ${activeFilter} posts.`,
          ]),
        ]));
        return;
      }

      for (const { row, i } of filtered) {
        const rowIdx  = i + 1;
        const status  = cell(row, cols.status);
        const statusKey = cmsStatusKey(status);
        const scheduled = cell(row, cols.scheduled);
        const state   = scheduleState(status, scheduled);

        const statusLabel = status || 'Draft';
        const statusBtn = el('button', {
          className: `cms-status-btn cms-status-${statusKey}`,
          title: 'Click to change status',
        }, [statusLabel]);

        statusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = cycleStatus(statusBtn, STATUSES, cmsStageClass, 'cms-status-btn cms-status-');
          emitEdit(rowIdx, cols.status, next);
          // Update row class
          tr.className = buildRowClass(next, state);
        });

        let schedFlag = null;
        if (state === 'overdue') {
          schedFlag = el('span', { className: 'cms-sched-flag cms-sched-overdue', title: 'Past scheduled date' }, ['⚠️ Overdue']);
        } else if (state === 'soon') {
          schedFlag = el('span', { className: 'cms-sched-flag cms-sched-soon', title: 'Publishing soon' }, ['🔔 Soon']);
        }

        const scheduledCell = el('td', { className: 'cms-cell cms-cell-date' }, [
          cols.scheduled >= 0
            ? editableCell('span', { className: 'cms-date-text' }, formatCmsDate(scheduled) || scheduled, rowIdx, cols.scheduled)
            : el('span', { className: 'cms-date-text' }, ['—']),
          schedFlag,
        ]);

        function buildRowClass(st, sched) {
          const cls = ['cms-row'];
          cls.push(`cms-row-${cmsStatusKey(st)}`);
          if (sched === 'overdue') cls.push('cms-row-overdue');
          if (sched === 'soon')    cls.push('cms-row-soon');
          return cls.join(' ');
        }

        const tr = el('tr', { className: buildRowClass(status, state) }, [
          el('td', { className: 'cms-cell cms-cell-title' }, [
            cols.title >= 0
              ? editableCell('span', { className: 'cms-title-text' }, cell(row, cols.title), rowIdx, cols.title)
              : el('span', {}, [row[0] || '—']),
          ]),
          el('td', { className: 'cms-cell cms-cell-type' }, [
            cols.type >= 0
              ? editableCell('span', { className: 'cms-type-badge' }, cell(row, cols.type) || '—', rowIdx, cols.type)
              : null,
          ]),
          el('td', { className: 'cms-cell cms-cell-status' }, [statusBtn]),
          scheduledCell,
          el('td', { className: 'cms-cell cms-cell-date' }, [
            cols.published >= 0
              ? editableCell('span', { className: 'cms-date-text' }, formatCmsDate(cell(row, cols.published)) || cell(row, cols.published), rowIdx, cols.published)
              : null,
          ]),
          el('td', { className: 'cms-cell cms-cell-author' }, [
            cols.author >= 0
              ? editableCell('span', { className: 'cms-author-text' }, cell(row, cols.author), rowIdx, cols.author)
              : null,
          ]),
          el('td', { className: 'cms-cell cms-cell-category' }, [
            cols.category >= 0
              ? editableCell('span', { className: 'cms-category-badge' }, cell(row, cols.category) || '—', rowIdx, cols.category)
              : null,
          ]),
          el('td', { className: 'cms-cell cms-cell-notes' }, [
            cols.notes >= 0
              ? editableCell('span', { className: 'cms-notes-text' }, cell(row, cols.notes), rowIdx, cols.notes)
              : null,
          ]),
        ]);

        tbody.append(tr);
      }
    }

    buildRows();

    const table = el('table', { className: 'cms-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { className: 'cms-th' }, ['Title']),
          el('th', { className: 'cms-th' }, ['Type']),
          el('th', { className: 'cms-th' }, ['Status']),
          el('th', { className: 'cms-th' }, ['Scheduled']),
          el('th', { className: 'cms-th' }, ['Published']),
          el('th', { className: 'cms-th' }, ['Author']),
          el('th', { className: 'cms-th' }, ['Category']),
          el('th', { className: 'cms-th' }, ['Notes']),
        ]),
      ]),
      tbody,
    ]);

    /* ---------- Filter click handling ---------- */
    delegateEvent(toolbar, 'click', '.cms-filter-btn', (_e, btn) => {
      activeFilter = btn.dataset.filter;
      filterBtns.forEach(b => b.classList.toggle('cms-filter-active', b.dataset.filter === activeFilter));
      buildRows();
    });

    const wrap = el('div', { className: 'cms-container' }, [alerts, header, el('div', { className: 'cms-table-wrap' }, [table])]);
    container.append(wrap);
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'cms-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'cms-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'cms-dir-icon tmpl-dir-icon' }, ['📝']),
      el('span', { className: 'cms-dir-title tmpl-dir-title' }, ['Content Calendars']),
      el('span', { className: 'cms-dir-count tmpl-dir-count' }, [
        `${sheets.length} calendar${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'cms-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      const published = rows.filter(r => cmsStatusKey(r[2] || '') === 'published').length;
      const scheduled = rows.filter(r => cmsStatusKey(r[2] || '') === 'scheduled').length;
      grid.append(el('div', {
        className: 'cms-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'cms-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'cms-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} post${rows.length !== 1 ? 's' : ''} — ${published} published, ${scheduled} scheduled`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.cms-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('cms', definition);
export default definition;
