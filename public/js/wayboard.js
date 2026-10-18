/* ============================================================
   wayboard.js — Unified Wayboard home: widgets, Wayside social,
   and the 50 selectable layout architectures (mode-1 … mode-50).
   ============================================================ */

import { el, showToast } from './ui.js';
import { api } from './api-client.js';
import * as userData from './user-data.js';
import * as collab from './collab.js';
import { TEMPLATES } from './templates/index.js';

/* ---------- 50 architecture names (for the Profile selector) ---------- */

export const MODE_NAMES = {
  1: 'Markup Command Center (Classic 3-Col)', 2: 'Bento Grid + Story Pill Markers', 3: 'Top Multiplayer Social Pill', 4: 'Guild Left-Dock (Discord Style)',
  5: 'Spatial Glass + Floating Bottom Dock', 6: 'Warm Editorial Daylight', 7: 'Dual-Column Split', 8: 'Linear Timeline',
  9: 'Infinite Dot-Grid Tactile Pinboard', 10: 'AR Field Engineer HUD', 11: 'Bottom Comms Utility Tray', 12: 'Visual Gallery Grid',
  13: 'AI-First Prompt Stream', 14: '3D World Stage (Floorplan IS Background)', 15: 'Orbital Node Map', 16: 'Multiplayer Tavern Rooms',
  17: 'BOOX E-Ink Paper Tablet', 18: 'Horizontal Time River', 19: 'Floating OS Window Manager', 20: 'Sheet Matrix Control Plane',
  21: 'VS Code / Cursor 4-Pane IDE Split', 22: 'Apple CoverFlow 3D Perspective Carousel', 23: 'AutoCAD / Revit 4-Viewport Station',
  24: 'Swiss International Typographic Grid', 25: 'Arc Browser Floating Glass Frame', 26: 'Kanban 4-Column Vertical Swimlanes',
  27: 'Circular Radar / Sonar Concentric Station', 28: 'Isometric 3D Pitched Tabletop Board', 29: 'Dynamic Island Top Pill',
  30: 'Obsidian Bi-Directional Graph', 31: 'Node-RED / ComfyUI Patch-Cord Canvas', 32: 'Newspaper Multi-Column Broadsheet',
  33: 'Video-First 50/50 Split', 34: 'Hyprland / i3wm Tiling Window Manager', 35: 'Interactive Horizontal Accordion Slices',
  36: 'Smart Glasses Peripheral AR HUD', 37: 'Architectural Blueprint Sheet + Title Block', 38: '4-Quadrant Compass Rose',
  39: 'Split-Level Mezzanine', 40: 'Zen Spotlight Focus Mode', 41: 'Jupyter / Observable Notebook Cells',
  42: 'Teenage Engineering OP-1 Tactile Synth', 43: '3-Monitor Curved Ultrawide Cockpit', 44: 'Staggered Masonry Waterfall Grid',
  45: 'Subway / Metro Transit Line Topology', 46: 'Floating Organic Glass Orbs', 47: 'Dual-Brain Reverse Split',
  48: 'Detective Corkboard + Polaroids + Red String', 49: 'SpaceX / Bloomberg 5-Column Telemetry', 50: 'Spotlight Command-First Zero-Chrome',
};

/** Grouping used by the Profile selector. */
export const MODE_GROUPS = [
  { label: '1–20 Core & Unchained', range: [1, 20] },
  { label: '21–35 Spatial Architectures', range: [21, 35] },
  { label: '36–50 Experimental Mechanics', range: [36, 50] },
];

const MAX_HOME_WIDGETS = 8;
const DEFAULT_HOME_WIDGETS = [
  { id: 'starter-overview', type: 'overview', title: 'Your Waymark overview', size: 'normal' },
  { id: 'starter-recent', type: 'recent', title: 'Recently opened', size: 'normal' },
  { id: 'starter-pinned', type: 'pinned', title: 'Pinned Waymarks', size: 'normal' },
  { id: 'starter-folders', type: 'folders', title: 'Pinned folders', size: 'normal' },
];
const WIDGET_TYPES = {
  overview: { label: 'Waymark overview', icon: '📊' },
  recent: { label: 'Recently opened', icon: '🕒' },
  pinned: { label: 'Pinned Waymarks', icon: '📌' },
  folders: { label: 'Pinned folders', icon: '📁' },
  sheet: { label: 'Waymark preview', icon: '📄' },
};
const sheetPreviewCache = new Map();

/* ---------- Mode application ---------- */

/**
 * Apply a home layout architecture to the Wayboard root.
 * @param {number} mode 1–50
 */
export function applyHomeMode(mode) {
  const root = document.getElementById('wayboard-root');
  if (!root) return;
  const n = (mode >= 1 && mode <= 50) ? mode : 1;
  root.className = `wayboard-root mode-${n}`;
}

/* ---------- Wayboard render ---------- */

