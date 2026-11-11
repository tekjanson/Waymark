/* ============================================================
   wayboard.js — Unified Wayboard home: widgets, Wayside social,
   and the 12 curated layout architectures (mode-1 … mode-12).
   ============================================================ */

import { el, showToast } from './ui.js';
import { api } from './api-client.js';
import * as userData from './user-data.js';
import * as collab from './collab.js';
import { discoverDirectory } from './contacts-picker.js';
import { detectTemplate, TEMPLATES } from './templates/index.js';
import { isEditLocked, setEditLocked } from './templates/shared.js';
import { URL_REGEX, appendLinkified } from './social-session.js';
import { SocialChatWidget } from './social-widget.js';
import {
  deriveAgentThreadTitle,
  buildAgentThreadList,
  formatWaysideSubtitle,
  openShareAgentModal,
} from './wayside-agent.js';

export { appendLinkified };
const WAYSIDE_URL_RE = URL_REGEX;

/* ---------- 12 curated Wayboard layouts (for the Profile selector) ----------
   Each is a distinct information architecture, not a colour swap, and is
   mobile-aware. Styling lives in css/home-modes.css (.mode-1 … .mode-12). */
const MODE_NAMES = {
  1: 'Command Center', 2: 'Bento Grid', 3: 'Focus', 4: 'Social Hub',
  5: 'Split Rail', 6: 'Stream', 7: 'Pinboard', 8: 'HUD',
  9: 'Gallery', 10: 'Canvas', 11: 'Editorial', 12: 'Matrix',
};

/** How many curated layouts exist. */
const LAYOUT_COUNT = 12;

/** Grouping used by the Profile selector. */
const MODE_GROUPS = [
  { label: 'Focused', range: [1, 4] },
  { label: 'Structured', range: [5, 8] },
  { label: 'Expressive', range: [9, 12] },
];

/* Legacy compatibility: the Wayboard used to ship 50 thin layout variants.
   Saved profiles may still reference modes 13–50, so map each retired mode to
   the closest surviving curated layout. Modes 1–12 pass through unchanged. */
const LEGACY_LAYOUT_MAP = {
  13: 6, 14: 10, 15: 10, 16: 7, 17: 11, 18: 6, 19: 10, 20: 12,
  21: 5, 22: 9, 23: 12, 24: 11, 25: 10, 26: 12, 27: 10, 28: 7,
  29: 4, 30: 10, 31: 10, 32: 11, 33: 4, 34: 5, 35: 9, 36: 8,
  37: 10, 38: 2, 39: 5, 40: 3, 41: 6, 42: 7, 43: 12, 44: 7,
  45: 6, 46: 10, 47: 5, 48: 7, 49: 12, 50: 3,
};

/**
 * Resolve any stored home-template mode (1–50, legacy or current) to one of the
 * 12 curated layouts.
 * @param {number|string} mode — stored mode value
 * @returns {number} layout index 1–LAYOUT_COUNT
 */
function resolveLayout(mode) {
  const n = parseInt(mode, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n <= LAYOUT_COUNT) return n;
  return LEGACY_LAYOUT_MAP[n] || 1;
}

const MAX_HOME_WIDGETS = 16;
const DEFAULT_HOME_WIDGETS = [
  { id: 'starter-quickmarks', type: 'quickmarks', title: 'Quick actions', actions: ['create', 'import', 'browse', 'examples'], size: 'normal' },
  { id: 'starter-overview', type: 'overview', title: 'Overview', size: 'normal' },
  { id: 'starter-recent', type: 'recent', title: 'Recent Waymarks', size: 'normal' },
  { id: 'starter-pinned', type: 'pinned', title: 'Pinned Waymarks', size: 'normal' },
  { id: 'starter-folders', type: 'folders', title: 'Pinned waypoints', size: 'normal' },
];
const WIDGET_TYPES = {
  sheet: { label: 'Any Waymark', icon: '📄' },
  quickmarks: { label: 'Quick actions', icon: '⚡' },
  overview: { label: 'Overview', icon: '📊' },
  recent: { label: 'Recent Waymarks', icon: '🕒' },
  pinned: { label: 'Pinned Waymarks', icon: '📌' },
  folders: { label: 'Pinned waypoints', icon: '📁' },
};
const QUICK_MARK_ACTIONS = [
  { id: 'create', label: 'New Waymark', shortLabel: 'New Waymark', icon: '📝', detail: 'Start a new Waymark' },
  { id: 'import', label: 'Import Waymark', shortLabel: 'Import Waymark', icon: '📥', detail: 'Import a Waymark' },
  { id: 'browse', label: 'Browse Waymarks', shortLabel: 'Browse Waymarks', icon: '📂', detail: 'Browse your Drive' },
  { id: 'examples', label: 'Example Waymarks', shortLabel: 'Example Waymarks', icon: '✨', detail: 'Explore example Waymarks' },
];
const QUICK_MARK_ACTION_IDS = QUICK_MARK_ACTIONS.map(action => action.id);
const sheetPreviewCache = new Map();

/* ---------- Mode application ---------- */

/**
 * Apply a home layout architecture to the Wayboard root AND (by default) theme
 * the whole platform with that layout's palette.
 *
 * The layout structure (grid/columns) is scoped to #wayboard-root via the
 * mode-N class. The palette is lifted app-wide by stamping data-wm-palette on
 * the html element — css/palettes.css maps it onto every --color-* token.
 *
 * Pass { theme: false } to update ONLY the Wayboard structure and leave the
 * global palette untouched — used when a custom Appearance theme is active and
 * must not be overwritten by a layout change.
 * @param {number} mode stored mode (1–50 legacy or 1–12 current)
 * @param {{ theme?: boolean }} [opts]
 */
