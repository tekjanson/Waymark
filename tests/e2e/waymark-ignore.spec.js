// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../helpers/test-utils');

/*
 * .waymarkIgnore tests — verifies that items are filtered from the
 * explorer when a .waymarkIgnore file exists in the folder, and that
 * the ignore button creates/updates the file correctly.
 */

test('expanding a folder with .waymarkIgnore filters matching items', async ({ page }) => {
  // Home Projects (f2) has a .waymarkIgnore fixture file (f2-ignore)
  // that should hide "Backyard" when its content includes that name
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'f2-ignore': 'Backyard\n' },
  });

  // Expand "Home Projects"
  const homeProjects = page.locator('.folder-item', { hasText: 'Home Projects' });
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // "Home Repairs" sheet should be visible
  await expect(page.locator('.sheet-item', { hasText: 'Home Repairs' })).toBeVisible();

  // "Backyard" folder should be filtered out
  const backyard = page.locator('.folder-name', { hasText: 'Backyard' });
  await expect(backyard).toHaveCount(0);
});

test('.waymarkIgnore file itself is hidden from the listing', async ({ page }) => {
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'f2-ignore': 'Backyard\n' },
  });

  const homeProjects = page.locator('.folder-item', { hasText: 'Home Projects' });
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // The .waymarkIgnore file should not appear in the listing
  const ignoreName = page.locator('.folder-name, .sheet-item', { hasText: '.waymarkIgnore' });
  await expect(ignoreName).toHaveCount(0);
});

test('.waymarkIgnore supports comments and blank lines', async ({ page }) => {
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'f2-ignore': '# This is a comment\n\nBackyard\n\n# Another comment\n' },
  });

  const homeProjects = page.locator('.folder-item', { hasText: 'Home Projects' });
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // "Backyard" should be hidden, "Home Repairs" should be visible
  await expect(page.locator('.sheet-item', { hasText: 'Home Repairs' })).toBeVisible();
  await expect(page.locator('.folder-name', { hasText: 'Backyard' })).toHaveCount(0);
});

test('.waymarkIgnore with no matching patterns shows all items', async ({ page }) => {
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'f2-ignore': 'NonExistent Folder\n' },
  });

  const homeProjects = page.locator('.folder-item', { hasText: 'Home Projects' });
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // Both items should be visible
  await expect(page.locator('.sheet-item', { hasText: 'Home Repairs' })).toBeVisible();
  await expect(page.locator('.folder-name', { hasText: 'Backyard' })).toBeVisible();
});

test('empty .waymarkIgnore shows all items', async ({ page }) => {
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'f2-ignore': '' },
  });

  const homeProjects = page.locator('.folder-item', { hasText: 'Home Projects' });
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  await expect(page.locator('.sheet-item', { hasText: 'Home Repairs' })).toBeVisible();
  await expect(page.locator('.folder-name', { hasText: 'Backyard' })).toBeVisible();
});

test('.waymarkIgnore supports glob wildcard patterns', async ({ page }) => {
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'f2-ignore': 'Back*\n' },
  });

  const homeProjects = page.locator('.folder-item', { hasText: 'Home Projects' });
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // "Backyard" matches "Back*" glob
  await expect(page.locator('.folder-name', { hasText: 'Backyard' })).toHaveCount(0);
  await expect(page.locator('.sheet-item', { hasText: 'Home Repairs' })).toBeVisible();
});

test('clicking ignore button creates .waymarkIgnore and hides item', async ({ page }) => {
  // Use Groceries folder (f1) which has no .waymarkIgnore yet
  await setupApp(page, { waitForExplorer: true });

  // Expand Groceries
  const groceries = page.locator('.folder-item', { hasText: 'Groceries' });
  await groceries.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // Verify "Multi-Store Grocery List" is visible
  const multiStore = page.locator('.sheet-item', { hasText: 'Multi-Store Grocery List' });
  await expect(multiStore).toBeVisible();

  // Hover and click the ignore button
  await multiStore.hover();
  const ignoreBtn = multiStore.locator('.btn-ignore');
  await ignoreBtn.click();

  // The item should be removed from the DOM
  await expect(multiStore).toHaveCount(0);

  // A record should have been created for the .waymarkIgnore file
  const records = await getCreatedRecords(page);
  const textRecord = records.find(r => r.name === '.waymarkIgnore');
  expect(textRecord).toBeTruthy();
  expect(textRecord.content).toContain('Multi-Store Grocery List');
});

