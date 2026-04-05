/* ============================================================
   templates/photos.js — Photo Gallery template
   Renders a Google Sheet of photo URLs as a visual gallery.
   Supports Google Drive sharing links (auto-converts to view URLs),
   album/category filtering, and a click-to-expand lightbox.
   ============================================================ */

import { el, cell, showToast, registerTemplate, uploadDriveFile, extractDriveFileId, loadDriveImage } from './shared.js';

/* ---------- Drive URL helpers ---------- */

/**
 * Convert any Google Drive sharing URL to a thumbnail src suitable for <img>.
 * Uses the Drive thumbnail endpoint (drive.google.com/thumbnail?id=&sz=w1280) which
 * works for the authenticated session owner without requiring public permissions.
 * - drive.google.com/file/d/{id}/view   → thumbnail?id={id}&sz=w1280
 * - drive.google.com/open?id={id}        → thumbnail?id={id}&sz=w1280
 * - drive.google.com/uc?id={id}          → thumbnail?id={id}&sz=w1280
 * Non-Drive URLs are returned unchanged.
 * @param {string} url
 * @returns {string}
 */
export function driveToImgSrc(url) {
  if (!url) return '';
  const trimmed = url.trim();
  // Pattern 1: /file/d/{id}/...
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w1280`;
  // Pattern 2 & 3: /open?id= or /uc?id= — use URL API to handle any param ordering
  try {
    const u = new URL(trimmed);
    if (u.hostname === 'drive.google.com' &&
        (u.pathname === '/open' || u.pathname === '/uc')) {
      const id = u.searchParams.get('id');
      if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w1280`;
    }
  } catch { /* not a valid URL — fall through */ }
  return trimmed;
}

/** Return true if a string looks like a usable image URL after Drive conversion. */
export function isPhotoUrl(raw) {
  const src = driveToImgSrc(raw);
  if (!src) return false;
  return /^https?:\/\/.+/i.test(src);
}

/* ---------- Lightbox ---------- */

let _lightbox = null;

function getLightbox() {
  if (!_lightbox) {
    const closeBtn = el('button', {
      className: 'photos-lb-close',
      title: 'Close (Esc)',
      on: { click: () => hideLightbox() },
    }, ['✕']);

    const img = el('img', { className: 'photos-lb-img', alt: '' });
    const title = el('div', { className: 'photos-lb-title' });
    const meta  = el('div', { className: 'photos-lb-meta' });

    const modal = el('div', { className: 'photos-lb-modal' }, [
      closeBtn,
      img,
      el('div', { className: 'photos-lb-info' }, [title, meta]),
    ]);

    const overlay = el('div', {
      className: 'photos-lb-overlay',
      on: {
        click(e) {
          if (e.target === overlay) hideLightbox();
        },
      },
    }, [modal]);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) hideLightbox();
    });

    document.body.appendChild(overlay);
    overlay.classList.add('hidden');
    _lightbox = { overlay, img, title, meta };
  }
  return _lightbox;
}

