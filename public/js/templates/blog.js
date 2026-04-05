/* ============================================================
   templates/blog.js — Blog template
   Renders a Google Sheet of blog posts (linked to Google Docs)
   as a card grid. Clicking a card opens an embedded reader
   using the Google Docs publish URL in a sandboxed iframe.
   ============================================================ */

import { el, cell, registerTemplate, delegateEvent, showToast, getUserName, createGoogleDoc } from './shared.js';

/* ---------- Helpers ---------- */

/** Google Doc ID pattern (20-44 alphanumeric + underscores/hyphens) */
const DOC_ID_RE = /[a-zA-Z0-9_-]{20,44}/;

/**
 * Extract a Google Doc ID from a URL or bare ID.
 * Supports:
 *   - docs.google.com/document/d/{id}/...
 *   - drive.google.com/file/d/{id}/...
 *   - Bare IDs (20-44 chars)
 * @param {string} raw
 * @returns {string|null}
 */
export function extractDocId(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Extract from /d/{id}/ URL pattern
  const slashD = trimmed.match(/\/d\/([a-zA-Z0-9_-]{20,44})/);
  if (slashD) return slashD[1];
  // Bare ID
  if (DOC_ID_RE.test(trimmed) && !/[\s/]/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Build the embedded Google Docs publish URL for an iframe.
 * @param {string} docId
 * @returns {string}
 */
export function docEmbedUrl(docId) {
  return `https://docs.google.com/document/d/${docId}/pub?embedded=true`;
}

/**
 * Classify a Status cell value.
 * @param {string} v
 * @returns {'published'|'draft'}
 */
export function blogStatus(v) {
  if (!v) return 'draft';
  return /^(published|public|live|yes|true|done)$/i.test(v.trim())
    ? 'published'
    : 'draft';
}

/**
 * Format a date string as "Month DD, YYYY".
 * @param {string} v
 * @returns {string}
 */
export function formatPostDate(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (_) { return v; }
}

/* ---------- Reader modal ---------- */

let _reader = null;

/** Build or retrieve the singleton reader overlay. */
function getReader() {
  if (!_reader) {
    const iframe = el('iframe', {
      className: 'blog-reader-iframe',
      sandbox: 'allow-scripts allow-same-origin allow-popups',
      title: 'Blog post reader',
    });

    const heading = el('h2', { className: 'blog-reader-title' });
    const meta    = el('div', { className: 'blog-reader-meta' });

    const closeBtn = el('button', {
      className: 'blog-reader-close',
      'aria-label': 'Close reader',
      on: { click: () => hideReader() },
    }, ['✕']);

    const header = el('div', { className: 'blog-reader-header' }, [
      el('div', { className: 'blog-reader-heading' }, [heading, meta]),
      closeBtn,
    ]);

    const body = el('div', { className: 'blog-reader-body' }, [iframe]);

    const modal = el('div', { className: 'blog-reader-modal' }, [header, body]);

    const overlay = el('div', {
      className: 'blog-reader-overlay',
      on: {
        click(e) { if (e.target === overlay) hideReader(); },
      },
    }, [modal]);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) hideReader();
    });

    document.body.appendChild(overlay);
    overlay.classList.add('hidden');
    _reader = { overlay, iframe, heading, meta };
  }
  return _reader;
}

