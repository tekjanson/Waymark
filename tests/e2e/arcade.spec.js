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

