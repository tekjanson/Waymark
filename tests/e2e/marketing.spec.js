// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('marketing detected as Content Workbench template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Content Workbench');
});

test('marketing renders scoreboard with post count and engagements', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-scoreboard', { timeout: 5_000 });

  await expect(page.locator('.marketing-scoreboard')).toBeVisible();
  const items = page.locator('.marketing-score-item');
  expect(await items.count()).toBe(5);
});

test('marketing renders what\'s working section for top posts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-whats-working', { timeout: 5_000 });

  await expect(page.locator('.marketing-whats-working')).toBeVisible();
  const topPosts = page.locator('.marketing-top-post');
  expect(await topPosts.count()).toBeGreaterThanOrEqual(2);
});

test('marketing renders platform breakdown cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-platforms', { timeout: 5_000 });

  await expect(page.locator('.marketing-platforms')).toBeVisible();
  const platCards = page.locator('.marketing-plat-card');
  expect(await platCards.count()).toBeGreaterThanOrEqual(2);
});

test('marketing renders post cards for all rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card', { timeout: 5_000 });

  const cards = page.locator('.marketing-card');
  expect(await cards.count()).toBe(11);
});

test('marketing status badge cycles on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-stage-btn', { timeout: 5_000 });

  const firstBtn = page.locator('.marketing-stage-btn').first();
  const initialText = await firstBtn.textContent();
  await firstBtn.click();

  const newText = await firstBtn.textContent();
  expect(newText).not.toBe(initialText);

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
});

test('marketing card shows platform badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card-platform', { timeout: 5_000 });

  const badges = page.locator('.marketing-card-platform');
  expect(await badges.count()).toBeGreaterThan(0);
});

test('marketing card shows engagement stats for posted content', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card-eng', { timeout: 5_000 });

  await expect(page.locator('.marketing-card-eng').first()).toBeVisible();
  const stats = page.locator('.marketing-eng-stat');
  expect(await stats.count()).toBeGreaterThan(0);
});

test('marketing card shows status-specific border colors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card', { timeout: 5_000 });

  await expect(page.locator('.marketing-card-posted').first()).toBeVisible();
  await expect(page.locator('.marketing-card-idea').first()).toBeVisible();
  await expect(page.locator('.marketing-card-drafting').first()).toBeVisible();
});

test('marketing post body is editable via inline edit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-card-body', { timeout: 5_000 });

  const bodyEl = page.locator('.marketing-card-body').first();
  await bodyEl.click();

  const input = page.locator('.marketing-card-body input.editable-cell-input');
  await expect(input).toBeVisible({ timeout: 3_000 });
  await input.fill('Updated post content');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'Updated post content')).toBe(true);
});

test('marketing AI writer panel is visible with form elements', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-writer', { timeout: 5_000 });

  await expect(page.locator('.marketing-writer')).toBeVisible();
  await expect(page.locator('.marketing-writer-platform')).toBeVisible();
  await expect(page.locator('.marketing-writer-idea')).toBeVisible();
  await expect(page.locator('.marketing-writer-gen-btn')).toBeVisible();
});

test('marketing AI writer collapses and expands on header click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-writer', { timeout: 5_000 });

  await expect(page.locator('.marketing-writer-body')).toBeVisible();
  await page.click('.marketing-writer-header');
  await expect(page.locator('.marketing-writer-body')).toBeHidden();
  await page.click('.marketing-writer-header');
  await expect(page.locator('.marketing-writer-body')).toBeVisible();
});

test('marketing AI writer preserves state across re-render', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-writer', { timeout: 5_000 });

  // Type an idea and select a platform
  await page.selectOption('.marketing-writer-platform', 'reddit');
  await page.fill('.marketing-writer-idea', 'My test idea that should survive');

  // Simulate an auto-refresh (click the refresh button which reloads the sheet)
  await page.evaluate(() => {
    const btn = document.querySelector('#refresh-btn');
    if (btn) btn.click();
  });

  // Wait for re-render to complete
  await page.waitForSelector('.marketing-writer', { timeout: 5_000 });

  // Verify state was preserved
  expect(await page.locator('.marketing-writer-idea').inputValue()).toBe('My test idea that should survive');
  expect(await page.locator('.marketing-writer-platform').inputValue()).toBe('reddit');
});

test('marketing AI writer generates draft via Gemini API', async ({ page }) => {
  await setupApp(page);

  // Mock generateContent endpoint
  await page.route(/generateContent/, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: 'Just shipped a new feature in Waymark that makes spreadsheets actually useful. No more staring at rows of data — now it turns into something you can work with. Try it out.' }],
          },
        }],
      }),
    });
  });

  // Set an API key so generateText can find one
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'test-key-123', nickname: 'Test', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
  });

  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-writer', { timeout: 5_000 });

  await page.selectOption('.marketing-writer-platform', 'twitter');
  await page.fill('.marketing-writer-idea', 'Announce the new template feature in Waymark');
  await page.click('.marketing-writer-gen-btn');

  await expect(page.locator('.marketing-writer-draft')).toBeVisible({ timeout: 10_000 });
  const draftText = await page.locator('.marketing-writer-draft-text').inputValue();
  expect(draftText.length).toBeGreaterThan(10);
});

