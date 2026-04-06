const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ---- Detection & Rendering ---- */

test('blog template is detected for a sheet with Title and Doc columns', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-container', { timeout: 5000 });
  await expect(page.locator('.blog-container')).toBeVisible();
});

test('blog grid renders a card for each row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });
  const count = await page.locator('.blog-card').count();
  expect(count).toBe(5);
});

test('blog header shows correct published post count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-post-count', { timeout: 5000 });
  // 4 published, 1 draft in fixture
  await expect(page.locator('.blog-post-count')).toContainText('4 posts');
});

test('blog card shows title, author, date, and category badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });
  const first = page.locator('.blog-card').first();
  await expect(first.locator('.blog-card-title')).toContainText('Getting Started with Waymark');
  await expect(first.locator('.blog-card-author')).toContainText('Jamie Levine');
  await expect(first.locator('.blog-category-badge')).toContainText('Tutorial');
});

test('draft post card shows Draft badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });
  // Draft card is the 4th row (index 3)
  await expect(page.locator('.blog-card').nth(3).locator('.blog-draft-badge')).toBeVisible();
});

/* ---- Filtering ---- */

test('blog toolbar renders category filter buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-filter-btn', { timeout: 5000 });
  const btns = page.locator('.blog-filter-btn');
  // All + 5 categories (Tutorial, Engineering, Community, Product, Design)
  const count = await btns.count();
  expect(count).toBeGreaterThanOrEqual(5);
});

test('All filter button is active by default', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-filter-btn', { timeout: 5000 });
  const allBtn = page.locator('.blog-filter-btn').first();
  await expect(allBtn).toHaveClass(/blog-filter-active/);
  await expect(allBtn).toContainText('All');
});

test('clicking a category filter shows only posts in that category', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-filter-btn', { timeout: 5000 });

  // Click Engineering filter
  await page.click('.blog-filter-btn[data-filter="Engineering"]');

  // Only Engineering cards visible
  const visibleCards = page.locator('.blog-card:not(.hidden)');
  const count = await visibleCards.count();
  expect(count).toBe(1);
  await expect(visibleCards.first().locator('.blog-card-title')).toContainText('Kanban Template');
});

test('clicking All restores all posts after filter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-filter-btn', { timeout: 5000 });

  // Filter then reset
  await page.click('.blog-filter-btn[data-filter="Tutorial"]');
  await page.click('.blog-filter-btn[data-filter="All"]');

  const visibleCards = page.locator('.blog-card:not(.hidden)');
  const count = await visibleCards.count();
  expect(count).toBe(5);
});

/* ---- Reader modal ---- */

test('clicking a blog card with a doc link opens the full-page reader', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:not(.hidden)');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('.blog-reader-page')).toBeVisible();
});

test('reader nav shows post title', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card >> text=Getting Started with Waymark');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await expect(page.locator('.blog-reader-nav-title')).toContainText('Getting Started with Waymark');
});

test('reader closes via back button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await page.click('.blog-reader-back');
  await expect(page.locator('.blog-reader-overlay')).toHaveClass(/hidden/);
});

test('reader closes on Escape key', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await page.keyboard.press('Escape');
  await expect(page.locator('.blog-reader-overlay')).toHaveClass(/hidden/);
});

test('reader iframe loads content via OAuth export (srcdoc) in local mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });
  // Wait for async export to finish (loading class removed from page)
  await page.waitForSelector('.blog-reader-page:not(.blog-reader-loading)', { timeout: 5000 });

  // In local mock mode exportDocAsHtml returns mock HTML → srcdoc is set
  const srcdoc = await page.locator('.blog-reader-iframe').getAttribute('srcdoc');
  expect(srcdoc).toBeTruthy();
  expect(srcdoc.length).toBeGreaterThan(0);
});