let _navigate = null;

/**
 * One-time wiring of Wayboard navigation callbacks.
 * @param {{ navigate: Function }} deps
 */
export function initWayboard(deps = {}) {
  _navigate = deps.navigate || null;
}

/**
 * Render the full Wayboard: status badges, dashboard widgets and the Wayside.
 * Pinned/recent markers are rendered by app.js into the existing containers.
 * @param {{ userName?: string }} [opts]
 */
export function renderWayboard(opts = {}) {
  applyHomeMode(userData.getHomeTemplateMode());
  renderStatusBadges();
  renderWidgets();
  renderWayside().catch(() => {});

  const addWidget = document.getElementById('wayboard-add-widget');
  if (addWidget && !addWidget._wired) {
    addWidget._wired = true;
    addWidget.addEventListener('click', () => {
      openWidgetManager();
    });
  }
}

function renderStatusBadges() {
  const host = document.getElementById('home-status-badges');
  if (!host) return;
  host.innerHTML = '';
  const pinned = userData.getPinnedSheets().length + userData.getPinnedFolders().length;
  const recent = userData.getRecentSheets().length;
  host.append(
    el('span', { className: 'badge' }, [`📌 ${pinned} pinned`]),
    el('span', { className: 'badge blue' }, [`🕒 ${recent} recent Waymark${recent === 1 ? '' : 's'}`]),
  );
}

/* ---------- Dashboard widgets ---------- */

