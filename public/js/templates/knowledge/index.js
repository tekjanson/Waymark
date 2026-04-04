/* ============================================================
   knowledge/index.js — Knowledge Base template (barrel)

   Features: article cards grouped by category, tag filtering,
   search, status badges, expandable content, directory view
   for multi-sheet browsing.
   ============================================================ */

import {
  el, cell, emitEdit, registerTemplate, editableCell,
  parseGroups, delegateEvent, getUserName,
  buildDirSyncBtn, getSheetData, appendSheetRows, createSpreadsheet,
} from '../shared.js';
import {
  classifyStatus, STATUS_COLORS, STATUS_LABELS,
  parseTags, collectTags, collectCategories,
  buildSnippet, formatDate, nowTimestamp, REACTION_EMOJIS,
} from './helpers.js';

/* ---------- Module state ---------- */

let _activeCategory = null;
let _activeTag = null;
let _searchQuery = '';
let _expandedArticles = new Set();

/* ---------- Lazy-loaded comments state ---------- */

/** Cache: sheetId → {values, sheetTitle} | null (failed) */
const _commentsCache = new Map();
/** Set of sheetIds currently being fetched */
const _commentsLoading = new Set();
/** Called after a comments fetch completes to trigger re-render */
let _refreshFn = null;

async function _loadComments(sheetId) {
  if (_commentsCache.has(sheetId) || _commentsLoading.has(sheetId)) return;
  _commentsLoading.add(sheetId);
  try {
    const data = await getSheetData(sheetId);
    _commentsCache.set(sheetId, data);
  } catch {
    _commentsCache.set(sheetId, null);
  } finally {
    _commentsLoading.delete(sheetId);
    if (_refreshFn) _refreshFn();
  }
}

/**
 * Auto-create a per-article comments spreadsheet.
 * Returns the newly created spreadsheetId.
 * @param {string} articleTitle
 * @returns {Promise<string>}
 */
async function _createCommentsSheet(articleTitle) {
  const title = `Comments – ${articleTitle}`;
  const result = await createSpreadsheet(title, [['Author', 'Comment', 'Date']]);
  return result.spreadsheetId;
}

/**
 * Extract a bare Google Sheet ID from a URL or raw ID string.
 * Handles: full Sheets URLs, Waymark viewer URLs (#/sheet/{id}), and raw IDs.
 */
