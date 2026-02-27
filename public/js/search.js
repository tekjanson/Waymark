/* ============================================================
   search.js — AI-powered search + keyword fallback
   ============================================================ */

import { api } from './api-client.js';
import { el, showToast, showView } from './ui.js';

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
 * Register sheets the user has browsed (for Gemini context).
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
    // Try AI search first
    const aiAvailable = await api.gemini.isAvailable();
    let result;

    if (aiAvailable) {
      result = await api.gemini.query(query, knownSheets);
    } else {
      // Keyword fallback
      result = keywordSearch(query);
    }

    renderResults(result, !aiAvailable);
  } catch (err) {
    // Fallback to keyword search on AI failure
    try {
      const result = keywordSearch(query);
      renderResults(result, true);
      showToast('AI search unavailable, showing keyword results', 'info');
    } catch (fallbackErr) {
      summaryEl.textContent = '';
      resultsEl.innerHTML = `<p class="empty-state">Search failed: ${err.message}</p>`;
    }
  }
}

/**
 * Simple keyword matching across known sheet names.
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

function renderResults(result, isKeyword = false) {
  resultsEl.innerHTML = '';
  summaryEl.textContent = result.summary || '';

  if (isKeyword) {
    summaryEl.textContent += ' (keyword search)';
  }

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