function getConfiguredWidgets() {
  const saved = userData.getHomeWidgets();
  const source = Array.isArray(saved) ? saved : DEFAULT_HOME_WIDGETS.filter(widget =>
    widget.type === 'overview'
      || (widget.type === 'recent' && userData.getRecentSheets().length > 0)
      || (widget.type === 'pinned' && userData.getPinnedSheets().length > 0)
      || (widget.type === 'folders' && userData.getPinnedFolders().length > 0)
  );
  const usedIds = new Set();
  return source
    .filter(w => w && WIDGET_TYPES[w.type])
    .slice(0, MAX_HOME_WIDGETS)
    .map(w => {
      let id = String(w.id || `widget-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      if (usedIds.has(id)) id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      usedIds.add(id);
      return {
        id,
        type: w.type,
        title: String(w.title || WIDGET_TYPES[w.type].label).slice(0, 48),
        sheetId: w.sheetId ? String(w.sheetId) : '',
        sheetName: String(w.sheetName || '').slice(0, 120),
        templateKey: String(w.templateKey || ''),
        size: w.size === 'wide' ? 'wide' : 'normal',
      };
    });
}

function saveWidgets(widgets) {
  return userData.setHomeWidgets(widgets.slice(0, MAX_HOME_WIDGETS));
}

function openWaymark(sheet) {
  if (sheet?.id && _navigate) _navigate('sheet', sheet.id, sheet.name || 'Waymark');
}

function emptyWidgetMessage(message, actionLabel = 'Browse Waymarks', action = () => { if (_navigate) _navigate('explorer'); }) {
  return el('div', { className: 'wayboard-widget-empty' }, [
    el('span', { className: 'wayboard-widget-empty-icon', 'aria-hidden': 'true' }, ['🗂️']),
    el('span', {}, [message]),
    el('button', { className: 'btn-secondary btn-sm', type: 'button', on: { click: action } }, [actionLabel]),
  ]);
}

function makeWidgetRow(item, icon = '📄', detail = '') {
  return el('button', {
    className: 'wayboard-data-row',
    type: 'button',
    title: item.name || 'Untitled Waymark',
    on: { click: () => openWaymark(item) },
  }, [
    el('span', { className: 'wayboard-data-icon', 'aria-hidden': 'true' }, [icon]),
    el('span', { className: 'wayboard-data-copy' }, [
      el('span', { className: 'wayboard-data-name' }, [item.name || 'Untitled Waymark']),
      detail ? el('span', { className: 'wayboard-data-detail' }, [detail]) : null,
    ]),
    el('span', { className: 'wayboard-data-arrow', 'aria-hidden': 'true' }, ['↗']),
  ]);
}

function renderOverviewWidget() {
  const recent = userData.getRecentSheets().length;
  const pinnedSheets = userData.getPinnedSheets().length;
  const pinnedFolders = userData.getPinnedFolders().length;
  const ledgers = userData.getShareLedgers().length;
  const values = [
    ['Recent', recent, '🕒'],
    ['Pinned', pinnedSheets, '📌'],
    ['Folders', pinnedFolders, '📁'],
    ['Share ledgers', ledgers, '🔗'],
  ];
  return el('div', { className: 'wayboard-metrics' }, values.map(([label, value, icon]) =>
    el('div', { className: 'wayboard-metric' }, [
      el('span', { className: 'wayboard-metric-icon', 'aria-hidden': 'true' }, [icon]),
      el('span', { className: 'wayboard-metric-value' }, [String(value)]),
      el('span', { className: 'wayboard-metric-label' }, [label]),
    ])
  ));
}

function renderSheetListWidget(type) {
  let items = [];
  if (type === 'recent') items = userData.getRecentSheets().slice(0, 5);
  if (type === 'pinned') items = userData.getPinnedSheets().slice(0, 5);
  if (type === 'folders') {
    const folders = userData.getPinnedFolders().slice(0, 5);
    if (!folders.length) return emptyWidgetMessage('No folders pinned yet. Pin a folder from Browse to see it here.');
    return el('div', { className: 'wayboard-data-list' }, folders.map(folder =>
      el('button', {
        className: 'wayboard-data-row', type: 'button', title: folder.name || 'Untitled folder',
        on: { click: () => _navigate && _navigate('folder', folder.id, folder.name) },
      }, [
        el('span', { className: 'wayboard-data-icon', 'aria-hidden': 'true' }, ['📁']),
        el('span', { className: 'wayboard-data-copy' }, [
          el('span', { className: 'wayboard-data-name' }, [folder.name || 'Untitled folder']),
          folder.owner ? el('span', { className: 'wayboard-data-detail' }, [
            `${folder.owner.includes('@') ? folder.owner.split('@')[0] : folder.owner}${folder.shared ? ' · Shared' : ''}`,
          ]) : (folder.shared ? el('span', { className: 'wayboard-data-detail' }, ['Shared']) : null),
        ]),
        el('span', { className: 'wayboard-data-arrow', 'aria-hidden': 'true' }, ['↗']),
      ])
    ));
  }
  if (!items.length) {
    const noun = type === 'recent' ? 'recent Waymarks' : 'pinned Waymarks';
    return emptyWidgetMessage(`No ${noun} yet. Open or pin a Waymark to fill this widget.`);
  }
  return el('div', { className: 'wayboard-data-list' }, items.map(sheet => {
    const template = sheet.templateKey ? TEMPLATES[sheet.templateKey] : null;
    const timestamp = sheet.openedAt ? Date.parse(sheet.openedAt) : NaN;
    const ago = Number.isFinite(timestamp)
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp)
      : '';
    return makeWidgetRow(sheet, template?.icon || '📄', ago);
  }));
}

function sheetDataPromise(sheetId) {
  const existing = sheetPreviewCache.get(sheetId);
  if (existing) return existing;
  const entry = api.sheets.getSpreadsheet(sheetId);
  sheetPreviewCache.set(sheetId, entry);
  entry.then(
    () => { if (sheetPreviewCache.get(sheetId) === entry) sheetPreviewCache.delete(sheetId); },
    () => { if (sheetPreviewCache.get(sheetId) === entry) sheetPreviewCache.delete(sheetId); },
  );
  return entry;
}

function summarizeSheet(widget, data) {
  const valueText = value => value === null || value === undefined ? '' : String(value).trim();
  const tabs = Array.isArray(data?.tabs) ? data.tabs : [];
  const firstTab = tabs.find(tab => Array.isArray(tab.values) && tab.values.length) || null;
  const values = firstTab?.values || data?.values || [];
  const headers = Array.isArray(values[0]) ? values[0].map(valueText) : [];
  const rows = values.slice(1).filter(row => Array.isArray(row) && row.some(value => valueText(value) !== ''));
  const body = el('div', { className: 'wayboard-sheet-preview' });
  body.append(el('div', { className: 'wayboard-sheet-stats' }, [
    el('span', {}, [`${rows.length} row${rows.length === 1 ? '' : 's'}`]),
    el('span', {}, [`${headers.filter(Boolean).length} column${headers.filter(Boolean).length === 1 ? '' : 's'}`]),
    firstTab?.title ? el('span', {}, [firstTab.title]) : null,
  ]));

  const template = widget.templateKey ? TEMPLATES[widget.templateKey] : null;
  const columns = template?.columns ? template.columns(headers.map(h => h.toLowerCase())) : null;
  if (columns && Number.isInteger(columns.status) && columns.status >= 0) {
    const complete = value => /^(true|yes|done|x|1|✓|✔|complete)$/i.test(valueText(value));
    const done = rows.filter(row => complete(row[columns.status])).length;
    const progress = rows.length ? Math.round(done / rows.length * 100) : 0;
    body.append(el('div', { className: 'wayboard-progress' }, [
      el('div', { className: 'wayboard-progress-copy' }, [`${done} of ${rows.length} complete`, `${progress}%`]),
      el('div', { className: 'wayboard-progress-track', role: 'progressbar', 'aria-valuenow': String(progress), 'aria-valuemin': '0', 'aria-valuemax': '100' }, [
        el('span', { className: 'wayboard-progress-fill', style: { width: `${progress}%` } }),
      ]),
    ]));
  }

  const labelIndex = columns && Number.isInteger(columns.text) && columns.text >= 0
    ? columns.text
    : (headers.findIndex(Boolean) >= 0 ? headers.findIndex(Boolean) : 0);
  const visibleRows = rows.slice(0, 3);
  if (visibleRows.length) {
    body.append(el('div', { className: 'wayboard-sheet-rows' }, visibleRows.map(row => {
      const title = valueText(row[labelIndex]) || valueText(row.find(value => valueText(value) !== '')) || '—';
      const secondary = row.find((value, index) => index !== labelIndex && valueText(value) !== '');
      return el('div', { className: 'wayboard-sheet-row' }, [
        el('span', { className: 'wayboard-sheet-row-title' }, [title]),
        secondary !== undefined ? el('span', { className: 'wayboard-sheet-row-detail' }, [valueText(secondary)]) : null,
      ]);
    })));
  } else {
    body.append(el('p', { className: 'wayboard-widget-note' }, ['This Waymark is ready for its first row.']));
  }
  return body;
}

function renderCustomSheetWidget(widget, body) {
  const sheets = [...userData.getPinnedSheets(), ...userData.getRecentSheets()];
  const sheet = sheets.find(item => item.id === widget.sheetId) || {
    id: widget.sheetId,
    name: widget.sheetName || widget.title,
    templateKey: widget.templateKey || '',
  };
  body.replaceChildren(el('div', { className: 'wayboard-widget-loading' }, ['Loading your Waymark…']));
  const currentCard = body.closest('[data-widget-id]');
  sheetDataPromise(widget.sheetId).then(data => {
    if (!body.isConnected || !currentCard?.isConnected) return;
    const preview = summarizeSheet({ ...widget, templateKey: sheet.templateKey }, data);
    preview.append(el('button', {
      className: 'btn-secondary btn-sm wayboard-sheet-open', type: 'button',
      on: { click: () => openWaymark(sheet) },
    }, ['Open Waymark']));
    body.replaceChildren(preview);
  }).catch(() => {
    if (!body.isConnected || !currentCard?.isConnected) return;
    body.replaceChildren(el('div', { className: 'wayboard-widget-error' }, [
      el('span', {}, ['Could not load this Waymark right now.']),
      el('button', { className: 'btn-secondary btn-sm', type: 'button', on: { click: () => {
        sheetPreviewCache.delete(widget.sheetId);
        renderCustomSheetWidget(widget, body);
      } } }, ['Try again']),
    ]));
  });
}

function makeWidget(widget) {
  const type = WIDGET_TYPES[widget.type] || WIDGET_TYPES.overview;
  const body = el('div', { className: 'wayboard-widget-body' });
  const card = el('article', {
    className: `widget wayboard-widget wayboard-widget-${widget.type}${widget.size === 'wide' ? ' wayboard-widget-wide' : ''}`,
    dataset: { widgetId: widget.id },
  }, [
    el('header', { className: 'wayboard-widget-head' }, [
      el('span', { className: 'wayboard-widget-heading' }, [
        el('span', { className: 'wayboard-widget-icon', 'aria-hidden': 'true' }, [type.icon]),
        el('span', { className: 'wayboard-widget-title' }, [widget.title]),
      ]),
      el('button', {
        className: 'wayboard-widget-edit', type: 'button', title: 'Edit widget', 'aria-label': `Edit ${widget.title}`,
        on: { click: () => openWidgetManager(widget.id) },
      }, ['•••']),
    ]),
    body,
  ]);

  if (widget.type === 'overview') body.replaceChildren(renderOverviewWidget());
  else if (widget.type === 'recent' || widget.type === 'pinned' || widget.type === 'folders') body.replaceChildren(renderSheetListWidget(widget.type));
  else if (widget.type === 'sheet') renderCustomSheetWidget(widget, body);
  return card;
}

function renderWidgets() {
  const grid = document.getElementById('wayboard-grid');
  if (!grid) return;
  grid.replaceChildren();
  const widgets = getConfiguredWidgets();
  for (const widget of widgets) grid.append(makeWidget(widget));
  if (!widgets.length) {
    grid.append(el('div', { className: 'wayboard-empty-dashboard' }, [
      el('p', {}, ['Your dashboard is clear. Add widgets for recent Waymarks, pinned items, folders, or a sheet preview.']),
      el('button', { className: 'btn-secondary', type: 'button', on: { click: openWidgetManager } }, ['Add your first widget']),
    ]));
  }
}

function availableSheets() {
  const seen = new Set();
  return [...userData.getPinnedSheets(), ...userData.getRecentSheets()].filter(sheet => {
    if (!sheet?.id || seen.has(sheet.id)) return false;
    seen.add(sheet.id);
    return true;
  });
}

function widgetTitle(type, sheetId) {
  if (type === 'sheet') return availableSheets().find(sheet => sheet.id === sheetId)?.name || 'Waymark preview';
  return WIDGET_TYPES[type]?.label || 'My widget';
}

let widgetManager;

function ensureWidgetManager() {
  if (widgetManager) return widgetManager;

  const typeSelect = el('select', { className: 'wayboard-widget-control', name: 'type' }, Object.entries(WIDGET_TYPES).map(([value, option]) =>
    el('option', { value }, [`${option.icon} ${option.label}`])
  ));
  const titleInput = el('input', {
    className: 'wayboard-widget-control', name: 'title', type: 'text', maxlength: '48',
    placeholder: 'Name this widget', autocomplete: 'off',
  });
  const sheetSelect = el('select', { className: 'wayboard-widget-control', name: 'sheet' });
  const sheetLabel = el('label', { className: 'wayboard-widget-field wayboard-widget-sheet-field hidden' }, [
    el('span', {}, ['Waymark to preview']), sheetSelect,
  ]);
  const sizeSelect = el('select', { className: 'wayboard-widget-control', name: 'size' }, [
    el('option', { value: 'normal' }, ['Regular']),
    el('option', { value: 'wide' }, ['Wide']),
  ]);
  const submitButton = el('button', { className: 'btn btn-primary', type: 'submit' }, ['Add widget']);
  const form = el('form', { className: 'wayboard-widget-form' }, [
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Widget']), typeSelect]),
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Title']), titleInput]),
    sheetLabel,
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Size']), sizeSelect]),
    el('div', { className: 'wayboard-widget-form-actions' }, [submitButton]),
  ]);
  const list = el('div', { className: 'wayboard-widget-manager-list' });
  const closeButton = el('button', { className: 'btn-icon', type: 'button', 'aria-label': 'Close widget manager' }, ['✕']);
  const dialog = el('div', { className: 'modal wayboard-widget-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wayboard-widget-title' }, [
    el('div', { className: 'modal-header wayboard-widget-dialog-header' }, [
      el('div', {}, [
        el('h3', { id: 'wayboard-widget-title' }, ['Customize your Wayboard']),
        el('p', { className: 'wayboard-widget-manager-hint' }, ['Add personal, live widgets and arrange them for your workflow.']),
      ]),
      closeButton,
    ]),
    el('div', { className: 'modal-body wayboard-widget-dialog-body' }, [
      el('section', { className: 'wayboard-widget-add-section' }, [
        el('h4', {}, ['Add a widget']),
        form,
      ]),
      el('section', { className: 'wayboard-widget-current-section' }, [
        el('div', { className: 'wayboard-widget-current-heading' }, [
          el('h4', {}, ['Your widgets']),
          el('span', { className: 'wayboard-widget-count' }),
        ]),
        list,
      ]),
    ]),
  ]);
  const overlay = el('div', { className: 'modal-overlay hidden wayboard-widget-overlay' }, [dialog]);
  overlay.addEventListener('click', event => { if (event.target === overlay) closeWidgetManager(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') closeWidgetManager(); });
  closeButton.addEventListener('click', closeWidgetManager);

  const refreshSheetOptions = () => {
    sheetSelect.replaceChildren();
    const sheets = availableSheets();
    if (!sheets.length) {
      sheetSelect.append(el('option', { value: '' }, ['No recent or pinned Waymarks yet']));
    } else {
      for (const sheet of sheets) {
        const template = sheet.templateKey ? TEMPLATES[sheet.templateKey] : null;
        sheetSelect.append(el('option', { value: sheet.id }, [`${template?.icon || '📄'} ${sheet.name || 'Untitled Waymark'}`]));
      }
    }
    sheetSelect.disabled = !sheets.length;
    sheetLabel.classList.toggle('hidden', typeSelect.value !== 'sheet');
    submitButton.disabled = typeSelect.value === 'sheet' && !sheets.length;
  };

  typeSelect.addEventListener('change', refreshSheetOptions);
  sheetSelect.addEventListener('change', () => {
    if (!titleInput.value.trim() && typeSelect.value === 'sheet') titleInput.placeholder = widgetTitle('sheet', sheetSelect.value);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const type = typeSelect.value;
    const sheetId = type === 'sheet' ? sheetSelect.value : '';
    if (type === 'sheet' && !sheetId) {
      showToast('Open or pin a Waymark before adding a preview widget.', 'info');
      return;
    }
    const current = getConfiguredWidgets();
    const editingId = form.dataset.editingId || '';
    if (!editingId && current.length >= MAX_HOME_WIDGETS) {
      showToast(`You can have up to ${MAX_HOME_WIDGETS} home widgets.`, 'info');
      return;
    }
    const selectedSheet = type === 'sheet' ? availableSheets().find(sheet => sheet.id === sheetId) : null;
    const previous = editingId ? current.find(widget => widget.id === editingId) : null;
    const item = {
      id: editingId || `home-widget-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      title: (titleInput.value.trim() || widgetTitle(type, sheetId)).slice(0, 48),
      sheetId,
      sheetName: selectedSheet?.name || previous?.sheetName || '',
      templateKey: selectedSheet?.templateKey || previous?.templateKey || '',
      size: sizeSelect.value === 'wide' ? 'wide' : 'normal',
    };
    const next = editingId ? current.map(widget => widget.id === editingId ? item : widget) : [...current, item];
    await saveWidgets(next);
    form.dataset.editingId = '';
    form.reset();
    submitButton.textContent = 'Add widget';
    refreshSheetOptions();
    renderWidgets();
    renderWidgetManagerList();
    showToast(editingId ? 'Widget updated' : 'Widget added', 'success');
  });

  widgetManager = { overlay, dialog, form, typeSelect, titleInput, sheetSelect, sheetLabel, sizeSelect, submitButton, list, refreshSheetOptions };
  document.body.append(overlay);
  return widgetManager;
}

