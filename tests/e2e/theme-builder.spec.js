// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

async function openSettings(page) {
  await page.locator('#user-name, #user-avatar').first().click();
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
}

/* Resolve a design token to the painted rgb() string via a probe element. */
async function tokenColor(page, token, prop = 'color') {
  return page.evaluate(({ token, prop }) => {
    const probe = document.createElement('div');
    probe.style.setProperty(prop, `var(${token})`);
    document.body.appendChild(probe);
    const value = getComputedStyle(probe)[prop];
    probe.remove();
    return value;
  }, { token, prop });
}

test('Settings has a sticky section nav that scrolls to a section', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);
  await expect(page.locator('.settings-nav')).toBeVisible();
  await expect(page.locator('.settings-nav-item')).toHaveCount(5);

  await page.locator('.settings-nav-item[data-settings-nav="appearance"]').click();
  await expect(page.locator('.settings-nav-item[data-settings-nav="appearance"]')).toHaveClass(/is-active/);
  await expect(page.locator('#settings-group-appearance')).toBeInViewport();
});

test('theme builder renders 12 presets and 7 colour swatches', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);
  await expect(page.locator('#theme-presets .theme-preset')).toHaveCount(12);
  await expect(page.locator('#theme-swatches .theme-swatch')).toHaveCount(7);
  await expect(page.locator('#theme-color-accent')).toBeVisible();
  await page.locator('.theme-advanced-summary').click();
  await expect(page.locator('#theme-copy-code')).toBeVisible();
  await expect(page.locator('#theme-apply-code')).toBeVisible();
  await expect(page.locator('#theme-code')).toBeVisible();
});

test('enabling a preset in the builder themes the whole app via --color tokens', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  // Click the HUD preset (id 8 — cyan accent #22d3ee, near-black bg #05080a).
  await page.locator('.theme-preset[data-preset="8"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', 'custom');
  await expect(page.locator('html')).toHaveAttribute('data-wm-base', 'dark');
  await expect(page.locator('#settings-theme-custom-enabled')).toBeChecked();

  expect(await tokenColor(page, '--color-primary')).toBe('rgb(34, 211, 238)');
  expect(await tokenColor(page, '--color-bg', 'background-color')).toBe('rgb(5, 8, 10)');
});

test('changing the accent colour updates the global token live', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);
  await page.locator('#settings-theme-custom-enabled').check();

  // Drive the native color input to a known value.
  await page.evaluate(() => {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('theme-color-accent'));
    input.value = '#ff0000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(255, 0, 0)');
});

test('the custom theme persists across reload', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);
  await page.locator('.theme-preset[data-preset="12"]').click(); // Matrix — electric lime #39ff14
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(57, 255, 20)');

  // Reload — the anti-flash script + boot must restore the custom theme.
  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', 'custom');
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(57, 255, 20)');
});

test('the base toggle flips the custom theme between light and dark', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);
  await page.locator('#settings-theme-custom-enabled').check();

  await page.locator('#theme-base-toggle .settings-seg-btn[data-theme-base="light"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wm-base', 'light');
  const schemeLight = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  expect(schemeLight).toContain('light');

  await page.locator('#theme-base-toggle .settings-seg-btn[data-theme-base="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wm-base', 'dark');
});

test('theme code can be pasted and applied as a custom theme', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);
  await page.locator('.theme-advanced-summary').click();

  await page.locator('#theme-code').fill(JSON.stringify({
    enabled: true,
    base: 'dark',
    bg: '#030706',
    surface: '#0b1612',
    accent: '#39ff14',
    text: '#dbffd4',
    muted: '#89d89a',
    border: '#214b2b',
    success: '#39ff14',
    radius: 5,
    font: 'mono',
  }, null, 2));
  await page.locator('#theme-apply-code').click();

  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', 'custom');
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(57, 255, 20)');
  expect(await tokenColor(page, '--color-bg', 'background-color')).toBe('rgb(3, 7, 6)');
});

test('load active layout palette seeds the builder and enables custom theme', async ({ page }) => {
  await setupApp(page, { homeTemplateMode: 8 });
  await openSettings(page);

  await page.locator('#theme-load-layout-preset').click();
  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', 'custom');
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(34, 211, 238)');
});

test('Reset to preset turns the custom theme off and restores the layout palette', async ({ page }) => {
  await setupApp(page, { homeTemplateMode: 1 }); // Command Center — blue #3b82f6
  await openSettings(page);
  await page.locator('.theme-preset[data-preset="8"]').click(); // go custom (cyan)
  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', 'custom');

  await page.locator('#settings-theme-reset').click();
  await expect(page.locator('#settings-theme-custom-enabled')).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', '1');
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(59, 130, 246)');
});
