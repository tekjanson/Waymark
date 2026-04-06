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

/**
 * Sanitize Google Docs HTML for safe inline rendering.
 * Strips scripts, styles, event handlers, and Google-specific class/id attributes.
 * Extracts body content only.
 * @param {string} rawHtml
 * @returns {string}
 */
function sanitizeDocHtml(rawHtml) {
  let html = rawHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/ style="[^"]*"/gi, '')
    .replace(/ class="[^"]*"/gi, '')
    .replace(/ id="[^"]*"/gi, '');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

/**
 * Walk the rendered article DOM and replace any Waymark links with inline embed cards.
 * Called after setting article.innerHTML so we can work with real DOM nodes.
 * @param {HTMLElement} articleEl
 * @param {boolean} isPublic
 */
function inlineEmbeds(articleEl, isPublic) {
  // Capture both the type (sheet|public) and the id so we can determine
  // fetch mode from the link itself rather than the viewer's auth state.
  const WAYMARK_HREF_RE = /(?:\/#|%23)\/(sheet|public)\/([a-zA-Z0-9_-]+)/;

  /**
   * Google Docs wraps external links in https://www.google.com/url?q=ENCODED_URL
   * where the `#` in Waymark hashes gets percent-encoded inside the q parameter.
   * URLSearchParams.get() decodes it, giving us the real target URL to match against.
   */
  function resolveHref(raw) {
    if (raw.includes('google.com/url')) {
      try {
        const q = new URL(raw).searchParams.get('q');
        if (q) return q;
      } catch { /* fall through */ }
    }
    return raw;
  }

  const seen = new Set();
  for (const a of [...articleEl.querySelectorAll('a[href]')]) {
    const href = resolveHref(a.getAttribute('href') || '');
    const m = WAYMARK_HREF_RE.exec(href);
    if (!m) continue;
    const linkType = m[1]; // 'sheet' or 'public'
    const id = m[2];
    if (seen.has(id)) {
      // Duplicate link to same sheet — silently remove it
      a.parentNode.removeChild(a);
      continue;
    }
    seen.add(id);
    // A /#/public/ link is always fetched publicly regardless of viewer mode.
    // A /#/sheet/ link uses the viewer's current auth context.
    const embedIsPublic = linkType === 'public' || isPublic;
    const label = a.textContent.trim() || id;
    const embedBody = el('div', { className: 'blog-embed-body' });
    const openHash = (embedIsPublic ? '/public/' : '/sheet/') + id;
    const header = el('div', { className: 'blog-embed-header' }, [
      el('span', { className: 'blog-embed-title' }, ['\u{1F4CA} ', label]),
      el('a', {
        className: 'blog-embed-open-link',
        href: '/#' + openHash,
        on: { click(e) { e.preventDefault(); hideReader(); window.location.hash = openHash; } },
      }, ['Open full view \u2192']),
    ]);
    const card = el('div', { className: 'blog-embed-card' }, [header, embedBody]);
    a.parentNode.replaceChild(card, a);
    // Extract card out of any inline container (e.g. <p>) to be a direct article child.
    // This lets the CSS grid full-bleed rule (grid-column: 1 / -1) apply.
    const cardParent = card.parentNode;
    if (cardParent !== articleEl) {
      const after = cardParent.cloneNode(false);
      let n = card.nextSibling;
      while (n) { const nx = n.nextSibling; after.appendChild(n); n = nx; }
      cardParent.after(card);
      if (after.hasChildNodes()) card.after(after);
      if (!cardParent.hasChildNodes() || cardParent.textContent.trim() === '') cardParent.remove();
    }
    if (window.__waymarkEmbedSheet) {
      window.__waymarkEmbedSheet(id, embedBody, { isPublic: embedIsPublic });
    }
  }
}

/**
 * Extract /#/sheet/{id} links from the exported HTML.
 * These are rendered as "Referenced Sheets" cards below the article.
 */
export function extractWaymarkLinks(html) {
  // Match anchors whose href contains /#/ (direct) or %23/ (URL-encoded, from Google Docs redirect)
  // before sheet/{id} or public/{id}. Returns [{id, label}] so cards can show the link text.
  const ANCHOR_RE = /<a\s[^>]*href=["'][^"']*(?:\/#|%23)\/(?:sheet|public)\/([a-zA-Z0-9_-]+)[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const results = [];
  let m;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const label = m[2].replace(/<[^>]+>/g, '').trim() || id;
    results.push({ id, label });
  }
  return results;
}

/* ---------- Full-page reader ---------- */

let _reader = null;
let _showCount = 0;     // incremented on showReader/hideReader to cancel stale async loads
let _currentSheetId = null;
let _currentDocId = null;
let _blogReturnHash = null;

// Reading width + font size presets. Stored as index in localStorage.
const READING_MODES = [
  { col: '520px',               font: '14px', label: 'A−', hint: 'Compact' },
  { col: '700px',               font: '16px', label: 'A',  hint: 'Comfortable' },
  { col: '940px',               font: '18px', label: 'A+', hint: 'Wide' },
  { col: 'calc(100% - 64px)',   font: '18px', label: '⊞',  hint: 'Full width' },
];
const BLOG_WIDTH_KEY = 'waymark-blog-width';

function getReadingModeIdx() {
  const v = parseInt(localStorage.getItem(BLOG_WIDTH_KEY) || '1', 10);
  return isNaN(v) ? 1 : Math.min(Math.max(v, 0), READING_MODES.length - 1);
}

function applyReadingMode(article, idx, btns) {
  const mode = READING_MODES[idx];
  article.style.setProperty('--blog-col', mode.col);
  article.style.setProperty('--blog-font', mode.font);
  localStorage.setItem(BLOG_WIDTH_KEY, String(idx));
  btns.forEach((b, i) => b.classList.toggle('blog-width-btn-active', i === idx));
}

/** Build or retrieve the singleton full-page reader. */
function getReader() {
  if (!_reader) {
    // Article: shows sanitized Google Docs content inline
    const article = el('div', { className: 'blog-reader-article' });

    // Fallback iframe: shown only when OAuth export fails.
    // Always loads https://docs.google.com/document/d/{id}/preview — a fixed
    // cross-origin URL.  Do NOT sandbox: sandboxing sets origin to null, which
    // breaks Google's own scripts (font cache, confirm(), frame access) without
    // providing any real security gain since the URL is never user-controlled to
    // a same-origin path.
    const iframe = el('iframe', {
      className: 'blog-reader-iframe hidden',
      referrerpolicy: 'no-referrer',
      title: 'Blog post reader',
    });

    const navTitle = el('div', { className: 'blog-reader-nav-title' });

    const openLink = el('a', {
      className: 'blog-reader-open-link',
      target: '_blank',
      rel: 'noopener noreferrer',
      title: 'Open in Google Docs',
    }, ['↗ Open in Docs']);

    const shareBtn = el('button', {
      className: 'blog-reader-share-btn',
      title: 'Copy shareable link',
      on: {
        click() {
          if (!_currentSheetId || !_currentDocId) return;
          const base = window.location.origin + window.location.pathname;
          const shareUrl = base + '#/public/' + _currentSheetId + '/post/' + _currentDocId;
          navigator.clipboard.writeText(shareUrl).then(() => {
            showToast('Link copied!', 'success');
          }).catch(() => {
            showToast('Could not copy link', 'error');
          });
        },
      },
    }, ['🔗 Share']);

    const backBtn = el('button', {
      className: 'blog-reader-back',
      on: { click: () => hideReader() },
    }, ['← All Posts']);

    // Reading width controls
    const widthBtns = READING_MODES.map((mode, idx) =>
      el('button', {
        className: 'blog-width-btn',
        title: mode.hint,
        on: { click: () => applyReadingMode(article, idx, widthBtns) },
      }, [mode.label]),
    );
    const widthGroup = el('div', { className: 'blog-width-group' }, widthBtns);

    const nav = el('nav', { className: 'blog-reader-nav' }, [backBtn, navTitle, widthGroup, shareBtn, openLink]);

    const body = el('div', { className: 'blog-reader-body' }, [article, iframe]);
    const page = el('div', { className: 'blog-reader-page' }, [nav, body]);
    const overlay = el('div', { className: 'blog-reader-overlay hidden' }, [page]);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) hideReader();
    });

    document.body.appendChild(overlay);
    _reader = { overlay, iframe, article, navTitle, openLink, body, page, widthBtns };
  }
  return _reader;
}

