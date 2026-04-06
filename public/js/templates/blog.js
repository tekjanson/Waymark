/* ============================================================
   templates/blog.js — Blog template
   Renders a Google Sheet of blog posts (linked to Google Docs)
   as a card grid. Clicking a card opens an embedded reader
   using the Google Docs publish URL in a sandboxed iframe.
   ============================================================ */

import { el, cell, registerTemplate, delegateEvent, showToast, getUserName, createGoogleDoc, exportDocAsHtml } from './shared.js';

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
 * Build the preview URL for a Google Doc — works for published docs,
 * link-shared docs, and private docs accessible via the user's browser session.
 * This replaces the old /pub?embedded=true URL which required explicit web publishing.
 * @param {string} docId
 * @returns {string}
 */
export function docEmbedUrl(docId) {
  return `https://docs.google.com/document/d/${docId}/preview`;
}

/**
 * Build the direct Google Docs edit URL for the "Open in Google Docs" fallback.
 * @param {string} docId
 * @returns {string}
 */
export function docOpenUrl(docId) {
  return `https://docs.google.com/document/d/${docId}/edit`;
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

/* ---------- Reader — reading styles injected into srcdoc ---------- */

const READING_CSS = [
  '* { box-sizing: border-box; }',
  'html, body { margin: 0; padding: 0; width: 100%; }',
  'body { padding: 32px 24px 64px; font-family: Georgia, Cambria, "Times New Roman", serif;',
  '  font-size: 17px; line-height: 1.78; color: #1e293b; background: #fff;',
  '  max-width: 720px; margin-left: auto; margin-right: auto;',
  '  word-wrap: break-word; -webkit-text-size-adjust: 100%; }',
  'h1,h2,h3,h4,h5,h6 { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; line-height: 1.3; }',
  'h1 { font-size: 2em; font-weight: 700; margin: 1em 0 0.4em; }',
  'h2 { font-size: 1.4em; font-weight: 600; margin: 1.6em 0 0.4em; }',
  'h3 { font-size: 1.15em; font-weight: 600; margin: 1.4em 0 0.3em; }',
  'h4 { font-size: 1em; font-weight: 600; margin: 1.2em 0 0.3em; }',
  'p { margin: 0 0 1.1em; }',
  'a { color: #2563eb; text-decoration: underline; }',
  'a:hover { color: #1d4ed8; }',
  'img { max-width: 100%; height: auto; border-radius: 4px; display: block; margin: 1.2em 0; }',
  'hr { border: none; border-top: 1px solid #e2e8f0; margin: 2.5em 0; }',
  'blockquote { margin: 1.5em 0; padding: 1em 1.2em; border-left: 4px solid #e2e8f0;',
  '  color: #475569; background: #f8fafc; border-radius: 0 6px 6px 0; }',
  'ul, ol { padding-left: 1.6em; margin: 0 0 1.1em; }',
  'li { margin-bottom: 0.35em; }',
  'table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.9em; }',
  'td, th { padding: 8px 12px; border: 1px solid #e2e8f0; text-align: left; }',
  'th { background: #f8fafc; font-weight: 600; }',
  'code { font-family: ui-monospace, monospace; font-size: 0.875em; background: #f1f5f9; padding: 2px 5px; border-radius: 3px; }',
  'pre { background: #f1f5f9; padding: 16px; border-radius: 6px; overflow-x: auto; }',
  'pre code { background: none; padding: 0; }',
  '@media (max-width: 480px) { body { padding: 20px 16px 48px; font-size: 16px; } h1 { font-size: 1.55em; } h2 { font-size: 1.25em; } }',
].join('\n');

/**
 * Remove Google Docs style blocks and inject clean reading CSS + viewport meta.
 * The result is set as iframe.srcdoc so Google's layout doesn't conflict with
 * the Waymark reading view.
 */
function injectReadingStyles(rawHtml) {
  let html = rawHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
  const injection = '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + READING_CSS + '</style>';
  if (html.includes('</head>')) return html.replace('</head>', injection + '</head>');
  if (html.includes('<head>'))  return html.replace('<head>', '<head>' + injection);
  return injection + html;
}

/**
 * Extract /#/sheet/{id} links from the exported HTML.
 * These are rendered as "Referenced Sheets" cards below the article.
 */
function extractWaymarkLinks(html) {
  const RE = /href=["'][^"']*\/#\/sheet\/([a-zA-Z0-9_-]+)["']/g;
  const ids = [];
  let m;
  while ((m = RE.exec(html)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/* ---------- Full-page reader ---------- */

let _reader = null;
let _showCount = 0; // incremented on showReader/hideReader to cancel stale async loads

/** Build or retrieve the singleton full-page reader. */
function getReader() {
  if (!_reader) {
    const iframe = el('iframe', {
      className: 'blog-reader-iframe',
      sandbox: 'allow-scripts allow-same-origin allow-popups',
      title: 'Blog post reader',
    });

    const navTitle = el('div', { className: 'blog-reader-nav-title' });

    const openLink = el('a', {
      className: 'blog-reader-open-link',
      target: '_blank',
      rel: 'noopener noreferrer',
      title: 'Open in Google Docs',
    }, ['↗ Open in Docs']);

    const backBtn = el('button', {
      className: 'blog-reader-back',
      on: { click: () => hideReader() },
    }, ['← All Posts']);

    const nav = el('nav', { className: 'blog-reader-nav' }, [backBtn, navTitle, openLink]);

    // Referenced sheets section (shown when the doc links to other Waymark sheets)
    const refsLabel = el('div', { className: 'blog-reader-refs-label' }, ['Referenced Sheets']);
    const refs = el('div', { className: 'blog-reader-refs hidden' }, [refsLabel]);

    const body = el('div', { className: 'blog-reader-body' }, [iframe, refs]);
    const page = el('div', { className: 'blog-reader-page' }, [nav, body]);
    const overlay = el('div', { className: 'blog-reader-overlay hidden' }, [page]);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) hideReader();
    });

    document.body.appendChild(overlay);
    _reader = { overlay, iframe, navTitle, openLink, body, refs, page };
  }
  return _reader;
}

async function showReader(docId, titleText, metaText) {
  const myCount = ++_showCount;
  const r = getReader();
  r.navTitle.textContent = titleText || '';
  r.openLink.href = docOpenUrl(docId);
  r.overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Reset iframe + refs state
  r.iframe.removeAttribute('srcdoc');
  r.iframe.src = '';
  r.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  r.refs.querySelectorAll('.blog-ref-card').forEach(c => c.remove());
  r.refs.classList.add('hidden');
  r.page.classList.add('blog-reader-loading');

  try {
    const rawHtml = await exportDocAsHtml(docId);
    if (myCount !== _showCount) return;
    // Inject clean reading styles — strips Google's layout CSS
    r.iframe.setAttribute('sandbox', 'allow-popups');
    r.iframe.srcdoc = injectReadingStyles(rawHtml);
    // Show referenced Waymark sheets as clickable cards
    const sheetIds = extractWaymarkLinks(rawHtml);
    if (sheetIds.length > 0) {
      const base = window.__WAYMARK_BASE || '';
      sheetIds.forEach(id => {
        const card = el('a', {
          className: 'blog-ref-card',
          href: base + '/#/sheet/' + id,
          on: { click(e) { e.preventDefault(); hideReader(); window.location.hash = '/sheet/' + id; } },
        }, [el('span', { className: 'blog-ref-icon' }, ['\u{1F4CA} ']), id]);
        r.refs.appendChild(card);
      });
      r.refs.classList.remove('hidden');
    }
  } catch (_) {
    if (myCount !== _showCount) return;
    r.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    r.iframe.src = docEmbedUrl(docId);
  } finally {
    if (myCount === _showCount) r.page.classList.remove('blog-reader-loading');
  }
}

function hideReader() {
  if (!_reader) return;
  _showCount++; // cancel any in-flight export
  _reader.overlay.classList.add('hidden');
  _reader.iframe.src = '';
  _reader.iframe.removeAttribute('srcdoc');
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
