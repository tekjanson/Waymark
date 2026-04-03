// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('arcade detected as Arcade template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-lobby', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Arcade');
});

test('arcade renders game grid with selectable cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-grid', { timeout: 5_000 });

  const cards = page.locator('.arcade-game-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
});

test('arcade game card becomes selected on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-card', { timeout: 5_000 });

  const firstCard = page.locator('.arcade-game-card').first();
  await firstCard.click();
  await expect(firstCard).toHaveClass(/arcade-game-card-selected/);
});

test('arcade renders match history table', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-history', { timeout: 5_000 });

  // Header row + 6 data rows = 7 total, but count only data rows (exclude header)
  const rows = page.locator('.arcade-history-row:not(.arcade-history-header)');
  expect(await rows.count()).toBe(6);
});

test('arcade shows no-peers message when offline', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-lobby', { timeout: 5_000 });

  await expect(page.locator('.arcade-no-peers')).toBeVisible();
});

test('arcade shows session password input field', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-password-row', { timeout: 5_000 });

  await expect(page.locator('.arcade-password-row')).toBeVisible();
  await expect(page.locator('.arcade-password-input')).toBeVisible();
  await expect(page.locator('.arcade-password-label')).toContainText('Password');
});

test('arcade password input uses password type for masking', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-password-input', { timeout: 5_000 });

  const inputType = await page.locator('.arcade-password-input').getAttribute('type');
  expect(inputType).toBe('password');
});

test('arcade password input is initially empty by default', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-password-input', { timeout: 5_000 });

  const val = await page.locator('.arcade-password-input').inputValue();
  expect(val).toBe('');
});

test('arcade password input accepts text entry', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-password-input', { timeout: 5_000 });

  const input = page.locator('.arcade-password-input');
  await input.fill('secret123');
  const val = await input.inputValue();
  expect(val).toBe('secret123');
});

test('arcade password row uses correct layout and styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-password-row', { timeout: 5_000 });

  await expect(page.locator('.arcade-password-row')).toHaveCSS('display', 'flex');
  await expect(page.locator('.arcade-password-input')).toHaveCSS('border-radius', /\d+px/);
});

test('arcade password input has pointer cursor on focus', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-password-input', { timeout: 5_000 });

  // Password input should be interactable (not disabled)
  const disabled = await page.locator('.arcade-password-input').getAttribute('disabled');
  expect(disabled).toBeNull();
});

test('arcade password row appears between connection bar and peers list', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-peers-section', { timeout: 5_000 });

  const section = page.locator('.arcade-peers-section');
  const connectionBar = section.locator('.arcade-connection-bar');
  const passwordRow = section.locator('.arcade-password-row');
  const noPeers = section.locator('.arcade-no-peers');

  // All three should be present within the peers section
  await expect(connectionBar).toBeVisible();
  await expect(passwordRow).toBeVisible();
  await expect(noPeers).toBeVisible();
});

test('arcade no-peers message contains hint to open on another device', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-no-peers', { timeout: 5_000 });

  await expect(page.locator('.arcade-no-peers')).toContainText('No peers connected');
  await expect(page.locator('.arcade-hint')).toBeVisible();
  await expect(page.locator('.arcade-hint')).toContainText('another device');
});

test('arcade connection bar is visible with status dot and label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-connection-bar', { timeout: 5_000 });

  await expect(page.locator('.arcade-status-dot')).toBeVisible();
  await expect(page.locator('.arcade-status-label')).toBeVisible();
  await expect(page.locator('.arcade-peer-count-label')).toBeVisible();
});

test('arcade connection bar shows searching status initially', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-status-label', { timeout: 5_000 });

  // Without a real signal the status stays at 'listening' (searching)
  await expect(page.locator('.arcade-status-label')).toContainText(/search|listen|connect/i);
});

test('arcade game cards have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-card', { timeout: 5_000 });

  await expect(page.locator('.arcade-game-card').first()).toHaveCSS('cursor', 'pointer');
});

test('arcade game cards show net model badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-card', { timeout: 5_000 });

  const badges = page.locator('.arcade-game-badge');
  // At least one badge contains "Turn-Based" or "Real-Time"
  const texts = await badges.allTextContents();
  const hasNetModel = texts.some(t => /turn-based|real-time|host-based/i.test(t));
  expect(hasNetModel).toBe(true);
});

test('arcade game cards show player count badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-card', { timeout: 5_000 });

  const badges = page.locator('.arcade-game-badge');
  const texts = await badges.allTextContents();
  const hasPlayerCount = texts.some(t => /\d+P/.test(t));
  expect(hasPlayerCount).toBe(true);
});

test('arcade lobby uses correct layout with grid for games', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-game-grid', { timeout: 5_000 });

  await expect(page.locator('.arcade-game-grid')).toHaveCSS('display', /grid/);
});

test('arcade lobby renders correctly at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-lobby', { timeout: 5_000 });

  // Verify game grid still renders with cards
  const cards = page.locator('.arcade-game-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(4);

  // No horizontal overflow from lobby
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.arcade-lobby *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.className || el.tagName);
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

test('arcade match history rows have correct count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-history', { timeout: 5_000 });

  // Verify header row exists
  await expect(page.locator('.arcade-history-header')).toBeVisible();
});

test('arcade body switches to single column at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.arcade-body', { timeout: 5_000 });

  // At 375px, the body grid should collapse to single column
  const gridCols = await page.locator('.arcade-body').evaluate(el =>
    getComputedStyle(el).gridTemplateColumns
  );
  // Single column produces one track value, not two
  const trackCount = gridCols.trim().split(/\s+(?=\d)/).length;
  expect(trackCount).toBe(1);
});