function applyHomeMode(mode, opts = {}) {
  const n = resolveLayout(mode);
  const current = document.documentElement.getAttribute('data-wm-palette');
  // Respect an active custom Appearance theme — a layout change must never
  // overwrite it with a preset palette. opts.theme === true forces the palette.
  const applyPalette = opts.theme === true || (opts.theme !== false && current !== 'custom');
  if (applyPalette) {
    document.documentElement.setAttribute('data-wm-palette', String(n));
  }
  const root = document.getElementById('wayboard-root');
  if (!root) return;
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
function initWayboard(deps = {}) {
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
    window.addEventListener('waymark:select-wayside-target', async (e) => {
      const detail = e.detail || {};
      const contactEmail = String(detail.contactEmail || 'assistant@waymark.internal').trim().toLowerCase();
      const group = String(detail.group || '').trim();
      const label = String(detail.label || (contactEmail === 'assistant@waymark.internal' ? 'Waymark AI' : contactEmail)).trim();
      await renderWayside({ autoSelect: false }).catch(() => {});
      const host = document.getElementById('home-wayside');
      if (host) {
        await selectTarget(group ? { group, label } : { contactEmail, label, isAgent: contactEmail === 'assistant@waymark.internal' }, host);
      }
    });
    document.addEventListener('waymark:open-agent-config', async () => {
      const homeView = document.getElementById('home-view');
      if (!homeView || homeView.classList.contains('hidden')) {
        window.location.hash = '#/';
        if (_navigate) _navigate('home');
        await new Promise((r) => setTimeout(r, 0));
      }
      await renderWayside({ autoSelect: false }).catch(() => {});
      const host = document.getElementById('home-wayside');
      if (host) {
        await selectTarget({
          contactEmail: 'assistant@waymark.internal',
          label: 'Waymark AI',
          isAgent: true,
        }, host);
        await openAgentModalForHost(host);
      }
    });
  }
}

/**
 * Render the full Wayboard: status badges, dashboard widgets and the Wayside.
 * Pinned/recent markers are rendered by app.js into the existing containers.
 * @param {{ userName?: string }} [opts]
 */
