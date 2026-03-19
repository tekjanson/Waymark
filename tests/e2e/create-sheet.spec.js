// @ts-check
/**
 * create-sheet.spec.js — Tests for the Create New Sheet modal.
 *
 * Each test bootstraps the app in full isolation via setupApp()
 * and verifies modal visibility, template selection, sheet naming,
 * and creation flow without any shared state between tests.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../helpers/test-utils');

/* ────────────────── Modal opens / closes ────────────────── */

test('clicking Create New Sheet opens the modal', async ({ page }) => {
  await setupApp(page);

  await expect(page.locator('#create-sheet-modal')).toBeHidden();
  await page.locator('#menu-create-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();
});

test('create sheet modal closes when clicking Cancel', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();

  await page.locator('#create-sheet-cancel-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeHidden();
});

test('create sheet modal closes when clicking the X button', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();

  await page.locator('#create-sheet-modal-close').click();
  await expect(page.locator('#create-sheet-modal')).toBeHidden();
});

test('create sheet modal closes when clicking the backdrop', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();

  // Click the overlay background (not the modal content)
  await page.locator('#create-sheet-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#create-sheet-modal')).toBeHidden();
});

/* ────────────────── Template grid ────────────────── */

test('create sheet modal shows a card for every template with default headers', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();

  const expected = await page.evaluate(async () => {
    const { TEMPLATES } = await import('/js/templates/index.js');
    return Object.values(TEMPLATES).filter(t => Array.isArray(t.defaultHeaders) && t.defaultHeaders.length > 0).length;
  });

  const cards = page.locator('.create-sheet-card');
  await expect(cards).toHaveCount(expected);
});

test('iot template card is visible and can be selected', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();

  const iotCard = page.locator('.create-sheet-card', {
    has: page.locator('.create-sheet-card-name', { hasText: 'IoT Sensor Dashboard' }),
  });
  await expect(iotCard).toBeVisible();
  await iotCard.click();
  await expect(iotCard).toHaveClass(/selected/);
});

test('each template card shows name and headers', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();

  // Check the first card has a name and header text
  const firstCard = page.locator('.create-sheet-card').first();
  await expect(firstCard.locator('.create-sheet-card-name')).toBeVisible();
  await expect(firstCard.locator('.create-sheet-card-headers')).toBeVisible();
});

/* ────────────────── Selection behaviour ────────────────── */

test('clicking a template card selects it', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  const firstCard = page.locator('.create-sheet-card').first();

  // Not selected initially
  await expect(firstCard).not.toHaveClass(/selected/);

  await firstCard.click();
  await expect(firstCard).toHaveClass(/selected/);
});

test('clicking a template auto-fills the name if empty', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();

  // Name should start empty
  await expect(page.locator('#create-sheet-name')).toHaveValue('');

  // Click a template
  await page.locator('.create-sheet-card').first().click();

  // Name should be auto-filled
  const nameVal = await page.locator('#create-sheet-name').inputValue();
  expect(nameVal.startsWith('My ')).toBe(true);
});

test('selecting a different card deselects the previous one', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  const cards = page.locator('.create-sheet-card');

  await cards.nth(0).click();
  await expect(cards.nth(0)).toHaveClass(/selected/);

  await cards.nth(1).click();
  await expect(cards.nth(0)).not.toHaveClass(/selected/);
  await expect(cards.nth(1)).toHaveClass(/selected/);
});

/* ────────────────── Create button state ────────────────── */

test('create button is disabled until template selected and name entered', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  const createBtn = page.locator('#create-sheet-create-btn');

  // Initially disabled
  await expect(createBtn).toBeDisabled();

  // Type a name — still disabled (no template)
  await page.locator('#create-sheet-name').fill('Test Sheet');
  await expect(createBtn).toBeDisabled();

  // Clear name, click template — disabled (auto-fills, but let's clear)
  await page.locator('#create-sheet-name').fill('');
  await page.locator('.create-sheet-card').first().click();
  // Auto-fill happened, so it should be enabled now
  await expect(createBtn).toBeEnabled();
});

