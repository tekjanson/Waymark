// @ts-check
/**
 * wayboard.spec.js — Unified Wayboard home, 50 layout architectures,
 * Profile layout selector, and the Wayside social pane.
 */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

async function openSettings(page) {
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
}

test('home renders the Wayboard with greeting, markers, widgets, and wayside', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });

  await expect(page.locator('#wayboard-root .greeting-banner')).toBeVisible();
  await expect(page.locator('#wayboard-root .markers-section')).toBeVisible();
  await expect(page.locator('#wayboard-root .wayboard-section')).toBeVisible();
  // Four dashboard widgets render.
  await expect(page.locator('#wayboard-grid .widget')).toHaveCount(4);
  // The Wayside social pane exists.
  await expect(page.locator('#home-wayside .wayside-head')).toContainText('The Wayside');
  // Status badges show.
  await expect(page.locator('#home-status-badges .badge')).not.toHaveCount(0);
});

test('default home layout is mode-1', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root.mode-1', { timeout: 5_000 });
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-1\b/);
});

test('Profile settings lists all 50 home layout templates', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  const options = page.locator('#settings-home-template option');
  await expect(options).toHaveCount(50);
  // Grouped into three optgroups.
  await expect(page.locator('#settings-home-template optgroup')).toHaveCount(3);
});

test('changing the home layout applies the mode class and persists to localStorage', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });
  await openSettings(page);

  await page.selectOption('#settings-home-template', '7');
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-7\b/);

  const stored = await page.evaluate(() => localStorage.getItem('waymark_home_template_mode'));
  expect(stored).toBe('7');
});

test('prev/next cycle buttons change the layout', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });
  await openSettings(page);

  await page.click('#settings-home-template-next');
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-2\b/);
  await page.click('#settings-home-template-prev');
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-1\b/);
});

test('saved home layout survives reload (zero-flash from localStorage)', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });
  await page.evaluate(() => localStorage.setItem('waymark_home_template_mode', '23'));

  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-23\b/);
});

test('Wayside shows Wayfarer Crews from a Contacts Waymark', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Wayfarer Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });
  await expect(page.locator('#home-wayside .crew-row', { hasText: 'Family Crew' })).toBeVisible();
  await expect(page.locator('#home-wayside .chat-input')).toBeVisible();
  await expect(page.locator('#wayside-call-btn')).toContainText('Call');
});