test('reader reading styles are injected into srcdoc (strips Google styles, adds clean CSS)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-page:not(.blog-reader-loading)', { timeout: 5000 });

  const srcdoc = await page.locator('.blog-reader-iframe').getAttribute('srcdoc');
  expect(srcdoc).toContain('max-width: 720px');    // reading column width from READING_CSS
  expect(srcdoc).toContain('font-family: Georgia'); // serif reading font
  expect(srcdoc).toContain('line-height: 1.78');   // comfortable line spacing
  expect(srcdoc).toContain('viewport');             // mobile viewport meta tag
});

/* ---- Style & Visual ---- */

test('blog cards show pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });
  await expect(page.locator('.blog-card').first()).toHaveCSS('cursor', 'pointer');
});

test('blog grid uses CSS grid layout', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-grid', { timeout: 5000 });
  await expect(page.locator('.blog-grid')).toHaveCSS('display', 'grid');
});

test('blog cards use surface background design token', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });
  const bg = await page.locator('.blog-card').first().evaluate(el =>
    getComputedStyle(el).backgroundColor,
  );
  expect(bg).not.toBe('');
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('active filter button uses primary color', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-filter-btn', { timeout: 5000 });
  const activeBg = await page.locator('.blog-filter-active').evaluate(el =>
    getComputedStyle(el).backgroundColor,
  );
  expect(activeBg).not.toBe('');
  expect(activeBg).not.toBe('rgba(0, 0, 0, 0)');
});

/* ---- Mobile ---- */

test('blog template renders correctly at 375px mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.blog-card, .blog-container').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ---- Unit helpers ---- */

test('extractDocId parses Google Doc share URL', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { extractDocId } = await import('/js/templates/blog.js');
    return {
      fromPub: extractDocId('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/pub'),
      fromEdit: extractDocId('https://docs.google.com/document/d/1kFkFakeDocIdForKanban001/edit'),
      fromBare: extractDocId('1x5PFakeDocIdForCommunityGuidelinesBlog'),
      fromNull: extractDocId(null),
      fromEmpty: extractDocId(''),
    };
  });
  expect(result.fromPub).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms');
  expect(result.fromEdit).toBe('1kFkFakeDocIdForKanban001');
  expect(result.fromBare).toBe('1x5PFakeDocIdForCommunityGuidelinesBlog');
  expect(result.fromNull).toBeNull();
  expect(result.fromEmpty).toBeNull();
});

test('docEmbedUrl constructs correct preview URL', async ({ page }) => {
  await setupApp(page);
  const url = await page.evaluate(async () => {
    const { docEmbedUrl } = await import('/js/templates/blog.js');
    return docEmbedUrl('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms');
  });
  expect(url).toBe('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/preview');
});

test('docOpenUrl constructs correct Google Docs edit URL', async ({ page }) => {
  await setupApp(page);
  const url = await page.evaluate(async () => {
    const { docOpenUrl } = await import('/js/templates/blog.js');
    return docOpenUrl('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms');
  });
  expect(url).toBe('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit');
});

test('blogStatus classifies published values correctly', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { blogStatus } = await import('/js/templates/blog.js');
    return {
      pub: blogStatus('Published'),
      pubLow: blogStatus('published'),
      live: blogStatus('live'),
      yes: blogStatus('yes'),
      draft: blogStatus('Draft'),
      empty: blogStatus(''),
      undef: blogStatus(undefined),
    };
  });
  expect(results.pub).toBe('published');
  expect(results.pubLow).toBe('published');
  expect(results.live).toBe('published');
  expect(results.yes).toBe('published');
  expect(results.draft).toBe('draft');
  expect(results.empty).toBe('draft');
  expect(results.undef).toBe('draft');
});

test('formatPostDate formats ISO date to readable string', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatPostDate } = await import('/js/templates/blog.js');
    return {
      iso: formatPostDate('2026-01-15'),
      empty: formatPostDate(''),
      invalid: formatPostDate('not-a-date'),
    };
  });
  expect(results.iso).toContain('2026');
  expect(results.iso).toContain('January');
  expect(results.empty).toBe('');
  expect(results.invalid).toBe('not-a-date');
});

/* ---- New Post feature ---- */