let widgetManagerReturnFocus = null;

function openWidgetManager(editingId = '') {
  const manager = ensureWidgetManager();
  widgetManagerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  manager.form.dataset.editingId = '';
  manager.form.reset();
  manager.submitButton.textContent = 'Add widget';
  manager.refreshSheetOptions();
  renderWidgetManagerList();
  manager.overlay.classList.remove('hidden');
  if (editingId) {
    const widget = getConfiguredWidgets().find(item => item.id === editingId);
    if (widget) {
      editWidget(widget);
      return;
    }
  }
  manager.dialog.querySelector('select[name="type"]')?.focus();
}

function closeWidgetManager() {
  if (!widgetManager || widgetManager.overlay.classList.contains('hidden')) return;
  widgetManager.overlay.classList.add('hidden');
  if (widgetManagerReturnFocus?.isConnected) widgetManagerReturnFocus.focus();
  widgetManagerReturnFocus = null;
}

function renderWidgetManagerList() {
  if (!widgetManager) return;
  const widgets = getConfiguredWidgets();
  widgetManager.list.replaceChildren();
  widgetManager.dialog.querySelector('.wayboard-widget-count').textContent = `${widgets.length}/${MAX_HOME_WIDGETS}`;
  if (!widgets.length) {
    widgetManager.list.append(el('p', { className: 'wayboard-widget-manager-empty' }, ['No widgets yet. Add one above to get started.']));
    return;
  }

  widgets.forEach((widget, index) => {
    const type = WIDGET_TYPES[widget.type];
    const row = el('div', { className: 'wayboard-widget-manager-item' }, [
      el('span', { className: 'wayboard-widget-manager-icon', 'aria-hidden': 'true' }, [type.icon]),
      el('span', { className: 'wayboard-widget-manager-copy' }, [
        el('b', {}, [widget.title]),
        el('small', {}, [widget.type === 'sheet'
          ? (availableSheets().find(sheet => sheet.id === widget.sheetId)?.name || widget.sheetName || 'Waymark preview')
          : type.label]),
      ]),
      el('div', { className: 'wayboard-widget-manager-actions' }, [
        el('button', { className: 'btn-secondary btn-sm', type: 'button', title: 'Edit widget', on: { click: () => editWidget(widget) } }, ['Edit']),
        el('button', { className: 'btn-secondary btn-sm', type: 'button', title: 'Move up', 'aria-label': 'Move widget up', on: { click: () => moveWidget(index, -1) } }, ['↑']),
        el('button', { className: 'btn-secondary btn-sm', type: 'button', title: 'Move down', 'aria-label': 'Move widget down', on: { click: () => moveWidget(index, 1) } }, ['↓']),
        el('button', { className: 'btn-danger btn-sm', type: 'button', title: 'Remove widget', on: { click: () => removeWidget(widget.id) } }, ['Remove']),
      ]),
    ]);
    row.querySelector('[title="Move up"]').disabled = index === 0;
    row.querySelector('[title="Move down"]').disabled = index === widgets.length - 1;
    widgetManager.list.append(row);
  });
}

