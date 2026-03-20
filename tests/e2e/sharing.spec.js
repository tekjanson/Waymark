// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/*
 * Sharing & Multi-folder tests — slimmed down after the Google Picker
 * migration removed the Drive folder-tree explorer. The old tests for
 * folder items, shared badges, expand/collapse, ignore buttons, and
 * folder-level pinning are no longer applicable. Remaining tests
 * verify pinned-folder rendering on the home page.
 */

test('pre-seeded pinned folders appear on home immediately', async ({ page }) => {
  // Precondition: two folders already pinned via setupApp
  await setupApp(page, {
    pinnedFolders: [
      { id: 'f1', name: 'Groceries', owner: null, shared: false },
      { id: 'f3', name: 'Family Chores', owner: 'spouse@gmail.com', shared: true },
    ],
  });

  const cards = page.locator('.pinned-card');
  expect(await cards.count()).toBe(2);
  await expect(page.locator('.pinned-card-name', { hasText: 'Groceries' })).toBeVisible();
  await expect(page.locator('.pinned-card-name', { hasText: 'Family Chores' })).toBeVisible();
});