function showLightbox(src, titleText, metaText) {
  const lb = getLightbox();
  lb.img.src = src;
  lb.img.alt = titleText || '';
  lb.title.textContent = titleText || '';
  lb.meta.textContent  = metaText || '';
  lb.overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideLightbox() {
  if (!_lightbox) return;
  _lightbox.overlay.classList.add('hidden');
  _lightbox.img.src = '';
  document.body.style.overflow = '';
}

/**
 * Replace a broken Drive-hosted image card with an inline permission guide.
 * @param {HTMLElement} cardEl - The .photos-card element
 * @param {string} src         - The image src (uc?export=view form)
 */
function showBrokenDriveCard(cardEl, src) {
  // Extract the file ID so we can build a proper View link
  const idMatch = src.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const fileId = idMatch ? idMatch[1] : null;
  const driveUrl = fileId
    ? `https://drive.google.com/file/d/${fileId}/view`
    : 'https://drive.google.com';

  cardEl.innerHTML = '';
  cardEl.classList.add('photos-card-broken', 'photos-card-permission');
  // Prevent the card's lightbox click from firing when the guide link is clicked
  cardEl.onclick = null;

  cardEl.appendChild(
    el('div', { className: 'photos-permission-card' }, [
      el('div', { className: 'photos-permission-card-icon' }, ['🔒']),
      el('p', { className: 'photos-permission-card-title' }, ['Photo not visible']),
      el('p', { className: 'photos-permission-card-hint' }, [
        'Drive sharing is off. ',
        el('a', {
          href: driveUrl,
          target: '_blank',
          rel: 'noopener',
          className: 'photos-permission-card-link',
          on: { click: (e) => e.stopPropagation() },
        }, ['Open in Drive']),
        ' → Share → "Anyone with the link → Viewer".',
      ]),
    ]),
  );
}

/* ---------- Template ---------- */

const definition = {
  name: 'Photo Gallery',
  icon: '📷',
  color: '#ec4899',
  priority: 20,
  itemNoun: 'Photo',
  defaultHeaders: ['Photo', 'Title', 'Date', 'Album'],

  detect(lower) {
    // Exclude Social Feed sheets (post/message + author columns) so the Social template
    // is not replaced when social sheets happen to include an Image column.
    const isSocial = lower.some(h => /^(post|message|status|wall|feed|update)/.test(h))
      && lower.some(h => /^(author|poster|user|posted.?by|from|who)/.test(h));
    if (isSocial) return false;

    return lower.some(h => /^(photo|image|picture|pic)\s*(url|link|src)?$/.test(h))
      || (lower.some(h => /\bphoto\b|\bimage\b|\bpicture\b/.test(h))
        && lower.some(h => /\btitle\b|\bcaption\b|\balbum\b|\bdate\b/.test(h)));
  },

  columns(lower) {
    const cols = { photo: -1, title: -1, date: -1, album: -1, description: -1 };
    cols.photo       = lower.findIndex(h => /^(photo|image|picture|pic)\s*(url|link|src)?$/.test(h));
    if (cols.photo === -1) cols.photo = lower.findIndex(h => /\bphoto\b|\bimage\b|\bpicture\b/.test(h));
    if (cols.photo === -1) cols.photo = lower.findIndex(h => /^url$/.test(h));
    cols.title       = lower.findIndex(h => /^(title|caption|name|label)$/.test(h));
    cols.date        = lower.findIndex(h => /^(date|taken|timestamp|when|on)$/.test(h));
    cols.album       = lower.findIndex(h => /^(album|category|collection|group|tag|folder)$/.test(h));
    cols.description = lower.findIndex(h => /^(description|notes?|caption|memo|comment)$/.test(h));
    // Deduplicate: description must not be same column as title
    if (cols.description === cols.title) cols.description = -1;
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'photo',       label: 'Photo URL',    colIndex: cols.photo,       type: 'text', placeholder: 'https://… or paste a Google Drive share link', required: true },
      { role: 'title',       label: 'Title',        colIndex: cols.title,       type: 'text', placeholder: 'Caption or name' },
      { role: 'date',        label: 'Date',         colIndex: cols.date,        type: 'date' },
      { role: 'album',       label: 'Album',        colIndex: cols.album,       type: 'text', placeholder: 'e.g. Vacation 2026' },
      { role: 'description', label: 'Description',  colIndex: cols.description, type: 'text', placeholder: 'Notes about this photo' },
    ];
  },

  render(container, rows, cols, template) {
    container.innerHTML = '';

    /* ---------- Collect albums for filter toolbar ---------- */
    const albums = new Set();
    for (const row of rows) {
      const album = cell(row, cols.album);
      if (album) albums.add(album);
    }

    /* ---------- State: active album filter ---------- */
    let activeAlbum = null;
    let gridEl = null;

    function renderGrid() {
      const filtered = activeAlbum
        ? rows.filter(r => cell(r, cols.album) === activeAlbum)
        : rows;

      gridEl.innerHTML = '';

      for (let i = 0; i < filtered.length; i++) {
        const row = filtered[i];
        const rawUrl    = cell(row, cols.photo);
        const src       = driveToImgSrc(rawUrl);
        const titleText = cell(row, cols.title) || '';
        const dateText  = cell(row, cols.date) || '';
        const albumText = cell(row, cols.album) || '';
        const desc      = cell(row, cols.description) || '';

        if (!src) continue;

        const metaParts = [albumText, dateText].filter(Boolean).join(' · ');

        const img = el('img', {
          className: 'photos-card-img',
          alt: titleText || 'Photo',
          loading: 'lazy',
        });

        const driveId = extractDriveFileId(rawUrl);

        if (driveId) {
          // Load via OAuth token — no public sharing required.
          // Avoids SameSite cookie restrictions that block drive.google.com in <img> tags.
          img.classList.add('photos-card-img-loading');
          loadDriveImage(driveId, img, () => {
            const cardEl = img.closest('.photos-card');
            if (cardEl) showBrokenDriveCard(cardEl, rawUrl);
          }).then(() => img.classList.remove('photos-card-img-loading'));
        } else {
          // Non-Drive URL (Unsplash, direct HTTPS, etc.) — set src directly.
          img.src = src;
          img.addEventListener('error', () => {
            const cardEl = img.closest('.photos-card');
            if (cardEl) cardEl.classList.add('photos-card-broken');
          });
        }

        const card = el('div', {
          className: 'photos-card',
          title: [titleText, metaParts].filter(Boolean).join('\n'),
          on: {
            click() {
              // Use img.src (may be blob URL or thumbnailLink after async load)
              const activeSrc = img.src || src;
              if (!activeSrc) return;
              const metaText = [metaParts, desc].filter(Boolean).join(' — ');
              showLightbox(activeSrc, titleText, metaText);
            },
          },
        }, [
          img,
          el('div', { className: 'photos-card-overlay' }, [
            titleText ? el('div', { className: 'photos-card-title' }, [titleText]) : null,
            metaParts ? el('div', { className: 'photos-card-meta'  }, [metaParts]) : null,
          ]),
        ]);

        gridEl.appendChild(card);
      }

      /* Show empty state if all rows were filtered out or have no valid photo */
      if (!gridEl.children.length) {
        gridEl.appendChild(el('div', { className: 'photos-empty' }, [
          el('div', { className: 'photos-empty-icon' }, ['📷']),
          el('p', {}, [activeAlbum ? `No photos in "${activeAlbum}"` : 'No photos yet']),
        ]));
      }
    }

    /* ---------- Filter toolbar (only when albums exist) ---------- */
    if (albums.size > 0) {
      const allBtn = el('button', {
        className: 'photos-filter-btn photos-filter-active',
        on: {
          click() {
            activeAlbum = null;
            toolbar.querySelectorAll('.photos-filter-btn').forEach(b => b.classList.remove('photos-filter-active'));
            allBtn.classList.add('photos-filter-active');
            renderGrid();
          },
        },
      }, ['All']);

      const albumBtns = Array.from(albums).map(album => {
        const btn = el('button', {
          className: 'photos-filter-btn',
          on: {
            click() {
              activeAlbum = album;
              toolbar.querySelectorAll('.photos-filter-btn').forEach(b => b.classList.remove('photos-filter-active'));
              btn.classList.add('photos-filter-active');
              renderGrid();
            },
          },
        }, [album]);
        return btn;
      });

      var toolbar = el('div', { className: 'photos-toolbar' }, [allBtn, ...albumBtns]);
      container.appendChild(toolbar);
    }

    /* ---------- Photo count + Upload button ---------- */
    const validCount = rows.filter(r => driveToImgSrc(cell(r, cols.photo))).length;

    // Hidden file input — opened programmatically by the upload button
    const fileInput = el('input', {
      type: 'file',
      className: 'photos-upload-input',
      accept: 'image/*',
    });
    fileInput.style.display = 'none';
    container.appendChild(fileInput);

    const uploadBtn = el('button', {
      className: 'photos-upload-btn',
      title: 'Upload a photo from your device to Google Drive',
    }, ['📤 Upload Photo']);

    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      // Reset so the same file can be picked again later
      fileInput.value = '';

      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading…';
      try {
        const driveUrl = await uploadDriveFile(file);

        // Build new row — place URL in the photo column, today's date in the date column
        const today = new Date().toISOString().split('T')[0];
        const maxCol = Math.max(...Object.values(cols).filter(i => i >= 0));
        const newRow = Array(maxCol + 1).fill('');
        if (cols.photo >= 0)       newRow[cols.photo]       = driveUrl;
        if (cols.date >= 0)        newRow[cols.date]        = today;
        if (cols.album >= 0 && activeAlbum) newRow[cols.album] = activeAlbum;

        if (template && typeof template._onInsertAfterRow === 'function') {
          await template._onInsertAfterRow(rows.length, [newRow]);
        }

        // File stays private (owner access only). Guide the user to share from Drive
        // if collaborators also need to see the photo.
        showToast('📤 Photo saved to Drive. You can see it now. To share with others, open the file in Drive and add their access.', 'success');
      } catch (err) {
        showToast(`Upload failed: ${err.message}`, 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '📤 Upload Photo';
      }
    });

    const header = el('div', { className: 'photos-header' }, [
      el('span', { className: 'photos-count' }, [`${validCount} photo${validCount !== 1 ? 's' : ''}`]),
      uploadBtn,
    ]);
    container.appendChild(header);

    /* ---------- Help banner (shown when no valid photos yet) ---------- */
    if (validCount === 0 && rows.length > 0) {
      container.appendChild(el('div', { className: 'photos-help' }, [
        el('strong', {}, ['💡 How to add photos from Google Drive:']),
        el('ol', {}, [
          el('li', {}, ['Open the photo in Google Drive']),
          el('li', {}, ['Right-click → Share → Copy link (or get the shareable link)']),
          el('li', {}, ['Paste the link into the "Photo" column of your Google Sheet']),
          el('li', {}, ['Waymark auto-converts Drive links into visible images']),
        ]),
        el('p', {}, ['You can also paste any direct HTTPS image URL (e.g. from Unsplash, Imgur, etc.)']),
      ]));
    }

    /* ---------- Grid ---------- */
    gridEl = el('div', { className: 'photos-grid' });
    container.appendChild(gridEl);
    renderGrid();
  },
};

registerTemplate('photos', definition);
export default definition;
