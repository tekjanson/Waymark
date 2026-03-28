const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, navigateToHome } = require('../helpers/test-utils');

/* ============================================================
   pin-sheet.spec.js — E2E tests for sheet pinning
   Covers: pin button click, toast, CSS state, home rendering,
   unpin flow, persistence across navigation, pre-seeded pins.
   ============================================================ */

test('pin button toggles pinned class on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  // Initially not pinned
  await expect(page.locator('#sheet-pin-btn')).not.toHaveClass(/pinned/);

  // Click to pin
  await page.locator('#sheet-pin-btn').click();
  await expect(page.locator('#sheet-pin-btn')).toHaveClass(/pinned/);
});

test('pin button shows toast with pinned message', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  await page.locator('#sheet-pin-btn').click();
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible({ timeout: 3000 });
  await expect(toast).toContainText(/pinned/i);
});

test('unpinning a sheet removes pinned class and shows unpin toast', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  // Pin first
  await page.locator('#sheet-pin-btn').click();
  await expect(page.locator('#sheet-pin-btn')).toHaveClass(/pinned/);
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Wait for toast to disappear
  await page.waitForFunction(() => !document.querySelector('.toast'), { timeout: 5000 }).catch(() => {});

  // Unpin
  await page.locator('#sheet-pin-btn').click();
  await expect(page.locator('#sheet-pin-btn')).not.toHaveClass(/pinned/);

  const toast = page.locator('.toast');
  await expect(toast).toBeVisible({ timeout: 3000 });
  await expect(toast).toContainText(/unpinned/i);
});

test('pinned sheet appears on home page after pinning', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  // Pin the sheet
  await page.locator('#sheet-pin-btn').click();
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Navigate back to home
  await navigateToHome(page);

  // The pinned sheets section should be visible
  await expect(page.locator('#home-pinned-sheets')).not.toHaveClass(/hidden/);

  // There should be at least one pinned card
  const cards = page.locator('#pinned-sheets .pinned-card');
  await expect(cards).toHaveCount(1);
});

test('pinned sheet card on home page navigates to the sheet on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  // Pin the sheet
  await page.locator('#sheet-pin-btn').click();
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Go home
  await navigateToHome(page);
  await page.waitForSelector('#pinned-sheets .pinned-card', { timeout: 5000 });

  // Click the pinned card
  await page.locator('#pinned-sheets .pinned-card').first().click();

  // Should navigate to checklist view
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
});

test('pin button state is restored when reopening a pinned sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-002');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  // Pin sheet-002
  await page.locator('#sheet-pin-btn').click();
  await expect(page.locator('#sheet-pin-btn')).toHaveClass(/pinned/);

  // Navigate home then back to the same sheet
  await navigateToHome(page);
  await navigateToSheet(page, 'sheet-002');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  // Pin state should be restored
  await expect(page.locator('#sheet-pin-btn')).toHaveClass(/pinned/);
});

test('pre-seeded pinned sheets render on home page', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [
      { id: 'sheet-001', name: 'Groceries', templateKey: 'checklist', pinnedAt: new Date().toISOString() },
      { id: 'sheet-016', name: 'Personal Budget', templateKey: 'budget', pinnedAt: new Date().toISOString() },
    ],
  });

  // Home should show pinned sheets section
  await expect(page.locator('#home-pinned-sheets')).not.toHaveClass(/hidden/);

  const cards = page.locator('#pinned-sheets .pinned-card');
  await expect(cards).toHaveCount(2);
});

test('empty pinned sheets section is hidden on home page', async ({ page }) => {
  await setupApp(page);

  // With no pinned sheets, the section should be hidden
  await expect(page.locator('#home-pinned-sheets')).toHaveClass(/hidden/);
});

test('pin button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });
  await expect(page.locator('#sheet-pin-btn')).toHaveCSS('cursor', 'pointer');
});

test('pin bounce animation class is applied and removed', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  await page.locator('#sheet-pin-btn').click();

  // The pin-bounce class should be added immediately
  await expect(page.locator('#sheet-pin-btn')).toHaveClass(/pin-bounce/);

  // After animation ends, the class is removed
  await page.waitForFunction(
    () => !document.getElementById('sheet-pin-btn').classList.contains('pin-bounce'),
    { timeout: 5000 },
  );
});

test('unpinned sheet disappears from home page', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });

  // Pin the sheet
  await page.locator('#sheet-pin-btn').click();
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Go home — should show 1 pinned card
  await navigateToHome(page);
  await expect(page.locator('#pinned-sheets .pinned-card')).toHaveCount(1);

  // Go back to sheet and unpin
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#sheet-pin-btn', { timeout: 5000 });
  await page.locator('#sheet-pin-btn').click();
  await page.waitForSelector('.toast', { timeout: 3000 });

  // Go home — pinned section should be hidden
  await navigateToHome(page);
  await expect(page.locator('#home-pinned-sheets')).toHaveClass(/hidden/);
});