async function showReader(docId, titleText, metaText, sheetId) {
  const myCount = ++_showCount;
  const r = getReader();
  r.navTitle.textContent = titleText || '';
  r.openLink.href = docOpenUrl(docId);
  // Restore saved reading width
  applyReadingMode(r.article, getReadingModeIdx(), r.widthBtns);

  // Store for share button and URL management
  _currentDocId = docId;
  if (sheetId) _currentSheetId = sheetId;

  // Update URL to reflect the open post (silent — no hashchange event)
  if (_currentSheetId) {
    const isPublic = document.body.classList.contains('waymark-public');
    const prefix = isPublic ? '#/public/' : '#/sheet/';
    const currentHash = window.location.hash;
    if (!currentHash.includes('/post/')) {
      _blogReturnHash = currentHash || (prefix + _currentSheetId);
    }
    history.replaceState(null, '', prefix + _currentSheetId + '/post/' + docId);
  }

  r.overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Reset article + iframe state
  r.article.innerHTML = '';
  r.iframe.src = '';
  r.iframe.removeAttribute('srcdoc');
  r.iframe.classList.add('hidden');
  r.page.classList.add('blog-reader-loading');

  try {
    const rawHtml = await exportDocAsHtml(docId);
    if (myCount !== _showCount) return;
    const isPublicRef = document.body.classList.contains('waymark-public');
    r.article.innerHTML = sanitizeDocHtml(rawHtml);
    inlineEmbeds(r.article, isPublicRef);
    // Detect and promote the document title to a styled editorial heading.
    // Google Docs exports the doc title as <h1> (or sometimes <p>) — the first
    // non-empty element that doesn't contain an embed card is the title.
    const firstTitleEl = [...r.article.children].find(
      c => c.textContent.trim() &&
           !c.classList.contains('blog-embed-card') &&
           !c.querySelector('.blog-embed-card'),
    );
    if (firstTitleEl) {
      if (firstTitleEl.tagName !== 'H1') {
        const h1 = document.createElement('h1');
        h1.innerHTML = firstTitleEl.innerHTML;
        firstTitleEl.replaceWith(h1);
        h1.classList.add('blog-doc-title');
      } else {
        firstTitleEl.classList.add('blog-doc-title');
      }
    }
  } catch (_) {
    if (myCount !== _showCount) return;
    // OAuth export failed — fall back to preview iframe
    r.article.innerHTML = '';
    r.iframe.removeAttribute('sandbox');
    r.iframe.src = docEmbedUrl(docId);
    r.iframe.classList.remove('hidden');
  } finally {
    if (myCount === _showCount) r.page.classList.remove('blog-reader-loading');
  }
}

