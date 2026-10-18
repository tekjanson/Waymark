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
  // User-configured Wayboard marks render.
  expect(await page.locator('#wayboard-grid .widget').count()).toBeGreaterThan(0);
  // The Wayside social pane exists.
  await expect(page.locator('#home-wayside .wayside-head')).toContainText('The Wayside');
  // Status badges show.
  await expect(page.locator('#home-status-badges .badge')).not.toHaveCount(0);
});

test('Wayboard widgets render the selected Waymark with its detected template', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [
      { id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() },
      { id: 'sheet-001', name: 'Grocery Waymark', templateKey: 'checklist', pinnedAt: new Date().toISOString() },
    ],
  });

  const addSheetWidget = async (sheetId) => {
    await page.locator('select[name="type"]').selectOption('sheet');
    await page.locator('select[name="sheet"]').selectOption(sheetId);
    await page.locator('.wayboard-widget-form button[type="submit"]').click();
  };

  await page.click('#wayboard-add-widget');
  await addSheetWidget('sheet-077');
  await expect(page.locator('.wayboard-template-wrap .contacts-layout')).toBeVisible();
  await addSheetWidget('sheet-001');
  await expect(page.locator('.wayboard-template-wrap .checklist-row')).toHaveCount(10);
  await expect(page.locator('.wayboard-template-wrap[aria-readonly="true"]')).toHaveCount(2);
  await page.locator('.wayboard-widget-dialog-header .btn-icon').click();

  const bread = page.locator('.wayboard-template-wrap .checklist-row', { hasText: 'Bread' });
  const breadState = await bread.getAttribute('class');
  await bread.locator('.checklist-checkbox').click();
  await expect(bread).toHaveAttribute('class', breadState);
});

test('Wayboard can add a spreadsheet directly from Drive without pinning it first', async ({ page }) => {
  await setupApp(page);
  await page.click('#wayboard-add-widget');
  await page.locator('select[name="type"]').selectOption('sheet');

  const source = page.locator('select[name="sheet"]');
  await expect(source).toBeEnabled();
  await expect(source).toHaveValue('');
  await page.getByRole('button', { name: 'Browse Drive' }).click();
  await expect(source).toHaveValue('sheet-001');
  await page.locator('.wayboard-widget-form button[type="submit"]').click();

  await expect(page.locator('.wayboard-template-wrap .checklist-row')).toHaveCount(10);
  await expect(page.locator('.wayboard-template-wrap[aria-readonly="true"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.wayboard-template-wrap .checklist-row')).toHaveCount(10);
});

test('default home layout is mode-1', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root.mode-1', { timeout: 5_000 });
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-1\b/);
});

test('home templates retain their defining layouts with user widgets enabled', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  const layouts = await page.evaluate(() => {
    const root = document.getElementById('wayboard-root');
    const read = mode => {
      root.className = `wayboard-root mode-${mode}`;
      const grid = getComputedStyle(root.querySelector('.wayboard-grid'));
      const section = getComputedStyle(root.querySelector('.wayboard-section'));
      const widget = getComputedStyle(root.querySelector('.wayboard-widget'));
      const greeting = getComputedStyle(root.querySelector('.greeting-banner'));
      return {
        gridDisplay: grid.display,
        gridWrap: grid.flexWrap,
        sectionPosition: section.position,
        widgetPosition: widget.position,
        greetingPosition: greeting.position,
        greetingBorder: greeting.borderBottomStyle,
      };
    };
    return {
      bento: read(2),
      prompt: read(13),
      stage: read(14),
      orbit: read(15),
      windows: read(19),
      accordion: read(35),
      compass: read(38),
      telemetry: read(49),
    };
  });

  expect(layouts.bento.greetingBorder).toBe('solid');
  expect(layouts.prompt.gridDisplay).toBe('flex');
  expect(layouts.stage.widgetPosition).toBe('relative');
  expect(layouts.orbit.gridWrap).toBe('wrap');
  expect(layouts.windows.sectionPosition).toBe('absolute');
  expect(layouts.accordion.gridWrap).toBe('wrap');
  expect(layouts.compass.greetingPosition).toBe('relative');
  expect(layouts.telemetry.gridDisplay).toBe('grid');
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

test('Wayside shows Waymarker Crews from a Contacts Waymark', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });
  await expect(page.locator('#home-wayside .crew-row', { hasText: 'Family Crew' })).toBeVisible();
  await expect(page.locator('#home-wayside .chat-input')).toBeVisible();
  await expect(page.locator('#wayside-call-btn')).toContainText('Call');
});
