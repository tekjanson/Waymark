/* ============================================================
   wayboard.js — Unified Wayboard home: widgets, Wayside social,
   and the 50 selectable layout architectures (mode-1 … mode-50).
   ============================================================ */

import { el, showToast } from './ui.js';
import { api } from './api-client.js';
import * as userData from './user-data.js';
import * as collab from './collab.js';
import { discoverDirectory } from './contacts-picker.js';
import { detectTemplate, TEMPLATES } from './templates/index.js';
import { isEditLocked, setEditLocked } from './templates/shared.js';
import { SocialSession, appendLinkified } from './social-session.js';

export { appendLinkified };

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

const MAX_HOME_WIDGETS = 16;
const DEFAULT_HOME_WIDGETS = [
  { id: 'starter-quickmarks', type: 'quickmarks', title: 'Quick marks', actions: ['create', 'import', 'browse', 'examples'], size: 'normal' },
  { id: 'starter-overview', type: 'overview', title: 'Your Waymark overview', size: 'normal' },
  { id: 'starter-recent', type: 'recent', title: 'Recent Waymarks', size: 'normal' },
  { id: 'starter-pinned', type: 'pinned', title: 'Pinned Waymarks', size: 'normal' },
  { id: 'starter-folders', type: 'folders', title: 'Pinned waypoints', size: 'normal' },
];
const WIDGET_TYPES = {
  quickmarks: { label: 'Quick marks', icon: '⚡' },
  overview: { label: 'Waymark overview', icon: '📊' },
  recent: { label: 'Recent Waymarks', icon: '🕒' },
  pinned: { label: 'Pinned Waymarks', icon: '📌' },
  folders: { label: 'Waymark waypoints', icon: '📁' },
  sheet: { label: 'Any Waymark', icon: '📄' },
};
const QUICK_MARK_ACTIONS = [
  { id: 'create', label: 'Mark a fresh trail', shortLabel: 'New Waymark', icon: '📝', detail: 'Start a new Waymark' },
  { id: 'import', label: 'Bring marks along', shortLabel: 'Import Waymarks', icon: '📥', detail: 'Import a Waymark' },
  { id: 'browse', label: 'Find your Waymarks', shortLabel: 'Find Waymarks', icon: '📂', detail: 'Browse your Drive trail' },
  { id: 'examples', label: 'Follow a trail guide', shortLabel: 'Waymark guides', icon: '✨', detail: 'Explore example Waymarks' },
];
const QUICK_MARK_ACTION_IDS = QUICK_MARK_ACTIONS.map(action => action.id);
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
  const expanded = root.classList.contains('wayboard-expanded');
  root.className = `wayboard-root mode-${n}`;
  if (expanded) root.classList.add('wayboard-expanded');
}

/* ---------- Wayboard render ---------- */

let _navigate = null;
let _quickMarkActions = {};
let _callListenerWired = false;

/**
 * One-time wiring of Wayboard navigation callbacks.
 * @param {{ navigate: Function }} deps
 */
