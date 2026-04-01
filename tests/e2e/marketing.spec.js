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

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
});