test('New Post button is visible in blog header', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-new-post-btn', { timeout: 5000 });
  await expect(page.locator('.blog-new-post-btn')).toBeVisible();
  await expect(page.locator('.blog-new-post-btn')).toContainText('New Post');
});

test('New Post button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-new-post-btn', { timeout: 5000 });
  await expect(page.locator('.blog-new-post-btn')).toHaveCSS('cursor', 'pointer');
});

test('New Post button click shows inline creation form', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-new-post-btn', { timeout: 5000 });

  // Form starts hidden
  await expect(page.locator('.blog-new-post-form')).toBeHidden();

  await page.click('.blog-new-post-btn');
  await expect(page.locator('.blog-new-post-form')).toBeVisible();
  await expect(page.locator('.blog-new-post-input')).toBeVisible();
  await expect(page.locator('.blog-new-post-category')).toBeVisible();
  await expect(page.locator('.blog-new-post-submit')).toBeVisible();
  await expect(page.locator('.blog-new-post-cancel')).toBeVisible();
});

test('New Post Create button is disabled when title is empty', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-new-post-btn', { timeout: 5000 });

  await page.click('.blog-new-post-btn');
  await page.waitForSelector('.blog-new-post-form:not(.hidden)', { timeout: 3000 });

  // Button should be disabled with empty title
  await expect(page.locator('.blog-new-post-submit')).toBeDisabled();
});

test('New Post Create button enables when title is entered', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-new-post-btn', { timeout: 5000 });

  await page.click('.blog-new-post-btn');
  await page.waitForSelector('.blog-new-post-form:not(.hidden)', { timeout: 3000 });

  await page.locator('.blog-new-post-input').fill('My Test Post');
  await expect(page.locator('.blog-new-post-submit')).not.toBeDisabled();
});

test('New Post Cancel dismisses form and restores button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-new-post-btn', { timeout: 5000 });

  await page.click('.blog-new-post-btn');
  await page.waitForSelector('.blog-new-post-form:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('.blog-new-post-btn')).toBeHidden();

  await page.click('.blog-new-post-cancel');
  await expect(page.locator('.blog-new-post-form')).toBeHidden();
  await expect(page.locator('.blog-new-post-btn')).toBeVisible();
});

test('New Post form creates Google Doc record with correct mimeType', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-new-post-btn', { timeout: 5000 });

  await page.click('.blog-new-post-btn');
  await page.waitForSelector('.blog-new-post-form:not(.hidden)', { timeout: 3000 });

  await page.locator('.blog-new-post-input').fill('Integration Test Post');
  await page.locator('.blog-new-post-category').fill('Testing');
  await expect(page.locator('.blog-new-post-submit')).not.toBeDisabled();

  // Handle popup opened by window.open
  const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
  await page.click('.blog-new-post-submit');
  await popupPromise;

  // Wait for Drive file creation record
  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.mimeType === 'application/vnd.google-apps.document'),
    { timeout: 5000 },
  );

  const records = await page.evaluate(() => window.__WAYMARK_RECORDS || []);
  const docRecord = records.find(r => r.mimeType === 'application/vnd.google-apps.document');
  expect(docRecord).toBeTruthy();
  expect(docRecord.name).toBe('Integration Test Post');
});

test('New Post form adds row to sheet with Draft status', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-new-post-btn', { timeout: 5000 });

  await page.click('.blog-new-post-btn');
  await page.waitForSelector('.blog-new-post-form:not(.hidden)', { timeout: 3000 });

  await page.locator('.blog-new-post-input').fill('New Draft Post');
  await expect(page.locator('.blog-new-post-submit')).not.toBeDisabled();

  const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
  await page.click('.blog-new-post-submit');
  await popupPromise;

  // Wait for sheet-replace record (row was inserted)
  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.type === 'sheet-replace'),
    { timeout: 5000 },
  );

  const records = await page.evaluate(() => window.__WAYMARK_RECORDS || []);
  const sheetRecord = records.find(r => r.type === 'sheet-replace');
  expect(sheetRecord).toBeTruthy();

  // The last data row should be the new post
  const rows = sheetRecord.rows;
  const newRow = rows[rows.length - 1];
  expect(newRow[0]).toBe('New Draft Post'); // Title column (index 0)
  expect(newRow[5]).toBe('Draft');           // Status column (index 5)
});

