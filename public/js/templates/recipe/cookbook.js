/* ============================================================
   recipe/cookbook.js — Cookbook directory view

   Sortable, filterable grid of recipe cards. Card DOM is
   built once per entry and reordered on state changes.
   All events are delegated on stable ancestor nodes.
   ============================================================ */

import { el, cell, delegateEvent, buildDirSyncBtn } from '../shared.js';

/**
 * Render a cookbook-style directory view for a folder of recipe sheets.
 *
 * @param {HTMLElement} container — target element
 * @param {{ id: string, name: string, rows: string[][], cols: Object }[]} sheets
 * @param {function} navigateFn — callback(type, id, name)
 */
export function cookbookDirectoryView(container, sheets, navigateFn) {
  // --- Extract metadata once per sheet ---
  const allEntries = sheets.map(s => {
    const firstRow = s.rows[0] || [];
    return {
      id: s.id,
      name: s.name,
      recipe: cell(firstRow, s.cols.text) || s.name,
      servings: cell(firstRow, s.cols.servings),
      prepTime: cell(firstRow, s.cols.prepTime),
      cookTime: cell(firstRow, s.cols.cookTime),
      category: cell(firstRow, s.cols.category),
      difficulty: cell(firstRow, s.cols.difficulty),
      el: null,  // card DOM — built once below
    };
  });

  // --- Pre-build card DOM for every entry (one-time cost) ---
  for (const entry of allEntries) {
    const diffClass = (entry.difficulty || '').toLowerCase().replace(/[^a-z]/g, '');

    const pills = [];
    if (entry.servings) {
      pills.push(el('span', { className: 'cookbook-pill' }, ['\uD83C\uDF7D\uFE0F ' + entry.servings]));
    }
    if (entry.prepTime) {
      pills.push(el('span', { className: 'cookbook-pill' }, ['\u23F1\uFE0F ' + entry.prepTime]));
    }
    if (entry.cookTime) {
      pills.push(el('span', { className: 'cookbook-pill' }, ['\uD83D\uDD25 ' + entry.cookTime]));
    }

    entry.el = el('div', { className: 'cookbook-card' }, [
      el('div', { className: 'cookbook-card-top' }, [
        el('span', { className: 'cookbook-card-name' }, [entry.recipe]),
        entry.difficulty
          ? el('span', { className: `cookbook-card-diff ${diffClass}` }, [entry.difficulty])
          : null,
      ]),
      pills.length > 0
        ? el('div', { className: 'cookbook-card-meta' }, pills)
        : null,
      entry.category
        ? el('div', { className: 'cookbook-card-category' }, [entry.category])
        : null,
    ]);
    entry.el.dataset.entryId = entry.id;
    entry.el.dataset.entryName = entry.name;
  }

  // --- Sort & filter state ---
  let sortKey = 'recipe';
  let sortAsc = true;
  let searchText = '';
  const activeFilters = {
    category: '',
    difficulty: '',
    servings: '',
    prepTime: '',
    cookTime: '',
  };

  const sortOptions = [
    { key: 'recipe', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'difficulty', label: 'Difficulty' },
    { key: 'servings', label: 'Servings' },
    { key: 'prepTime', label: 'Prep Time' },
    { key: 'cookTime', label: 'Cook Time' },
  ];

  const filterColumns = [
    { key: 'category', label: 'Category' },
    { key: 'difficulty', label: 'Difficulty' },
    { key: 'servings', label: 'Servings' },
    { key: 'prepTime', label: 'Prep Time' },
    { key: 'cookTime', label: 'Cook Time' },
  ];

  // Cache unique filter values (immutable for the lifetime of the view)
  const filterOpts = {};
  for (const col of filterColumns) {
    const set = new Set();
    for (const e of allEntries) { if (e[col.key]) set.add(e[col.key]); }
    filterOpts[col.key] = [...set].sort();
  }

  function getFilteredEntries() {
    let list = allEntries;
    const q = searchText.toLowerCase();
    if (q) {
      list = list.filter(e =>
        e.recipe.toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q) ||
        (e.difficulty || '').toLowerCase().includes(q)
      );
    }
    for (const [key, val] of Object.entries(activeFilters)) {
      if (val) list = list.filter(e => e[key] === val);
    }
    return list;
  }

  function sortList(list) {
    return list.slice().sort((a, b) => {
      let va = a[sortKey] || '';
      let vb = b[sortKey] || '';
      if (sortKey === 'servings') {
        const na = parseFloat(va) || 0;
        const nb = parseFloat(vb) || 0;
        return sortAsc ? na - nb : nb - na;
      }
      va = va.toLowerCase();
      vb = vb.toLowerCase();
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  const hasActiveFilters = () =>
    searchText || Object.values(activeFilters).some(v => v);

  // --- Build stable shell (one-time) ---
  const wrapper = el('div', { className: 'cookbook-directory' });

  const countSpan = el('span', { className: 'cookbook-count' });
  wrapper.append(el('div', { className: 'cookbook-title-bar' }, [
    el('span', { className: 'cookbook-title-icon' }, ['\ud83d\udcd6']),
    el('div', { className: 'cookbook-title-group' }, [
      el('span', { className: 'cookbook-title' }, ['Family Cookbook']),
      el('span', { className: 'cookbook-subtitle' }, ['Shared recipes from everyone in the family']),
    ]),
    countSpan,
    buildDirSyncBtn(wrapper),
  ]));

  const grid = el('div', { className: 'cookbook-grid' });
  const emptyMsg = el('p', { className: 'cookbook-empty hidden' });
  for (const entry of allEntries) grid.append(entry.el);
  grid.append(emptyMsg);

  // --- Delegated event handlers on stable ancestors ---
  // Card clicks — one listener covers all cards
  delegateEvent(grid, 'click', '.cookbook-card', (_e, card) => {
    navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
  });
  // Search input (persists through toolbar rebuilds)
  delegateEvent(wrapper, 'input', '.cookbook-search', (_e, input) => {
    searchText = input.value.trim();
    updateView();
  });
  // Sort select
  delegateEvent(wrapper, 'change', '[data-sort-role]', (_e, sel) => {
    if (sortKey === sel.value) {
      sortAsc = !sortAsc;
    } else {
      sortKey = sel.value;
      sortAsc = true;
    }
    updateView();
  });
  // Sort direction toggle
  delegateEvent(wrapper, 'click', '.cookbook-sort-dir', () => {
    sortAsc = !sortAsc;
    updateView();
  });
  // Filter selects
  delegateEvent(wrapper, 'change', '[data-filter-key]', (_e, sel) => {
    activeFilters[sel.dataset.filterKey] = sel.value;
    updateView();
  });
  // Clear all filters
  delegateEvent(wrapper, 'click', '.cookbook-filter-clear', () => {
    searchText = '';
    for (const k of Object.keys(activeFilters)) activeFilters[k] = '';
    updateView();
  });

  // Toolbar slot — rebuilt on state change (lightweight, no listeners)
  wrapper.append(grid);
  container.append(wrapper);

  let toolbarEl = null;

  function buildToolbar() {
    const tb = el('div', { className: 'cookbook-toolbar' });

    // Search (value-only, no listener — delegated on wrapper)
    tb.append(el('input', {
      type: 'text',
      className: 'cookbook-search',
      placeholder: 'Search recipes\u2026',
      value: searchText,
    }));

    // Sort dropdown (no listener — delegated on wrapper)
    const sortSelect = el('select', {
      className: 'cookbook-sort-select',
      title: 'Sort by',
    });
    sortSelect.dataset.sortRole = '';
    for (const opt of sortOptions) {
      const label = opt.label + (sortKey === opt.key ? (sortAsc ? ' \u2191' : ' \u2193') : '');
      const optEl = el('option', { value: opt.key }, [label]);
      if (sortKey === opt.key) optEl.selected = true;
      sortSelect.append(optEl);
    }

    const sortDir = el('button', {
      className: 'cookbook-sort-dir',
      type: 'button',
      title: sortAsc ? 'Ascending' : 'Descending',
    }, [sortAsc ? '\u2191' : '\u2193']);

    tb.append(el('div', { className: 'cookbook-sort-group' }, [sortSelect, sortDir]));

    // Filter dropdowns (no listeners — delegated on wrapper)
    for (const col of filterColumns) {
      const opts = filterOpts[col.key];
      if (opts.length < 2) continue;
      const select = el('select', {
        className: `cookbook-filter-select${activeFilters[col.key] ? ' active' : ''}`,
        title: `Filter by ${col.label}`,
      });
      select.dataset.filterKey = col.key;
      select.append(el('option', { value: '' }, [col.label]));
      for (const opt of opts) {
        const optEl = el('option', { value: opt }, [opt]);
        if (activeFilters[col.key] === opt) optEl.selected = true;
        select.append(optEl);
      }
      tb.append(select);
    }

    // Clear button (only when filters active — no listener, delegated)
    if (hasActiveFilters()) {
      tb.append(el('button', {
        className: 'cookbook-filter-clear',
        type: 'button',
        title: 'Clear all filters',
      }, ['Clear']));
    }

    return tb;
  }

  function updateView() {
    const filtered = sortList(getFilteredEntries());
    const filteredSet = new Set(filtered.map(e => e.id));

    // Update recipe count
    countSpan.textContent = filtered.length === allEntries.length
      ? `${allEntries.length} recipe${allEntries.length !== 1 ? 's' : ''}`
      : `${filtered.length} of ${allEntries.length}`;

    // Rebuild toolbar (small element count, zero listeners — all delegated)
    const newToolbar = buildToolbar();
    if (toolbarEl) {
      toolbarEl.replaceWith(newToolbar);
    } else {
      wrapper.insertBefore(newToolbar, grid);
    }
    toolbarEl = newToolbar;

    // Show / hide cards and reorder (main perf win — no DOM recreation)
    for (const entry of allEntries) {
      entry.el.classList.toggle('hidden', !filteredSet.has(entry.id));
    }
    for (const entry of filtered) {
      grid.append(entry.el);   // moves existing element to sorted position
    }
    grid.append(emptyMsg);    // keep empty message at end

    if (filtered.length === 0) {
      emptyMsg.textContent = hasActiveFilters()
        ? 'No recipes match your filters.'
        : 'No recipes found.';
      emptyMsg.classList.remove('hidden');
    } else {
      emptyMsg.classList.add('hidden');
    }

    // Restore search focus & caret position
    if (searchText) {
      const si = wrapper.querySelector('.cookbook-search');
      if (si) {
        si.focus();
        si.setSelectionRange(si.value.length, si.value.length);
      }
    }
  }

  updateView();
}
