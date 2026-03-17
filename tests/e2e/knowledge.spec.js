const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ---------- Detection & rendering ---------- */

test('knowledge template is detected for knowledge base headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-toolbar', { timeout: 5000 });
  await expect(page.locator('#template-badge')).toContainText('Knowledge Base');
});

test('knowledge template renders article cards grouped by category', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-section', { timeout: 5000 });

  const sections = page.locator('.knowledge-section');
  expect(await sections.count()).toBeGreaterThanOrEqual(3);

  const cards = page.locator('.knowledge-card');
  expect(await cards.count()).toBe(5);
});

test('knowledge template shows status badges on each card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-status-badge', { timeout: 5000 });

  const badges = page.locator('.knowledge-status-badge');
  expect(await badges.count()).toBe(5);

  const firstBadge = badges.first();
  await expect(firstBadge).toBeVisible();
  const text = await firstBadge.textContent();
  expect(['Published', 'Draft', 'In Review', 'Archived']).toContain(text);
});

test('knowledge template renders category filter pills', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-cat-bar', { timeout: 5000 });

  const pills = page.locator('.knowledge-cat-pill');
  expect(await pills.count()).toBeGreaterThanOrEqual(4);
  await expect(pills.first()).toContainText('All');
  await expect(pills.first()).toHaveClass(/active/);
});

test('knowledge template renders search input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-search', { timeout: 5000 });

  const search = page.locator('.knowledge-search');
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute('placeholder', 'Search articles…');
});

/* ---------- Interactions: category filtering ---------- */

test('clicking category pill filters articles to that category', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-cat-pill', { timeout: 5000 });

  const allCards = page.locator('.knowledge-card');
  const totalBefore = await allCards.count();
  expect(totalBefore).toBe(5);

  const devopsPill = page.locator('.knowledge-cat-pill', { hasText: 'DevOps' });
  await devopsPill.click();
  await expect(devopsPill).toHaveClass(/active/);

  const filteredCards = page.locator('.knowledge-card');
  const filteredCount = await filteredCards.count();
  expect(filteredCount).toBe(2);
});

test('clicking All pill resets category filter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-cat-pill', { timeout: 5000 });

  const devopsPill = page.locator('.knowledge-cat-pill', { hasText: 'DevOps' });
  await devopsPill.click();

  const allPill = page.locator('.knowledge-cat-pill', { hasText: 'All' });
  await allPill.click();
  await expect(allPill).toHaveClass(/active/);

  const cards = page.locator('.knowledge-card');
  expect(await cards.count()).toBe(5);
});

/* ---------- Interactions: search ---------- */

test('search filters articles by text content', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-search', { timeout: 5000 });

  const search = page.locator('.knowledge-search');
  await search.fill('deployment');

  await page.waitForSelector('.knowledge-card', { timeout: 3000 });
  const cards = page.locator('.knowledge-card');
  expect(await cards.count()).toBe(1);
  await expect(cards.first().locator('.knowledge-card-title')).toContainText('Deployment');
});

test('search shows empty state when no match', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-search', { timeout: 5000 });

  const search = page.locator('.knowledge-search');
  await search.fill('zzznomatchzzz');

  await page.waitForSelector('.knowledge-empty', { timeout: 3000 });
  await expect(page.locator('.knowledge-empty')).toContainText('No articles');
});

/* ---------- Interactions: expand/collapse ---------- */

test('clicking expand button shows full article content', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-expand-btn', { timeout: 5000 });

  const firstCard = page.locator('.knowledge-card').first();
  await expect(firstCard.locator('.knowledge-card-snippet')).toBeVisible();
  await expect(firstCard.locator('.knowledge-card-content')).toBeHidden();

  await firstCard.locator('.knowledge-expand-btn').click();

  await page.waitForSelector('.knowledge-card-content', { timeout: 3000 });
  await expect(firstCard.locator('.knowledge-card-content')).toBeVisible();
  const contentLines = firstCard.locator('.knowledge-content-line');
  expect(await contentLines.count()).toBeGreaterThanOrEqual(3);
});

