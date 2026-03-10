// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../helpers/test-utils');

test('settings modal opens when clicking user name', async ({ page }) => {
  await setupApp(page);

  const userName = page.locator('#user-name');
  await userName.waitFor({ state: 'visible', timeout: 5_000 });
  await userName.click();

  const modal = page.locator('#settings-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('.settings-modal')).toBeVisible();
});

test('settings modal shows user profile info', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  const name = page.locator('#settings-user-name');
  await expect(name).not.toBeEmpty();
});

test('settings modal closes on Done button', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  await page.locator('#settings-done-btn').click();
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);
});

test('settings modal closes on X button', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  await page.locator('#settings-modal-close').click();
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);
});

test('settings modal closes on overlay click', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  // Click the overlay (outside the modal content)
  await page.locator('#settings-modal').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);
});

test('settings modal shows auto-refresh toggle', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  const toggle = page.locator('#settings-auto-refresh');
  await expect(toggle).toBeVisible();
  // Default should be checked (auto-refresh = true)
  await expect(toggle).toBeChecked();
});

test('settings modal shows sort order select', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  const select = page.locator('#settings-sort-order');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('name');
});

test('settings modal shows import folder with default', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  const folderName = page.locator('#settings-import-folder');
  await expect(folderName).toContainText('Waymark / Imports');

  const chooseBtn = page.locator('#settings-choose-folder');
  await expect(chooseBtn).toBeVisible();
});

test('settings choose folder opens folder browser', async ({ page }) => {
  await setupApp(page);

  await page.locator('#user-name').click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

  await page.locator('#settings-choose-folder').click();

  const browser = page.locator('#settings-folder-browser');
  await expect(browser).toBeVisible();

  // Should show folder items (from mock fixture)
  await page.waitForSelector('.settings-folder-item', { timeout: 5_000 });
  const items = page.locator('.settings-folder-item');
  expect(await items.count()).toBeGreaterThan(0);
});
