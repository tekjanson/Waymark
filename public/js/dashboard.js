/* ============================================================
   dashboard.js — Multi-Sheet Dashboard view
   Renders a composite view of multiple sheets side-by-side.
   Users pick a layout (2x2, 3x1, sidebar+main) and select
   a sheet for each panel.  Each panel renders its sheet using
   the standard template detection pipeline.
   ============================================================ */

import { api }            from './api-client.js';
import { el, showToast }  from './ui.js';
import * as userData      from './user-data.js';
import { detectTemplate, TEMPLATES } from './templates/index.js';

/* ---------- Layout definitions ---------- */

const LAYOUTS = {
  '2x2':         { label: '2 × 2 Grid',       panelCount: 4, cssClass: 'dashboard-grid-2x2' },
  '3x1':         { label: '3 Column',          panelCount: 3, cssClass: 'dashboard-grid-3x1' },
  'sidebar-main':{ label: 'Sidebar + Main',    panelCount: 2, cssClass: 'dashboard-grid-sidebar' },
  '2x1':         { label: '2 Column',          panelCount: 2, cssClass: 'dashboard-grid-2x1' },
};

/* ---------- State ---------- */

let _viewEl = null;
let _currentDashboardId = null;

/* ---------- Module-private helpers ---------- */

/**
 * Generate a simple unique ID string.
 * @returns {string}
 */
function genId() {
  return `db-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------- Public API ---------- */

/**
 * Initialise the dashboard module.  Call once at app boot.
 * @param {HTMLElement} container — the #dashboard-view section
 */
export function init(container) {
  _viewEl = container;
}

/** Hide the dashboard view. */
export function hide() {
  if (_viewEl) _viewEl.classList.add('hidden');
  _currentDashboardId = null;
}

/**
 * Show the dashboard management home (list of dashboards + create button).
 */
export function showHome() {
  if (!_viewEl) return;
  _viewEl.classList.remove('hidden');
  _currentDashboardId = null;
  renderDashboardHome();
}

/**
 * Open a specific dashboard by ID.
 * @param {string} dashboardId
 */
export async function showDashboard(dashboardId) {
  if (!_viewEl) return;
  _viewEl.classList.remove('hidden');

  const dashboards = userData.getDashboards();
  const db = dashboards.find(d => d.id === dashboardId);
  if (!db) {
    showToast('Dashboard not found', 'error');
    showHome();
    return;
  }

  _currentDashboardId = dashboardId;
  await renderDashboard(db);
}

/* ---------- Home — list of dashboards ---------- */

function renderDashboardHome() {
  _viewEl.innerHTML = '';

  const header = el('div', { className: 'dashboard-home-header' }, [
    el('h2', { className: 'dashboard-home-title' }, ['📊 Dashboards']),
    el('button', {
      className: 'btn btn-primary dashboard-create-btn',
      on: { click: openCreateModal },
    }, ['+ New Dashboard']),
  ]);

  const dashboards = userData.getDashboards();
  let body;

  if (dashboards.length === 0) {
    body = el('div', { className: 'dashboard-empty' }, [
      el('p', { className: 'dashboard-empty-text' }, [
        'No dashboards yet — create one to view multiple sheets side by side.',
      ]),
    ]);
  } else {
    body = el('div', { className: 'dashboard-list' },
      dashboards.map(db => renderDashboardCard(db)),
    );
  }

  _viewEl.appendChild(header);
  _viewEl.appendChild(body);
}

/**
 * Build a card for a single dashboard in the home list.
 * @param {{ id: string, name: string, layout: string, panels: Array }} db
 */
function renderDashboardCard(db) {
  const layoutDef = LAYOUTS[db.layout] || LAYOUTS['2x2'];
  const panelCount = (db.panels || []).filter(p => p && p.sheetId).length;

  return el('div', { className: 'dashboard-card' }, [
    el('div', { className: 'dashboard-card-body', on: {
      click: () => {
        window.location.hash = `#/dashboard/${db.id}`;
      },
    }}, [
      el('div', { className: 'dashboard-card-icon' }, ['📊']),
      el('div', { className: 'dashboard-card-info' }, [
        el('h3', { className: 'dashboard-card-name' }, [db.name]),
        el('p', { className: 'dashboard-card-meta' }, [
          `${layoutDef.label} · ${panelCount} / ${layoutDef.panelCount} panels`,
        ]),
      ]),
    ]),
    el('div', { className: 'dashboard-card-actions' }, [
      el('button', {
        className: 'btn-icon dashboard-edit-btn',
        title: 'Edit dashboard',
        on: { click: (e) => { e.stopPropagation(); openEditModal(db); } },
      }, ['✏️']),
      el('button', {
        className: 'btn-icon dashboard-delete-btn',
        title: 'Delete dashboard',
        on: { click: (e) => { e.stopPropagation(); confirmDelete(db); } },
      }, ['🗑️']),
    ]),
  ]);
}