function hideReader() {
  if (!_reader) return;
  _showCount++; // cancel any in-flight export
  _reader.overlay.classList.add('hidden');
  _reader.article.innerHTML = '';
  _reader.iframe.src = '';
  _reader.iframe.classList.add('hidden');
  document.body.style.overflow = '';
  // Restore URL to blog list (silent — no hashchange event).
  // When arriving via a /post/ permalink, _blogReturnHash is null — construct the
  // return URL from _currentSheetId so "← All Posts" always navigates correctly.
  const returnHash = _blogReturnHash || (() => {
    if (!_currentSheetId) return null;
    const isPublic = document.body.classList.contains('waymark-public');
    return (isPublic ? '#/public/' : '#/sheet/') + _currentSheetId;
  })();
  if (returnHash) history.replaceState(null, '', returnHash);
  _blogReturnHash = null;
  _currentDocId = null;
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Blog',
  noAutoRefresh: true,
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

    // Extract sheet ID from the current URL for permalink support
    const hashAtRender = window.location.hash;
    const sheetIdFromHash = hashAtRender
      .replace(/^#\/(public|sheet)\//, '')
      .split('/')[0] || '';
    if (sheetIdFromHash) _currentSheetId = sheetIdFromHash;

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
            showReader(docId, title, metaParts.join(' · '), sheetIdFromHash);
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

    // Auto-open a post if the URL contains /post/{docId} (e.g. navigating to a shared link)
    const postMatch = hashAtRender.match(/\/post\/([^/]+)$/);
    if (postMatch) {
      const pendingDocId = postMatch[1];
      const matchRow = rows.find(r => extractDocId(cell(r, cols.doc)) === pendingDocId);
      if (matchRow) {
        const pTitle  = cell(matchRow, cols.title)  || '(Untitled)';
        const pAuthor = cell(matchRow, cols.author);
        const pDate   = cell(matchRow, cols.date);
        const pMeta   = [pAuthor, formatPostDate(pDate)].filter(Boolean).join(' · ');
        Promise.resolve().then(() => showReader(pendingDocId, pTitle, pMeta, sheetIdFromHash));
      } else {
        Promise.resolve().then(() => showReader(pendingDocId, '', '', sheetIdFromHash));
      }
    }
  },
};

registerTemplate('blog', definition);
export default definition;
