/* ============================================================
   templates/linker.js — Community Linker: directory of public
   Waymarks and sub-linkers, navigable card grid with search,
   breadcrumb trail, tag filtering
   ============================================================ */

import { el, cell, editableCell, registerTemplate, delegateEvent, isEditLocked, buildDirSyncBtn } from './shared.js';

/* ---------- Helpers ---------- */

/** Google Sheets ID pattern — 20-60 chars of alphanumeric, hyphen, underscore */
const SHEET_ID_RE = /^[a-zA-Z0-9_-]{20,60}$/;

/** Short Waymark-style ID (e.g. sheet-058) */
const SHORT_ID_RE = /^sheet-\d{1,5}$/;

/**
 * Extract a Google Sheets ID from a cell value.
 * Accepts raw IDs (long or short), full URLs, or Waymark public/sheet URLs.
 * @param {string} raw
 * @returns {string|null}
 */
function extractSheetId(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (SHORT_ID_RE.test(trimmed)) return trimmed;
  if (SHEET_ID_RE.test(trimmed)) return trimmed;
  // Try to extract from Google Sheets URL
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,60})/);
  if (match) return match[1];
  // Try Waymark URL: #/public/{id} or #/sheet/{id}
  const wmMatch = trimmed.match(/#\/(?:public|sheet)\/([a-zA-Z0-9_-]+)/);
  if (wmMatch) return wmMatch[1];
  return null;
}

/**
 * Determine if a type cell indicates a linker (sub-directory).
 * @param {string} val
 * @returns {boolean}
 */
function isLinkerType(val) {
  return /^(linker|directory|hub|group|sub|folder|community)$/i.test((val || '').trim());
}