test('clicking expand again collapses the content', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-expand-btn', { timeout: 5000 });

  const firstCard = page.locator('.knowledge-card').first();
  await firstCard.locator('.knowledge-expand-btn').click();
  await page.waitForSelector('.knowledge-card-content', { timeout: 3000 });

  await firstCard.locator('.knowledge-expand-btn').click();
  await page.waitForSelector('.knowledge-card-snippet', { timeout: 3000 });
  await expect(firstCard.locator('.knowledge-card-snippet')).toBeVisible();
});

/* ---------- Interactions: status badge cycling ---------- */

test('clicking status badge cycles to next status', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-status-badge', { timeout: 5000 });

  const firstBadge = page.locator('.knowledge-status-badge').first();
  const initialText = await firstBadge.textContent();
  await firstBadge.click();

  const newText = await firstBadge.textContent();
  expect(newText).not.toBe(initialText);

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update')).toBe(true);
});

/* ---------- Inline editing ---------- */

test('inline editing article title emits record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-card-title', { timeout: 5000 });

  const titleCell = page.locator('.knowledge-card-title').first();
  await titleCell.click();
  const input = page.locator('.knowledge-card-title input.editable-cell-input').first();
  await input.waitFor({ timeout: 3000 });
  await input.fill('Updated Article Title');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Updated Article Title')).toBe(true);
});

/* ---------- Visual consistency ---------- */

test('knowledge template uses correct design tokens', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-toolbar', { timeout: 5000 });

  const toolbar = page.locator('.knowledge-toolbar');
  const bgColor = await toolbar.evaluate(el => getComputedStyle(el).getPropertyValue('background-color'));
  expect(bgColor).not.toBe('');
  expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');

  await expect(toolbar).toHaveCSS('border-radius', /\d+px/);
});

test('category pills show pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-cat-pill', { timeout: 5000 });

  await expect(page.locator('.knowledge-cat-pill').first()).toHaveCSS('cursor', 'pointer');
});

test('status badges show pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-status-badge', { timeout: 5000 });

  await expect(page.locator('.knowledge-status-badge').first()).toHaveCSS('cursor', 'pointer');
});

/* ---------- Tag filtering ---------- */

test('clicking tag pill filters articles by tag', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-tag-pill', { timeout: 5000 });

  const tagPill = page.locator('.knowledge-tag-pill').first();
  await tagPill.click();
  await expect(tagPill).toHaveClass(/active/);

  const cards = page.locator('.knowledge-card');
  const count = await cards.count();
  expect(count).toBeLessThan(5);
  expect(count).toBeGreaterThan(0);
});

test('clicking active tag pill deselects it', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-tag-pill', { timeout: 5000 });

  const tagPill = page.locator('.knowledge-tag-pill').first();
  await tagPill.click();
  await expect(tagPill).toHaveClass(/active/);

  await tagPill.click();
  expect(await tagPill.getAttribute('class')).not.toMatch(/active/);

  const cards = page.locator('.knowledge-card');
  expect(await cards.count()).toBe(5);
});

/* ---------- Meta information ---------- */

test('article cards show author and date metadata', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-card-meta', { timeout: 5000 });

  const meta = page.locator('.knowledge-card-meta').first();
  await expect(meta.locator('.knowledge-meta-author')).toContainText('Alex');
  await expect(meta.locator('.knowledge-meta-date')).toBeVisible();
});

test('article cards show tag badges in metadata', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-card-tags', { timeout: 5000 });

  const tags = page.locator('.knowledge-tag').first();
  await expect(tags).toBeVisible();
});

/* ---------- Responsive ---------- */

