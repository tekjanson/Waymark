/* ============================================================
   party/index.js — Party Planning Dashboard (barrel)

   A collaborative, single-page party planning dashboard rendered from a
   MULTI-TAB Google Sheets workbook. Each planning category is its own tab
   (Guests, Menu, Budget, Decorations, Links) so the backend data stays
   clean and human-editable. The Details tab drives the hero header and is
   what template detection matches on.

   Everything is clickable and editable inline; sections show a per-category
   percent-complete bar and can be rearranged (drag or ▲▼) with the order
   persisted to an internal Layout tab. External tools (Amazon registries,
   Pinterest boards, playlists…) live in the Links tab and render as chips.

   All edits persist per-tab via writeSheetTab — the correct primitive for a
   multi-tab workbook.
   ============================================================ */

import {
  el, showToast, registerTemplate, writeSheetTab, readSheetTab,
} from '../shared.js';
import {
  CATEGORIES, CATEGORY_KEYS, categoryByKey,
  META_TAB, LINKS_TAB, LAYOUT_TAB, META_HEADER,
  metaFromValues, metaToValues,
  rowsFromTab, tabValues,
  linksFromTab, linksToValues,
  layoutFromTab, layoutToValues, resolveOrder,
} from './helpers.js';
import { buildHero, buildCategoryCard, buildLinksCard } from './cards.js';
import { openItemModal, openLinkModal, openMetaModal } from './modal.js';

/* ---------- Module state ---------- */

let _container = null;
let _tabs = [];
let _meta = {};
let _catRows = {};       // key → string[][]
let _links = [];         // { label, url, type }[]
let _order = [];         // section keys in display order
let _collapsed = new Set();

/** Extract the current sheet id from the route hash. */
function currentSheetId() {
  const m = (window.location.hash || '').match(/#\/(?:sheet|public)\/([^/?#]+)/);
  return m ? m[1] : null;
}

/* ---------- Persistence (per tab) ---------- */

async function persistTab(tabTitle, values) {
  const sid = currentSheetId();
  if (!sid) return;
  try {
    await writeSheetTab(sid, tabTitle, values);
    // Keep the in-memory tab snapshot fresh so a reload reflects the write.
    const existing = readSheetTab(_tabs, tabTitle);
    if (existing) existing.values = values;
    else _tabs = [..._tabs, { title: tabTitle, numericSheetId: -1, values }];
  } catch (err) {
    showToast(err.message || `Could not save ${tabTitle}`, 'error');
  }
}

function persistCategory(key) {
  const cat = categoryByKey(key);
  if (cat) persistTab(cat.tab, tabValues(cat, _catRows[key] || []));
}

function persistLinks() {
  persistTab(LINKS_TAB, linksToValues(_links));
}

function persistLayout() {
  persistTab(LAYOUT_TAB, layoutToValues(_order, _collapsed));
}

function persistMeta() {
  persistTab(META_TAB, metaToValues(_meta));
}

/* ---------- Handlers ---------- */

const handlers = {
  editMeta() {
    openMetaModal(_meta, (m) => { _meta = m; rerender(); persistMeta(); });
  },

  toggleCollapse(key) {
    if (_collapsed.has(key)) _collapsed.delete(key);
    else _collapsed.add(key);
    rerender();
    persistLayout();
  },

  moveSection(key, dir) {
    const i = _order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= _order.length) return;
    [_order[i], _order[j]] = [_order[j], _order[i]];
    rerender();
    persistLayout();
  },

  reorder(fromKey, toKey) {
    const from = _order.indexOf(fromKey);
    const to = _order.indexOf(toKey);
    if (from < 0 || to < 0 || from === to) return;
    _order.splice(from, 1);
    _order.splice(_order.indexOf(toKey) + (from < to ? 1 : 0), 0, fromKey);
    rerender();
    persistLayout();
  },

  inlineEdit(catKey, rowIdx, col, value) {
    const rows = _catRows[catKey];
    if (!rows || !rows[rowIdx]) return;
    rows[rowIdx][col] = value;
    rerender();
    persistCategory(catKey);
  },

  addItem(catKey) {
    const cat = categoryByKey(catKey);
    if (!cat) return;
    const blank = cat.header.map(() => '');
    openItemModal(cat, blank, true, (row) => {
      _catRows[catKey] = (_catRows[catKey] || []).concat([row]);
      _collapsed.delete(catKey);
      rerender();
      persistCategory(catKey);
    });
  },

  deleteItem(catKey, rowIdx) {
    const rows = _catRows[catKey];
    if (!rows || !rows[rowIdx]) return;
    rows.splice(rowIdx, 1);
    rerender();
    persistCategory(catKey);
  },

  addLink() {
    openLinkModal({ label: '', url: '', type: 'Registry' }, true, (link) => {
      _links = _links.concat([link]);
      _collapsed.delete('links');
      rerender();
      persistLinks();
    });
  },

  openLink(idx) {
    const link = _links[idx];
    if (!link) return;
    openLinkModal(link, false,
      (updated) => { _links[idx] = updated; rerender(); persistLinks(); },
      () => { _links.splice(idx, 1); rerender(); persistLinks(); },
    );
  },
};

