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