function showReader(docId, titleText, metaText) {
  const r = getReader();
  r.iframe.src = docEmbedUrl(docId);
  r.heading.textContent = titleText || '';
  r.meta.textContent    = metaText || '';
  r.overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideReader() {
  if (!_reader) return;
  _reader.overlay.classList.add('hidden');
  _reader.iframe.src = '';
  document.body.style.overflow = '';
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Blog',
  icon: '✍️',
  color: '#0f766e',
  priority: 20,
  defaultHeaders: ['Title', 'Doc', 'Date', 'Author', 'Category', 'Status'],

  detect(lower) {
    // Requires a title column AND a doc link column
    // Excludes knowledge sheets (which have inline content column)
    const hasTitle   = lower.some(h => /^(title|headline|post|article)$/.test(h));
    const hasDocLink = lower.some(h => /^(doc|document|google.?doc|article.?url|post.?url|doc.?link)$/.test(h));
    const hasInline  = lower.some(h => /^(content|body|text|answer)$/.test(h));
    return hasTitle && hasDocLink && !hasInline;
  },

  columns(lower) {
    const cols = {
      title:    -1,
      doc:      -1,
      date:     -1,
      author:   -1,
      category: -1,
      status:   -1,
    };
    cols.title    = lower.findIndex(h => /^(title|headline|post|article)$/.test(h));
    cols.doc      = lower.findIndex(h => /^(doc|document|google.?doc|article.?url|post.?url|doc.?link)$/.test(h));
    cols.date     = lower.findIndex(h => /^(date|published.?on|posted|when|timestamp)$/.test(h));
    cols.author   = lower.findIndex(h => /^(author|writer|by|from|creator|name)$/.test(h));
    cols.category = lower.findIndex(h => /^(category|tag|topic|section|type)$/.test(h));
    cols.status   = lower.findIndex(h => /^(status|state|visibility|published)$/.test(h));
    return cols;
  },

  render(container, rows, cols, template) {
    container.innerHTML = '';

    /* ---- New Post form ---- */
    let creating = false;

    const titleInput = el('input', {
      className: 'blog-new-post-input',
      type: 'text',
      placeholder: 'Post title…',
      'aria-label': 'New post title',
    });

    const categoryInput = el('input', {
      className: 'blog-new-post-category',
      type: 'text',
      placeholder: 'Category (optional)',
      'aria-label': 'Post category',
    });

    const submitBtn = el('button', { className: 'blog-new-post-submit' }, ['Create']);
    submitBtn.disabled = true;

    const cancelBtn = el('button', {
      className: 'blog-new-post-cancel',
      on: { click() { hideNewPostForm(); } },
    }, ['Cancel']);

    const newPostForm = el('div', { className: 'blog-new-post-form hidden' }, [
      titleInput,
      categoryInput,
      el('div', { className: 'blog-new-post-actions' }, [submitBtn, cancelBtn]),
    ]);

    titleInput.addEventListener('input', () => {
      submitBtn.disabled = titleInput.value.trim() === '';
    });

    const newPostBtn = el('button', {
      className: 'blog-new-post-btn',
      on: { click() { showNewPostForm(); } },
    }, ['✍️ New Post']);

    function showNewPostForm() {
      newPostForm.classList.remove('hidden');
      newPostBtn.classList.add('hidden');
      titleInput.value = '';
      categoryInput.value = '';
      submitBtn.disabled = true;
      titleInput.focus();
    }

    function hideNewPostForm() {
      newPostForm.classList.add('hidden');
      newPostBtn.classList.remove('hidden');
      creating = false;
    }

    submitBtn.addEventListener('click', async () => {
      const titleVal = titleInput.value.trim();
      if (!titleVal || creating) return;
      creating = true;
      submitBtn.textContent = 'Creating…';
      submitBtn.disabled = true;
      try {
        const { url } = await createGoogleDoc(titleVal);
        const today = new Date().toISOString().slice(0, 10);
        const author = getUserName() || '';
        const category = categoryInput.value.trim();
        const numCols = (template && template._totalColumns)
          ? template._totalColumns
          : Math.max(6, ...Object.values(cols).filter(v => v >= 0).map(v => v + 1));
        const newRow = Array(numCols).fill('');
        if (cols.title >= 0) newRow[cols.title] = titleVal;
        if (cols.doc >= 0) newRow[cols.doc] = url;
        if (cols.date >= 0) newRow[cols.date] = today;
        if (cols.author >= 0) newRow[cols.author] = author;
        if (cols.category >= 0) newRow[cols.category] = category;
        if (cols.status >= 0) newRow[cols.status] = 'Draft';
        if (template && typeof template._onInsertAfterRow === 'function') {
          await template._onInsertAfterRow(rows.length, [newRow]);
        }
        window.open(url, '_blank');
        hideNewPostForm();
      } catch (err) {
        showToast(`Failed to create post: ${err.message}`, 'error');
        creating = false;
        submitBtn.textContent = 'Create';
        submitBtn.disabled = false;
      }
    });

    /* ---- Toolbar ---- */
    const categories = [...new Set(
      rows.map(r => cell(r, cols.category)).filter(Boolean),
    )];

    let activeFilter = 'All';

    const filterBtns = [
      el('button', {
        className: 'blog-filter-btn blog-filter-active',
        dataset: { filter: 'All' },
        on: { click() { setFilter('All'); } },
      }, ['All']),
      ...categories.map(cat =>
        el('button', {
          className: 'blog-filter-btn',
          dataset: { filter: cat },
          on: { click() { setFilter(cat); } },
        }, [cat]),
      ),
    ];

    const toolbar = el('div', { className: 'blog-toolbar' }, filterBtns);

    /* ---- Post count ---- */
    const publishedCount = rows.filter(r =>
      blogStatus(cell(r, cols.status)) === 'published',
    ).length;

    const header = el('div', { className: 'blog-header' }, [
      el('span', { className: 'blog-post-count' }, [`${publishedCount} post${publishedCount !== 1 ? 's' : ''}`]),
      toolbar,
      newPostBtn,
    ]);

    /* ---- Card grid ---- */
    const grid = el('div', { className: 'blog-grid' });

    rows.forEach((row, i) => {
      const title    = cell(row, cols.title)    || '(Untitled)';
      const docRaw   = cell(row, cols.doc);
      const date     = cell(row, cols.date);
      const author   = cell(row, cols.author);
      const category = cell(row, cols.category);
      const status   = blogStatus(cell(row, cols.status));
      const docId    = extractDocId(docRaw);

      const card = el('div', {
        className: `blog-card blog-card-${status}`,
        dataset: { category: category || '', index: String(i) },
        on: {
          click() {
            if (!docId) return;
            const metaParts = [author, formatPostDate(date)].filter(Boolean);
            showReader(docId, title, metaParts.join(' · '));
          },
        },
      }, [
        category
          ? el('span', { className: 'blog-category-badge' }, [category])
          : null,
        el('h3', { className: 'blog-card-title' }, [title]),
        el('div', { className: 'blog-card-meta' }, [
          author ? el('span', { className: 'blog-card-author' }, [author]) : null,
          date   ? el('span', { className: 'blog-card-date'   }, [formatPostDate(date)]) : null,
        ]),
        status === 'draft'
          ? el('span', { className: 'blog-draft-badge' }, ['Draft'])
          : null,
        !docId
          ? el('span', { className: 'blog-no-doc' }, ['No document linked'])
          : null,
      ].filter(Boolean));

      grid.appendChild(card);
    });

    /* ---- Filter logic ---- */
    function setFilter(cat) {
      activeFilter = cat;
      filterBtns.forEach(btn => {
        btn.classList.toggle('blog-filter-active', btn.dataset.filter === cat);
      });
      const cards = grid.querySelectorAll('.blog-card');
      cards.forEach(card => {
        const show = cat === 'All' || card.dataset.category === cat;
        card.classList.toggle('hidden', !show);
      });
    }

    const wrap = el('div', { className: 'blog-container' }, [header, newPostForm, grid]);
    container.appendChild(wrap);
  },
};

registerTemplate('blog', definition);
export default definition;
