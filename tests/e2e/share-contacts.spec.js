// @ts-check
/**
 * share-contacts.spec.js — Contacts Waymark picker inside the Share modal.
 *
 * The collaborator invite section pulls contacts from the user's Contacts
 * Waymark sheets (discovered from pinned/recent sheets) so a collaborator
 * can be chosen from a dropdown, while manual email entry still works.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

// A Contacts Waymark the user has pinned — makes it discoverable to the picker.
const CONTACTS_BOOK = { id: 'sheet-013', name: 'Emergency Contacts', templateKey: 'contacts', pinnedAt: new Date().toISOString() };

async function openShareModal(page) {
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items', { timeout: 5_000 });
  await page.click('#share-btn');
  await page.waitForSelector('#share-modal', { timeout: 5_000 });
}

test('share modal shows a contacts picker when the user has a Contacts Waymark', async ({ page }) => {
  await setupApp(page, { pinnedSheets: [CONTACTS_BOOK] });
  await openShareModal(page);

  const select = page.locator('.share-invite-contact-select');
  await expect(select).toBeVisible({ timeout: 5_000 });
  // Placeholder option + at least one real contact from the fixture.
  const optionCount = await select.locator('option').count();
  expect(optionCount).toBeGreaterThan(1);
});

test('selecting a contact fills the collaborator email field', async ({ page }) => {
  await setupApp(page, { pinnedSheets: [CONTACTS_BOOK] });
  await openShareModal(page);

  await page.waitForSelector('.share-invite-contact-select option[value="sjohnson@medical.com"]', { state: 'attached', timeout: 5_000 });
  // Pick the first real contact (fixture: sjohnson@medical.com).
  await page.selectOption('.share-invite-contact-select', 'sjohnson@medical.com');

  await expect(page.locator('.share-invite-email')).toHaveValue('sjohnson@medical.com');
});

test('contacts picker is hidden when the user has no Contacts Waymark', async ({ page }) => {
  await setupApp(page);
  await openShareModal(page);

  // Manual email entry must still work; the picker container stays hidden.
  await expect(page.locator('.share-invite-email')).toBeVisible();
  await expect(page.locator('.share-invite-contact-select')).toHaveCount(0);
});

test('manual email entry still works alongside the contacts picker', async ({ page }) => {
  await setupApp(page, { pinnedSheets: [CONTACTS_BOOK] });
  await openShareModal(page);

  await page.waitForSelector('.share-invite-contact-select', { timeout: 5_000 });
  await page.fill('.share-invite-email', 'brand-new@example.com');
  await expect(page.locator('.share-invite-email')).toHaveValue('brand-new@example.com');
});

test('share modal contacts picker includes Waymarker Crews and updates invite link with ledger ID after grant', async ({ page }) => {
  const CREWS_BOOK = { id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() };
  await setupApp(page, { pinnedSheets: [CREWS_BOOK] });
  await openShareModal(page);

  await page.waitForSelector('.share-invite-contact-select option[value="group:Family Crew"]', { state: 'attached', timeout: 5_000 });
  await page.selectOption('.share-invite-contact-select', 'group:Family Crew');
  await expect(page.locator('.share-invite-email')).toHaveValue('group:Family Crew');

  await page.click('.share-invite-grant-btn');
  await page.waitForSelector('.toast', { timeout: 5_000 });

  const inviteLink = await page.locator('.share-invite-link').inputValue();
  expect(inviteLink).toContain('ledger=');
  expect(inviteLink).toContain('group=Family+Crew');
});