function renderWayboard(opts = {}) {
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
    el('span', { className: 'badge' }, [`📌 ${pinned} pinned`]),
    el('span', { className: 'badge blue' }, [`🕒 ${recent} recent Waymark${recent === 1 ? '' : 's'}`]),
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
    ['Recent', recent, '🕒'],
    ['Pinned', pinnedSheets, '📌'],
    ['Waypoints', pinnedFolders, '📁'],
    ['Shared', ledgers, '🔗'],
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

function renderFullWidgetList(items, makeRow) {
  return el('div', { className: 'wayboard-paged-list wayboard-full-list' }, [
    el('div', { className: 'wayboard-data-list' }, items.map(makeRow)),
  ]);
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
    if (!folders.length) return emptyWidgetMessage('No waypoints pinned yet. Pin a folder in Browse to add one.');
    return renderPagedWidgetList(folders, renderFolderRow);
  }

  let items = [];
  if (type === 'recent') items = userData.getRecentSheets();
  if (type === 'pinned') items = userData.getPinnedSheets();
  if (!items.length) {
    const noun = type === 'recent' ? 'recent Waymarks' : 'pinned Waymarks';
    return emptyWidgetMessage(`No ${noun} yet. Open or pin a Waymark to see it here.`);
  }
  const makeRow = sheet => {
    const template = sheet.templateKey ? TEMPLATES[sheet.templateKey] : null;
    const timestamp = sheet.openedAt ? Date.parse(sheet.openedAt) : NaN;
    const ago = Number.isFinite(timestamp)
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp)
      : '';
    return makeWidgetRow(sheet, template?.icon || '📄', ago);
  };
  // Pinned Waymarks always show in full (no paging) and the widget grows to fit.
  if (type === 'pinned') return renderFullWidgetList(items, makeRow);
  return renderPagedWidgetList(items, makeRow);
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
    return emptyWidgetMessage('No quick actions yet. Edit this widget to choose a few.', 'Edit widget', () => openWidgetManager(widget.id));
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
      el('p', {}, ['Your Wayboard is empty. Add a widget to show your Waymarks, waypoints, and more.']),
      el('button', { className: 'btn-secondary', type: 'button', on: { click: openWidgetManager } }, ['Add a widget']),
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
    el('option', { value, ...(value === 'sheet' ? { selected: 'selected' } : {}) }, [`${option.icon} ${option.label}`])
  ));
  const titleInput = el('input', {
    className: 'wayboard-widget-control', name: 'title', type: 'text', maxlength: '48',
    placeholder: 'Any Waymark', autocomplete: 'off',
  });
  const sheetSelect = el('select', { className: 'wayboard-widget-control', name: 'sheet', id: 'wayboard-widget-source' });
  const browseDriveButton = el('button', {
    className: 'btn-secondary btn-sm wayboard-widget-drive-button', type: 'button',
    title: 'Browse Google Drive for a Waymark',
  }, ['Browse Drive']);
  const sheetLabel = el('div', { className: 'wayboard-widget-field wayboard-widget-sheet-field' }, [
    el('label', { for: 'wayboard-widget-source' }, ['Waymark to show']),
    el('div', { className: 'wayboard-widget-sheet-picker' }, [sheetSelect, browseDriveButton]),
  ]);
  const sizeSelect = el('select', { className: 'wayboard-widget-control', name: 'size' }, [
    el('option', { value: 'normal' }, ['Normal']),
    el('option', { value: 'compact' }, ['Compact']),
    el('option', { value: 'wide' }, ['Wide']),
    el('option', { value: 'tall' }, ['Tall']),
    el('option', { value: 'full' }, ['Full width']),
  ]);
  const submitButton = el('button', { className: 'btn btn-primary', type: 'submit' }, ['Add widget']);
  const quickmarkOptions = el('div', {
    className: 'wayboard-widget-field wayboard-widget-quickmark-options hidden',
    role: 'group', 'aria-label': 'Choose and arrange quick actions',
  });
  const form = el('form', { className: 'wayboard-widget-form' }, [
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Widget type']), typeSelect]),
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Widget name']), titleInput]),
    sheetLabel,
    quickmarkOptions,
    el('label', { className: 'wayboard-widget-field' }, [el('span', {}, ['Widget size']), sizeSelect]),
    el('div', { className: 'wayboard-widget-form-actions' }, [submitButton]),
  ]);
  const list = el('div', { className: 'wayboard-widget-manager-list' });
  const closeButton = el('button', { className: 'btn-icon', type: 'button', 'aria-label': 'Close widget manager' }, ['✕']);
  const dialog = el('div', { className: 'modal wayboard-widget-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wayboard-widget-title' }, [
    el('div', { className: 'modal-header wayboard-widget-dialog-header' }, [
      el('div', {}, [
        el('h3', { id: 'wayboard-widget-title' }, ['Manage Wayboard widgets']),
        el('p', { className: 'wayboard-widget-manager-hint' }, ['Add, arrange, and edit the widgets on your Wayboard.']),
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
    quickmarkOptions.append(el('span', { className: 'wayboard-widget-field-label' }, ['Quick actions to include'])) ;
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
    if (!titleInput.value.trim()) titleInput.placeholder = widgetTitle(typeSelect.value, sheetSelect.value);
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
        if (files?.length) showToast('Choose a Google spreadsheet to add as a widget.', 'info');
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
    typeSelect.value = 'sheet';
    titleInput.placeholder = 'Any Waymark';
    submitButton.textContent = 'Add widget';
    refreshQuickmarkOptions();
    refreshSheetOptions();
    renderWidgets();
    renderWidgetManagerList();
    showToast(editingId ? 'Widget updated' : 'Widget added', 'success');
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
  manager.typeSelect.value = 'sheet';
  manager.titleInput.placeholder = 'Any Waymark';
  manager.submitButton.textContent = 'Add widget';
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
    widgetManager.list.append(el('p', { className: 'wayboard-widget-manager-empty' }, ['No widgets yet. Add one above.']));
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
          : widget.type === 'quickmarks' ? `${widget.actions.length} quick actions` : type.label]),
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
  manager.refreshQuickmarkOptions(widget.actions || QUICK_MARK_ACTION_IDS);
  manager.refreshSheetOptions();
  if (widget.sheetId && !Array.from(manager.sheetSelect.options).some(option => option.value === widget.sheetId)) {
    manager.sheetSelect.append(el('option', { value: widget.sheetId }, [`📄 ${widget.sheetName || widget.title}`]));
    manager.driveSheets.set(widget.sheetId, { id: widget.sheetId, name: widget.sheetName || widget.title, templateKey: widget.templateKey || '' });
    manager.sheetSelect.disabled = false;
    manager.submitButton.disabled = false;
  }
  if (widget.sheetId) manager.sheetSelect.value = widget.sheetId;
  manager.submitButton.textContent = 'Save widget';
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
let _activeLedgerId = null;
let _waysideTargetGeneration = 0;
let _waysideRenderToken = 0;
let _waysidePollingWired = false;
let _waysideSocialRefreshKey = null;

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

  // Always surface Waymark AI companion in Wayside
  if (!emailSeen.has('assistant@waymark.internal')) {
    emailSeen.add('assistant@waymark.internal');
    people.unshift({
      name: 'Waymark AI',
      email: 'assistant@waymark.internal',
      group: '',
      isAgent: true,
    });
  }

  return { crews: [...crews.keys()].map(name => ({ name })), people };
}

let _waysideWidget = null;

function teardownWaysideWidget() {
  if (_waysideWidget) {
    _waysideWidget.destroy();
    _waysideWidget = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('waymark:auth-logout', () => {
    teardownWaysideWidget();
  });
}

/** Mark the crew row / avatar matching `target` as active. */
function highlightWaysideTarget(host, target) {
  if (!host || !target) return;
  host.querySelectorAll('.crew-row').forEach(r => r.classList.toggle('active', r.dataset.group === target.group));
  host.querySelectorAll('.avatar').forEach(av => {
    const title = (av.getAttribute('title') || '').toLowerCase();
    const isTarget = target.contactEmail && title.includes(target.contactEmail.toLowerCase());
    av.classList.toggle('active', !!isTarget);
  });
}

function renderWaysidePlaceholder(container) {
  if (!container) return;
  container.replaceChildren();
  const placeholder = el('div', { className: 'chat-box wayside-placeholder', id: 'wayside-placeholder' }, [
    el('div', { className: 'chat-box-head' }, [
      el('b', { id: 'wayside-crew-title' }, ['💬 Wayside']),
    ]),
    el('div', { className: 'chat-sheet-line', id: 'wayside-sheet-line' }, ['Pick a crew or Waymarker to chat, call, or share']),
    el('div', {
      className: 'chat-log',
      id: 'wayside-chat-log',
      style: 'display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-style:italic;text-align:center;padding:1.5rem;',
    }, ['Pick a crew or Waymarker above to start chatting, calling, or sharing Waymarks.']),
  ]);
  container.append(placeholder);
}

function renderWaysidePoppedOutPlaceholder(container, onDock, target) {
  if (!container) return;
  container.replaceChildren();
  const label = target?.label || 'Wayside';
  const isAi = Boolean(target?.isAgent || target?.contactEmail === 'assistant@waymark.internal');
  const icon = isAi ? '🤖' : '💬';
  const placeholder = el('div', { className: 'chat-box wayside-placeholder wayside-popped-out-placeholder', id: 'wayside-placeholder' }, [
    el('div', { className: 'chat-box-head' }, [
      el('b', { id: 'wayside-crew-title' }, [`${icon} ${label}`]),
      el('span', { className: 'badge blue' }, ['Popped Out']),
    ]),
    el('div', { className: 'chat-sheet-line', id: 'wayside-sheet-line' }, ['Floating session active · drag anywhere or truncate to bubble']),
    el('div', {
      className: 'wayside-popped-body',
    }, [
      el('div', { className: 'wayside-popped-icon' }, ['↗']),
      el('div', { className: 'wayside-popped-text' }, ['Chat session is floating on screen.']),
      el('button', {
        type: 'button',
        className: 'btn btn-secondary wayside-dock-btn',
        id: 'wayside-dock-btn',
        title: 'Dock chat back to the Wayside column',
        on: { click: onDock },
      }, ['↙ Dock chat here']),
    ]),
  ]);
  container.append(placeholder);
}

function deselectTarget(host) {
  _waysideTargetGeneration++;
  teardownWaysideWidget();
  _activeTarget = null;
  _activeLedgerId = null;

  if (host) {
    host.querySelectorAll('.crew-row').forEach(r => r.classList.remove('active'));
    host.querySelectorAll('.avatar').forEach(av => av.classList.remove('active'));
    const chatContainer = host.querySelector('#wayside-chat-container');
    if (chatContainer) renderWaysidePlaceholder(chatContainer);
  }
  renderSharedFiles([]);
}

async function renderWayside({ autoSelect = true } = {}) {
  const host = document.getElementById('home-wayside');
  if (!host) return;
  const renderToken = ++_waysideRenderToken;
  host.innerHTML = '';

  // The active chat/call widget owns live media + WebRTC state. Re-rendering the
  // Wayside (home navigation, pin changes, ...) must NOT tear down an ongoing
  // call, so keep the widget and re-mount its root into the fresh DOM below.
  const keepWidget = Boolean(_waysideWidget && _activeTarget);
  if (!keepWidget) {
    teardownWaysideWidget();
    _activeTarget = null;
    _activeLedgerId = null;
  }

  host.append(el('div', { className: 'wayside-head' }, [
    el('div', { className: 'wayside-head-titles' }, [
      el('b', {}, ['🧭 The Wayside']),
      el('span', { className: 'wayside-head-tagline' }, ['Chat, call & share Waymarks']),
    ]),
    el('span', { className: 'wayside-status', 'aria-live': 'polite' }, ['Finding Waymarkers…']),
  ]));

  const { crews, people } = await discoverCrews();
  if (renderToken !== _waysideRenderToken) return;
  const waysideStatus = host.querySelector('.wayside-status');
  if (waysideStatus) waysideStatus.textContent = `${crews.length} crew${crews.length === 1 ? '' : 's'} · ${people.length} Waymarker${people.length === 1 ? '' : 's'}`;

  // Crews (shared groups)
  const crewsBlock = el('div', { className: 'crews-block' }, [
    el('div', { className: 'wayside-label' }, ['CREWS']),
  ]);
  if (!crews.length) {
    crewsBlock.append(el('div', { className: 'wayside-empty' }, ['Add a Contacts Waymark with a Group column to form crews.']));
  }
  const crewLedgers = await Promise.all(
    crews.map(crew => collab.findExistingShareLedger({ group: crew.name }).catch(() => null))
  );
  if (renderToken !== _waysideRenderToken) return;
  for (let i = 0; i < crews.length; i++) {
    const crew = crews[i];
    const ledger = crewLedgers[i];
    if (ledger?.sheetId) {
      _waysideTargetLedgerCache.set(getWaysideTargetKey({ group: crew.name }), ledger);
    }
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
    el('div', { className: 'wayside-label' }, ['WAYMARKERS']),
  ]);
  const avatarRow = el('div', { className: 'avatar-row' });
  for (const p of people.slice(0, 8)) {
    const isAi = p.isAgent || p.email === 'assistant@waymark.internal';
    const initials = isAi ? '🤖' : (p.name || p.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
    const av = el('div', {
      className: `avatar${isAi ? ' avatar-ai' : ''}`,
      title: `${p.name} (${p.email})`
    }, [initials || '?']);
    av.addEventListener('click', () => selectTarget({ contactEmail: p.email, label: p.name, isAgent: isAi }, host));
    avatarRow.append(av);
  }
  if (!people.length) avatarRow.append(el('div', { className: 'wayside-empty' }, ['No Waymarkers yet.']));
  onlineBlock.append(avatarRow);
  host.append(onlineBlock);

  // Warm ledger/snapshot/backfill caches so switching between any listed
  // crew or Waymarker is instant and the share list is already backfilled.
  warmWaysideCaches([
    ...crews.map(c => ({ group: c.name })),
    ...people
      .filter(p => !p.isAgent && p.email !== 'assistant@waymark.internal')
      .map(p => ({ contactEmail: p.email })),
  ], renderToken);

  // Shared Files between users
  const filesBlock = el('div', { className: 'wayside-files', id: 'wayside-files' });
  host.append(filesBlock);

  // Chat container
  const chatContainer = el('div', { className: 'wayside-chat-container', id: 'wayside-chat-container' });
  host.append(chatContainer);
  ensureWaysidePolling();

  if (keepWidget && _waysideWidget) {
    _waysideWidget.setDockContainer(chatContainer);
    if (_waysideWidget.isPoppedOut) {
      renderWaysidePoppedOutPlaceholder(chatContainer, () => _waysideWidget.dock(), _activeTarget);
    } else {
      _waysideWidget.mount(chatContainer);
    }
    highlightWaysideTarget(host, _activeTarget);
    refreshWaysideSocial(host).catch(() => {});
    return;
  }
  renderWaysidePlaceholder(chatContainer);

  if (autoSelect) {
    // Auto-select the first crew / human Waymarker (Waymark AI stays ready as a one-click avatar).
    const firstHuman = people.find(p => !p.isAgent && p.email !== 'assistant@waymark.internal');
    if (crews.length) selectTarget({ group: crews[0].name, label: crews[0].name }, host);
    else if (firstHuman) selectTarget({ contactEmail: firstHuman.email, label: firstHuman.name }, host);
  }
}

const _waysideSnapshotCache = new Map();
const _waysideTargetLedgerCache = new Map();
/* Docs Waymark knows were shared with a target, scanned across every known
   ledger (not just the active one). Keyed by target key. Powers share-list
   backfill so older shares still appear. */
const _waysideBackfillFiles = new Map();

function getWaysideTargetKey(target = {}) {
  if (target.group) return `group:${String(target.group).trim().toLowerCase()}`;
  return `contact:${String(target.contactEmail || '').trim().toLowerCase()}`;
}

/** Merge a ledger's live shared files with the backfilled docs for a target. */
function mergeBackfillFiles(target, files) {
  const base = Array.isArray(files) ? files : [];
  const extra = _waysideBackfillFiles.get(getWaysideTargetKey(target || _activeTarget || {})) || [];
  if (!extra.length) return base;
  const seen = new Set(base.map(f => (f.docId || f.Document_ID || '').trim()).filter(Boolean));
  const merged = [...base];
  for (const f of extra) {
    const id = (f.docId || '').trim();
    if (id && !seen.has(id)) { seen.add(id); merged.push(f); }
  }
  return merged;
}

/**
 * Warm the Wayside ledger/snapshot/backfill caches in the background so that
 * switching between any listed crew or Waymarker feels instant (a cache hit)
 * instead of waiting on a Drive round-trip. Fire-and-forget; every async step
 * is guarded by the render token so a newer render supersedes stale warms.
 * @param {Array<{group?:string, contactEmail?:string}>} targets
 * @param {number} renderToken
 */
function warmWaysideCaches(targets, renderToken) {
  for (const t of targets.slice(0, 16)) {
    const tKey = getWaysideTargetKey(t);

    // Backfill is independent of the active ledger — compute it for every target.
    collab.getKnownSharedDocsForTarget(t).then(docs => {
      if (renderToken !== _waysideRenderToken) return;
      if (docs && docs.length) _waysideBackfillFiles.set(tKey, docs);
      else _waysideBackfillFiles.delete(tKey);
      if (_activeTarget && getWaysideTargetKey(_activeTarget) === tKey) {
        const snap = _activeLedgerId ? _waysideSnapshotCache.get(_activeLedgerId) : null;
        renderSharedFiles(mergeBackfillFiles(_activeTarget, snap?.files || []));
      }
    }).catch(() => {});

    const prefetchSnapshot = (sheetId) => {
      if (!sheetId || _waysideSnapshotCache.has(sheetId)) return;
      collab.readSocialSnapshot(sheetId).then(snap => {
        if (renderToken === _waysideRenderToken && snap) _waysideSnapshotCache.set(sheetId, snap);
      }).catch(() => {});
    };

    const cached = _waysideTargetLedgerCache.get(tKey);
    if (cached?.sheetId) { prefetchSnapshot(cached.sheetId); continue; }

    collab.findExistingShareLedger(t).then(ledger => {
      if (renderToken !== _waysideRenderToken || !ledger?.sheetId) return;
      _waysideTargetLedgerCache.set(tKey, ledger);
      prefetchSnapshot(ledger.sheetId);
    }).catch(() => {});
  }
}

function peekKnownLedgerForTarget(target = {}) {
  const tKey = getWaysideTargetKey(target);
  const mem = _waysideTargetLedgerCache.get(tKey);
  if (mem?.sheetId) return mem;
  const all = userData.getShareLedgers?.() || [];
  if (target.group) {
    const g = String(target.group).trim().toLowerCase();
    return all.find(l => String(l.group || '').trim().toLowerCase() === g && l.sheetId) || null;
  }
  const email = String(target.contactEmail || '').trim().toLowerCase();
  if (!email) return null;
  return all.find(l => String(l.contactEmail || '').trim().toLowerCase() === email && l.sheetId) || null;
}

async function selectTarget(target, host) {
  const generation = ++_waysideTargetGeneration;
  const targetChanged = !_activeTarget
    || _activeTarget.group !== target.group
    || _activeTarget.contactEmail !== target.contactEmail;

  // Re-selecting the already-active target must not rebuild the widget: that
  // would drop an in-progress call and its media tracks.
  if (!targetChanged && _waysideWidget) {
    highlightWaysideTarget(host, target);
    if (!_activeLedgerId) {
      try {
        const ledger = await collab.findExistingShareLedger(target);
        if (generation === _waysideTargetGeneration && ledger?.sheetId && _waysideWidget) {
          _activeLedgerId = ledger.sheetId;
          _waysideTargetLedgerCache.set(getWaysideTargetKey(target), ledger);
          _waysideWidget.setSignaling(ledger.sheetId, collab.createLedgerSignal(ledger.sheetId));
        }
      } catch {}
    }
    await refreshWaysideSocial(host);
    return;
  }

  _activeTarget = target;
  highlightWaysideTarget(host, target);

  const chatContainer = host.querySelector('#wayside-chat-container')
    || document.querySelector('#home-wayside #wayside-chat-container');
  if (!chatContainer) return;

  // Instantaneous synchronous lookup: mount widget & render cached messages in 0ms
  let ledger = peekKnownLedgerForTarget(target);
  _activeLedgerId = ledger ? ledger.sheetId : null;
  if (!_activeLedgerId) {
    renderSharedFiles(mergeBackfillFiles(target, []));
  }

  const wasPoppedOut = Boolean(_waysideWidget?.isPoppedOut);
  const wasBubbleMode = Boolean(_waysideWidget?.isBubbleMode);
  const savedPos = _waysideWidget?._savedPos;
  const savedSize = _waysideWidget?._savedSize;

  teardownWaysideWidget();
  chatContainer.replaceChildren();

  const user = api.auth.getUser?.() || {};
  const displayName = user.name || (user.email ? user.email.split('@')[0] : 'Waymarker');
  const userEmail = collab.currentEmail();
  const isAgentTarget = Boolean(target.isAgent || target.contactEmail === 'assistant@waymark.internal');
  if (targetChanged && isAgentTarget) {
    _activeAgentThreadId = 'default';
    _activeAgentThreadTitle = '';
  }

  const widget = new SocialChatWidget({
    mode: wasPoppedOut ? 'floating' : 'embedded',
    isPoppedOut: wasPoppedOut,
    isBubbleMode: wasBubbleMode,
    savedPos,
    savedSize,
    dockContainer: chatContainer,
    bubbleIcon: isAgentTarget ? '🤖' : (target.label ? target.label[0].toUpperCase() : '💬'),
    sheetId: _activeLedgerId || '',
    signal: _activeLedgerId ? collab.createLedgerSignal(_activeLedgerId) : null,
    displayName,
    userEmail,
    title: `${isAgentTarget ? '🤖' : '💬'} ${target.label}`,
    subtitle: formatWaysideSubtitle(isAgentTarget, _activeLedgerId, ledger),
    mountTo: wasPoppedOut ? document.body : chatContainer,
    showClose: true,
    showMinimize: false,
    showPopout: true,
    showBubble: true,
    showSheetLink: true,
    showConnectDrive: true,
    showShareAgent: isAgentTarget,
    showAgentThreads: isAgentTarget,
    onClose: () => deselectTarget(host),
    onPopOutChange: (popped) => {
      if (popped) {
        renderWaysidePoppedOutPlaceholder(chatContainer, () => widget.dock(), _activeTarget);
      } else {
        const ph = chatContainer.querySelector('.wayside-popped-out-placeholder');
        if (ph) ph.remove();
      }
    },
    onOpenSheet: () => openSocialSheet(),
    onConnectDrive: () => connectSharedLedgerFromWayside(host),
    onShareAgent: () => openAgentModalForHost(host),
    onSelectThread: (threadId) => selectAgentThread(threadId, host),
    onNewThread: () => startNewAgentThread(host, { isClear: false }),
    onClearThread: () => startNewAgentThread(host, { isClear: true }),
    onPeerMessage: () => {
      setTimeout(() => {
        refreshWaysideSocial(host).catch(() => {});
      }, 600);
    },
    onBeforeStartCall: async () => {
      if (!_activeTarget) return;
      const signaling = _activeLedgerId
        ? { sheetId: _activeLedgerId, signal: collab.createLedgerSignal(_activeLedgerId) }
        : await collab.getSignalingTarget(_activeTarget);
      if (signaling?.sheetId) {
        _activeLedgerId = signaling.sheetId;
        widget.setSignaling(signaling.sheetId, signaling.signal);
        widget.setSubtitle(formatWaysideSubtitle(isAgentTarget, signaling.sheetId, ledger));
      }
    },
    getMessageExtra: (text) => {
      if (!isAgentTarget) return { email: userEmail };
      _userSelectedAgentThread = true;
      if (!_activeAgentThreadTitle && _activeAgentThreadId !== 'default') {
        _activeAgentThreadTitle = deriveAgentThreadTitle(text);
        const pending = _pendingAgentThreads.get(_activeAgentThreadId);
        if (pending) pending.title = _activeAgentThreadTitle;
      }
      const liveToken = api.auth?.getToken?.() || null;
      return {
        email: userEmail,
        threadId: _activeAgentThreadId,
        threadTitle: _activeAgentThreadTitle,
        ...(liveToken ? { tokenBundle: { access_token: liveToken, token_type: 'Bearer' } } : {}),
      };
    },
    persistChat: async (msg) => {
      let chatTarget = target;
      if (isAgentTarget) {
        _userSelectedAgentThread = true;
        if (!_activeAgentThreadTitle && _activeAgentThreadId !== 'default') {
          _activeAgentThreadTitle = deriveAgentThreadTitle(msg.text);
          const pending = _pendingAgentThreads.get(_activeAgentThreadId);
          if (pending) pending.title = _activeAgentThreadTitle;
        }
        chatTarget = {
          ...target,
          threadId: _activeAgentThreadId,
          threadTitle: _activeAgentThreadTitle,
        };
      }
      // Optimistically update in-memory snapshot cache so thread switching is instant
      if (_activeLedgerId) {
        const cachedSnap = _waysideSnapshotCache.get(_activeLedgerId) || { chat: [], files: [], presence: [] };
        cachedSnap.chat = [
          ...(cachedSnap.chat || []),
          {
            id: msg.id,
            sender: userEmail,
            text: msg.text,
            ts: new Date().toISOString(),
            threadId: isAgentTarget ? _activeAgentThreadId : 'default',
            threadTitle: isAgentTarget ? _activeAgentThreadTitle : '',
          },
        ];
        _waysideSnapshotCache.set(_activeLedgerId, cachedSnap);
        if (isAgentTarget && _waysideWidget) {
          const threads = getAgentThreads(cachedSnap.chat);
          _waysideWidget.setThreads(threads, _activeAgentThreadId);
        }
      }
      const result = await collab.sendChat(chatTarget, msg.text, '', msg.id);
      const nextLedgerId = result?.sheetId || _activeLedgerId;
      if (widget && nextLedgerId && nextLedgerId !== _activeLedgerId) {
        _activeLedgerId = nextLedgerId;
        widget.setSubtitle(formatWaysideSubtitle(isAgentTarget, _activeLedgerId, ledger));
        widget.setSignaling(_activeLedgerId, collab.createLedgerSignal(_activeLedgerId));
      }
      if (isAgentTarget) {
        setTimeout(() => {
          refreshWaysideSocial(host).catch(() => {});
        }, 150);
      }
      return result;
    },
  });

  _waysideWidget = widget;
  if (wasPoppedOut) {
    renderWaysidePoppedOutPlaceholder(chatContainer, () => widget.dock(), target);
  }

  // Render cached snapshot immediately in 0ms if available
  if (_activeLedgerId && _waysideSnapshotCache.has(_activeLedgerId)) {
    applyWaysideSnapshot(host, _waysideSnapshotCache.get(_activeLedgerId), isAgentTarget);
  } else if (isAgentTarget) {
    _waysideWidget.setThreads(getAgentThreads([]), _activeAgentThreadId);
  }

  // Resolve/verify ledger in Drive if not already known
  if (!ledger) {
    try {
      ledger = await collab.findExistingShareLedger(target);
    } catch {}
    if (generation !== _waysideTargetGeneration) return;
    if (ledger?.sheetId) {
      _waysideTargetLedgerCache.set(getWaysideTargetKey(target), ledger);
      if (ledger.sheetId !== _activeLedgerId) {
        _activeLedgerId = ledger.sheetId;
        if (_waysideWidget === widget) {
          widget.setSignaling(ledger.sheetId, collab.createLedgerSignal(ledger.sheetId));
          widget.setSubtitle(formatWaysideSubtitle(isAgentTarget, ledger.sheetId, ledger));
          if (_waysideSnapshotCache.has(ledger.sheetId)) {
            applyWaysideSnapshot(host, _waysideSnapshotCache.get(ledger.sheetId), isAgentTarget);
          }
        }
      }
    }
  } else {
    _waysideTargetLedgerCache.set(getWaysideTargetKey(target), ledger);
  }

  // Publish presence in the background — never block chat rendering on Presence tab I/O!
  if (_activeLedgerId) {
    collab.publishPresence(target, {
      sheetId: _activeLedgerId,
      status: 'online',
      activeWaymarkId: 'home',
    }).catch(() => {});
  }
  await refreshWaysideSocial(host);
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
    el('div', { className: 'wayside-label' }, [`SHARED WAYMARKS (${list.length})`]),
    el('button', { className: 'btn btn-muted wayside-share-file', type: 'button' }, ['＋ Share a Waymark']),
  ]);
  heading.querySelector('button').addEventListener('click', () => shareWaymarkWithTarget());
  container.append(heading);

  if (!list.length) {
    container.append(el('div', { className: 'wayside-empty' }, ['No shared Waymarks yet. Choose a Waymark to share with this Waymarker.']));
    return;
  }
  const listEl = el('div', { className: 'wayside-files-list' });
  for (const f of list) {
    const docId = (f.docId || f.Document_ID || '').trim();
    const title = f.title || f.Document_Title || docId;
    const type = f.type || f.Waymark_Type || 'Waymark';
    const permission = f.permission || f.Permission_Level || '';
    const isGoogleDoc = type.toLowerCase() === 'doc';
    const linkAttrs = {
      className: 'wayside-file',
      href: isGoogleDoc ? `https://docs.google.com/document/d/${docId}/edit` : `#/sheet/${docId}`,
      title: `${title} (${type}${permission ? ` · ${permission}` : ''})`,
    };
    if (isGoogleDoc) {
      linkAttrs.target = '_blank';
      linkAttrs.rel = 'noopener noreferrer';
    }
    listEl.append(el('a', linkAttrs, [
      el('span', {}, [`${isGoogleDoc ? '📝' : '📄'} ${title}`]),
      el('small', {}, [`${type}${permission ? ` · ${permission}` : ''}`]),
    ]));
  }
  container.append(listEl);
}

let _activeAgentThreadId = 'default';
let _activeAgentThreadTitle = '';
let _userSelectedAgentThread = false;
const _pendingAgentThreads = new Map();

function getAgentThreads(chatRows = []) {
  return buildAgentThreadList(chatRows, _activeAgentThreadId, {
    pendingThreads: _pendingAgentThreads,
    activeThreadTitle: _activeAgentThreadTitle,
  });
}

function applyWaysideSnapshot(host, snap, isAgentTarget) {
  if (!_waysideWidget || !snap) return;
  const allChat = snap.chat || [];
  let visibleChat = allChat;
  if (isAgentTarget) {
    if (!_userSelectedAgentThread && allChat.length > 0) {
      const latestMsg = allChat[allChat.length - 1];
      if (latestMsg?.threadId) {
        _activeAgentThreadId = latestMsg.threadId;
        _activeAgentThreadTitle = latestMsg.threadTitle || '';
      }
    }
    const threads = getAgentThreads(allChat);
    const activeMeta = threads.find(t => t.id === _activeAgentThreadId);
    if (activeMeta?.title && !_activeAgentThreadTitle && _activeAgentThreadId !== 'default') {
      _activeAgentThreadTitle = activeMeta.title;
    }
    _waysideWidget.setThreads(threads, _activeAgentThreadId);
    visibleChat = allChat.filter(m => (m.threadId || 'default') === _activeAgentThreadId);
  }
  for (const m of visibleChat) {
    _waysideWidget.appendMessage({
      id: m.id,
      sender: m.sender,
      text: m.text,
      ts: m.ts,
      history: true,
    });
  }
  renderSharedFiles(mergeBackfillFiles(_activeTarget, snap.files || []));
  applyPresenceRings(host, snap.presence || []);
}

async function selectAgentThread(threadId, host) {
  const nextId = String(threadId || 'default').trim() || 'default';
  _userSelectedAgentThread = true;
  _activeAgentThreadId = nextId;
  const pending = _pendingAgentThreads.get(nextId);
  _activeAgentThreadTitle = pending?.title || '';
  _waysideSocialRefreshKey = null;
  if (_waysideWidget) {
    _waysideWidget.clearMessages();
  }
  // Instant 0ms thread swap from in-memory snapshot cache
  if (_activeLedgerId && _waysideSnapshotCache.has(_activeLedgerId)) {
    applyWaysideSnapshot(host, _waysideSnapshotCache.get(_activeLedgerId), true);
    refreshWaysideSocial(host).catch(() => {});
    return;
  }
  await refreshWaysideSocial(host);
}

async function startNewAgentThread(host, { isClear = false } = {}) {
  const newThreadId = `thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  _userSelectedAgentThread = true;
  _activeAgentThreadId = newThreadId;
  _activeAgentThreadTitle = '';
  _pendingAgentThreads.set(newThreadId, {
    id: newThreadId,
    title: 'New Conversation',
    createdAt: new Date().toISOString(),
  });
  _waysideSocialRefreshKey = null;
  if (_waysideWidget) {
    _waysideWidget.clearMessages(
      isClear
        ? '🧹 Context cleared! Started a fresh conversation thread — previous chats remain saved in Google Drive above.'
        : '✨ New conversation thread started — switch between saved Google Drive threads anytime above.'
    );
    const cachedSnap = _activeLedgerId ? _waysideSnapshotCache.get(_activeLedgerId) : null;
    const threads = getAgentThreads(cachedSnap?.chat || []);
    _waysideWidget.setThreads(threads, _activeAgentThreadId);
  }
  showToast(
    isClear
      ? 'Context cleared — started a fresh thread (past chats saved in Drive)'
      : 'Started a new Waymark AI conversation thread',
    'info'
  );
  if (_activeLedgerId && _waysideSnapshotCache.has(_activeLedgerId)) {
    refreshWaysideSocial(host).catch(() => {});
    return;
  }
  await refreshWaysideSocial(host);
}

async function refreshWaysideSocial(host) {
  if (!_activeTarget || !_waysideWidget) return;
  const generation = _waysideTargetGeneration;
  if (!_activeLedgerId) {
    try {
      const ledger = await collab.findExistingShareLedger(_activeTarget);
      if (generation === _waysideTargetGeneration && ledger?.sheetId && _waysideWidget) {
        _activeLedgerId = ledger.sheetId;
        _waysideTargetLedgerCache.set(getWaysideTargetKey(_activeTarget), ledger);
        _waysideWidget.setSignaling(ledger.sheetId, collab.createLedgerSignal(ledger.sheetId));
      }
    } catch {}
  }
  const ledgerId = _activeLedgerId;
  const isAgentTarget = Boolean(_activeTarget?.isAgent || _activeTarget?.contactEmail === 'assistant@waymark.internal');
  const refreshKey = `${generation}:${ledgerId || 'unlinked'}:${isAgentTarget ? _activeAgentThreadId : 'all'}`;
  if (_waysideSocialRefreshKey === refreshKey) return;
  _waysideSocialRefreshKey = refreshKey;
  try {
    if (ledgerId) {
      const snap = await collab.readSocialSnapshot(ledgerId);
      if (generation !== _waysideTargetGeneration || ledgerId !== _activeLedgerId) return;
      _waysideSnapshotCache.set(ledgerId, snap);
      applyWaysideSnapshot(host, snap, isAgentTarget);
    } else {
      if (isAgentTarget) {
        const threads = getAgentThreads([]);
        _waysideWidget.setThreads(threads, _activeAgentThreadId);
      }
      renderSharedFiles(mergeBackfillFiles(_activeTarget, []));
      applyPresenceRings(host, []);
    }
  } catch { /* ignore */ }
  finally {
    if (_waysideSocialRefreshKey === refreshKey) _waysideSocialRefreshKey = null;
  }
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
async function sendWaysideChat() {
  if (_waysideWidget) {
    _waysideWidget.sendMessage();
  }
}
async function endWaysideCall(opts = {}) {
  if (_waysideWidget) {
    await _waysideWidget.session.endCall(opts);
  }
}
async function startCall() {
  if (!_activeTarget) { showToast('Pick a crew or Waymarker first', 'info'); return; }
  const host = document.getElementById('home-wayside');
  if (!_waysideWidget && host) {
    await selectTarget(_activeTarget, host);
  }
  if (_waysideWidget) {
    const stream = await _waysideWidget.toggleCall({ video: false });
    if (stream) {
      showToast('📹 Call ready', 'success');
    }
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
    if (_activeLedgerId && _waysideWidget && !_waysideWidget.session.sheetId) {
      _waysideWidget.setSignaling(_activeLedgerId, collab.createLedgerSignal(_activeLedgerId));
    }
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

function openAgentModalForHost(host) {
  return openShareAgentModal(host, {
    getActiveLedgerId: () => _activeLedgerId,
    setActiveLedgerId: (id) => { _activeLedgerId = id; },
    getActiveTarget: () => _activeTarget,
    getWidget: () => _waysideWidget,
    setCachedTargetLedger: (key, val) => _waysideTargetLedgerCache.set(key, val),
    clearRefreshKey: () => { _waysideSocialRefreshKey = null; },
    applyCachedSnapshot: (sheetId) => {
      if (_waysideSnapshotCache.has(sheetId)) {
        applyWaysideSnapshot(host, _waysideSnapshotCache.get(sheetId), true);
      }
    },
    refreshSocial: () => refreshWaysideSocial(host),
  });
}

export {
  LAYOUT_COUNT,
  MODE_GROUPS,
  MODE_NAMES,
  WAYSIDE_URL_RE,
  applyHomeMode,
  endWaysideCall,
  initWayboard,
  renderWayboard,
  resolveLayout,
  sendWaysideChat,
  startCall,
};