function extractSheetId(val) {
  if (!val || typeof val !== 'string') return null;
  const clean = val.trim();
  const urlMatch = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  if (urlMatch) return urlMatch[1];
  const viewerMatch = clean.match(/[#?/]sheet[/=]([a-zA-Z0-9_-]{4,})/);
  if (viewerMatch) return viewerMatch[1];
  if (/^[a-zA-Z0-9_-]{4,}$/.test(clean)) return clean;
  return null;
}

/* ---------- External comments renderer ---------- */

/**
 * Render comments loaded from a separate Google Sheet into `container`.
 * @param {Element} container
 * @param {{values: string[][], sheetTitle: string}} sheetData
 * @param {string} sheetId  — used for the "post comment" flow
 */
function _renderExternalComments(container, sheetData, sheetId) {
  const values = sheetData.values || [];
  if (values.length < 2) {
    container.append(el('div', { className: 'knowledge-no-comments' }, ['No comments yet.']));
    buildExternalCommentForm(container, sheetData, sheetId);
    return;
  }

  const headerRow = values[0].map(h => (h || '').toLowerCase().trim());
  const authorIdx = headerRow.findIndex(h => /^(author|name|by|user)/.test(h));
  const textIdx   = headerRow.findIndex(h => /^(comment|text|content|message|body)/.test(h));
  const dateIdx   = headerRow.findIndex(h => /^(date|time|created|when|timestamp)/.test(h));

  const rows = values.slice(1).filter(r => r.some(c => (c || '').trim()));

  for (const row of rows) {
    const author = authorIdx >= 0 ? (row[authorIdx] || '').trim() : '';
    const text   = textIdx   >= 0 ? (row[textIdx]   || '').trim() : '';
    const date   = dateIdx   >= 0 ? (row[dateIdx]   || '').trim() : '';
    if (!text) continue;

    const commentEl = el('div', { className: 'knowledge-comment' });
    commentEl.append(
      el('div', { className: 'knowledge-comment-header' }, [
        ...(author ? [el('span', { className: 'knowledge-comment-author' }, [author])] : []),
        ...(date   ? [el('span', { className: 'knowledge-comment-date' }, [formatDate(date)])] : []),
      ]),
      el('div', { className: 'knowledge-comment-text' }, [text]),
    );
    container.append(commentEl);
  }

  buildExternalCommentForm(container, sheetData, sheetId);
}

function buildExternalCommentForm(container, sheetData, sheetId) {
  const addCommentTrigger = el('button', { className: 'knowledge-add-comment-trigger' }, ['+ Comment']);
  const addCommentForm = el('div', { className: 'knowledge-add-comment-form hidden' });
  const commentInput = el('input', {
    type: 'text', className: 'knowledge-add-comment-input', placeholder: 'Add a comment…',
  });
  const commentName = el('input', {
    type: 'text', className: 'knowledge-add-comment-name', placeholder: 'Your name',
    value: getUserName(),
  });
  const commentSubmit = el('button', { className: 'knowledge-add-comment-btn' }, ['Post']);
  addCommentForm.append(commentInput, commentName, commentSubmit);

  addCommentTrigger.addEventListener('click', () => {
    addCommentForm.classList.toggle('hidden');
    if (!addCommentForm.classList.contains('hidden')) commentInput.focus();
  });

  async function submitExternalComment() {
    const text = commentInput.value.trim();
    const name = (commentName.value.trim()) || 'Anonymous';
    if (!text) return;
    try {
      await appendSheetRows(sheetId, sheetData.sheetTitle || 'Sheet1', [[name, text, nowTimestamp()]]);
      commentInput.value = '';
      _commentsCache.delete(sheetId);
      _loadComments(sheetId);
    } catch { /* silent — form stays open */ }
  }
  commentSubmit.addEventListener('click', submitExternalComment);
  commentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitExternalComment(); });

  container.append(addCommentTrigger, addCommentForm);
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Knowledge Base',
  icon: '📚',
  color: '#6366f1',
  priority: 18,
  itemNoun: 'Article',
  defaultHeaders: ['Title', 'Category', 'Content', 'Tags', 'Author', 'Updated', 'Status', 'Source'],

  migrations: [
    { role: 'comments', header: 'Comments Sheet', description: 'Google Sheet ID for per-article comments (separate sharing)' },
  ],

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
      author: -1, updated: -1, status: -1, source: -1, comments: -1,
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
    cols.comments = lower.findIndex((h, i) => !used().includes(i) && /^(comments?[_\s]?sheet|thread[_\s]?id|discussion[_\s]?sheet|replies[_\s]?sheet|feedback[_\s]?sheet)/.test(h));

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
      { role: 'source',   label: 'Source',   colIndex: cols.source,   type: 'text', placeholder: 'URL or reference' },
      { role: 'comments', label: 'Comments Sheet', colIndex: cols.comments, type: 'text', placeholder: 'Google Sheet ID for comments (optional)' },
    ].filter(f => f.colIndex >= 0 || ['title', 'category', 'content', 'tags', 'author', 'status', 'source'].includes(f.role));
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
      buildDirSyncBtn(wrapper),
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

  render(container, rows, cols, template) {
    const groups = parseGroups(rows, cols.title);

    /* Expose updateView to the lazy-load callback */
    _refreshFn = () => updateView();

    /* Split each group's children into contentLines, comments, and reactions */
    for (const group of groups) {
      group.contentLines = [];
      group.comments = [];
      group.reactions = [];
      for (const child of group.children) {
        const authorVal = cols.author >= 0 ? (child.row[cols.author] || '').trim() : '';
        const contentVal = cols.content >= 0 ? (child.row[cols.content] || '').trim() : '';
        if (REACTION_EMOJIS.includes(contentVal) && authorVal) {
          group.reactions.push({ emoji: contentVal, author: authorVal, idx: child.idx });
        } else if (authorVal) {
          group.comments.push({ text: contentVal, author: authorVal, idx: child.idx, row: child.row });
        } else if (contentVal) {
          group.contentLines.push(child);
        }
      }
    }

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
        const contentText = (g.contentLines || g.children)
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
          const contentLines = group.contentLines || [];
          if (!isExpanded && cols.content >= 0 && contentLines.length > 0) {
            const snippet = buildSnippet(contentLines, cols.content);
            if (snippet) {
              card.append(el('div', { className: 'knowledge-card-snippet' }, [snippet]));
            }
          }

          if (isExpanded) {
            /* Expanded content lines */
            if (cols.content >= 0 && contentLines.length > 0) {
              const contentSection = el('div', { className: 'knowledge-card-content' });
              for (const child of contentLines) {
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

            /* Add line form */
            if (cols.content >= 0 && typeof template._onInsertAfterRow === 'function') {
              const addLineForm = el('div', { className: 'knowledge-add-line-form hidden' });
              const lineInput = el('input', {
                type: 'text',
                className: 'knowledge-add-line-input',
                placeholder: 'Add a new line…',
              });
              const lineSubmit = el('button', { className: 'knowledge-add-line-btn' }, ['Add']);
              addLineForm.append(lineInput, lineSubmit);

              const addLineTrigger = el('button', { className: 'knowledge-add-line-trigger' }, ['+ Add Line']);
              addLineTrigger.addEventListener('click', () => {
                addLineForm.classList.toggle('hidden');
                if (!addLineForm.classList.contains('hidden')) lineInput.focus();
              });

              function submitLine() {
                const text = lineInput.value.trim();
                if (!text) return;
                const allIdxs = [group.idx, ...group.children.map(c => c.idx)];
                const lastIdx = Math.max(...allIdxs);
                const newRow = new Array(template._totalColumns || 0).fill('');
                newRow[cols.content] = text;
                template._onInsertAfterRow(lastIdx + 1, [newRow]);
              }
              lineSubmit.addEventListener('click', submitLine);
              lineInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLine(); });

              card.append(addLineTrigger, addLineForm);
            }

            /* Reactions bar */
            const reactionsBar = el('div', { className: 'knowledge-reaction-bar' });
            for (const emoji of REACTION_EMOJIS) {
              const count = (group.reactions || []).filter(r => r.emoji === emoji).length;
              const btn = el('button', {
                className: `knowledge-reaction-btn${count > 0 ? ' knowledge-reaction-active' : ''}`,
                dataset: { emoji },
              }, [`${emoji}${count > 0 ? ` ${count}` : ''}`]);
              btn.addEventListener('click', () => {
                if (typeof template._onInsertAfterRow !== 'function') return;
                const allIdxs = [group.idx, ...group.children.map(c => c.idx)];
                const lastIdx = Math.max(...allIdxs);
                const newRow = new Array(template._totalColumns || 0).fill('');
                newRow[cols.content] = emoji;
                if (cols.author >= 0) newRow[cols.author] = getUserName();
                if (cols.updated >= 0) newRow[cols.updated] = nowTimestamp();
                template._onInsertAfterRow(lastIdx + 1, [newRow]);
              });
              reactionsBar.append(btn);
            }
            card.append(reactionsBar);

            /* Comments section — lazy-loaded from external sheet or inline */
            const commentsSheetId = cols.comments >= 0
              ? extractSheetId(cell(group.row, cols.comments))
              : null;
            const commentsSection = el('div', { className: 'knowledge-comments-section' });

            if (commentsSheetId) {
              /* External sheet: lazy-load */
              if (_commentsLoading.has(commentsSheetId)) {
                commentsSection.append(
                  el('div', { className: 'knowledge-comments-loader' }, ['Loading comments…']),
                );
              } else if (_commentsCache.has(commentsSheetId)) {
                const cached = _commentsCache.get(commentsSheetId);
                if (cached) {
                  _renderExternalComments(commentsSection, cached, commentsSheetId);
                } else {
                  commentsSection.append(
                    el('div', { className: 'knowledge-comments-error' }, ['Could not load comments.']),
                  );
                }
              } else {
                commentsSection.append(
                  el('div', { className: 'knowledge-comments-loader' }, ['Loading comments…']),
                );
                _loadComments(commentsSheetId);
              }
            } else if (cols.comments >= 0) {
              /* Comments Sheet column exists but no sheet ID yet — offer auto-create */
              const createBtn = el('button', {
                className: 'knowledge-create-comments-btn',
                dataset: { rowIdx: String(rowIdx) },
              }, ['🗂 Create Comments Sheet']);

              const createStatus = el('div', { className: 'knowledge-create-comments-status hidden' }, [
                'Creating…',
              ]);

              createBtn.addEventListener('click', async () => {
                if (createBtn.disabled) return;
                createBtn.disabled = true;
                createStatus.classList.remove('hidden');
                createStatus.textContent = 'Creating…';
                try {
                  const newId = await _createCommentsSheet(titleText);
                  /* Persist the new sheet ID into the row */
                  emitEdit(rowIdx, cols.comments, newId);
                  /* Update local cache so re-render shows the empty-but-ready sheet */
                  const emptyData = {
                    id: newId,
                    title: `Comments – ${titleText}`,
                    sheetTitle: 'Sheet1',
                    values: [['Author', 'Comment', 'Date']],
                  };
                  _commentsCache.set(newId, emptyData);
                  /* Update the in-memory row so the re-render picks up the new ID */
                  if (cols.comments >= 0) group.row[cols.comments] = newId;
                  if (_refreshFn) _refreshFn();
                } catch {
                  createStatus.textContent = 'Failed to create — check permissions.';
                  createBtn.disabled = false;
                }
              });

              commentsSection.append(createBtn, createStatus);
            } else {
              /* Inline comments (same sheet sub-rows) */
              if ((group.comments || []).length > 0) {
                for (const comment of group.comments) {
                  const commentEl = el('div', { className: 'knowledge-comment' });
                  commentEl.append(
                    el('div', { className: 'knowledge-comment-header' }, [
                      el('span', { className: 'knowledge-comment-author' }, [comment.author]),
                      el('span', { className: 'knowledge-comment-date' }, [
                        cols.updated >= 0 ? formatDate(comment.row[cols.updated] || '') : '',
                      ]),
                    ]),
                    el('div', { className: 'knowledge-comment-text' }, [comment.text]),
                  );
                  commentsSection.append(commentEl);
                }
              }

              if (typeof template._onInsertAfterRow === 'function') {
                const addCommentTrigger = el('button', { className: 'knowledge-add-comment-trigger' }, ['+ Comment']);
                const addCommentForm = el('div', { className: 'knowledge-add-comment-form hidden' });
                const commentInput = el('input', {
                  type: 'text',
                  className: 'knowledge-add-comment-input',
                  placeholder: 'Add a comment…',
                });
                const commentName = el('input', {
                  type: 'text',
                  className: 'knowledge-add-comment-name',
                  placeholder: 'Your name',
                  value: getUserName(),
                });
                const commentSubmit = el('button', { className: 'knowledge-add-comment-btn' }, ['Post']);
                addCommentForm.append(commentInput, commentName, commentSubmit);

                addCommentTrigger.addEventListener('click', () => {
                  addCommentForm.classList.toggle('hidden');
                  if (!addCommentForm.classList.contains('hidden')) commentInput.focus();
                });

                function submitComment() {
                  const text = commentInput.value.trim();
                  const name = commentName.value.trim();
                  if (!text) return;
                  const allIdxs = [group.idx, ...group.children.map(c => c.idx)];
                  const lastIdx = Math.max(...allIdxs);
                  const newRow = new Array(template._totalColumns || 0).fill('');
                  if (cols.content >= 0) newRow[cols.content] = text;
                  if (cols.author >= 0) newRow[cols.author] = name;
                  if (cols.updated >= 0) newRow[cols.updated] = nowTimestamp();
                  template._onInsertAfterRow(lastIdx + 1, [newRow]);
                }
                commentSubmit.addEventListener('click', submitComment);
                commentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitComment(); });

                commentsSection.append(addCommentTrigger, addCommentForm);
              }
            }

            card.append(commentsSection);
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
