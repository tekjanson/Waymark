// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

test('choosing a folder then "Set as default" persists and auto-applies for the template', async ({ page }) => {
  await setupApp(page);

  // Open modal
  await page.locator('#menu-create-btn').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();

  // Select the Recipe template card
  const recipeCard = page.locator('.create-sheet-card', {
    has: page.locator('.create-sheet-card-name', { hasText: 'Recipe' }),
  });
  await recipeCard.click();

  // Click Choose Folder (mock picker returns 'Groceries' in local fixtures)
  await page.locator('#create-sheet-choose-folder-btn').click();
  // Wait for the display to update (picker is async in local mocks)
  await page.waitForFunction(() => {
    const el = document.getElementById('create-sheet-folder-display');
    return el && el.textContent && el.textContent.indexOf('Groceries') !== -1;
  }, null, { timeout: 8000 });
  await expect(page.locator('#create-sheet-folder-display')).toContainText('Groceries', { timeout: 2000 });

  // Click the "Set as default" action (button created in status area)
  const setBtn = page.locator('#create-sheet-status').locator('button', { hasText: 'Set as default' });
  await expect(setBtn).toBeVisible();
  await setBtn.click();

  // Confirm status updated
  await expect(page.locator('#create-sheet-status')).toContainText('Default set', { timeout: 3000 });
  // Re-select the Recipe template in the same modal — default folder should auto-apply
  await recipeCard.click();
  await expect(page.locator('#create-sheet-folder-display')).toContainText('Groceries', { timeout: 3000 });
});