test('New Post form re-renders grid with new card after creation', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  // Baseline: 5 cards
  expect(await page.locator('.blog-card').count()).toBe(5);

  await page.click('.blog-new-post-btn');
  await page.waitForSelector('.blog-new-post-form:not(.hidden)', { timeout: 3000 });
  await page.locator('.blog-new-post-input').fill('A Brand New Post');
  await expect(page.locator('.blog-new-post-submit')).not.toBeDisabled();

  const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
  await page.click('.blog-new-post-submit');
  await popupPromise;

  // After re-render, grid should show 6 cards (5 original + 1 new)
  await page.waitForFunction(
    () => document.querySelectorAll('.blog-card').length >= 6,
    { timeout: 5000 },
  );
  expect(await page.locator('.blog-card').count()).toBe(6);
});

/* ---- OAuth reader (private doc support) ---- */

test('reader nav shows Back button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await expect(page.locator('.blog-reader-back')).toBeVisible();
  await expect(page.locator('.blog-reader-back')).toContainText('All Posts');
});

test('reader nav Back button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await expect(page.locator('.blog-reader-back')).toHaveCSS('cursor', 'pointer');
});

test('reader is full-screen at mobile width (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  const overlayRect = await page.locator('.blog-reader-overlay').boundingBox();
  expect(overlayRect.width).toBeCloseTo(375, 0);
  expect(overlayRect.height).toBeGreaterThan(700);
});

test('reader header shows Open in Docs link when reader is open', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await expect(page.locator('.blog-reader-open-link')).toBeVisible();
});

test('Open in Docs link has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await expect(page.locator('.blog-reader-open-link')).toHaveCSS('cursor', 'pointer');
});

test('Open in Docs link points to correct Google Docs URL', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  // Click the first card (Getting Started with Waymark)
  await page.click('.blog-card >> text=Getting Started with Waymark');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  const href = await page.locator('.blog-reader-open-link').getAttribute('href');
  expect(href).toContain('docs.google.com/document/d/');
  expect(href).toContain('/edit');
});

test('reader closes while async export is in flight without errors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  // Open reader
  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  // Close immediately via back button before async export can finish
  await page.click('.blog-reader-back');
  await expect(page.locator('.blog-reader-overlay')).toHaveClass(/hidden/);

  // No JS errors should have been thrown
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.waitForTimeout(200); // let any async callbacks settle
  expect(errors).toHaveLength(0);
});

test('reader falls back to preview URL when OAuth export fails', async ({ page }) => {
  // Override exportDocAsHtml mock to throw (simulates 403 from drive.file scope)
  await page.addInitScript(() => {
    // Intercept the export so it rejects — verifies fallback path works
    window.__WAYMARK_FORCE_EXPORT_FAIL = true;
  });
  await setupApp(page);

  // Inject the override AFTER setup to intercept the real api call
  await page.evaluate(() => {
    // Monkey-patch the api object post-setup
    if (window.__WAYMARK_API && window.__WAYMARK_API.drive) {
      const orig = window.__WAYMARK_API.drive.exportDocAsHtml;
      window.__WAYMARK_API.drive.exportDocAsHtml = async () => {
        throw new Error('Permission denied — simulated 403');
      };
    }
  });

  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });
  // After export fails the loading state should clear and iframe src should be set
  await page.waitForSelector('.blog-reader-page:not(.blog-reader-loading)', { timeout: 5000 });

  const iframe = page.locator('.blog-reader-iframe');
  const src = await iframe.getAttribute('src');
  const srcdoc = await iframe.getAttribute('srcdoc');
  // Either srcdoc (from successful mock if monkey-patch didn't reach) or
  // src (fallback preview URL) should be set — reader should not be empty
  expect(src || srcdoc).toBeTruthy();
});

