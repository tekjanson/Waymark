// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('emergency contacts detected as Contacts template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.template-contact-card', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Contacts');

  // Check contact cards rendered
  const cards = page.locator('.template-contact-card');
  expect(await cards.count()).toBe(8);

  // Check a name
  const names = await page.locator('.template-contact-name').allTextContents();
  expect(names).toContain('Dr. Sarah Johnson');
});

test('contacts show editable phone and email fields', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.template-contact-card', { timeout: 5_000 });

  // Contact fields are editable cells (phone + email share template-contact-link class)
  const contactLinks = page.locator('.template-contact-link.editable-cell');
  expect(await contactLinks.count()).toBeGreaterThan(0);

  // Name fields are also editable
  const names = page.locator('.template-contact-name.editable-cell');
  expect(await names.count()).toBeGreaterThan(0);
});

test('contacts are sorted alphabetically with letter headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.contacts-letter-header', { timeout: 5_000 });

  const headers = await page.locator('.contacts-letter-header').allTextContents();
  // Sorted letters from fixture: C, D, H, L, M, P, T, V
  expect(headers.length).toBeGreaterThanOrEqual(5);
  // Verify alphabetical order
  for (let i = 1; i < headers.length; i++) {
    expect(headers[i] >= headers[i - 1]).toBe(true);
  }
});

test('contacts show alphabetical sidebar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.contacts-alpha-sidebar', { timeout: 5_000 });

  const buttons = page.locator('.contacts-alpha-btn');
  expect(await buttons.count()).toBe(27); // A-Z + #

  // Active letters should not have disabled class
  const activeBtn = page.locator('.contacts-alpha-btn:not(.contacts-alpha-disabled)');
  expect(await activeBtn.count()).toBeGreaterThanOrEqual(5);
});

test('contacts search filters cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.template-contact-card', { timeout: 5_000 });

  const search = page.locator('.contacts-search');
  await search.fill('sarah');
  await page.waitForTimeout(200);

  const visibleCards = page.locator('.template-contact-card:not([style*="display: none"])');
  expect(await visibleCards.count()).toBe(1);
  const text = await visibleCards.first().textContent();
  expect(text).toContain('Sarah Johnson');
});

test('contacts search clears to show all cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-013');
  await page.waitForSelector('.template-contact-card', { timeout: 5_000 });

  const search = page.locator('.contacts-search');
  await search.fill('sarah');
  await page.waitForTimeout(200);
  await search.fill('');
  await page.waitForTimeout(200);

  const visibleCards = page.locator('.template-contact-card:not([style*="display: none"])');
  expect(await visibleCards.count()).toBe(8);
});
