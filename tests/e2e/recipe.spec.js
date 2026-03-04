// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('recipe detected as Recipe template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Recipe');
});

test('recipe renders title and metadata', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card-title', { timeout: 5_000 });

  await expect(page.locator('.recipe-card-title')).toContainText('Spaghetti Bolognese');
  await expect(page.locator('.recipe-difficulty-badge')).toContainText('Easy');
  await expect(page.locator('.recipe-category-badge')).toContainText('Italian');
});

test('recipe renders ingredients with separate quantities', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  const items = page.locator('.recipe-ingredients-list li');
  expect(await items.count()).toBeGreaterThanOrEqual(7);

  // First ingredient should show quantity and name separately
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('400g');

  const firstName = page.locator('.recipe-ingredient-text').first();
  await expect(firstName).toContainText('spaghetti');
});

test('recipe renders instructions as numbered steps', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-instructions-list li', { timeout: 5_000 });

  const steps = page.locator('.recipe-instructions-list li');
  expect(await steps.count()).toBeGreaterThanOrEqual(5);

  await expect(steps.first()).toContainText('Cook spaghetti');
});

test('recipe scale bar is visible with default 1× active', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  const scaleBar = page.locator('.recipe-scale-bar');
  await expect(scaleBar).toBeVisible();

  // 1× button should be active by default
  const activeBtn = page.locator('.recipe-scale-btn.active');
  await expect(activeBtn).toContainText('1×');
});

test('recipe scaling doubles quantities when 2× is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Click 2× button
  const btn2x = page.locator('.recipe-scale-btn[data-scale="2"]');
  await btn2x.click();

  // 2× should now be active
  await expect(btn2x).toHaveClass(/active/);

  // First quantity "400g" → "800g"
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('800g');

  // Servings "4" → "8"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('8');
});

test('recipe scaling halves quantities when ½× is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Click ½× button
  const btnHalf = page.locator('.recipe-scale-btn[data-scale="0.5"]');
  await btnHalf.click();

  // First quantity "400g" → "200g"
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('200g');

  // Servings "4" → "2"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('2');
});

test('recipe scaling resets to original when 1× is clicked back', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Scale to 3×
  await page.locator('.recipe-scale-btn[data-scale="3"]').click();
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('1200g');

  // Reset to 1×
  await page.locator('.recipe-scale-btn[data-scale="1"]').click();
  await expect(firstQty).toContainText('400g');
});

test('recipe inline edit commits on Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-text', { timeout: 5_000 });

  // Click the first ingredient name to start editing
  const ingredientCell = page.locator('.recipe-ingredient-text').first();
  await ingredientCell.click();

  const input = page.locator('.recipe-ingredient-text input.editable-cell-input').first();
  await input.fill('penne');
  await input.press('Enter');

  // Check edit was recorded
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'penne')).toBe(true);
});

test('recipe custom scale input scales quantities', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Type a custom scale of 4
  const customInput = page.locator('.recipe-scale-custom');
  await expect(customInput).toBeVisible();
  await customInput.fill('4');

  // First quantity "400g" → "1600g"
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('1600g');

  // Servings "4" → "16"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('16');

  // Preset buttons should not be active
  const activePresets = page.locator('.recipe-scale-btn.active');
  await expect(activePresets).toHaveCount(0);
});

test('recipe custom scale input clears when preset is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Type a custom scale
  const customInput = page.locator('.recipe-scale-custom');
  await customInput.fill('5');

  // Now click a preset button
  await page.locator('.recipe-scale-btn[data-scale="2"]').click();

  // Custom input should be cleared
  await expect(customInput).toHaveValue('');

  // 2× should be active
  const activeBtn = page.locator('.recipe-scale-btn.active');
  await expect(activeBtn).toContainText('2×');
});

test('recipe displays source URL when present', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  // Source bar should be visible since fixture has a source URL
  const sourceBar = page.locator('.recipe-source-bar');
  await expect(sourceBar).toBeVisible();

  // Source link should contain the domain
  const sourceLink = page.locator('.recipe-source-link');
  await expect(sourceLink).toContainText('example.com');

  // Re-sync button should be present
  const resyncBtn = page.locator('.recipe-resync-btn');
  await expect(resyncBtn).toBeVisible();
  await expect(resyncBtn).toContainText('Re-sync');
});