/* ---------- Dashboard rendering ---------- */

/**
 * Render a full dashboard: header + panel grid.
 * @param {{ id: string, name: string, layout: string, panels: Array }} db
 */
async function renderDashboard(db) {
  _viewEl.innerHTML = '';

  const layoutDef = LAYOUTS[db.layout] || LAYOUTS['2x2'];

  const header = el('div', { className: 'dashboard-view-header' }, [
    el('button', {
      className: 'btn-icon dashboard-back-btn',
      title: 'All dashboards',
      on: { click: () => { window.location.hash = '#/dashboard'; } },
    }, [
      el('svg', { width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', 'stroke-width': '2' }, [
        el('line', { x1: '19', y1: '12', x2: '5', y2: '12' }),
        el('polyline', { points: '12 19 5 12 12 5' }),
      ]),
    ]),
    el('h2', { className: 'dashboard-view-title' }, [db.name]),
    el('span', { className: 'dashboard-layout-badge' }, [layoutDef.label]),
    el('button', {
      className: 'btn-icon dashboard-refresh-btn',
      title: 'Refresh all panels',
      on: { click: () => refreshAllPanels() },
    }, [
      el('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', 'stroke-width': '2' }, [
        el('polyline', { points: '23 4 23 10 17 10' }),
        el('polyline', { points: '1 20 1 14 7 14' }),
        el('path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' }),
      ]),
    ]),
  ]);

  _viewEl.appendChild(header);

  // Ensure panels array is the right length
  const panels = normalisePanels(db.panels, layoutDef.panelCount);

  const grid = el('div', { className: `dashboard-grid ${layoutDef.cssClass}`, id: 'dashboard-grid' });
  _viewEl.appendChild(grid);

  // Render each panel slot
  for (let i = 0; i < layoutDef.panelCount; i++) {
    const panelEl = buildPanelShell(i, panels[i], db);
    grid.appendChild(panelEl);
  }

  // Load panel data concurrently
  await Promise.all(panels.map((panel, i) => {
    if (panel && panel.sheetId) {
      return loadPanel(i, panel.sheetId, db);
    }
    return Promise.resolve();
  }));
}

/**
 * Ensure panels array has exactly panelCount entries (fill with nulls if short).
 */
function normalisePanels(panels, panelCount) {
  const arr = Array.isArray(panels) ? [...panels] : [];
  while (arr.length < panelCount) arr.push(null);
  return arr.slice(0, panelCount);
}

/**
 * Build the DOM shell for a single panel (before data loads).
 * @param {number} index — zero-based panel index
 * @param {{ sheetId: string, title?: string }|null} panel
 * @param {{ id, name, layout, panels }} db
 */
function buildPanelShell(index, panel, db) {
  const panelEl = el('div', {
    className: 'dashboard-panel',
    id: `dashboard-panel-${index}`,
  });

  const titleBar = el('div', { className: 'dashboard-panel-titlebar' }, [
    el('span', { className: 'dashboard-panel-title' }, [panel?.title || 'Empty Panel']),
    el('div', { className: 'dashboard-panel-actions' }, [
      panel && panel.sheetId ? el('a', {
        className: 'btn-icon dashboard-panel-open-btn',
        href: `#/sheet/${panel.sheetId}`,
        title: 'Open sheet',
      }, ['↗']) : el('span', {}),
      el('button', {
        className: 'btn-icon dashboard-panel-pick-btn',
        title: 'Choose sheet for this panel',
        on: { click: () => openPanelPicker(index, db) },
      }, ['⊕']),
    ]),
  ]);

  const content = el('div', { className: 'dashboard-panel-content' });

  if (panel && panel.sheetId) {
    content.appendChild(el('div', { className: 'dashboard-panel-loading' }, ['Loading…']));
  } else {
    content.appendChild(el('div', { className: 'dashboard-panel-empty' }, [
      el('p', {}, ['No sheet selected']),
      el('button', {
        className: 'btn btn-secondary dashboard-panel-add-btn',
        on: { click: () => openPanelPicker(index, db) },
      }, ['+ Add Sheet']),
    ]));
  }

  panelEl.appendChild(titleBar);
  panelEl.appendChild(content);
  return panelEl;
}