/* ---------- Overall readiness ---------- */

/** Aggregate completion across the four planning categories. */
function overallProgress() {
  let done = 0, total = 0;
  for (const cat of CATEGORIES) {
    const p = cat.progress(_catRows[cat.key] || []);
    done += p.done;
    total += p.total;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/* ---------- Render ---------- */

function buildContext() {
  return {
    meta: _meta,
    links: _links,
    collapsed: _collapsed,
    order: _order,
    overall: overallProgress(),
    handlers,
  };
}

/** Render (or re-render) the whole dashboard into the container. */
function rerender() {
  if (!_container) return;
  _container.innerHTML = '';
  const ctx = buildContext();
  const root = el('div', { className: 'party-root' });

  root.append(buildHero(ctx));

  const board = el('div', { className: 'party-board' });
  for (const key of _order) {
    if (key === 'links') {
      board.append(buildLinksCard(ctx, _links));
    } else {
      const cat = categoryByKey(key);
      if (cat) board.append(buildCategoryCard(ctx, cat, _catRows[key] || []));
    }
  }
  root.append(board);
  _container.append(root);
}

/* ---------- Load state from workbook tabs ---------- */

function loadFromTabs() {
  // Meta comes from the Details tab (the detected primary tab).
  const detailsTab = readSheetTab(_tabs, META_TAB) || (_tabs[0] || null);
  _meta = metaFromValues(detailsTab ? detailsTab.values : []);

  // Each category reads its own tab (missing tabs → empty, so it's configurable).
  _catRows = {};
  for (const cat of CATEGORIES) {
    const tab = readSheetTab(_tabs, cat.tab);
    _catRows[cat.key] = rowsFromTab(cat, tab ? tab.values : null);
  }

  // External tool links.
  const linksTab = readSheetTab(_tabs, LINKS_TAB);
  _links = linksFromTab(linksTab ? linksTab.values : null);

  // Layout (section order + collapsed state).
  const layoutTab = readSheetTab(_tabs, LAYOUT_TAB);
  const layout = layoutFromTab(layoutTab ? layoutTab.values : null);
  _order = resolveOrder(layout.order);
  _collapsed = new Set(layout.collapsed.filter(k => _order.includes(k)));
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Party Planning Dashboard',
  icon: '🎉',
  color: '#db2777',
  priority: 24,
  itemNoun: 'Detail',
  noAutoRefresh: true,
  defaultHeaders: META_HEADER,

  detect(lower) {
    const has = (re) => lower.some(h => re.test(h));
    return has(/guest of honor/) && has(/theme/) && (has(/^party$/) || has(/^party\b/) || has(/venue/) || has(/host/));
  },

  columns(lower) {
    const cols = { party: -1, guestOfHonor: -1, date: -1, theme: -1, venue: -1, host: -1 };
    cols.party = lower.findIndex(h => /^party$/.test(h) || /^party name$/.test(h));
    cols.guestOfHonor = lower.findIndex(h => /guest of honor/.test(h));
    cols.date = lower.findIndex(h => /^date$/.test(h) || /party date/.test(h));
    cols.theme = lower.findIndex(h => /theme/.test(h));
    cols.venue = lower.findIndex(h => /venue|location/.test(h));
    cols.host = lower.findIndex(h => /host|organizer|planner/.test(h));
    return cols;
  },

  render(container, rows, cols, template) {
    _container = container;
    _tabs = Array.isArray(template && template._tabs) ? template._tabs : [];
    loadFromTabs();
    container.innerHTML = '';
    rerender();
  },
};

registerTemplate('party', definition);
export default definition;