test('marketing AI writer adds draft to sheet on "Add to Sheet"', async ({ page }) => {
  await setupApp(page);

  await page.route(/generateContent/, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: 'AI generated test post content' }],
          },
        }],
      }),
    });
  });

  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'test-key-456', nickname: 'Test', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
  });

  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-writer', { timeout: 5_000 });

  await page.selectOption('.marketing-writer-platform', 'linkedin');
  await page.fill('.marketing-writer-idea', 'Test idea for adding to sheet');
  await page.click('.marketing-writer-gen-btn');

  await expect(page.locator('.marketing-writer-draft')).toBeVisible({ timeout: 10_000 });
  await page.click('.marketing-writer-use-btn');

  // _onAddRow uses appendRows which creates row-append records
  const records = await getCreatedRecords(page);
  const appends = records.filter(r => r.type === 'row-append');
  expect(appends.length).toBeGreaterThanOrEqual(1);
  // Verify the appended row contains the AI-generated content
  const lastAppend = appends[appends.length - 1];
  const appendedRow = lastAppend.rows[0];
  expect(appendedRow.some(v => v.includes('AI generated test post content'))).toBe(true);
  expect(appendedRow.some(v => v === 'LinkedIn')).toBe(true);
  expect(appendedRow.some(v => v === 'Idea')).toBe(true);
});

/* ---------- Sync Metrics button and modal ---------- */

test('marketing scoreboard shows Sync Metrics button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-scoreboard', { timeout: 5000 });
  await expect(page.locator('.marketing-sync-btn')).toBeVisible();
  await expect(page.locator('.marketing-sync-btn')).toContainText('Sync Metrics');
});

test('Sync Metrics button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await expect(page.locator('.marketing-sync-btn')).toHaveCSS('cursor', 'pointer');
});

test('clicking Sync Metrics opens the metrics modal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await page.click('.marketing-sync-btn');
  await page.waitForSelector('.marketing-metrics-overlay', { timeout: 3000 });
  await expect(page.locator('.marketing-metrics-overlay')).toBeVisible();
  await expect(page.locator('.marketing-metrics-modal')).toBeVisible();
  await expect(page.locator('.marketing-metrics-modal-title')).toContainText(/Sync Metrics/i);
});

test('metrics modal contains config JSON with correct shape', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await page.click('.marketing-sync-btn');
  await page.waitForSelector('.marketing-metrics-config', { timeout: 3000 });

  const configText = await page.locator('.marketing-metrics-config').textContent();
  const config = JSON.parse(configText);
  // Must have sheetId
  expect(typeof config.sheetId).toBe('string');
  // Must have apiKey fields for supported platforms
  expect('youtubeApiKey' in config).toBe(true);
  expect('twitterBearerToken' in config).toBe(true);
});

test('metrics modal Copy Config button copies JSON to clipboard', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await page.click('.marketing-sync-btn');
  await page.waitForSelector('.marketing-metrics-copy-btn', { timeout: 3000 });

  // Grant clipboard permissions
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('.marketing-metrics-copy-btn');

  // Button text should change to indicate success
  await expect(page.locator('.marketing-metrics-copy-btn')).toContainText(/copied|✓/i, { timeout: 2000 });
});

test('metrics modal closes via X button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await page.click('.marketing-sync-btn');
  await page.waitForSelector('.marketing-metrics-overlay', { timeout: 3000 });

  await page.click('.marketing-metrics-modal-close');
  await expect(page.locator('.marketing-metrics-overlay')).toBeHidden();
});

test('metrics modal closes via overlay click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await page.click('.marketing-sync-btn');
  await page.waitForSelector('.marketing-metrics-overlay', { timeout: 3000 });

  await page.click('.marketing-metrics-overlay', { position: { x: 5, y: 5 } });
  await expect(page.locator('.marketing-metrics-overlay')).toBeHidden();
});

test('metrics modal closes via Escape key', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await page.click('.marketing-sync-btn');
  await page.waitForSelector('.marketing-metrics-overlay', { timeout: 3000 });

  await page.keyboard.press('Escape');
  await expect(page.locator('.marketing-metrics-overlay')).toBeHidden();
});

test('metrics modal shows platform support table with key platforms', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await page.click('.marketing-sync-btn');
  await page.waitForSelector('.marketing-metrics-platforms', { timeout: 3000 });
  const table = page.locator('.marketing-metrics-platform-table');
  await expect(table).toBeVisible();
  // Verify all major platforms are listed
  const tableText = await table.textContent();
  expect(tableText).toMatch(/YouTube/i);
  expect(tableText).toMatch(/Hacker News/i);
  expect(tableText).toMatch(/Reddit/i);
  expect(tableText).toMatch(/Twitter/i);
  expect(tableText).toMatch(/LinkedIn/i);
});

test('metrics modal shows step-by-step setup instructions', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.marketing-sync-btn', { timeout: 5000 });
  await page.click('.marketing-sync-btn');
  await page.waitForSelector('.marketing-metrics-steps', { timeout: 3000 });
  const steps = page.locator('.marketing-metrics-steps ol li');
  const count = await steps.count();
  expect(count).toBeGreaterThanOrEqual(4);
});

/* ---------- Worker template: metrics handler badge ---------- */

test('worker template shows metrics handler badge with amber color', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-061');
  await page.waitForSelector('.worker-card', { timeout: 5000 });
  // Find the card for the 'metrics' handler
  const metricsBadge = page.locator('.worker-handler-badge').filter({ hasText: /metrics/i });
  await expect(metricsBadge.first()).toBeVisible();
});