test('clicking ignore button appends to existing .waymarkIgnore', async ({ page }) => {
  // Home Projects (f2) already has a .waymarkIgnore
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'f2-ignore': '# Hidden items\n' },
  });

  const homeProjects = page.locator('.folder-item', { hasText: 'Home Projects' });
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // Click ignore on "Backyard"
  const backyard = page.locator('.folder-item', { hasText: 'Backyard' });
  await backyard.hover();
  const ignoreBtn = backyard.locator('.btn-ignore');
  await ignoreBtn.click();

  // Backyard should be removed
  await expect(page.locator('.folder-name', { hasText: 'Backyard' })).toHaveCount(0);

  // A text-update record should exist
  const records = await getCreatedRecords(page);
  const updateRecord = records.find(r => r.type === 'text-update');
  expect(updateRecord).toBeTruthy();
  expect(updateRecord.content).toContain('Backyard');
});

test('ignored items stay hidden after collapsing and re-expanding folder', async ({ page }) => {
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'f2-ignore': 'Backyard\n' },
  });

  const homeProjects = page.locator('.folder-item', { hasText: 'Home Projects' });

  // Expand
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });
  await expect(page.locator('.folder-name', { hasText: 'Backyard' })).toHaveCount(0);

  // Collapse
  await homeProjects.click();
  const wrapper = homeProjects.locator('..').locator('.folder-children');
  await expect(wrapper).toBeEmpty();

  // Re-expand
  await homeProjects.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // "Backyard" should STILL be hidden
  await expect(page.locator('.folder-name', { hasText: 'Backyard' })).toHaveCount(0);
  await expect(page.locator('.sheet-item', { hasText: 'Home Repairs' })).toBeVisible();
});

test('newly ignored item stays hidden after re-expanding folder', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  // Expand Groceries
  const groceries = page.locator('.folder-item', { hasText: 'Groceries' });
  await groceries.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });

  // Ignore "Multi-Store Grocery List"
  const multiStore = page.locator('.sheet-item', { hasText: 'Multi-Store Grocery List' });
  await multiStore.hover();
  await multiStore.locator('.btn-ignore').click();
  await expect(multiStore).toHaveCount(0);

  // Collapse
  await groceries.click();
  const wrapper = groceries.locator('..').locator('.folder-children');
  await expect(wrapper).toBeEmpty();

  // Re-expand — the item should still be hidden
  await groceries.click();
  await page.waitForSelector('.sheet-item', { timeout: 5_000 });
  await expect(page.locator('.sheet-item', { hasText: 'Multi-Store Grocery List' })).toHaveCount(0);
  await expect(page.locator('.sheet-item', { hasText: 'Grocery List' })).toBeVisible();
});

/* ---------- Root-level .waymarkIgnore ---------- */

test('root .waymarkIgnore filters matching root-level folders', async ({ page }) => {
  // root-ignore is the .waymarkIgnore at the root of My Drive
  // Set its content to hide "Empty Folder"
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'root-ignore': 'Empty Folder\n' },
  });

  // "Empty Folder" should be hidden
  await expect(page.locator('.folder-item', { hasText: 'Empty Folder' })).toHaveCount(0);

  // Other root folders should still be visible
  await expect(page.locator('.folder-item', { hasText: 'Groceries' })).toBeVisible();
  await expect(page.locator('.folder-item', { hasText: 'Home Projects' })).toBeVisible();
});

test('root .waymarkIgnore with glob hides matching folders', async ({ page }) => {
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'root-ignore': 'Empty*\n' },
  });

  await expect(page.locator('.folder-item', { hasText: 'Empty Folder' })).toHaveCount(0);
  await expect(page.locator('.folder-item', { hasText: 'Groceries' })).toBeVisible();
});

test('root .waymarkIgnore with no matches shows all root folders', async ({ page }) => {
  await setupApp(page, {
    waitForExplorer: true,
    textFiles: { 'root-ignore': 'NonExistent Folder\n' },
  });

  await expect(page.locator('.folder-item', { hasText: 'Empty Folder' })).toBeVisible();
  await expect(page.locator('.folder-item', { hasText: 'Groceries' })).toBeVisible();
  await expect(page.locator('.folder-item', { hasText: 'Home Projects' })).toBeVisible();
});

test('clicking ignore on root folder creates root .waymarkIgnore', async ({ page }) => {
  // Don't seed root-ignore content so no file exists yet in the text store
  await setupApp(page, { waitForExplorer: true });

  const emptyFolder = page.locator('.folder-item', { hasText: 'Empty Folder' });
  await expect(emptyFolder).toBeVisible();

  // Hover and click the ignore button
  await emptyFolder.hover();
  const ignoreBtn = emptyFolder.locator('.btn-ignore');
  await ignoreBtn.click();

  // The folder should be removed from the DOM
  await expect(page.locator('.folder-item', { hasText: 'Empty Folder' })).toHaveCount(0);

  // Other root folders should still be visible
  await expect(page.locator('.folder-item', { hasText: 'Groceries' })).toBeVisible();
});
