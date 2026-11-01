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
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5_000 });

  // Pinned folders render in the Pinned waypoints wayboard widget
  const rows = page.locator('.wayboard-widget-folders .wayboard-data-name');
  await expect(rows).toHaveCount(2, { timeout: 5_000 });
  await expect(rows.filter({ hasText: 'Groceries' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Family Chores' })).toBeVisible();
});