/* ---------- Panel loading ---------- */

/**
 * Load a sheet and render it inside the panel.
 * @param {number} index
 * @param {string} sheetId
 * @param {{ id, name, layout, panels }} db
 */
async function loadPanel(index, sheetId, db) {
  const panelEl = document.getElementById(`dashboard-panel-${index}`);
  if (!panelEl) return;
  const content = panelEl.querySelector('.dashboard-panel-content');
  if (!content) return;

  try {
    const data = await api.sheets.getSpreadsheet(sheetId);
    const values = data.values || [];
    const headers = values[0] || [];
    const rows = values.slice(1);
    const { key: templateKey, template } = detectTemplate(headers);

    // Update title bar
    const titleEl = panelEl.querySelector('.dashboard-panel-title');
    if (titleEl) titleEl.textContent = data.title || 'Untitled';

    // Update badge
    const existing = panelEl.querySelector('.dashboard-panel-badge');
    if (existing) existing.remove();
    const badge = el('span', {
      className: 'dashboard-panel-badge',
      style: `background:${template.color || '#64748b'}`,
    }, [template.icon || '', ' ', template.name]);
    const titleBar = panelEl.querySelector('.dashboard-panel-titlebar');
    if (titleBar) titleBar.insertBefore(badge, titleBar.querySelector('.dashboard-panel-actions'));

    // Save title back to dashboard definition for future renders
    const panels = normalisePanels(db.panels, Object.keys(LAYOUTS[db.layout]
      ? LAYOUTS[db.layout] : LAYOUTS['2x2']).length);
    if (db.panels && db.panels[index]) {
      db.panels[index].title = data.title;
    }

    // Render the template
    content.innerHTML = '';
    const templateContainer = el('div', { className: 'dashboard-template-wrap' });
    content.appendChild(templateContainer);
    template.render(templateContainer, rows, template.columns(
      headers.map(h => (h || '').toLowerCase().trim())
    ), template);

  } catch (err) {
    content.innerHTML = '';
    content.appendChild(el('div', { className: 'dashboard-panel-error' }, [
      el('p', {}, [`Failed to load: ${err.message}`]),
    ]));
  }
}

/**
 * Reload all panels from fresh API data.
 */
function refreshAllPanels() {
  const db = userData.getDashboards().find(d => d.id === _currentDashboardId);
  if (!db) return;
  renderDashboard(db);
}

/* ---------- Panel picker modal ---------- */

/**
 * Open a simple modal to pick a sheet for a specific panel slot.
 * @param {number} panelIndex
 * @param {{ id, name, layout, panels }} db
 */
function openPanelPicker(panelIndex, db) {
  const existing = document.getElementById('dashboard-picker-modal');
  if (existing) existing.remove();

  const recentSheets = userData.getRecentSheets();
  const pinnedSheets = userData.getPinnedSheets();
  // Combine unique sheets, pins first
  const seen = new Set();
  const suggestions = [...pinnedSheets, ...recentSheets].filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  const listItems = suggestions.length > 0
    ? suggestions.map(sheet => el('button', {
        className: 'dashboard-picker-item',
        on: { click: () => selectPanelSheet(panelIndex, sheet.id, sheet.name, db, overlay) },
      }, [
        el('span', { className: 'dashboard-picker-icon' }, [TEMPLATES[sheet.templateKey]?.icon || '📊']),
        el('span', { className: 'dashboard-picker-name' }, [sheet.name || sheet.id]),
      ]))
    : [el('p', { className: 'dashboard-picker-empty' }, [
        'Open some sheets first to see them here.',
      ])];

  const clearBtn = db.panels?.[panelIndex]?.sheetId
    ? el('button', {
        className: 'btn btn-secondary',
        on: { click: () => selectPanelSheet(panelIndex, null, null, db, overlay) },
      }, ['Remove Panel'])
    : null;

  const overlay = el('div', {
    id: 'dashboard-picker-modal',
    className: 'modal-overlay',
    on: { click: (e) => { if (e.target === overlay) overlay.remove(); } },
  }, [
    el('div', { className: 'modal' }, [
      el('div', { className: 'modal-header' }, [
        el('h3', {}, [`Choose Sheet for Panel ${panelIndex + 1}`]),
        el('button', {
          className: 'btn-icon modal-close',
          on: { click: () => overlay.remove() },
        }, ['×']),
      ]),
      el('div', { className: 'modal-body dashboard-picker-body' }, [
        el('ul', { className: 'dashboard-picker-list' }, listItems),
      ]),
      ...(clearBtn ? [el('div', { className: 'modal-footer' }, [clearBtn])] : []),
    ]),
  ]);

  document.body.appendChild(overlay);
}

