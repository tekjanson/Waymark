/* ============================================================
   knowledge/index.js — Knowledge Base template (barrel)

   Features: article cards grouped by category, tag filtering,
   search, status badges, expandable content, directory view
   for multi-sheet browsing.
   ============================================================ */

import {
  el, cell, emitEdit, registerTemplate, editableCell,
  parseGroups, delegateEvent,
} from '../shared.js';
import {
  classifyStatus, STATUS_COLORS, STATUS_LABELS,
  parseTags, collectTags, collectCategories,
  buildSnippet, formatDate,
} from './helpers.js';

/* ---------- Module state ---------- */

let _activeCategory = null;
let _activeTag = null;
let _searchQuery = '';
let _expandedArticles = new Set();

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Knowledge Base',
  icon: '📚',
  color: '#6366f1',
  priority: 18,
  itemNoun: 'Article',
  defaultHeaders: ['Title', 'Category', 'Content', 'Tags', 'Author', 'Updated', 'Status', 'Source'],

  detect(lower) {
    const hasKnowledge = lower.some(h =>
      /^(knowledge|wiki|article|documentation|doc|faq|guide|kb)/.test(h)
      || /knowledge.?base|help.?center/i.test(h),
    );
    const hasContent = lower.some(h =>
      /^(content|body|text|answer|detail|description|article)/.test(h),
    );
    const hasCategory = lower.some(h =>
      /^(category|section|topic|subject|area|domain|group)/.test(h),
    );
    // Need either a strong knowledge signal or content+category together
    // with a title/article column
    const hasTitle = lower.some(h =>
      /^(title|article|topic|question|subject|entry|name|heading)/.test(h),
    );
    return (hasKnowledge && (hasContent || hasTitle))
      || (hasTitle && hasContent && hasCategory);
  },

  columns(lower) {
    const cols = {
      title: -1, category: -1, content: -1, tags: -1,
      author: -1, updated: -1, status: -1, source: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.title    = lower.findIndex(h => /^(title|article|topic|question|subject|entry|heading|knowledge|wiki|faq)/.test(h));
    if (cols.title === -1) cols.title = lower.findIndex((h, i) => !used().includes(i) && /^(name|item)/.test(h));
    cols.category = lower.findIndex((h, i) => !used().includes(i) && /^(category|section|topic|subject|area|domain|group)/.test(h));
    cols.content  = lower.findIndex((h, i) => !used().includes(i) && /^(content|body|text|answer|detail|description|info|note)/.test(h));
    cols.tags     = lower.findIndex((h, i) => !used().includes(i) && /^(tag|keyword|label)/.test(h));
    cols.author   = lower.findIndex((h, i) => !used().includes(i) && /^(author|writer|created.?by|owner|contributor)/.test(h));
    cols.updated  = lower.findIndex((h, i) => !used().includes(i) && /^(updated|modified|date|last.?edit|changed)/.test(h));
    cols.status   = lower.findIndex((h, i) => !used().includes(i) && /^(status|state|publish|stage)/.test(h));
    cols.source   = lower.findIndex((h, i) => !used().includes(i) && /^(source|url|link|reference|ref)/.test(h));

    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'title',    label: 'Title',    colIndex: cols.title,    type: 'text', placeholder: 'Article title', required: true },
      { role: 'category', label: 'Category', colIndex: cols.category, type: 'combo', placeholder: 'Select or type…' },
      { role: 'content',  label: 'Content',  colIndex: cols.content,  type: 'textarea', placeholder: 'Article content' },
      { role: 'tags',     label: 'Tags',     colIndex: cols.tags,     type: 'text', placeholder: 'tag1, tag2, …' },
      { role: 'author',   label: 'Author',   colIndex: cols.author,   type: 'combo', placeholder: 'Author name' },
      { role: 'status',   label: 'Status',   colIndex: cols.status,   type: 'select', options: ['Draft', 'Published', 'In Review', 'Archived'], defaultValue: 'Draft' },
      { role: 'source',   label: 'Source',    colIndex: cols.source,   type: 'text', placeholder: 'URL or reference' },
    ];
  },

  /* ---------- Directory View ---------- */

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'knowledge-directory' });

    const titleBar = el('div', { className: 'knowledge-dir-title-bar' });
    titleBar.append(
      el('span', { className: 'knowledge-dir-title-icon' }, ['📚']),
      el('span', { className: 'knowledge-dir-title' }, ['Knowledge Bases']),
      el('span', { className: 'knowledge-dir-count' }, [
        `${sheets.length} source${sheets.length !== 1 ? 's' : ''}`,
      ]),
    );
    wrapper.append(titleBar);

    const grid = el('div', { className: 'knowledge-dir-grid' });

    for (const sheet of sheets) {
      const cols = sheet.cols;
      const rows = sheet.rows || [];
      const groups = parseGroups(rows, cols.title);

      /* Count by category and status */
      const catCounts = {};
      const statusCounts = { published: 0, draft: 0, review: 0, archived: 0 };
      for (const g of groups) {
        const cat = cols.category >= 0 ? (g.row[cols.category] || '').trim() : 'Uncategorized';
        catCounts[cat || 'Uncategorized'] = (catCounts[cat || 'Uncategorized'] || 0) + 1;
        const st = cols.status >= 0 ? classifyStatus(g.row[cols.status]) : 'draft';
        statusCounts[st]++;
      }

      const card = el('div', {
        className: 'knowledge-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      });

      const header = el('div', { className: 'knowledge-dir-card-header' });
      header.append(
        el('span', { className: 'knowledge-dir-card-name' }, [sheet.name]),
        el('span', { className: 'knowledge-dir-card-count' }, [
          `${groups.length} article${groups.length !== 1 ? 's' : ''}`,
        ]),
      );
      card.append(header);

      /* Status summary */
      const statusRow = el('div', { className: 'knowledge-dir-status-row' });
      for (const [key, label] of Object.entries(STATUS_LABELS)) {
        const count = statusCounts[key] || 0;
        if (count === 0) continue;
        statusRow.append(el('span', {
          className: `knowledge-dir-status-badge knowledge-status-${key}`,
        }, [`${label}: ${count}`]));
      }
      card.append(statusRow);

      /* Category list */
      const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
      if (catEntries.length > 0) {
        const catSection = el('div', { className: 'knowledge-dir-categories' });
        for (const [cat, count] of catEntries.slice(0, 5)) {
          catSection.append(el('span', { className: 'knowledge-dir-cat-item' }, [
            el('span', { className: 'knowledge-dir-cat-dot' }),
            `${cat} (${count})`,
          ]));
        }
        if (catEntries.length > 5) {
          catSection.append(el('span', { className: 'knowledge-dir-cat-more' }, [
            `+${catEntries.length - 5} more`,
          ]));
        }
        card.append(catSection);
      }

      grid.append(card);
    }

    delegateEvent(grid, 'click', '.knowledge-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },

  /* ---------- Main render ---------- */

  render(container, rows, cols) {
    const groups = parseGroups(rows, cols.title);

    const allCategories = collectCategories(groups, cols.category);
    const allTags = collectTags(groups, cols.tags);

    /* ---- Toolbar ---- */
    const toolbar = el('div', { className: 'knowledge-toolbar' });

    /* Search */
    const searchWrap = el('div', { className: 'knowledge-search-wrap' });
    const searchInput = el('input', {
      type: 'text',
      className: 'knowledge-search',
      placeholder: 'Search articles…',
      value: _searchQuery,
    });
    searchInput.addEventListener('input', () => {
      _searchQuery = searchInput.value.toLowerCase().trim();
      updateView();
    });
    searchWrap.append(searchInput);
    toolbar.append(searchWrap);

    /* Category filter pills */
    if (allCategories.length > 0) {
      const catBar = el('div', { className: 'knowledge-cat-bar' });
      catBar.append(el('button', {
        className: `knowledge-cat-pill ${!_activeCategory ? 'active' : ''}`,
        dataset: { category: '' },
      }, ['All']));
      for (const cat of allCategories) {
        catBar.append(el('button', {
          className: `knowledge-cat-pill ${_activeCategory === cat ? 'active' : ''}`,
          dataset: { category: cat },
        }, [cat]));
      }
      delegateEvent(catBar, 'click', '.knowledge-cat-pill', (_e, pill) => {
        _activeCategory = pill.dataset.category || null;
        catBar.querySelectorAll('.knowledge-cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        updateView();
      });
      toolbar.append(catBar);
    }

    /* Tag filter pills */
    if (allTags.length > 0) {
      const tagBar = el('div', { className: 'knowledge-tag-bar' });
      tagBar.append(el('span', { className: 'knowledge-tag-label' }, ['Tags:']));
      for (const tag of allTags) {
        tagBar.append(el('button', {
          className: `knowledge-tag-pill ${_activeTag === tag ? 'active' : ''}`,
          dataset: { tag },
        }, [tag]));
      }
      delegateEvent(tagBar, 'click', '.knowledge-tag-pill', (_e, pill) => {
        const t = pill.dataset.tag;
        _activeTag = _activeTag === t ? null : t;
        tagBar.querySelectorAll('.knowledge-tag-pill').forEach(p => p.classList.remove('active'));
        if (_activeTag) pill.classList.add('active');
        updateView();
      });
      toolbar.append(tagBar);
    }

    container.append(toolbar);

    /* ---- Article list ---- */
    const listEl = el('div', { className: 'knowledge-list' });
    container.append(listEl);

    function updateView() {
      listEl.innerHTML = '';

      const filtered = groups.filter(g => {
        const title = cell(g.row, cols.title).toLowerCase();
        const cat = cols.category >= 0 ? cell(g.row, cols.category).trim() : '';
        const tags = cols.tags >= 0 ? parseTags(cell(g.row, cols.tags)) : [];
        const contentText = g.children
          .map(c => (cols.content >= 0 ? (c.row[cols.content] || '') : '').toLowerCase())
          .join(' ');

        if (_activeCategory && cat !== _activeCategory) return false;
        if (_activeTag && !tags.some(t => t.toLowerCase() === _activeTag.toLowerCase())) return false;
        if (_searchQuery) {
          const haystack = `${title} ${cat} ${tags.join(' ')} ${contentText}`.toLowerCase();
          if (!haystack.includes(_searchQuery)) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        listEl.append(el('div', { className: 'knowledge-empty' }, ['No articles match the current filters.']));
        return;
      }

      /* Group by category */
      const byCat = new Map();
      for (const g of filtered) {
        const cat = cols.category >= 0 ? (cell(g.row, cols.category).trim() || 'Uncategorized') : 'Uncategorized';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(g);
      }

      for (const [cat, articles] of byCat) {
        const section = el('div', { className: 'knowledge-section' });
        section.append(el('div', { className: 'knowledge-section-header' }, [
          el('span', { className: 'knowledge-section-title' }, [cat]),
          el('span', { className: 'knowledge-section-count' }, [`${articles.length}`]),
        ]));

        for (const group of articles) {
          const rowIdx = group.idx + 1;
          const titleText = cell(group.row, cols.title);
          const statusVal = cols.status >= 0 ? cell(group.row, cols.status) : '';
          const statusKey = classifyStatus(statusVal);
          const author = cols.author >= 0 ? cell(group.row, cols.author) : '';
          const updated = cols.updated >= 0 ? cell(group.row, cols.updated) : '';
          const tags = cols.tags >= 0 ? parseTags(cell(group.row, cols.tags)) : [];
          const source = cols.source >= 0 ? cell(group.row, cols.source) : '';
          const isExpanded = _expandedArticles.has(rowIdx);

          const card = el('div', {
            className: `knowledge-card ${isExpanded ? 'knowledge-card-expanded' : ''}`,
            dataset: { rowIdx: String(rowIdx) },
          });

          /* Card header */
          const cardHeader = el('div', { className: 'knowledge-card-header' });

          const expandBtn = el('button', { className: 'knowledge-expand-btn' }, [
            isExpanded ? '▾' : '▸',
          ]);

          const titleEl = editableCell('span', { className: 'knowledge-card-title' },
            titleText, rowIdx, cols.title);

          const statusBadge = el('span', {
            className: `knowledge-status-badge knowledge-status-${statusKey}`,
          }, [STATUS_LABELS[statusKey]]);

          cardHeader.append(expandBtn, titleEl, statusBadge);
          card.append(cardHeader);

          /* Meta row */
          const meta = el('div', { className: 'knowledge-card-meta' });
          if (author) {
            meta.append(el('span', { className: 'knowledge-meta-author' }, [`✍ ${author}`]));
          }
          if (updated) {
            meta.append(el('span', { className: 'knowledge-meta-date' }, [
              `📅 ${formatDate(updated)}`,
            ]));
          }
          if (source) {
            const sourceEl = el('a', {
              className: 'knowledge-meta-source',
              href: source.startsWith('http') ? source : '#',
              target: '_blank',
              rel: 'noopener noreferrer',
            }, ['🔗 Source']);
            meta.append(sourceEl);
          }
          if (tags.length > 0) {
            const tagWrap = el('span', { className: 'knowledge-card-tags' });
            for (const t of tags) {
              tagWrap.append(el('span', { className: 'knowledge-tag' }, [t]));
            }
            meta.append(tagWrap);
          }
          card.append(meta);

          /* Snippet (shown when collapsed) */
          if (!isExpanded && cols.content >= 0 && group.children.length > 0) {
            const snippet = buildSnippet(group.children, cols.content);
            if (snippet) {
              card.append(el('div', { className: 'knowledge-card-snippet' }, [snippet]));
            }
          }

          /* Expanded content */
          if (isExpanded && cols.content >= 0 && group.children.length > 0) {
            const contentSection = el('div', { className: 'knowledge-card-content' });
            for (const child of group.children) {
              const contentText = cell(child.row, cols.content);
              if (contentText) {
                const contentRowIdx = child.idx + 1;
                contentSection.append(
                  editableCell('p', { className: 'knowledge-content-line' },
                    contentText, contentRowIdx, cols.content),
                );
              }
            }
            card.append(contentSection);
          }

          section.append(card);
        }

        listEl.append(section);
      }
    }

    /* Delegated expand/collapse */
    delegateEvent(listEl, 'click', '.knowledge-expand-btn', (_e, btn) => {
      const card = btn.closest('.knowledge-card');
      if (!card) return;
      const rowIdx = Number(card.dataset.rowIdx);
      if (_expandedArticles.has(rowIdx)) {
        _expandedArticles.delete(rowIdx);
      } else {
        _expandedArticles.add(rowIdx);
      }
      updateView();
    });

    /* Delegated status badge click → cycle */
    delegateEvent(listEl, 'click', '.knowledge-status-badge', (_e, badge) => {
      const card = badge.closest('.knowledge-card');
      if (!card) return;
      const rowIdx = Number(card.dataset.rowIdx);
      if (!rowIdx || cols.status < 0) return;

      const states = ['Draft', 'In Review', 'Published', 'Archived'];
      const current = badge.textContent.trim();
      const idx = states.indexOf(current);
      const next = states[(idx + 1) % states.length];
      const nextKey = classifyStatus(next);

      badge.textContent = STATUS_LABELS[nextKey];
      badge.className = `knowledge-status-badge knowledge-status-${nextKey}`;
      emitEdit(rowIdx, cols.status, next);
    });

    updateView();
  },
};

registerTemplate('knowledge', definition);
export default definition;
