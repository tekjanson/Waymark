// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, getExplorerFolderNames } = require('../helpers/test-utils');
const { overrideFixture } = require('../helpers/mock-server');

/*
 * Sharing & Multi-folder tests — each test builds its own state.
 * Tests that need custom fixture data use page.route() BEFORE
 * setupApp() navigates, keeping isolation intact.
 */

test('shared folders display owner email', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const owners = page.locator('.folder-owner');
  const count = await owners.count();
  expect(count).toBeGreaterThan(0);

  const ownerTexts = await owners.allTextContents();
  expect(ownerTexts.some(t => t.includes('@'))).toBe(true);
});

test('shared folders have "shared" badges', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const badges = page.locator('.badge-shared');
  expect(await badges.count()).toBeGreaterThan(0);
});

test('pinning shared folder preserves shared flag', async ({ page }) => {
  // Start with clean state — no pinned folders
  await setupApp(page, { waitForExplorer: true });

  // Pin "Family Chores" (shared folder)
  const familyRow = page.locator('.folder-item', { hasText: 'Family Chores' });
  await familyRow.locator('.btn-pin').click();

  // Go to home
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)');

  // Verify the pinned card has "shared" badge
  await expect(page.locator('.pinned-card', { hasText: 'Family Chores' })).toBeVisible();
  const card = page.locator('.pinned-card', { hasText: 'Family Chores' });
  await expect(card.locator('.badge-shared')).toBeVisible();
});

test('pinning shared folder shows owner info', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const teamRow = page.locator('.folder-item', { hasText: 'Team Tasks' });
  await teamRow.locator('.btn-pin').click();

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)');

  const card = page.locator('.pinned-card', { hasText: 'Team Tasks' });
  await expect(card.locator('.pinned-card-owner')).toContainText('boss@work.com');
});

test('multiple folders can be pinned simultaneously', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  // Pin three folders from clean state
  await page.locator('.folder-item', { hasText: 'Groceries' }).locator('.btn-pin').click();
  await page.locator('.folder-item', { hasText: 'Home Projects' }).locator('.btn-pin').click();
  await page.locator('.folder-item', { hasText: 'Family Chores' }).locator('.btn-pin').click();

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)');

  const cards = page.locator('.pinned-card');
  expect(await cards.count()).toBe(3);
});

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

test('expanding shared folder shows its sheets', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const familyRow = page.locator('.folder-item', { hasText: 'Family Chores' });
  await familyRow.locator('.expand-icon').click();

  await page.waitForSelector('.sheet-item', { timeout: 5_000 });
  const sheetText = await page.locator('.sheet-item').last().textContent();
  expect(sheetText).toContain('Weekly Chores');
});

test('clicking a shared sheet opens checklist view', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const familyRow = page.locator('.folder-item', { hasText: 'Family Chores' });
  await familyRow.locator('.expand-icon').click();

  await page.waitForSelector('.sheet-item', { timeout: 5_000 });
  await page.locator('.sheet-item', { hasText: 'Weekly Chores' }).click();

  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5_000 });
  await expect(page.locator('#checklist-title')).toHaveText('Weekly Chores');
});

test('both My Drive and Shared sections populate together', async ({ page }) => {
  await setupApp(page, { waitForExplorer: true });

  const names = await getExplorerFolderNames(page);

  expect(names).toContain('Groceries');
  expect(names).toContain('Home Projects');
  expect(names).toContain('Family Chores');
  expect(names).toContain('Team Tasks');
});

test('custom fixture with no shared folders isolates correctly', async ({ page }) => {
  // Override fixture data BEFORE navigation (same page, same context)
  const customFolders = {
    myDrive: [
      {
        id: 'f-solo',
        name: 'Solo Folder',
        mimeType: 'application/vnd.google-apps.folder',
        shared: false,
        children: [],
      },
    ],
    sharedWithMe: [],
  };

  await overrideFixture(page, 'folders.json', customFolders);
  await setupApp(page, { waitForExplorer: true });

  const names = await getExplorerFolderNames(page);
  expect(names).toContain('Solo Folder');
  expect(names).not.toContain('Family Chores');
  expect(names).not.toContain('Team Tasks');
});