function editWidget(widget) {
  const manager = ensureWidgetManager();
  manager.form.dataset.editingId = widget.id;
  manager.typeSelect.value = widget.type;
  manager.titleInput.value = widget.title;
  manager.sizeSelect.value = widget.size;
  manager.refreshSheetOptions();
  if (widget.sheetId && !Array.from(manager.sheetSelect.options).some(option => option.value === widget.sheetId)) {
    manager.sheetSelect.append(el('option', { value: widget.sheetId }, [`📄 ${widget.sheetName || widget.title}`]));
    manager.sheetSelect.disabled = false;
    manager.submitButton.disabled = false;
  }
  if (widget.sheetId) manager.sheetSelect.value = widget.sheetId;
  manager.submitButton.textContent = 'Save changes';
  manager.typeSelect.focus();
}

async function moveWidget(index, offset) {
  const widgets = getConfiguredWidgets();
  const target = index + offset;
  if (target < 0 || target >= widgets.length) return;
  [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
  await saveWidgets(widgets);
  renderWidgets();
  renderWidgetManagerList();
}

async function removeWidget(id) {
  await saveWidgets(getConfiguredWidgets().filter(widget => widget.id !== id));
  renderWidgets();
  renderWidgetManagerList();
}

/* ---------- The Wayside (social) ---------- */

let _activeTarget = null; // { group? , contactEmail? , label }

/**
 * Discover Wayfarer Crews (contact groups) and contacts from the user's
 * Contacts Waymarks (pinned/recent).
 * @returns {Promise<{ crews: Array<{name:string}>, people: Array<{name:string, email:string, group:string}> }>}
 */
async function discoverCrews() {
  const pool = [...userData.getPinnedSheets(), ...userData.getRecentSheets()];
  const seen = new Set();
  const books = pool.filter(s => s && s.templateKey === 'contacts' && !seen.has(s.id) && seen.add(s.id));
  const crews = new Map();
  const people = [];
  const emailSeen = new Set();
  for (const book of books) {
    try {
      const data = await api.sheets.getSpreadsheet(book.id);
      const tab = (data.tabs && data.tabs[0]) || null;
      const values = (tab && tab.values) || data.values || [];
      if (values.length < 2) continue;
      const lower = (values[0] || []).map(h => (h || '').toLowerCase().trim());
      const cols = TEMPLATES.contacts.columns(lower);
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const name = (cols.name >= 0 ? row[cols.name] : '') || '';
        const email = ((cols.email >= 0 ? row[cols.email] : '') || '').trim();
        const group = ((cols.group >= 0 ? row[cols.group] : '') || '').trim();
        if (group) crews.set(group, true);
        if (email && !emailSeen.has(email.toLowerCase())) {
          emailSeen.add(email.toLowerCase());
          people.push({ name: name.trim() || email, email, group });
        }
      }
    } catch { /* skip */ }
  }
  return { crews: [...crews.keys()].map(name => ({ name })), people };
}