test('knowledge template renders at mobile width without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-card', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.knowledge-list *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ---------- Source link ---------- */

test('article with source shows clickable source link', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-meta-source', { timeout: 5000 });

  const sourceLink = page.locator('.knowledge-meta-source').first();
  await expect(sourceLink).toBeVisible();
  await expect(sourceLink).toContainText('Source');
  await expect(sourceLink).toHaveAttribute('target', '_blank');
});

/* ---------- Section headers ---------- */

test('section headers show category title and article count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('.knowledge-section-header', { timeout: 5000 });

  const header = page.locator('.knowledge-section-header').first();
  await expect(header.locator('.knowledge-section-title')).toBeVisible();
  await expect(header.locator('.knowledge-section-count')).toBeVisible();
});

/* ---------- Waymark Knowledge Base (sheet-045) — deep rich fixture ---------- */

test('Waymark knowledge base is detected and renders as Knowledge Base', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-toolbar', { timeout: 5000 });
  await expect(page.locator('#template-badge')).toContainText('Knowledge Base');
});

test('Waymark knowledge base renders 8 categories', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-cat-pill', { timeout: 5000 });

  const pills = page.locator('.knowledge-cat-pill');
  // All + 8 categories = 9 pills minimum
  expect(await pills.count()).toBeGreaterThanOrEqual(9);
  await expect(pills.first()).toContainText('All');
});

test('Waymark knowledge base renders many article cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-card', { timeout: 5000 });

  const cards = page.locator('.knowledge-card');
  // The Waymark fixture has 35+ articles
  expect(await cards.count()).toBeGreaterThanOrEqual(30);
});

test('Waymark knowledge base Architecture category contains correct articles', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-cat-pill', { timeout: 5000 });

  const archPill = page.locator('.knowledge-cat-pill', { hasText: 'Architecture' });
  await archPill.click();
  await expect(archPill).toHaveClass(/active/);

  const cards = page.locator('.knowledge-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(4);

  // "Waymark Architecture Overview" article must be present
  const titles = page.locator('.knowledge-card-title');
  const titleTexts = await titles.allTextContents();
  expect(titleTexts.some(t => /architecture overview/i.test(t))).toBe(true);
});

test('Waymark knowledge base AI Agent category contains correct articles', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-cat-pill', { timeout: 5000 });

  const agentPill = page.locator('.knowledge-cat-pill', { hasText: 'AI Agent' });
  await agentPill.click();
  await expect(agentPill).toHaveClass(/active/);

  const cards = page.locator('.knowledge-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(4);

  const titles = page.locator('.knowledge-card-title');
  const titleTexts = await titles.allTextContents();
  expect(titleTexts.some(t => /builder agent|workboard|rejection/i.test(t))).toBe(true);
});

test('Waymark knowledge base search finds architecture articles', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-search', { timeout: 5000 });

  await page.locator('.knowledge-search').fill('api-client');
  await page.waitForSelector('.knowledge-card', { timeout: 3000 });

  const cards = page.locator('.knowledge-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(1);
});

test('Waymark knowledge base expand reveals full article content with multiple lines', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-expand-btn', { timeout: 5000 });

  const firstCard = page.locator('.knowledge-card').first();
  await firstCard.locator('.knowledge-expand-btn').click();

  await page.waitForSelector('.knowledge-card-content', { timeout: 3000 });
  await expect(firstCard.locator('.knowledge-card-content')).toBeVisible();

  const contentLines = firstCard.locator('.knowledge-content-line');
  // Waymark articles have 4-5 content lines each
  expect(await contentLines.count()).toBeGreaterThanOrEqual(4);
});

test('Waymark knowledge base all sections have article counts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-section-header', { timeout: 5000 });

  const headers = page.locator('.knowledge-section-header');
  expect(await headers.count()).toBeGreaterThanOrEqual(8);

  // Every section header shows a count badge
  const counts = page.locator('.knowledge-section-count');
  expect(await counts.count()).toBeGreaterThanOrEqual(8);
});

test('Waymark knowledge base mobile layout has no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-045');
  await page.waitForSelector('.knowledge-card', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.knowledge-list *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