export function initWayboard(deps = {}) {
  _navigate = deps.navigate || null;
  _quickMarkActions = deps.quickMarkActions || {};

  if (!_callListenerWired && typeof window !== 'undefined') {
    _callListenerWired = true;
    window.addEventListener('waymark:start-wayside-call', async (e) => {
      const detail = e.detail || {};
      const contactEmail = String(detail.contactEmail || detail.from || '').trim().toLowerCase();
      const group = String(detail.group || '').trim();
      const label = String(detail.label || group || (contactEmail ? contactEmail.split('@')[0] : 'Collaborator')).trim();
      if (!contactEmail && !group) return;

      const homeView = document.getElementById('home-view');
      if (!homeView || homeView.classList.contains('hidden')) {
        window.location.hash = '#/';
        if (_navigate) _navigate('home');
        await new Promise((r) => setTimeout(r, 0));
      }
      await renderWayside({ autoSelect: false }).catch(() => {});
      const host = document.getElementById('home-wayside');
      if (host) {
        const target = group ? { group, label } : { contactEmail, label };
        await selectTarget(target, host);
        await startCall();
      }
    });
  }
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

  const expand = document.getElementById('wayboard-expand-toggle');
  if (expand && !expand._wired) {
    expand._wired = true;
    expand.addEventListener('click', () => {
      const root = document.getElementById('wayboard-root');
      if (!root) return;
      const expanded = root.classList.toggle('wayboard-expanded');
      expand.setAttribute('aria-pressed', String(expanded));
      expand.textContent = expanded ? '↙ Restore layout' : '⤢ Expand Wayboard';
      expand.title = expanded ? 'Restore the Wayside panel' : 'Give the Wayboard more room';
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
    el('span', { className: 'badge' }, [`📌 ${pinned} marks pinned`]),
    el('span', { className: 'badge blue' }, [`🕒 ${recent} fresh Waymark${recent === 1 ? '' : 's'}`]),
  );
}

/* ---------- Dashboard widgets ---------- */

function getConfiguredWidgets() {
  const saved = userData.getHomeWidgets();
  const source = Array.isArray(saved) ? [...saved] : DEFAULT_HOME_WIDGETS.filter(widget =>
    widget.type === 'overview'
      || widget.type === 'quickmarks'
      || (widget.type === 'recent' && userData.getRecentSheets().length > 0)
      || (widget.type === 'pinned' && userData.getPinnedSheets().length > 0)
      || (widget.type === 'folders' && userData.getPinnedFolders().length > 0)
  );
  if (Array.isArray(saved)
      && (userData.getHomeWidgetsVersion?.() || 0) < 2
      && !source.some(widget => widget?.type === 'quickmarks')) {
    source.unshift({ ...DEFAULT_HOME_WIDGETS[0] });
  }
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
        actions: w.type === 'quickmarks'
          ? (Array.isArray(w.actions) ? [...new Set(w.actions.filter(id => QUICK_MARK_ACTION_IDS.includes(id)))] : [...QUICK_MARK_ACTION_IDS])
          : [],
        size: ['compact', 'normal', 'wide', 'tall', 'full'].includes(w.size) ? w.size : 'normal',
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
    ['Fresh marks', recent, '🕒'],
    ['Pinned marks', pinnedSheets, '📌'],
    ['Waypoints', pinnedFolders, '📁'],
    ['Shared marks', ledgers, '🔗'],
  ];
  return el('div', { className: 'wayboard-metrics' }, values.map(([label, value, icon]) =>
    el('div', { className: 'wayboard-metric' }, [
      el('span', { className: 'wayboard-metric-icon', 'aria-hidden': 'true' }, [icon]),
      el('span', { className: 'wayboard-metric-value' }, [String(value)]),
      el('span', { className: 'wayboard-metric-label' }, [label]),
    ])
  ));
}

function renderPagedWidgetList(items, makeRow) {
  const pageSize = 5;
  let visibleCount = Math.min(pageSize, items.length);
  const list = el('div', { className: 'wayboard-data-list' }, items.slice(0, visibleCount).map(makeRow));
  const remainingCount = () => Math.min(pageSize, items.length - visibleCount);
  const showMore = el('button', {
    className: 'btn-secondary btn-sm wayboard-show-more',
    type: 'button',
    on: { click: () => {
      const previousCount = visibleCount;
      visibleCount = Math.min(visibleCount + pageSize, items.length);
      list.append(...items.slice(previousCount, visibleCount).map(makeRow));
      list.scrollTop = list.scrollHeight;
      showMore.hidden = visibleCount >= items.length;
      showMore.textContent = `Show ${remainingCount()} more`;
    } },
  }, [`Show ${remainingCount()} more`]);
  showMore.hidden = visibleCount >= items.length;
  return el('div', { className: 'wayboard-paged-list' }, [list, showMore]);
}

function renderFolderRow(folder) {
  return el('button', {
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
  ]);
}

function renderSheetListWidget(type) {
  if (type === 'folders') {
    const folders = userData.getPinnedFolders();
    if (!folders.length) return emptyWidgetMessage('No folder waypoints pinned yet. Pin one in Browse to mark the trail.');
    return renderPagedWidgetList(folders, renderFolderRow);
  }

  let items = [];
  if (type === 'recent') items = userData.getRecentSheets();
  if (type === 'pinned') items = userData.getPinnedSheets();
  if (!items.length) {
    const noun = type === 'recent' ? 'recent Waymarks' : 'pinned Waymarks';
    return emptyWidgetMessage(`No ${noun} yet. Open or pin a Waymark to leave a mark here.`);
  }
  return renderPagedWidgetList(items, sheet => {
    const template = sheet.templateKey ? TEMPLATES[sheet.templateKey] : null;
    const timestamp = sheet.openedAt ? Date.parse(sheet.openedAt) : NaN;
    const ago = Number.isFinite(timestamp)
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp)
      : '';
    return makeWidgetRow(sheet, template?.icon || '📄', ago);
  });
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

let previewLockCount = 0;
let previewLockPrevious = false;

function guardTemplatePreview(container) {
  container.setAttribute('aria-readonly', 'true');
  container.querySelectorAll('[contenteditable="true"]').forEach(node => node.setAttribute('contenteditable', 'false'));
  const lockForPreview = event => {
    if (event.type === 'beforeinput' && event.target instanceof Element && event.target.closest('[contenteditable]')) event.preventDefault();
    if (previewLockCount++ === 0) previewLockPrevious = isEditLocked();
    setEditLocked(true);
    window.setTimeout(() => {
      previewLockCount = Math.max(0, previewLockCount - 1);
      if (previewLockCount === 0) setEditLocked(previewLockPrevious);
    }, 0);
  };
  for (const eventName of ['beforeinput', 'change', 'click', 'input', 'keydown']) {
    container.addEventListener(eventName, lockForPreview, true);
  }
}

function renderCustomSheetWidget(widget, body, card) {
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
    const tabs = Array.isArray(data?.tabs) ? data.tabs : [];
    const firstTab = tabs.find(tab => Array.isArray(tab.values) && tab.values.length) || null;
    const values = firstTab?.values || data?.values || [];
    const headers = Array.isArray(values[0]) ? values[0] : [];
    const rows = values.slice(1);
    const { template } = detectTemplate(headers);
    const templateContainer = el('div', {
      className: 'dashboard-template-wrap wayboard-template-wrap',
      role: 'region',
      'aria-label': `${sheet.name || 'Waymark'} read-only template view`,
    });
    template.render(templateContainer, rows, template.columns(
      headers.map(header => (header || '').toLowerCase().trim())
    ), template);
    guardTemplatePreview(templateContainer);
    const action = el('button', {
      className: 'btn-secondary btn-sm wayboard-sheet-open', type: 'button',
      on: { click: () => openWaymark(sheet) },
    }, ['Open this Waymark']);
    body.replaceChildren(templateContainer, action);
    const templateIcon = card?.querySelector('.wayboard-widget-icon');
    if (templateIcon) templateIcon.textContent = template.icon || '📄';
  }).catch(() => {
    if (!body.isConnected || !currentCard?.isConnected) return;
    body.replaceChildren(el('div', { className: 'wayboard-widget-error' }, [
      el('span', {}, ['Could not load this Waymark right now.']),
      el('button', { className: 'btn-secondary btn-sm', type: 'button', on: { click: () => {
        sheetPreviewCache.delete(widget.sheetId);
        renderCustomSheetWidget(widget, body, card);
      } } }, ['Try again']),
    ]));
  });
}

function renderQuickmarksWidget(widget) {
  const actions = widget.actions
    .map(id => QUICK_MARK_ACTIONS.find(action => action.id === id))
    .filter(Boolean);
  if (!actions.length) {
    return emptyWidgetMessage('No quick marks on this leg yet. Edit this widget to choose a few.', 'Edit quick marks', () => openWidgetManager(widget.id));
  }
  return el('div', { className: 'markers-row home-quick-actions' }, actions.map(action => {
    const attrs = {
      className: 'marker-card home-action-card',
      type: 'button',
      title: action.detail,
      'aria-label': action.label,
      dataset: { quickmarkAction: action.id },
      on: { click: () => _quickMarkActions[action.id]?.() },
    };
    if (widget.id === 'starter-quickmarks') attrs.id = `home-action-${action.id}`;
    return el('button', attrs, [
      el('span', { className: 'marker-thumb home-action-icon', 'aria-hidden': 'true' }, [action.icon]),
      el('span', { className: 'marker-meta' }, [
        el('span', { className: 'home-action-label' }, [action.shortLabel]),
        el('span', { className: 'marker-social' }, [action.detail]),
      ]),
    ]);
  }));
}