async function renderWayside() {
  const host = document.getElementById('home-wayside');
  if (!host) return;
  host.innerHTML = '';

  host.append(el('div', { className: 'wayside-head' }, [
    el('b', {}, ['🧭 The Wayside']),
    el('span', { className: 'wayside-status', 'aria-live': 'polite' }, ['Loading contacts…']),
  ]));

  const { crews, people } = await discoverCrews();
  const waysideStatus = host.querySelector('.wayside-status');
  if (waysideStatus) waysideStatus.textContent = `${crews.length} crews · ${people.length} contacts`;

  // Wayfarer Crews
  const crewsBlock = el('div', { className: 'crews-block' }, [
    el('div', { className: 'wayside-label' }, ['WAYFARER CREWS (SHARE LEDGERS)']),
  ]);
  if (!crews.length) {
    crewsBlock.append(el('div', { className: 'wayside-empty' }, ['Add a Contacts Waymark with a Group column to form crews.']));
  }
  for (const crew of crews) {
    const ledger = userData.getShareLedgerFor(`group:${crew.name.toLowerCase()}`);
    const row = el('div', { className: 'crew-row', dataset: { group: crew.name } }, [
      el('span', {}, [`🏠 ${crew.name}`]),
      ledger
        ? el('a', { className: 'share-chip', href: `#/sheet/${ledger.sheetId}` }, ['🔗 Sheet ↗'])
        : el('span', { className: 'share-chip', title: 'Provisioned on first share' }, ['🔗 New']),
    ]);
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      selectTarget({ group: crew.name, label: crew.name }, host);
    });
    crewsBlock.append(row);
  }
  host.append(crewsBlock);

  // Online Wayfarers
  const onlineBlock = el('div', {}, [
    el('div', { className: 'wayside-label' }, ['ONLINE WAYFARERS']),
  ]);
  const avatarRow = el('div', { className: 'avatar-row' });
  for (const p of people.slice(0, 8)) {
    const initials = (p.name || p.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
    const av = el('div', { className: 'avatar', title: `${p.name} (${p.email})` }, [initials || '?']);
    av.addEventListener('click', () => selectTarget({ contactEmail: p.email, label: p.name }, host));
    avatarRow.append(av);
  }
  if (!people.length) avatarRow.append(el('div', { className: 'wayside-empty' }, ['No wayfarers yet.']));
  onlineBlock.append(avatarRow);
  host.append(onlineBlock);

  // Chat box
  const chatBox = el('div', { className: 'chat-box' }, [
    el('div', { className: 'chat-box-head' }, [
      el('b', { id: 'wayside-crew-title' }, ['💬 Wayside']),
      el('div', { className: 'chat-box-actions' }, [
        el('button', { className: 'btn', id: 'wayside-call-btn', title: 'Start a WebRTC call' }, ['📹 Call']),
        el('button', { className: 'btn btn-muted', id: 'wayside-sheet-btn', title: 'Open the social sheet' }, ['🔗 Sheet']),
      ]),
    ]),
    el('div', { className: 'chat-sheet-line', id: 'wayside-sheet-line' }, ['Pick a crew or wayfarer to chat']),
    el('div', { className: 'chat-log', id: 'wayside-chat-log' }),
    el('input', {
      type: 'text', className: 'chat-input', id: 'wayside-chat-input',
      placeholder: 'Send a wave…',
      on: { keydown: (e) => { if (e.key === 'Enter') sendWaysideChat(); } },
    }),
  ]);
  host.append(chatBox);

  const callBtn = chatBox.querySelector('#wayside-call-btn');
  callBtn.addEventListener('click', () => startCall());
  const sheetBtn = chatBox.querySelector('#wayside-sheet-btn');
  sheetBtn.addEventListener('click', () => openSocialSheet());

  // Auto-select the first crew / wayfarer.
  if (crews.length) selectTarget({ group: crews[0].name, label: crews[0].name }, host);
  else if (people.length) selectTarget({ contactEmail: people[0].email, label: people[0].name }, host);
}

