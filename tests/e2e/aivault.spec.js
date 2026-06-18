const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('aivault-template-detected-from-fixture', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  await expect(page.locator('#template-badge')).toContainText('AI Secrets Vault');
});

test('aivault-renders-vault-with-category-grouping', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Should see AI/ML category header
  await expect(page.locator('.aivault-category-header')).toContainText('AI/ML');
  
  // Should see category count
  await expect(page.locator('.aivault-category-count')).toContainText('3');
  
  // Should see cards
  await expect(page.locator('.aivault-card')).toHaveCount(3);
});

test('aivault-displays-service-names-correctly', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Check service names are displayed
  await expect(page.locator('.aivault-card-service')).toContainText('OpenAI');
  await expect(page.locator('.aivault-card-service')).toContainText('Anthropic');
  await expect(page.locator('.aivault-card-service')).toContainText('Cohere');
});

test('aivault-shows-key-names', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Check key names are displayed
  await expect(page.locator('.aivault-card-keyname')).toContainText('GPT-4 Production');
  await expect(page.locator('.aivault-card-keyname')).toContainText('Claude API');
  await expect(page.locator('.aivault-card-keyname')).toContainText('Embed Key');
});

test('aivault-masks-encrypted-keys-by-default', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // All keys should show masked dots
  const valueSpans = await page.locator('.aivault-field-value').all();
  for (const span of valueSpans) {
    const text = await span.textContent();
    expect(text).toBe('••••••••');
  }
});

test('aivault-requires-master-password-on-load', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Auth modal should be visible
  const modal = page.locator('.aivault-auth-modal');
  const isHidden = await modal.evaluate(el => el.classList.contains('hidden'));
  expect(isHidden).toBe(false);
});

test('aivault-can-unlock-vault-with-password', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Fill in password
  await page.fill('#aivault-password-input', 'test-password-123');
  
  // Click unlock button
  await page.click('#aivault-auth-btn');
  
  // Modal should hide
  await expect(page.locator('.aivault-auth-modal')).toHaveClass(/hidden/);
});

test('aivault-search-filters-cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Unlock
  await page.fill('#aivault-password-input', 'password');
  await page.click('#aivault-auth-btn');
  
  // Search for OpenAI
  await page.fill('.aivault-search', 'OpenAI');
  
  // Should show only OpenAI card
  const visibleCards = await page.locator('.aivault-card:not(.hidden)').count();
  expect(visibleCards).toBeGreaterThanOrEqual(1);
  
  // Anthropic card should be hidden
  const anthropicCard = page.locator('.aivault-card-service:has-text("Anthropic")').locator('..').locator('..');
  await expect(anthropicCard).toHaveClass(/hidden/);
});

test('aivault-displays-notes-when-present', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Unlock
  await page.fill('#aivault-password-input', 'password');
  await page.click('#aivault-auth-btn');
  
  // Should see notes
  await expect(page.locator('.aivault-card-notes')).toContainText('Primary GPT-4 API key');
  await expect(page.locator('.aivault-card-notes')).toContainText('Claude Sonnet access');
});

test('aivault-provides-copy-to-clipboard-button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Unlock
  await page.fill('#aivault-password-input', 'password');
  await page.click('#aivault-auth-btn');
  
  // Should have copy buttons
  const copyButtons = await page.locator('.aivault-decrypt-btn').count();
  expect(copyButtons).toBeGreaterThan(0);
});

test('aivault-provides-view-toggle-button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-070');
  
  // Unlock
  await page.fill('#aivault-password-input', 'password');
  await page.click('#aivault-auth-btn');
  
  // Should have view buttons
  const viewButtons = await page.locator('.aivault-view-btn').count();
  expect(viewButtons).toBeGreaterThan(0);
});