/** Default icon for entries without one */
const DEFAULT_WAYMARK_ICON = '📄';
const DEFAULT_LINKER_ICON = '📁';

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Community Linker',
  icon: '🔗',
  color: '#7c3aed',
  priority: 22,
  itemNoun: 'Entry',
  defaultHeaders: ['Name', 'Description', 'Link', 'Type', 'Tags', 'Icon'],

  detect(lower) {
    const hasLink = lower.some(h => /^(link|url|sheet|waymark.?link|sheet.?id|public.?link)/.test(h));
    const hasType = lower.some(h => /^(type|kind|entry.?type)/.test(h));
    const hasName = lower.some(h => /^(name|title|community|label)/.test(h));
    return hasLink && hasType && hasName;
  },

  columns(lower) {
    const cols = { name: -1, description: -1, link: -1, type: -1, tags: -1, icon: -1 };
    cols.name        = lower.findIndex(h => /^(name|title|community|label)/.test(h));
    cols.link        = lower.findIndex((h, i) => i !== cols.name && /^(link|url|sheet|waymark.?link|sheet.?id|public.?link)/.test(h));
    cols.type        = lower.findIndex((h, i) => i !== cols.name && i !== cols.link && /^(type|kind|entry.?type)/.test(h));
    cols.description = lower.findIndex((h, i) => i !== cols.name && i !== cols.link && i !== cols.type && /^(description|desc|about|summary|detail)/.test(h));
    cols.tags        = lower.findIndex((h, i) => i !== cols.name && /^(tags?|categor|topic|label|group)/.test(h));
    cols.icon        = lower.findIndex((h, i) => i !== cols.name && /^(icon|emoji|symbol)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'name',        label: 'Name',        colIndex: cols.name,        type: 'text', placeholder: 'Community or sheet name', required: true },
      { role: 'description', label: 'Description',  colIndex: cols.description, type: 'text', placeholder: 'What is this about?' },
      { role: 'link',        label: 'Link',         colIndex: cols.link,        type: 'text', placeholder: 'Sheet ID or URL', required: true },
      { role: 'type',        label: 'Type',         colIndex: cols.type,        type: 'text', placeholder: 'waymark or linker', defaultValue: 'waymark' },
      { role: 'tags',        label: 'Tags',         colIndex: cols.tags,        type: 'text', placeholder: 'cooking, recipes, ...' },
      { role: 'icon',        label: 'Icon',         colIndex: cols.icon,        type: 'text', placeholder: '📄 or 📁' },
    ];
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    /* ---------- Search / Filter Bar ---------- */
    const searchInput = el('input', {
      type: 'text',
      className: 'linker-search',
      placeholder: 'Search entries...',
    });
    container.append(el('div', { className: 'linker-search-bar' }, [searchInput]));

    /* ---------- Card Grid ---------- */
    const grid = el('div', { className: 'linker-grid' });

    const entries = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = cell(row, cols.name);
      if (!name) continue; // skip blank rows

      const rawLink     = cell(row, cols.link);
      const sheetId     = extractSheetId(rawLink);
      const type        = cell(row, cols.type);
      const description = cell(row, cols.description);
      const tags        = cell(row, cols.tags);
      const iconVal     = cell(row, cols.icon);
      const isLinker    = isLinkerType(type);
      const icon        = iconVal || (isLinker ? DEFAULT_LINKER_ICON : DEFAULT_WAYMARK_ICON);
      const rowIdx      = i + 1; // 1-based for editing

      const tagList = tags ? tags.split(/[,;]+/).map(t => t.trim()).filter(Boolean) : [];

      const cardChildren = [
        el('div', { className: 'linker-card-header' }, [
          el('span', { className: 'linker-card-icon' }, [icon]),
          el('span', { className: `linker-card-type ${isLinker ? 'linker-type-directory' : 'linker-type-waymark'}` }, [
            isLinker ? 'Directory' : 'Waymark',
          ]),
        ]),
      ];

      // Name — editable in auth mode
      if (isEditLocked()) {
        cardChildren.push(el('div', { className: 'linker-card-name' }, [name]));
      } else {
        cardChildren.push(editableCell('div', { className: 'linker-card-name' }, name, rowIdx, cols.name));
      }

      // Description
      if (description || !isEditLocked()) {
        if (isEditLocked()) {
          if (description) cardChildren.push(el('div', { className: 'linker-card-desc' }, [description]));
        } else {
          cardChildren.push(editableCell('div', { className: 'linker-card-desc' }, description || '', rowIdx, cols.description));
        }
      }

      // Tags
      if (tagList.length > 0) {
        cardChildren.push(el('div', { className: 'linker-card-tags' },
          tagList.map(t => el('span', { className: 'linker-tag' }, [t]))
        ));
      }

      // Invalid link warning
      if (!sheetId && rawLink) {
        cardChildren.push(el('div', { className: 'linker-card-warning' }, ['⚠ Invalid link']));
      }

      const card = el('div', {
        className: `linker-card${!sheetId ? ' linker-card-invalid' : ''}`,
        dataset: { sheetId: sheetId || '', isLinker: isLinker ? '1' : '0', entryName: name },
      }, cardChildren);

      grid.append(card);
      entries.push({ name, description, tags, card });
    }

    container.append(grid);

    /* ---------- Empty State ---------- */
    if (entries.length === 0) {
      grid.append(el('p', { className: 'empty-state' }, ['No entries in this directory.']));
    }

    /* ---------- Search Filter ---------- */
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      let visible = 0;
      for (const entry of entries) {
        const text = `${entry.name} ${entry.description} ${entry.tags}`.toLowerCase();
        const show = !query || text.includes(query);
        entry.card.classList.toggle('hidden', !show);
        if (show) visible++;
      }
      // Show/hide empty state for filtered results
      const emptyEl = grid.querySelector('.linker-empty-filter');
      if (visible === 0 && query) {
        if (!emptyEl) {
          grid.append(el('p', { className: 'empty-state linker-empty-filter' }, [`No entries matching "${query}".`]));
        }
      } else if (emptyEl) {
        emptyEl.remove();
      }
    });

    /* ---------- Card Click Navigation ---------- */
    delegateEvent(grid, 'click', '.linker-card', (e, card) => {
      // Don't navigate if user clicked an editable cell
      if (e.target.closest('[contenteditable]')) return;
      const sheetId = card.dataset.sheetId;
      if (!sheetId) return;
      // Navigate to the linked sheet
      const base = window.__WAYMARK_BASE || '';
      if (document.body.classList.contains('waymark-public')) {
        window.location.hash = `${base}#/public/${sheetId}`;
      } else {
        window.location.hash = `${base}#/sheet/${sheetId}`;
      }
    });
  },
};

/* ---------- Directory View ---------- */

definition.directoryView = function(container, sheets, navigateFn) {
  const wrapper = el('div', { className: 'linker-directory tmpl-directory' });
  wrapper.append(el('div', { className: 'linker-dir-title-bar tmpl-dir-title-bar' }, [
    el('span', { className: 'linker-dir-icon tmpl-dir-icon' }, ['🔗']),
    el('span', { className: 'linker-dir-title tmpl-dir-title' }, ['Community Linkers']),
    el('span', { className: 'linker-dir-count tmpl-dir-count' }, [
      `${sheets.length} linker${sheets.length !== 1 ? 's' : ''}`,
    ]),
    buildDirSyncBtn(wrapper),
  ]));

  const grid = el('div', { className: 'linker-dir-grid tmpl-dir-grid' });
  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    grid.append(el('div', {
      className: 'linker-dir-card tmpl-dir-card',
      dataset: { entryId: sheet.id, entryName: sheet.name },
    }, [
      el('div', { className: 'linker-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
      el('div', { className: 'linker-dir-card-stat tmpl-dir-card-stat' }, [
        `${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'}`,
      ]),
    ]));
  }

  delegateEvent(grid, 'click', '.linker-dir-card', (_e, card) => {
    navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
  });

  wrapper.append(grid);
  container.append(wrapper);
};

registerTemplate('linker', definition);
export default definition;