async function selectTarget(target, host) {
  _activeTarget = target;
  const title = host.querySelector('#wayside-crew-title');
  if (title) title.textContent = `💬 ${target.label}`;
  host.querySelectorAll('.crew-row').forEach(r => r.classList.toggle('active', r.dataset.group === target.group));

  // Load existing chat/presence WITHOUT provisioning a ledger (viewing is read-only).
  // Presence is only published once a ledger already exists for this target
  // (i.e. after the first share), so merely opening Home never creates sheets.
  try {
    const key = target.group ? `group:${target.group.toLowerCase()}` : `contact:${(target.contactEmail || '').toLowerCase()}`;
    const ledger = userData.getShareLedgerFor(key);
    const sheetLine = host.querySelector('#wayside-sheet-line');
    if (sheetLine) sheetLine.textContent = ledger ? `Linked: ${ledger.sheetId}` : 'Linked on first share';
    if (ledger) {
      await collab.publishPresence(target, { status: 'online', activeWaymarkId: 'home' });
    }
    await refreshWaysideChat();
    await refreshPresenceRings(host);
  } catch { /* social is best-effort */ }
}

async function refreshWaysideChat() {
  const log = document.getElementById('wayside-chat-log');
  if (!log || !_activeTarget) return;
  try {
    const me = collab.currentEmail();
    const messages = await collab.readChat(_activeTarget);
    log.innerHTML = '';
    for (const m of messages.slice(-30)) {
      const who = (m.sender || '').toLowerCase() === me ? 'You' : (m.sender || '').split('@')[0];
      log.append(el('div', { className: (who === 'You' ? 'chat-self' : 'chat-peer') }, [
        el('b', {}, [`${who}: `]), m.text,
      ]));
    }
    log.scrollTop = log.scrollHeight;
  } catch { /* ignore */ }
}