/**
 * Assign a sheet to a panel and save to user-data.
 */
async function selectPanelSheet(panelIndex, sheetId, sheetName, db, overlayEl) {
  if (overlayEl) overlayEl.remove();

  const layout = LAYOUTS[db.layout] || LAYOUTS['2x2'];
  const panels = normalisePanels(db.panels, layout.panelCount);

  if (sheetId) {
    panels[panelIndex] = { sheetId, title: sheetName || sheetId };
  } else {
    panels[panelIndex] = null;
  }

  const updated = { ...db, panels };
  await userData.saveDashboard(updated);

  // Re-render entire dashboard
  await renderDashboard(updated);
}

/* ---------- Create / Edit modal ---------- */

function openCreateModal() {
  openDashboardModal(null);
}

function openEditModal(db) {
  openDashboardModal(db);
}

/**
 * Open the create/edit modal for a dashboard definition.
 * @param {{ id, name, layout, panels }|null} existing — null = create mode
 */
function openDashboardModal(existing) {
  const existing_modal = document.getElementById('dashboard-create-modal');
  if (existing_modal) existing_modal.remove();

  const nameInput = el('input', {
    type: 'text',
    id: 'dashboard-modal-name',
    className: 'dashboard-modal-input',
    placeholder: 'Dashboard name…',
    value: existing?.name || '',
  });

  const layoutRadios = Object.entries(LAYOUTS).map(([key, def]) => {
    const radio = el('input', {
      type: 'radio',
      name: 'dashboard-layout',
      value: key,
      id: `dashboard-layout-${key}`,
    });
    if ((existing?.layout || '2x2') === key) radio.checked = true;
    return el('label', {
      className: 'dashboard-layout-option',
      htmlFor: `dashboard-layout-${key}`,
    }, [radio, el('span', { className: 'dashboard-layout-label' }, [def.label])]);
  });

  const saveBtn = el('button', {
    className: 'btn btn-primary',
    on: { click: async () => {
      const name = nameInput.value.trim();
      if (!name) { showToast('Please enter a dashboard name', 'error'); return; }
      const layout = overlay.querySelector('input[name="dashboard-layout"]:checked')?.value || '2x2';
      const layoutDef = LAYOUTS[layout];
      const panels = normalisePanels(existing?.panels || [], layoutDef.panelCount);
      const db = {
        id: existing?.id || genId(),
        name,
        layout,
        panels,
      };
      await userData.saveDashboard(db);
      overlay.remove();
      showToast(`Dashboard "${name}" saved`, 'success');
      window.location.hash = `#/dashboard/${db.id}`;
    }},
  }, [existing ? 'Save Changes' : 'Create Dashboard']);

  const overlay = el('div', {
    id: 'dashboard-create-modal',
    className: 'modal-overlay',
    on: { click: (e) => { if (e.target === overlay) overlay.remove(); } },
  }, [
    el('div', { className: 'modal' }, [
      el('div', { className: 'modal-header' }, [
        el('h3', {}, [existing ? 'Edit Dashboard' : 'New Dashboard']),
        el('button', {
          className: 'btn-icon modal-close',
          on: { click: () => overlay.remove() },
        }, ['×']),
      ]),
      el('div', { className: 'modal-body' }, [
        el('label', { className: 'dashboard-modal-label', htmlFor: 'dashboard-modal-name' },
          ['Name']),
        nameInput,
        el('fieldset', { className: 'dashboard-layout-fieldset' }, [
          el('legend', { className: 'dashboard-modal-label' }, ['Layout']),
          el('div', { className: 'dashboard-layout-options' }, layoutRadios),
        ]),
      ]),
      el('div', { className: 'modal-footer' }, [saveBtn]),
    ]),
  ]);

  document.body.appendChild(overlay);
  nameInput.focus();
}

/* ---------- Delete confirmation ---------- */

async function confirmDelete(db) {
  if (!confirm(`Delete dashboard "${db.name}"? This cannot be undone.`)) return;
  await userData.deleteDashboard(db.id);
  showToast(`Dashboard "${db.name}" deleted`, 'success');
  renderDashboardHome();
}
