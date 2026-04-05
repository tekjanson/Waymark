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

test('clicking a blog card with a doc link opens the reader modal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:not(.hidden)');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('.blog-reader-modal')).toBeVisible();
});

test('reader modal shows post title and meta', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card >> text=Getting Started with Waymark');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await expect(page.locator('.blog-reader-title')).toContainText('Getting Started with Waymark');
  await expect(page.locator('.blog-reader-meta')).toContainText('Jamie Levine');
});

test('reader modal closes via X button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await page.click('.blog-reader-close');
  await expect(page.locator('.blog-reader-overlay')).toHaveClass(/hidden/);
});

test('reader modal closes via overlay click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await page.click('.blog-reader-overlay', { position: { x: 5, y: 5 } });
  await expect(page.locator('.blog-reader-overlay')).toHaveClass(/hidden/);
});

test('reader modal closes on Escape key', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  await page.keyboard.press('Escape');
  await expect(page.locator('.blog-reader-overlay')).toHaveClass(/hidden/);
});

test('reader iframe has embedded Google Docs URL as src', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-062');
  await page.waitForSelector('.blog-card', { timeout: 5000 });

  await page.click('.blog-card:first-child');
  await page.waitForSelector('.blog-reader-overlay:not(.hidden)', { timeout: 3000 });

  const src = await page.locator('.blog-reader-iframe').getAttribute('src');
  expect(src).toContain('docs.google.com/document/d/');
  expect(src).toContain('embedded=true');
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

test('docEmbedUrl constructs correct embedded URL', async ({ page }) => {
  await setupApp(page);
  const url = await page.evaluate(async () => {
    const { docEmbedUrl } = await import('/js/templates/blog.js');
    return docEmbedUrl('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms');
  });
  expect(url).toBe('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/pub?embedded=true');
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
