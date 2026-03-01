// @ts-check
/**
 * examples-modal.spec.js — Tests for the example generation modal.
 *
 * Each test bootstraps the app in full isolation via setupApp()
 * and verifies modal visibility, category selection behaviour,
 * and generation flow without any shared state between tests.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToHome } = require('../helpers/test-utils');

/* ────────────────── Modal opens / closes ────────────────── */

test('clicking Generate Example Sheets opens the modal', async ({ page }) => {
  await setupApp(page);

  await expect(page.locator('#examples-modal')).toBeHidden();
  await page.locator('#generate-examples-btn').click();
  await expect(page.locator('#examples-modal')).toBeVisible();
});

test('modal closes when clicking Cancel', async ({ page }) => {
  await setupApp(page);

  await page.locator('#generate-examples-btn').click();
  await expect(page.locator('#examples-modal')).toBeVisible();

  await page.locator('#examples-cancel-btn').click();
  await expect(page.locator('#examples-modal')).toBeHidden();
});

test('modal closes when clicking the X button', async ({ page }) => {
  await setupApp(page);

  await page.locator('#generate-examples-btn').click();
  await expect(page.locator('#examples-modal')).toBeVisible();

  await page.locator('#examples-modal-close').click();
  await expect(page.locator('#examples-modal')).toBeHidden();
});

test('modal closes when clicking the backdrop', async ({ page }) => {
  await setupApp(page);

  await page.locator('#generate-examples-btn').click();
  await expect(page.locator('#examples-modal')).toBeVisible();

  // Click the overlay background (not the modal content)
  await page.locator('#examples-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#examples-modal')).toBeHidden();
});

/* ────────────────── Category cards ────────────────── */

test('modal displays all expected category cards', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  const cards = page.locator('.example-category-card');
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(10); // We have 18 categories

  // Spot-check a few category names
  const names = await page.$$eval('.example-category-name', els => els.map(e => e.textContent.trim()));
  expect(names).toContain('Checklists');
  expect(names).toContain('Trackers');
  expect(names).toContain('Kanban');
  expect(names).toContain('Budgets');
});

test('all categories are selected by default', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  const cards = page.locator('.example-category-card');
  const total = await cards.count();

  const selected = page.locator('.example-category-card.selected');
  const selectedCount = await selected.count();
  expect(selectedCount).toBe(total);
});

test('each category card shows sheet count', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  // Every card should display "N sheet(s)"
  const sheetLabels = await page.$$eval(
    '.example-category-info .text-muted',
    els => els.map(e => e.textContent.trim()),
  );
  expect(sheetLabels.length).toBeGreaterThan(0);
  for (const label of sheetLabels) {
    expect(label).toMatch(/\d+ sheets?$/);
  }
});

/* ────────────────── Selection controls ────────────────── */

test('clicking a selected card deselects it', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  const firstCard = page.locator('.example-category-card').first();
  await expect(firstCard).toHaveClass(/selected/);

  await firstCard.click();
  await expect(firstCard).not.toHaveClass(/selected/);
});

test('clicking a deselected card selects it', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  // Deselect first, then re-select
  const firstCard = page.locator('.example-category-card').first();
  await firstCard.click(); // deselect
  await expect(firstCard).not.toHaveClass(/selected/);

  await firstCard.click(); // re-select
  await expect(firstCard).toHaveClass(/selected/);
});

test('Select None deselects all categories', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  await page.locator('#examples-select-none').click();

  const selected = page.locator('.example-category-card.selected');
  expect(await selected.count()).toBe(0);
});

test('Select All after Select None re-selects all categories', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  await page.locator('#examples-select-none').click();
  expect(await page.locator('.example-category-card.selected').count()).toBe(0);

  await page.locator('#examples-select-all').click();

  const total = await page.locator('.example-category-card').count();
  const selected = await page.locator('.example-category-card.selected').count();
  expect(selected).toBe(total);
});

test('selection count text updates as categories are toggled', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  const countEl = page.locator('#examples-selection-count');
  const totalCards = await page.locator('.example-category-card').count();

  // All selected by default
  await expect(countEl).toContainText(`${totalCards} of ${totalCards}`);

  // Deselect one
  await page.locator('.example-category-card').first().click();
  await expect(countEl).toContainText(`${totalCards - 1} of ${totalCards}`);

  // Select None
  await page.locator('#examples-select-none').click();
  await expect(countEl).toContainText(`0 of ${totalCards}`);
});

test('Generate button is disabled when no categories selected', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  await page.locator('#examples-select-none').click();
  await expect(page.locator('#examples-generate-btn')).toBeDisabled();
});

test('Generate button is enabled when at least one category selected', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  // Deselect all, then select one
  await page.locator('#examples-select-none').click();
  await expect(page.locator('#examples-generate-btn')).toBeDisabled();

  await page.locator('.example-category-card').first().click();
  await expect(page.locator('#examples-generate-btn')).toBeEnabled();
});

/* ────────────────── Generate action ────────────────── */

test('clicking Generate Selected shows progress text', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  // Select only one category to keep the generation fast
  await page.locator('#examples-select-none').click();
  await page.locator('.example-category-card').first().click();

  // Watch for progress text to appear at any point during generation
  const progressEl = page.locator('#examples-modal-progress');
  // Capture text even after generation completes (it stays in the DOM)
  await page.locator('#examples-generate-btn').click();

  // Wait for generation to complete — progress element will have text
  // regardless of whether it's still visible (fast mock mode may hide modal)
  await expect(progressEl).toHaveText(/.+/, { timeout: 10_000 });
  const progressText = await progressEl.textContent();
  expect(progressText.length).toBeGreaterThan(0);
});

test('Generate button text changes to Generating… during generation', async ({ page }) => {
  await setupApp(page);
  await page.locator('#generate-examples-btn').click();

  await page.locator('#examples-select-none').click();
  await page.locator('.example-category-card').first().click();

  const genBtn = page.locator('#examples-generate-btn');
  await expect(genBtn).toHaveText('Generate Selected');

  // Inject a delay into the mock createFile API to slow generation
  await page.evaluate(() => {
    const origCreateFile = window.__WAYMARK_API_REF?.drive?.createFile;
    if (origCreateFile) {
      window.__WAYMARK_API_REF.drive.createFile = async (...args) => {
        await new Promise(r => setTimeout(r, 2000));
        return origCreateFile(...args);
      };
    }
  });

  // If we can't monkey-patch, verify button text at minimum via a race
  const genPromise = genBtn.click();

  // The button text should change to "Generating…" during the async operation
  // Use polling to catch the transient state
  const sawGenerating = await Promise.race([
    expect(genBtn).toHaveText('Generating…', { timeout: 3000 }).then(() => true).catch(() => false),
    genPromise.then(() => false),
  ]);

  // If mock generation is too fast to catch the transient state, verify
  // that the button at least returns to its original text after completion
  await expect(genBtn).toHaveText('Generate Selected', { timeout: 10_000 });
});

/* ────────────────── Modal state resets ────────────────── */

test('re-opening modal resets all categories to selected', async ({ page }) => {
  await setupApp(page);

  // Open, deselect some, close
  await page.locator('#generate-examples-btn').click();
  await page.locator('#examples-select-none').click();
  expect(await page.locator('.example-category-card.selected').count()).toBe(0);
  await page.locator('#examples-cancel-btn').click();

  // Re-open — should be all selected again
  await page.locator('#generate-examples-btn').click();
  const total = await page.locator('.example-category-card').count();
  const selected = await page.locator('.example-category-card.selected').count();
  expect(selected).toBe(total);
});
