/* ============================================================
   templates/photos.js — Photo Gallery template
   Renders a Google Sheet of photo URLs as a visual gallery.
   Supports Google Drive sharing links (auto-converts to view URLs),
   album/category filtering, and a click-to-expand lightbox.
   ============================================================ */

import { el, cell, showToast, registerTemplate, uploadDriveFile } from './shared.js';

/* ---------- Drive URL helpers ---------- */

/**
 * Convert any Google Drive sharing URL to a direct image src.
 * - drive.google.com/file/d/{id}/view   → uc?export=view&id={id}
 * - drive.google.com/open?id={id}        → uc?export=view&id={id}
 * - drive.google.com/uc?id={id}          → uc?export=view&id={id}
 * Non-Drive URLs are returned unchanged.
 * @param {string} url
 * @returns {string}
 */
export function driveToImgSrc(url) {
  if (!url) return '';
  const trimmed = url.trim();
  // Pattern 1: /file/d/{id}/...
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return `https://drive.google.com/uc?export=view&id=${fileMatch[1]}`;
  // Pattern 2 & 3: /open?id= or /uc?id= — use URL API to handle any param ordering
  try {
    const u = new URL(trimmed);
    if (u.hostname === 'drive.google.com' &&
        (u.pathname === '/open' || u.pathname === '/uc')) {
      const id = u.searchParams.get('id');
      if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
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

/* ---------- Drive permission guide ---------- */

/**
 * Show a non-blocking permission guide banner below the upload toolbar.
 * Called when Drive reports that public sharing could not be set for a file.
 * @param {HTMLElement} container - The template root element
 * @param {string} driveUrl - The Drive file URL (view link)
 * @param {string} fileName - The uploaded file name for the label
 */
function showPermissionGuide(container, driveUrl, fileName) {
  // Remove any pre-existing guide
  container.querySelector('.photos-permission-banner')?.remove();

  const fileId = (driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || '';
  const driveFileUrl = fileId
    ? `https://drive.google.com/file/d/${fileId}/view`
    : driveUrl;

  const banner = el('div', { className: 'photos-permission-banner' }, [
    el('div', { className: 'photos-permission-banner-header' }, [
      el('span', { className: 'photos-permission-banner-icon' }, ['🔒']),
      el('strong', {}, ['Photo sharing not enabled yet']),
      el('button', {
        className: 'photos-permission-banner-close',
        title: 'Dismiss',
        on: { click: () => banner.remove() },
      }, ['✕']),
    ]),
    el('p', { className: 'photos-permission-banner-msg' }, [
      `"${fileName}" was saved to Drive, but its sharing is restricted — it will appear as a broken image until you enable access.`,
    ]),
    el('ol', { className: 'photos-permission-banner-steps' }, [
      el('li', {}, [
        'Open ',
        el('a', { href: driveFileUrl, target: '_blank', rel: 'noopener' }, ['the file in Google Drive']),
        '.',
      ]),
      el('li', {}, ['Right-click the file → Share (or click the Share button in the toolbar).']),
      el('li', {}, ['Under "General access", choose "Anyone with the link → Viewer".']),
      el('li', {}, ['Click Done. The photo will load automatically once sharing is enabled.']),
    ]),
  ]);

  // Insert after the toolbar (first child) if possible, otherwise prepend
  const toolbar = container.querySelector('.photos-toolbar');
  if (toolbar && toolbar.nextSibling) {
    container.insertBefore(banner, toolbar.nextSibling);
  } else {
    container.prepend(banner);
  }
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
        const src      = driveToImgSrc(rawUrl);
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
        // Set src after element creation to allow lazy loading
        img.src = src;
        img.addEventListener('error', () => {
          const cardEl = img.closest('.photos-card');
          if (!cardEl) return;
          // For Drive-hosted images, replace the card with an actionable guide
          if (/drive\.google\.com/.test(src)) {
            showBrokenDriveCard(cardEl, src);
          } else {
            cardEl.classList.add('photos-card-broken');
          }
        });

        const card = el('div', {
          className: 'photos-card',
          title: [titleText, metaParts].filter(Boolean).join('\n'),
          on: {
            click() {
              const metaText = [metaParts, desc].filter(Boolean).join(' — ');
              showLightbox(src, titleText, metaText);
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
        const { url: driveUrl, permissionSet } = await uploadDriveFile(file);

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

        if (permissionSet) {
          showToast('Photo uploaded — it may take a moment to appear', 'success');
        } else {
          // Drive sharing was blocked (e.g. Google Workspace policy).
          // Show an actionable guide so the user can manually enable access.
          showPermissionGuide(container, driveUrl, file.name);
        }
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