function makeWidget(widget) {
  const type = WIDGET_TYPES[widget.type] || WIDGET_TYPES.overview;
  const body = el('div', { className: 'wayboard-widget-body' });
  const quickmarks = widget.type === 'quickmarks';
  const card = el('article', {
    className: `widget wayboard-widget wayboard-widget-${widget.type} wayboard-widget-size-${widget.size}${quickmarks ? ' markers-section' : ''}${['wide', 'full'].includes(widget.size) ? ` wayboard-widget-${widget.size}` : ''}${widget.size === 'tall' ? ' wayboard-widget-tall' : ''}`,
    dataset: { widgetId: widget.id },
  }, [
    el('header', { className: `wayboard-widget-head${quickmarks ? ' section-head' : ''}` }, [
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

  if (quickmarks) body.replaceChildren(renderQuickmarksWidget(widget));
  else if (widget.type === 'overview') body.replaceChildren(renderOverviewWidget());
  else if (widget.type === 'recent' || widget.type === 'pinned' || widget.type === 'folders') body.replaceChildren(renderSheetListWidget(widget.type));
  else if (widget.type === 'sheet') renderCustomSheetWidget(widget, body, card);
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
      el('p', {}, ['Your Wayboard is clear. Add Waymarks, waypoints, or a view of your choice to set the course.']),
      el('button', { className: 'btn-secondary', type: 'button', on: { click: openWidgetManager } }, ['Mark your Wayboard with a widget']),
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

function findWidgetSheet(sheetId) {
  return availableSheets().find(sheet => sheet.id === sheetId)
    || widgetManager?.driveSheets.get(sheetId)
    || null;
}

function widgetTitle(type, sheetId) {
  if (type === 'sheet') return findWidgetSheet(sheetId)?.name || 'Any Waymark';
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
    placeholder: 'Name this mark', autocomplete: 'off',
  });
  const sheetSelect = el('select', { className: 'wayboard-widget-control', name: 'sheet', id: 'wayboard-widget-source' });
  const browseDriveButton = el('button', {
    className: 'btn-secondary btn-sm wayboard-widget-drive-button', type: 'button',
    title: 'Browse Google Drive for a Waymark',
  }, ['Browse Drive']);
  const sheetLabel = el('div', { className: 'wayboard-widget-field wayboard-widget-sheet-field hidden' }, [
    el('label', { for: 'wayboard-widget-source' }, ['Waymark to bring along']),
    el('div', { className: 'wayboard-widget-sheet-picker' }, [sheetSelect, browseDriveButton]),
  ]);
  const sizeSelect = el('select', { className: 'wayboard-widget-control', name: 'size' }, [
    el('option', { value: 'normal' }, ['Roomy mark']),
    el('option', { value: 'compact' }, ['Compact mark']),
    el('option', { value: 'wide' }, ['Two lanes wide']),
    el('option', { value: 'tall' }, ['Two lanes tall']),
    el('option', { value: 'full' }, ['Full trail']),
  ]);
  const submitButton = el('button', { className: 'btn btn-primary', type: 'submit' }, ['Add Waymark widget']);
  const quickmarkOptions = el('div', {
    className: 'wayboard-widget-field wayboard-widget-quickmark-options hidden',
    role: 'group', 'aria-label': 'Choose and arrange quick marks',
  });
  const form = el('form', { className: 'wayboard-widget-form' }, [
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Waymark widget']), typeSelect]),
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Mark name']), titleInput]),
    sheetLabel,
    quickmarkOptions,
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Trail footprint']), sizeSelect]),
    el('div', { className: 'wayboard-widget-form-actions' }, [submitButton]),
  ]);
  const list = el('div', { className: 'wayboard-widget-manager-list' });
  const closeButton = el('button', { className: 'btn-icon', type: 'button', 'aria-label': 'Close widget manager' }, ['✕']);
  const dialog = el('div', { className: 'modal wayboard-widget-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wayboard-widget-title' }, [
    el('div', { className: 'modal-header wayboard-widget-dialog-header' }, [
      el('div', {}, [
        el('h3', { id: 'wayboard-widget-title' }, ['Mark up your Wayboard']),
        el('p', { className: 'wayboard-widget-manager-hint' }, ['Drop in the Waymarks you need and arrange your route.']),
      ]),
      closeButton,
    ]),
    el('div', { className: 'modal-body wayboard-widget-dialog-body' }, [
      el('section', { className: 'wayboard-widget-add-section' }, [
        el('h4', {}, ['Mark a widget']),
        form,
      ]),
      el('section', { className: 'wayboard-widget-current-section' }, [
        el('div', { className: 'wayboard-widget-current-heading' }, [
          el('h4', {}, ['Your Wayboard marks']),
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

  const selectedQuickmarks = () => Array.from(quickmarkOptions.children)
    .filter(row => row.querySelector('input[type="checkbox"]')?.checked)
    .map(row => row.dataset.actionId);
  const updateQuickmarkOrderButtons = () => {
    const rows = Array.from(quickmarkOptions.querySelectorAll('.wayboard-widget-quickmark-option'));
    rows.forEach((row, index) => {
      row.querySelector('[data-move="up"]').disabled = index === 0;
      row.querySelector('[data-move="down"]').disabled = index === rows.length - 1;
    });
  };
  const updateSubmitState = () => {
    submitButton.disabled = (typeSelect.value === 'sheet' && !sheetSelect.value)
      || (typeSelect.value === 'quickmarks' && !selectedQuickmarks().length);
  };
  const refreshQuickmarkOptions = (selected = QUICK_MARK_ACTION_IDS) => {
    const selectedSet = new Set(selected.filter(id => QUICK_MARK_ACTION_IDS.includes(id)));
    const ordered = [...selected, ...QUICK_MARK_ACTION_IDS]
      .filter((id, index, list) => QUICK_MARK_ACTION_IDS.includes(id) && list.indexOf(id) === index);
    quickmarkOptions.replaceChildren();
    quickmarkOptions.classList.toggle('hidden', typeSelect.value !== 'quickmarks');
    quickmarkOptions.append(el('span', { className: 'wayboard-widget-field-label' }, ['Quick marks to pack'])) ;
    for (const id of ordered) {
      const action = QUICK_MARK_ACTIONS.find(option => option.id === id);
      const checkbox = el('input', { type: 'checkbox', name: 'quickmarkAction', value: id });
      checkbox.checked = selectedSet.has(id);
      checkbox.defaultChecked = checkbox.checked;
      checkbox.addEventListener('change', updateSubmitState);
      const moveUp = el('button', {
        className: 'btn-secondary btn-sm', type: 'button', 'data-move': 'up',
        title: `Move ${action.shortLabel} earlier`, 'aria-label': `Move ${action.shortLabel} earlier`,
        on: { click: event => {
          const row = event.currentTarget.closest('.wayboard-widget-quickmark-option');
          if (row?.previousElementSibling) quickmarkOptions.insertBefore(row, row.previousElementSibling);
          updateQuickmarkOrderButtons();
        } },
      }, ['↑']);
      const moveDown = el('button', {
        className: 'btn-secondary btn-sm', type: 'button', 'data-move': 'down',
        title: `Move ${action.shortLabel} later`, 'aria-label': `Move ${action.shortLabel} later`,
        on: { click: event => {
          const row = event.currentTarget.closest('.wayboard-widget-quickmark-option');
          if (row?.nextElementSibling) quickmarkOptions.insertBefore(row.nextElementSibling, row);
          updateQuickmarkOrderButtons();
        } },
      }, ['↓']);
      quickmarkOptions.append(el('div', { className: 'wayboard-widget-quickmark-option', dataset: { actionId: id } }, [
        el('label', {}, [checkbox, el('span', { className: 'wayboard-widget-quickmark-icon' }, [action.icon]), action.shortLabel]),
        el('div', { className: 'wayboard-widget-quickmark-order' }, [moveUp, moveDown]),
      ]));
    }
    updateQuickmarkOrderButtons();
    updateSubmitState();
  };

  const refreshSheetOptions = () => {
    const selectedId = sheetSelect.value;
    sheetSelect.replaceChildren();
    const driveSheets = widgetManager ? [...widgetManager.driveSheets.values()] : [];
    const sheets = [...availableSheets(), ...driveSheets];
    const uniqueSheets = [...new Map(sheets.filter(sheet => sheet?.id).map(sheet => [sheet.id, sheet])).values()];
    sheetSelect.append(el('option', { value: '' }, ['Choose a Waymark…']));
    for (const sheet of uniqueSheets) {
      const template = sheet.templateKey ? TEMPLATES[sheet.templateKey] : null;
      sheetSelect.append(el('option', { value: sheet.id }, [`${template?.icon || '📄'} ${sheet.name || 'Untitled Waymark'}`]));
    }
    sheetSelect.disabled = false;
    if (selectedId && Array.from(sheetSelect.options).some(option => option.value === selectedId)) sheetSelect.value = selectedId;
    sheetLabel.classList.toggle('hidden', typeSelect.value !== 'sheet');
    quickmarkOptions.classList.toggle('hidden', typeSelect.value !== 'quickmarks');
    updateSubmitState();
  };

  typeSelect.addEventListener('change', () => {
    refreshSheetOptions();
    if (typeSelect.value === 'quickmarks' && !quickmarkOptions.children.length) refreshQuickmarkOptions();
  });
  sheetSelect.addEventListener('change', () => {
    updateSubmitState();
    if (!titleInput.value.trim() && typeSelect.value === 'sheet') titleInput.placeholder = widgetTitle('sheet', sheetSelect.value);
  });

  browseDriveButton.addEventListener('click', async () => {
    const previousLabel = browseDriveButton.textContent;
    browseDriveButton.disabled = true;
    browseDriveButton.textContent = 'Opening Drive…';
    try {
      const files = await api.picker.pickSpreadsheets({
        includeSharedDrives: true,
        title: 'Choose a Waymark for your Wayboard',
      });
      const file = files?.find(item => item?.id && item.mimeType === 'application/vnd.google-apps.spreadsheet');
      if (!file) {
        if (files?.length) showToast('Choose a Google spreadsheet to add as a Waymark widget.', 'info');
        return;
      }
      widgetManager.driveSheets.set(file.id, { id: file.id, name: file.name || 'Untitled Waymark', templateKey: '' });
      refreshSheetOptions();
      sheetSelect.value = file.id;
      updateSubmitState();
      if (!titleInput.value.trim()) titleInput.placeholder = file.name || 'Any Waymark';
      sheetSelect.focus();
      showToast(`${file.name || 'Waymark'} is ready to add to your Wayboard.`, 'success');
    } catch (error) {
      showToast(error.message || 'Could not open Google Drive.', 'error');
    } finally {
      browseDriveButton.disabled = false;
      browseDriveButton.textContent = previousLabel;
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const type = typeSelect.value;
    const sheetId = type === 'sheet' ? sheetSelect.value : '';
    const actions = type === 'quickmarks' ? selectedQuickmarks() : [];
    if (type === 'sheet' && !sheetId) {
      showToast('Choose a Waymark from Drive before adding it to your Wayboard.', 'info');
      return;
    }
    if (type === 'quickmarks' && !actions.length) {
      showToast('Choose at least one quick mark for this widget.', 'info');
      return;
    }
    const current = getConfiguredWidgets();
    const editingId = form.dataset.editingId || '';
    if (!editingId && current.length >= MAX_HOME_WIDGETS) {
      showToast(`Your Wayboard can hold up to ${MAX_HOME_WIDGETS} widgets.`, 'info');
      return;
    }
    const selectedSheet = type === 'sheet' ? findWidgetSheet(sheetId) : null;
    const previous = editingId ? current.find(widget => widget.id === editingId) : null;
    const item = {
      id: editingId || `home-widget-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      title: (titleInput.value.trim() || widgetTitle(type, sheetId)).slice(0, 48),
      sheetId,
      sheetName: selectedSheet?.name || previous?.sheetName || '',
      templateKey: selectedSheet?.templateKey || previous?.templateKey || '',
      actions,
      size: ['compact', 'normal', 'wide', 'tall', 'full'].includes(sizeSelect.value) ? sizeSelect.value : 'normal',
    };
    const next = editingId ? current.map(widget => widget.id === editingId ? item : widget) : [...current, item];
    await saveWidgets(next);
    form.dataset.editingId = '';
    form.reset();
    submitButton.textContent = 'Add Waymark widget';
    refreshQuickmarkOptions();
    refreshSheetOptions();
    renderWidgets();
    renderWidgetManagerList();
    showToast(editingId ? 'Wayboard mark updated' : 'Wayboard mark added', 'success');
  });

  widgetManager = { overlay, dialog, form, typeSelect, titleInput, sheetSelect, sheetLabel, sizeSelect, submitButton, list, refreshSheetOptions, refreshQuickmarkOptions, driveSheets: new Map() };
  document.body.append(overlay);
  return widgetManager;
}

let widgetManagerReturnFocus = null;

function openWidgetManager(editingId = '') {
  const manager = ensureWidgetManager();
  widgetManagerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  manager.form.dataset.editingId = '';
  manager.form.reset();
  manager.submitButton.textContent = 'Add Waymark widget';
  manager.refreshQuickmarkOptions(QUICK_MARK_ACTION_IDS);
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
    widgetManager.list.append(el('p', { className: 'wayboard-widget-manager-empty' }, ['Your Wayboard is clear. Add a mark above to set your course.']));
    return;
  }

  widgets.forEach((widget, index) => {
    const type = WIDGET_TYPES[widget.type];
    const row = el('div', { className: 'wayboard-widget-manager-item' }, [
      el('span', { className: 'wayboard-widget-manager-icon', 'aria-hidden': 'true' }, [type.icon]),
      el('span', { className: 'wayboard-widget-manager-copy' }, [
        el('b', {}, [widget.title]),
        el('small', {}, [widget.type === 'sheet'
          ? (findWidgetSheet(widget.sheetId)?.name || widget.sheetName || 'Any Waymark')
          : widget.type === 'quickmarks' ? `${widget.actions.length} quick marks` : type.label]),
      ]),
      el('div', { className: 'wayboard-widget-manager-actions' }, [
        el('button', { className: 'btn-secondary btn-sm', type: 'button', title: 'Edit Waymark widget', on: { click: () => editWidget(widget) } }, ['Edit mark']),
        el('button', { className: 'btn-secondary btn-sm', type: 'button', title: 'Move up', 'aria-label': 'Move widget up', on: { click: () => moveWidget(index, -1) } }, ['↑']),
        el('button', { className: 'btn-secondary btn-sm', type: 'button', title: 'Move down', 'aria-label': 'Move widget down', on: { click: () => moveWidget(index, 1) } }, ['↓']),
        el('button', { className: 'btn-danger btn-sm', type: 'button', title: 'Remove Waymark widget', on: { click: () => removeWidget(widget.id) } }, ['Remove mark']),
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
  manager.refreshQuickmarkOptions(widget.actions || QUICK_MARK_ACTION_IDS);
  manager.refreshSheetOptions();
  if (widget.sheetId && !Array.from(manager.sheetSelect.options).some(option => option.value === widget.sheetId)) {
    manager.sheetSelect.append(el('option', { value: widget.sheetId }, [`📄 ${widget.sheetName || widget.title}`]));
    manager.driveSheets.set(widget.sheetId, { id: widget.sheetId, name: widget.sheetName || widget.title, templateKey: widget.templateKey || '' });
    manager.sheetSelect.disabled = false;
    manager.submitButton.disabled = false;
  }
  if (widget.sheetId) manager.sheetSelect.value = widget.sheetId;
  manager.submitButton.textContent = 'Save Waymark widget';
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

export const WAYSIDE_URL_RE = /https?:\/\/[^\s<>"']+/gi;

let _activeTarget = null; // { group? , contactEmail? , label }
let _activeLedgerId = null;
let _waysideSession = null;
let _waysideSessionLedgerId = null;
let _waysideTargetGeneration = 0;
let _waysidePollingWired = false;
let _waysideSocialRefreshKey = null;
let _liveMessages = [];
let _sheetMessages = [];

function ensureWaysidePolling() {
  if (_waysidePollingWired) return;
  _waysidePollingWired = true;
  document.addEventListener('waymark:collab-sync', () => {
    const homeView = document.getElementById('home-view');
    const host = document.getElementById('home-wayside');
    if (!document.hidden && _activeTarget && homeView && !homeView.classList.contains('hidden') && host) {
      refreshWaysideSocial(host).catch(() => {});
    }
  });
}

/**
 * Discover Waymarker Crews (contact groups) and contacts from the user's
 * Contacts Waymarks (pinned/recent).
 * @returns {Promise<{ crews: Array<{name:string}>, people: Array<{name:string, email:string, group:string}> }>}
 */
async function discoverCrews() {
  const crews = new Map();
  const people = [];
  const emailSeen = new Set();

  try {
    const dir = await discoverDirectory();
    for (const c of dir.crews || []) {
      if (c?.name) crews.set(c.name, true);
    }
    for (const p of dir.contacts || []) {
      const eLower = (p?.email || '').trim().toLowerCase();
      if (p?.group && !crews.has(p.group)) crews.set(p.group, true);
      if (eLower && !emailSeen.has(eLower)) {
        emailSeen.add(eLower);
        people.push({ name: p.name || p.email, email: p.email, group: p.group || '' });
      }
    }
  } catch { /* skip */ }

  // Merge past collaborators and crews from Share Ledgers so users can call/chat
  // anyone they have shared with in the past, even without a Contacts Waymark.
  try {
    const known = collab.getKnownCollaborators();
    for (const c of known.crews || []) {
      if (c?.name && !crews.has(c.name)) crews.set(c.name, true);
    }
    for (const p of known.contacts || []) {
      const eLower = (p?.email || '').trim().toLowerCase();
      if (eLower && !emailSeen.has(eLower)) {
        emailSeen.add(eLower);
        people.push({ name: p.name || p.email, email: p.email, group: p.group || '' });
      }
    }
  } catch { /* ignore */ }

  return { crews: [...crews.keys()].map(name => ({ name })), people };
}

async function renderWayside({ autoSelect = true } = {}) {
  const host = document.getElementById('home-wayside');
  if (!host) return;
  host.innerHTML = '';

  host.append(el('div', { className: 'wayside-head' }, [
    el('b', {}, ['🧭 The Wayside']),
    el('span', { className: 'wayside-status', 'aria-live': 'polite' }, ['Finding Waymarkers…']),
  ]));

  const { crews, people } = await discoverCrews();
  const waysideStatus = host.querySelector('.wayside-status');
  if (waysideStatus) waysideStatus.textContent = `${crews.length} crews · ${people.length} Waymarkers`;

  // Waymarker Crews
  const crewsBlock = el('div', { className: 'crews-block' }, [
    el('div', { className: 'wayside-label' }, ['WAYMARKER CREWS (SHARED WAYMARKS)']),
  ]);
  if (!crews.length) {
    crewsBlock.append(el('div', { className: 'wayside-empty' }, ['Add a Contacts Waymark with a Group column to form crews.']));
  }
  for (const crew of crews) {
    const ledger = await collab.findExistingShareLedger({ group: crew.name });
    const row = el('div', { className: 'crew-row', dataset: { group: crew.name } }, [
      el('span', {}, [`🏠 ${crew.name}`]),
      ledger
        ? el('a', { className: 'share-chip', href: `#/sheet/${ledger.sheetId}` }, ['🔗 Waymark ↗'])
        : el('span', { className: 'share-chip', title: 'Provisioned on first share' }, ['🔗 New']),
    ]);
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      selectTarget({ group: crew.name, label: crew.name }, host);
    });
    crewsBlock.append(row);
  }
  host.append(crewsBlock);

  // Online Waymarkers
  const onlineBlock = el('div', {}, [
    el('div', { className: 'wayside-label' }, ['ONLINE WAYMARKERS']),
  ]);
  const avatarRow = el('div', { className: 'avatar-row' });
  for (const p of people.slice(0, 8)) {
    const initials = (p.name || p.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
    const av = el('div', { className: 'avatar', title: `${p.name} (${p.email})` }, [initials || '?']);
    av.addEventListener('click', () => selectTarget({ contactEmail: p.email, label: p.name }, host));
    avatarRow.append(av);
  }
  if (!people.length) avatarRow.append(el('div', { className: 'wayside-empty' }, ['No Waymarkers on this trail yet.']));
  onlineBlock.append(avatarRow);
  host.append(onlineBlock);

  // Shared Files between users
  const filesBlock = el('div', { className: 'wayside-files', id: 'wayside-files' });
  host.append(filesBlock);

  // Chat box
  const chatBox = el('div', { className: 'chat-box' }, [
    el('div', { className: 'chat-box-head' }, [
      el('b', { id: 'wayside-crew-title' }, ['💬 Wayside']),
      el('div', { className: 'chat-box-actions' }, [
        el('button', { className: 'btn', id: 'wayside-call-btn', title: 'Start a WebRTC call' }, ['📹 Call']),
        el('button', { className: 'btn btn-muted', id: 'wayside-sheet-btn', title: 'Open the shared Waymark' }, ['🔗 Waymark']),
        el('button', { className: 'btn btn-muted', id: 'wayside-connect-btn', title: 'Connect a shared ledger from Drive' }, ['📥 Connect']),
      ]),
    ]),
    el('div', { className: 'chat-sheet-line', id: 'wayside-sheet-line' }, ['Pick a crew or Waymarker to trade Waymarks']),
    el('div', { className: 'chat-log', id: 'wayside-chat-log' }),
    el('audio', { id: 'wayside-remote-audio', autoplay: true, playsInline: true }),
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
  const connectBtn = chatBox.querySelector('#wayside-connect-btn');
  connectBtn.addEventListener('click', () => connectSharedLedgerFromWayside(host));

  ensureWaysidePolling();

  if (autoSelect) {
    // Auto-select the first crew / Waymarker.
    if (crews.length) selectTarget({ group: crews[0].name, label: crews[0].name }, host);
    else if (people.length) selectTarget({ contactEmail: people[0].email, label: people[0].name }, host);
  }
}

async function selectTarget(target, host) {
  const generation = ++_waysideTargetGeneration;
  const targetChanged = !_activeTarget
    || _activeTarget.group !== target.group
    || _activeTarget.contactEmail !== target.contactEmail;

  if (targetChanged && _waysideSession) {
    _waysideSession.destroy();
    _waysideSession = null;
    _waysideSessionLedgerId = null;
    updateWaysideCallUI('idle');
  }
  _activeTarget = target;
  if (targetChanged) {
    _activeLedgerId = null;
    _liveMessages = [];
    _sheetMessages = [];
    renderChatLines([]);
    renderSharedFiles([]);
  }

  const title = host.querySelector('#wayside-crew-title');
  if (title) title.textContent = `💬 ${target.label}`;
  host.querySelectorAll('.crew-row').forEach(r => r.classList.toggle('active', r.dataset.group === target.group));

  try {
    const ledger = await collab.findExistingShareLedger(target);
    if (generation !== _waysideTargetGeneration) return;
    if (!targetChanged && (ledger?.sheetId || null) !== _activeLedgerId) {
      _liveMessages = [];
      _sheetMessages = [];
      renderChatLines([]);
      renderSharedFiles([]);
    }
    _activeLedgerId = ledger ? ledger.sheetId : null;
    const sheetLine = host.querySelector('#wayside-sheet-line');
    if (sheetLine) sheetLine.textContent = ledger ? `Linked: ${ledger.sheetId}` : 'Linked on first share';
    if (ledger) {
      startWaysideSession(ledger.sheetId);
      await collab.publishPresence(target, { status: 'online', activeWaymarkId: 'home' }).catch(() => {});
      if (generation !== _waysideTargetGeneration) return;
    }
    await refreshWaysideSocial(host);
  } catch { /* social is best-effort */ }
}

function renderChatLines(messages) {
  const log = document.getElementById('wayside-chat-log');
  if (!log) return;
  const me = collab.currentEmail();
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
  const existing = new Map([...log.children].map(node => [node.dataset.messageKey, node]));
  const visible = messages.slice(-50);
  const nextNodes = [];
  for (const [index, m] of visible.entries()) {
    const key = String(m.id || m.messageId || `${m.sender || ''}:${m.ts || index}:${m.text || ''}`);
    let line = existing.get(key);
    if (line) {
      existing.delete(key);
      if (m.failed) line.classList.add('chat-failed');
      else line.classList.remove('chat-failed');
      nextNodes.push(line);
      continue;
    }
    const isSelf = m.self || (m.sender || '').toLowerCase() === me;
    const who = isSelf ? 'You' : (m.sender || '').split('@')[0];
    line = el('div', { className: isSelf ? 'chat-self' : 'chat-peer', dataset: { messageKey: key } }, [
      el('b', {}, [`${who}: `]),
    ]);
    if (m.failed) line.classList.add('chat-failed');
    appendLinkified(line, m.text);
    nextNodes.push(line);
  }
  for (const stale of existing.values()) stale.remove();
  for (const [index, node] of nextNodes.entries()) {
    if (log.children[index] !== node) log.insertBefore(node, log.children[index] || null);
  }
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function renderSharedFiles(files) {
  const container = document.getElementById('wayside-files');
  if (!container) return;
  const byDoc = new Map();
  for (const f of files || []) {
    const id = (f.docId || f.Document_ID || '').trim();
    if (id && !byDoc.has(id)) byDoc.set(id, f);
  }
  const list = [...byDoc.values()];
  const signature = JSON.stringify(list.map(f => [f.docId || f.Document_ID, f.title || f.Document_Title, f.type || f.Waymark_Type, f.permission || f.Permission_Level]));
  if (container.dataset.signature === signature) return;
  container.dataset.signature = signature;
  container.replaceChildren();

  const heading = el('div', { className: 'wayside-files-head' }, [
    el('div', { className: 'wayside-label' }, [`SHARED FILES (${list.length})`]),
    el('button', { className: 'btn btn-muted wayside-share-file', type: 'button' }, ['＋ Share a Waymark']),
  ]);
  heading.querySelector('button').addEventListener('click', () => shareWaymarkWithTarget());
  container.append(heading);

  if (!list.length) {
    container.append(el('div', { className: 'wayside-empty' }, ['No shared files yet. Choose a Waymark to share with this collaborator.']));
    return;
  }
  const listEl = el('div', { className: 'wayside-files-list' });
  for (const f of list) {
    const docId = (f.docId || f.Document_ID || '').trim();
    const title = f.title || f.Document_Title || docId;
    const type = f.type || f.Waymark_Type || 'Waymark';
    const permission = f.permission || f.Permission_Level || '';
    listEl.append(el('a', {
      className: 'wayside-file',
      href: `#/sheet/${docId}`,
      title: `${title} (${type}${permission ? ` · ${permission}` : ''})`,
    }, [
      el('span', {}, [`📄 ${title}`]),
      el('small', {}, [`${type}${permission ? ` · ${permission}` : ''}`]),
    ]));
  }
  container.append(listEl);
}

async function refreshWaysideSocial(host) {
  if (!_activeTarget) return;
  const generation = _waysideTargetGeneration;
  const ledgerId = _activeLedgerId;
  const refreshKey = `${generation}:${ledgerId || 'unlinked'}`;
  if (_waysideSocialRefreshKey === refreshKey) return;
  _waysideSocialRefreshKey = refreshKey;
  try {
    if (ledgerId) {
      const snap = await collab.readSocialSnapshot(ledgerId);
      if (generation !== _waysideTargetGeneration || ledgerId !== _activeLedgerId) return;
      _sheetMessages = (snap.chat || []).map(m => ({
        id: m.id,
        sender: m.sender,
        text: m.text,
        ts: m.ts,
      }));
      const confirmedIds = new Set(_sheetMessages.map(m => m.id).filter(Boolean));
      _liveMessages = _liveMessages.filter(m => !m.id || !confirmedIds.has(m.id));
      renderActiveChat();
      renderSharedFiles(snap.files || []);
      applyPresenceRings(host, snap.presence || []);
    } else {
      _sheetMessages = [];
      renderActiveChat();
      renderSharedFiles([]);
      applyPresenceRings(host, []);
    }
  } catch { /* ignore */ }
  finally {
    if (_waysideSocialRefreshKey === refreshKey) _waysideSocialRefreshKey = null;
  }
}

function renderActiveChat() {
  const timestamp = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : (Date.parse(value || '') || 0);
  };
  const seen = new Set();
  const all = [..._sheetMessages, ..._liveMessages].filter(m => {
    const k = m.id || `${m.sender}:${m.ts}:${m.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  renderChatLines(all.sort((a, b) => timestamp(a.ts) - timestamp(b.ts)));
}

function applyPresenceRings(host, presence) {
  const byEmail = new Map(presence.map(p => [p.email, p.status]));
  host.querySelectorAll('.avatar').forEach(av => {
    const title = (av.getAttribute('title') || '').toLowerCase();
    const m = title.match(/\(([^)]+)\)/);
    const email = m ? m[1] : '';
    const status = byEmail.get(email);
    av.classList.remove('avatar-online', 'avatar-away', 'avatar-offline');
    if (status) av.classList.add(`avatar-${status}`);
  });
}

function startWaysideSession(sheetId, signal = collab.createLedgerSignal(sheetId)) {
  if (!sheetId || (_waysideSession && _waysideSessionLedgerId === sheetId)) {
    return _waysideSession;
  }
  if (_waysideSession) {
    const prev = _waysideSession;
    _waysideSession = null;
    _waysideSessionLedgerId = null;
    prev.destroy();
  }

  const user = api.auth.getUser?.() || {};
  const displayName = user.name || (user.email ? user.email.split('@')[0] : 'Waymarker');
  const target = { ..._activeTarget };

  const session = new SocialSession({
    sheetId,
    displayName,
    signal,
    persistChat: async (msg) => {
      const result = await collab.sendChat(target, msg.text, '', msg.id);
      _activeLedgerId = result?.sheetId || _activeLedgerId;
      const sheetLine = document.getElementById('wayside-sheet-line');
      if (sheetLine && _activeLedgerId) sheetLine.textContent = `Linked: ${_activeLedgerId}`;
      return result;
    },
    onMessage: (msg) => {
      _liveMessages.push(msg);
      _liveMessages = _liveMessages.slice(-50);
      renderActiveChat();
    },
    onPeersChanged: (peers) => {
      if (_waysideSession !== session) return;
      const count = peers?.size ?? (Array.isArray(peers) ? peers.length : 0);
      const sheetLine = document.getElementById('wayside-sheet-line');
      if (sheetLine && !session.inCall) {
        sheetLine.textContent = `P2P · ${count} connected · Linked: ${sheetId}`;
      }
    },
    onCallStateChanged: (state, details) => {
      if (_waysideSession !== session) return;
      updateWaysideCallUI(state, details);
    },
    onRemoteStream: () => {},
  });

  const remoteAudio = document.getElementById('wayside-remote-audio');
  if (remoteAudio) session.bindRemoteAudio(remoteAudio);

  _waysideSession = session;
  _waysideSessionLedgerId = sheetId;
  session.start();
  return session;
}

function updateWaysideCallUI(state, details = {}) {
  const callBtn = document.getElementById('wayside-call-btn');
  const sheetLine = document.getElementById('wayside-sheet-line');

  if (state === 'calling') {
    if (callBtn) {
      callBtn.textContent = '⏳ Starting…';
      callBtn.classList.add('call-active');
      callBtn.title = 'Cancel the call setup';
    }
  } else if (state === 'in-call') {
    if (callBtn) {
      callBtn.textContent = '📴 End Call';
      callBtn.classList.add('call-active');
      callBtn.title = 'End the active WebRTC call';
    }
    if (sheetLine) {
      sheetLine.textContent = `📹 In call · Linked: ${_activeLedgerId}`;
    }
  } else if (state === 'ringing') {
    if (callBtn) {
      callBtn.textContent = '📲 Join Call';
      callBtn.classList.add('call-active');
      callBtn.title = `Join ${details.name || 'the incoming'} call`;
    }
    if (sheetLine) {
      sheetLine.textContent = `Incoming call from ${details.name || 'a Waymarker'} · Linked: ${_activeLedgerId}`;
    }
  } else {
    // idle
    if (callBtn) {
      callBtn.textContent = '📹 Call';
      callBtn.classList.remove('call-active');
      callBtn.title = 'Start a WebRTC call';
    }
    if (sheetLine) {
      sheetLine.textContent = _activeLedgerId ? `Linked: ${_activeLedgerId}` : 'Linked on first share';
    }
  }
}

export async function sendWaysideChat() {
  const input = document.getElementById('wayside-chat-input');
  if (!input || !input.value.trim() || !_activeTarget) return;
  const text = input.value.trim();
  input.value = '';

  const messageId = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const optMsg = {
    id: messageId,
    sender: collab.currentEmail(),
    text,
    ts: new Date().toISOString(),
    self: true,
  };

  // 1. Instantly display in UI
  _liveMessages.push(optMsg);
  renderActiveChat();

  // 2. Send via session if active
  if (_waysideSession?.connect) {
    try { _waysideSession.connect.send(text, 'message', { messageId }); } catch {}
  }

  // 3. Persist asynchronously
  try {
    const result = await collab.sendChat(_activeTarget, text, '', messageId);
    _activeLedgerId = result?.sheetId || _activeLedgerId;
    const sheetLine = document.getElementById('wayside-sheet-line');
    if (sheetLine && _activeLedgerId) sheetLine.textContent = `Linked: ${_activeLedgerId}`;
    if (_activeLedgerId && (!_waysideSession || _waysideSessionLedgerId !== _activeLedgerId)) {
      startWaysideSession(_activeLedgerId);
    }
  } catch (err) {
    optMsg.failed = true;
    renderActiveChat();
    showToast(`Could not send: ${err.message}`, 'error');
  }
}

export async function endWaysideCall(opts = {}) {
  if (_waysideSession) {
    await _waysideSession.endCall(opts);
  }
}

export async function startCall() {
  if (!_activeTarget) { showToast('Pick a crew or Waymarker first', 'info'); return; }
  const generation = _waysideTargetGeneration;
  const activeTarget = { ..._activeTarget };

  let session = _waysideSession;
  if (!session) {
    try {
      const target = await collab.getSignalingTarget(activeTarget);
      if (generation !== _waysideTargetGeneration) return;
      _activeLedgerId = target.sheetId;
      session = startWaysideSession(target.sheetId, target.signal);
      const sheetLine = document.getElementById('wayside-sheet-line');
      if (sheetLine) sheetLine.textContent = `Linked: ${target.sheetId}`;
    } catch (err) {
      showToast(`Could not start call: ${err.message}`, 'error');
      return;
    }
  }

  if (session.inCall || session.callState === 'calling') {
    await session.endCall();
    return;
  }
  if (session.callState === 'ringing') {
    await session.acceptCall(false);
    return;
  }

  try {
    await session.startCall({ audio: true, video: false });
    showToast('📹 Call ready', 'success');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    showToast(`Could not start call: ${err.message}`, 'error');
  }
}

async function shareWaymarkWithTarget() {
  if (!_activeTarget) return;
  const target = { ..._activeTarget };
  const generation = _waysideTargetGeneration;
  try {
    const files = await api.picker.pickSpreadsheets({ includeSharedDrives: true });
    if (generation !== _waysideTargetGeneration) return;
    const picked = Array.isArray(files) ? files[0] : files;
    if (!picked?.id) return;
    if (picked.mimeType && picked.mimeType !== 'application/vnd.google-apps.spreadsheet') {
      showToast('Choose a spreadsheet to share', 'info');
      return;
    }
    const summary = await api.sheets.getSpreadsheetSummary(picked.id);
    if (generation !== _waysideTargetGeneration) return;
    const { key: waymarkType } = detectTemplate(summary.values?.[0] || []);
    await collab.shareDocumentWithContact({
      ...target,
      docId: picked.id,
      docTitle: picked.name || summary.title || 'Shared Waymark',
      waymarkType,
      permission: 'reader',
    });
    if (generation !== _waysideTargetGeneration) return;
    showToast(`Shared ${picked.name || summary.title || 'Waymark'}`, 'success');
    const host = document.getElementById('home-wayside');
    const ledger = await collab.findExistingShareLedger(target);
    _activeLedgerId = ledger?.sheetId || _activeLedgerId;
    if (_activeLedgerId) startWaysideMesh(_activeLedgerId);
    if (host) await refreshWaysideSocial(host);
  } catch (err) {
    showToast(`Could not share Waymark: ${err.message}`, 'error');
  }
}

async function connectSharedLedgerFromWayside(host) {
  try {
    const connected = await collab.connectSharedLedgerViaPicker(_activeTarget || {});
    if (!connected.length) return;
    showToast(`Connected ${connected.length} shared ledger${connected.length === 1 ? '' : 's'}`, 'success');
    if (_activeTarget && host) {
      await selectTarget(_activeTarget, host);
    }
  } catch (err) {
    showToast(`Could not connect ledger: ${err.message}`, 'error');
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
