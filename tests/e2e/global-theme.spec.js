// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, navigateToHome } = require('../helpers/test-utils');

/* Resolve a design token to a concrete rgb() string by probing a real element,
   so we assert the value the browser actually paints (var() fully substituted). */
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

test('selected Profile palette stamps data-wm-palette on the html element', async ({ page }) => {
  await setupApp(page, { homeTemplateMode: 8 });
  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', '8');
});

test('Profile palette themes the whole app via the global --color-* tokens', async ({ page }) => {
  // Mode 8 (HUD) — dark background #05080a, cyan accent #22d3ee.
  await setupApp(page, { homeTemplateMode: 8 });
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(34, 211, 238)');
  expect(await tokenColor(page, '--color-bg', 'background-color')).toBe('rgb(5, 8, 10)');
});

test('Profile palette themes template/detail views, not just the Wayboard', async ({ page }) => {
  // A light palette (mode 2 — Bento, indigo accent #6366f1, bg #f5f6fb).
  await setupApp(page, { homeTemplateMode: 2 });
  await navigateToSheet(page, 'sheet-016');
  await expect(page.locator('#checklist-view')).toBeVisible();
  // Tokens resolve to the palette even on a sheet view, away from #wayboard-root.
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(99, 102, 241)');
  expect(await tokenColor(page, '--color-bg', 'background-color')).toBe('rgb(245, 246, 251)');
});

test('switching the Profile palette re-themes the entire platform', async ({ page }) => {
  await setupApp(page, { homeTemplateMode: 1 });
  // Mode 1 (Command Center) — blue accent #3b82f6.
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(59, 130, 246)');

  // Change the layout/palette through the Profile selector and confirm the whole
  // app adopts the new accent (mode 12 — Matrix, electric lime #39ff14).
  await page.evaluate(() => {
    const select = document.getElementById('settings-home-template');
    if (select) {
      select.value = '12';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', '12');
  expect(await tokenColor(page, '--color-primary')).toBe('rgb(57, 255, 20)');
});

test('the Wayboard keeps its layout mode class while theming globally', async ({ page }) => {
  await setupApp(page, { homeTemplateMode: 5 });
  await navigateToHome(page);
  await expect(page.locator('#wayboard-root')).toHaveClass(/mode-5/);
  await expect(page.locator('html')).toHaveAttribute('data-wm-palette', '5');
});
