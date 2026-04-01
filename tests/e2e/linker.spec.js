// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, setupPublicApp, navigateToSheet } = require('../helpers/test-utils');

/* ============================================================
   linker.spec.js — Community Linker template E2E tests
   Fixture: sheet-058 → linker-community.json (10 entries)
   ============================================================ */

/* ---------- Detection ---------- */

test('linker detected from Name/Link/Type headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-grid', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Linker');
});

/* ---------- Card Rendering ---------- */

test('linker renders all 13 entries as cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const cards = page.locator('.linker-card');
  expect(await cards.count()).toBe(13);
});

test('linker card shows name and description', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // First card is "Cooking & Recipes"
  const firstCard = page.locator('.linker-card').first();
  await expect(firstCard.locator('.linker-card-name')).toContainText('Cooking & Recipes');
  await expect(firstCard.locator('.linker-card-desc')).toContainText('community hub for home cooks');
});

test('linker card shows icon', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const firstIcon = page.locator('.linker-card-icon').first();
  await expect(firstIcon).toContainText('🍳');
});

/* ---------- Type Badges ---------- */

test('linker shows Directory badge for linker-type entries', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // First entry is type "linker" → Directory badge
  const firstBadge = page.locator('.linker-card').first().locator('.linker-card-type');
  await expect(firstBadge).toContainText('Directory');
  await expect(firstBadge).toHaveClass(/linker-type-directory/);
});

test('linker shows Waymark badge for waymark-type entries', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // "Mimi's Kitchen" is index 2 (third entry), type "waymark"
  const mimi = page.locator('.linker-card').nth(2);
  await expect(mimi.locator('.linker-card-type')).toContainText('Waymark');
  await expect(mimi.locator('.linker-card-type')).toHaveClass(/linker-type-waymark/);
});

/* ---------- Tags ---------- */

test('linker renders tag chips', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // First card has "cooking, food, recipes" tags
  const firstTags = page.locator('.linker-card').first().locator('.linker-tag');
  expect(await firstTags.count()).toBe(3);
  const tagTexts = await firstTags.allTextContents();
  expect(tagTexts).toContain('cooking');
  expect(tagTexts).toContain('food');
  expect(tagTexts).toContain('recipes');
});

/* ---------- Search / Filter ---------- */

test('linker search filters cards by name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });

  const search = page.locator('.linker-search');
  await search.fill('Mimi');
  // Only "Mimi's Kitchen" should be visible
  const visibleCards = page.locator('.linker-card:not(.hidden)');
  expect(await visibleCards.count()).toBe(1);
  await expect(visibleCards.first().locator('.linker-card-name')).toContainText("Mimi's Kitchen");
});

test('linker search filters by tags', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });

  const search = page.locator('.linker-search');
  await search.fill('fitness');
  const visibleCards = page.locator('.linker-card:not(.hidden)');
  expect(await visibleCards.count()).toBe(1);
  await expect(visibleCards.first().locator('.linker-card-name')).toContainText('Fitness Tracker');
});

test('linker search shows empty message when no matches', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });

  const search = page.locator('.linker-search');
  await search.fill('zzzznonexistent');
  const emptyMsg = page.locator('.linker-empty-filter');
  await expect(emptyMsg).toBeVisible();
  await expect(emptyMsg).toContainText('No entries matching');
});

test('linker search clears filter when input emptied', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });

  const search = page.locator('.linker-search');
  await search.fill('Mimi');
  expect(await page.locator('.linker-card:not(.hidden)').count()).toBe(1);
  await search.fill('');
  expect(await page.locator('.linker-card:not(.hidden)').count()).toBe(13);
});

/* ---------- Card Click Navigation ---------- */

test('linker card click navigates to #/sheet/{id} in auth mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // Click the type badge (not contenteditable) on first card ("Cooking & Recipes" → sheet-059)
  await page.locator('.linker-card').first().locator('.linker-card-header').click();
  await page.waitForTimeout(300);
  expect(page.url()).toContain('#/sheet/sheet-059');
});

test('linker card click navigates to #/public/{id} in public mode', async ({ page }) => {
  await setupPublicApp(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // Click the first linker card
  await page.locator('.linker-card').first().click();
  await page.waitForTimeout(300);
  expect(page.url()).toContain('#/public/sheet-059');
});

/* ---------- Directory View ---------- */

test('linker directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-linker/Waymark%20Community%20Hub'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('linker directoryView renders folder cards', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-linker/Waymark%20Community%20Hub'; });
  await page.waitForSelector('.linker-directory', { timeout: 8_000 });
  await expect(page.locator('.linker-dir-title')).toContainText('Community Linkers');
});

/* ---------- Security ---------- */

test('linker rejects external URLs and shows warning', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // "External Blog" card has https://example.com/blog — should show invalid warning
  const blogCard = page.locator('.linker-card', { hasText: 'External Blog' });
  await expect(blogCard.locator('.linker-card-warning')).toContainText('Not a valid Waymark link');
  await expect(blogCard).toHaveClass(/linker-card-invalid/);
});

test('linker rejects javascript: URI and shows warning', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // "Sneaky Script" card has javascript:alert(1) — must be blocked
  const malCard = page.locator('.linker-card', { hasText: 'Sneaky Script' });
  await expect(malCard.locator('.linker-card-warning')).toContainText('Not a valid Waymark link');
  await expect(malCard).toHaveClass(/linker-card-invalid/);
});

test('linker accepts full Waymark URL and extracts sheet ID', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  // "Social Hub" has full URL https://swiftirons.com/waymark/#/sheet/{id}
  const socialCard = page.locator('.linker-card', { hasText: 'Social Hub' });
  // Should NOT show invalid warning — the Waymark URL is valid
  await expect(socialCard.locator('.linker-card-warning')).toHaveCount(0);
  // Should not have the invalid class
  await expect(socialCard).not.toHaveClass(/linker-card-invalid/);
});

test('linker invalid card click does not navigate', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const currentUrl = page.url();
  // Click the invalid "External Blog" card
  await page.locator('.linker-card', { hasText: 'External Blog' }).click();
  await page.waitForTimeout(300);
  // URL should not change
  expect(page.url()).toBe(currentUrl);
});