async function refreshPresenceRings(host) {
  if (!_activeTarget) return;
  try {
    const presence = await collab.readPresence(_activeTarget);
    const byEmail = new Map(presence.map(p => [p.email, p.status]));
    host.querySelectorAll('.avatar').forEach(av => {
      const title = (av.getAttribute('title') || '').toLowerCase();
      const m = title.match(/\(([^)]+)\)/);
      const email = m ? m[1] : '';
      const status = byEmail.get(email);
      av.classList.remove('avatar-online', 'avatar-away', 'avatar-offline');
      if (status) av.classList.add(`avatar-${status}`);
    });
  } catch { /* ignore */ }
}

async function sendWaysideChat() {
  const input = document.getElementById('wayside-chat-input');
  if (!input || !input.value.trim() || !_activeTarget) return;
  const text = input.value.trim();
  input.value = '';
  try {
    await collab.sendChat(_activeTarget, text);
    await refreshWaysideChat();
  } catch (err) {
    showToast(`Could not send: ${err.message}`, 'error');
  }
}

async function startCall() {
  if (!_activeTarget) { showToast('Pick a crew or wayfarer first', 'info'); return; }
  try {
    const target = await collab.getSignalingTarget(_activeTarget);
    showToast(`📹 Call ready — signaling on ${target.tab} of the shared ledger`, 'success');
  } catch (err) {
    showToast(`Could not start call: ${err.message}`, 'error');
  }
}

async function openSocialSheet() {
  if (!_activeTarget) return;
  try {
    const { sheetId } = await collab.getSocialTarget(_activeTarget);
    window.location.hash = `#/sheet/${sheetId}`;
  } catch (err) {
    showToast(`Could not open sheet: ${err.message}`, 'error');
  }
}
