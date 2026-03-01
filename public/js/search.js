/* ============================================================
   search.js — Keyword-based search across known sheets
   ============================================================ */

import { el, showView } from './ui.js';

let resultsEl, summaryEl, noResultsEl;
let onNavigate;         // callback from app.js
let knownSheets = [];   // cached sheet list for context

/* ---------- Public ---------- */

export function init(navigateFn) {
  resultsEl   = document.getElementById('search-results');
  summaryEl   = document.getElementById('search-summary');
  noResultsEl = document.getElementById('no-results');
  onNavigate  = navigateFn;

  const form  = document.getElementById('search-form');
  const input = document.getElementById('search-input');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query) performSearch(query);
  });
}

/**
 * Register sheets the user has browsed (for search context).
 */
export function registerSheets(sheets) {
  knownSheets = sheets;
}

/* ---------- Search execution ---------- */

async function performSearch(query) {
  showView('search');
  window.location.hash = `#/search?q=${encodeURIComponent(query)}`;

  resultsEl.innerHTML = '';
  summaryEl.textContent = 'Searching…';
  noResultsEl.classList.add('hidden');

  try {
    const result = keywordSearch(query);
    renderResults(result);
  } catch (err) {
    summaryEl.textContent = '';
    resultsEl.innerHTML = `<p class="empty-state">Search failed: ${err.message}</p>`;
  }
}

/**
 * Keyword matching across known sheet names.
 */
function keywordSearch(query) {
  const q = query.toLowerCase();
  const matches = knownSheets
    .filter(s => s.name.toLowerCase().includes(q))
    .map(s => ({
      sheetId: s.id,
      sheetName: s.name,
      reason: `Name contains "${query}"`,
    }));

  return {
    matches,
    summary: matches.length
      ? `Found ${matches.length} sheet${matches.length !== 1 ? 's' : ''} matching "${query}".`
      : `No sheets found matching "${query}".`,
  };
}

/* ---------- Rendering ---------- */

function renderResults(result) {
  resultsEl.innerHTML = '';
  summaryEl.textContent = result.summary || '';

  if (!result.matches || result.matches.length === 0) {
    noResultsEl.classList.remove('hidden');
    return;
  }

  noResultsEl.classList.add('hidden');

  for (const match of result.matches) {
    const item = el('div', {
      className: 'sheet-list-item',
      on: {
        click() { onNavigate?.('sheet', match.sheetId, match.sheetName); },
      },
    }, [
      el('span', { className: 'sheet-emoji' }, ['📊']),
      el('div', {}, [
        el('div', { className: 'sheet-list-item-name' }, [match.sheetName]),
        el('div', { className: 'text-muted' }, [match.reason || '']),
      ]),
    ]);
    resultsEl.append(item);
  }
}

/**
 * Trigger search from URL hash (e.g., #/search?q=grocery).
 */
export function searchFromHash(hash) {
  const params = new URLSearchParams(hash.split('?')[1] || '');
  const q = params.get('q');
  if (q) {
    document.getElementById('search-input').value = q;
    performSearch(q);
  }
}