test('create button enables when both name and template are set', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();

  // Fill name first, then select template
  await page.locator('#create-sheet-name').fill('My Budget');
  await page.locator('.create-sheet-card').first().click();

  await expect(page.locator('#create-sheet-create-btn')).toBeEnabled();
});

/* ────────────────── Sheet creation ────────────────── */

test('creating a sheet records the correct data in WAYMARK_RECORDS', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();

  // Select Budget template (find card with text "Budget")
  const budgetCard = page.locator('.create-sheet-card', { has: page.locator('.create-sheet-card-name', { hasText: 'Budget' }) });
  await budgetCard.click();

  // Set a custom name
  await page.locator('#create-sheet-name').fill('My Personal Budget');

  // Click create
  await page.locator('#create-sheet-create-btn').click();

  // Wait for modal to close
  await expect(page.locator('#create-sheet-modal')).toBeHidden({ timeout: 5000 });

  // Check records
  const records = await getCreatedRecords(page);
  const createRecord = records.find(r => r.title === 'My Personal Budget');
  expect(createRecord).toBeTruthy();
  expect(createRecord.spreadsheetId).toContain('created-sheet-');
  expect(createRecord.rows).toBeTruthy();
  expect(createRecord.rows[0]).toContain('Description');
  expect(createRecord.rows[0]).toContain('Amount');
});

test('creating an IoT sheet writes IoT headers', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();

  const iotCard = page.locator('.create-sheet-card', {
    has: page.locator('.create-sheet-card-name', { hasText: 'IoT Sensor Dashboard' }),
  });
  await iotCard.click();
  await page.locator('#create-sheet-name').fill('My IoT Sheet');

  await page.locator('#create-sheet-create-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeHidden({ timeout: 5000 });

  const records = await getCreatedRecords(page);
  const createRecord = records.find(r => r.title === 'My IoT Sheet');
  expect(createRecord).toBeTruthy();
  expect(createRecord.rows?.[0]).toEqual(['Sensor', 'Reading', 'Unit', 'Timestamp', 'Min', 'Max', 'Alert']);
});

test('creating a sheet shows a success toast', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  await page.locator('.create-sheet-card').first().click();
  await page.locator('#create-sheet-name').fill('Test Toast Sheet');
  await page.locator('#create-sheet-create-btn').click();

  // Wait for toast
  await page.waitForSelector('#toast-container .toast', { timeout: 5000 });
  const toast = page.locator('#toast-container .toast');
  await expect(toast).toContainText('Created');
});

test('creating a sheet navigates to the new sheet', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-create-btn').click();
  await page.locator('.create-sheet-card').first().click();
  await page.locator('#create-sheet-name').fill('Nav Test Sheet');
  await page.locator('#create-sheet-create-btn').click();

  // Wait for navigation
  await page.waitForFunction(
    () => window.location.hash.startsWith('#/sheet/created-sheet-'),
    { timeout: 5000 },
  );
  expect(page.url()).toContain('#/sheet/created-sheet-');
});

test('modal resets state when reopened', async ({ page }) => {
  await setupApp(page);

  // Open and select a template
  await page.locator('#menu-create-btn').click();
  await page.locator('.create-sheet-card').first().click();
  await page.locator('#create-sheet-name').fill('First Sheet');

  // Close and reopen
  await page.locator('#create-sheet-cancel-btn').click();
  await page.locator('#menu-create-btn').click();

  // Name should be empty, no template selected, button disabled
  await expect(page.locator('#create-sheet-name')).toHaveValue('');
  await expect(page.locator('#create-sheet-create-btn')).toBeDisabled();
  const selectedCards = page.locator('.create-sheet-card.selected');
  await expect(selectedCards).toHaveCount(0);
});

test('home action create button opens modal with template grid populated', async ({ page }) => {
  await setupApp(page);

  // Click the home view create button
  const homeBtn = page.locator('#home-action-create');
  await homeBtn.click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();

  // Template cards should be rendered (not empty)
  const cards = page.locator('.create-sheet-card');
  expect(await cards.count()).toBeGreaterThan(0);
});
