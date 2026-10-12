// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

async function chooseTool(page, menu, tool) {
  await page.click(`.floorplan-menu-summary:has-text("${menu}")`);
  await page.click(`.floorplan-tool-button[data-tool="${tool}"]`);
}

test('floor plan is detected and rendered', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Floor Plan');
  await expect(page.locator('.floorplan-title')).toContainText('House Plan');
  await expect(page.locator('.floorplan-room')).toHaveCount(9);
  await expect(page.locator('.floorplan-wall')).toHaveCount(3);
  await expect(page.locator('.floorplan-board')).toHaveClass(/floorplan-fullscreen/);
});

test('floor plan does not render generic placeholder wall labels', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const genericText = await page.locator('.floorplan-svg text').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
  expect(genericText.some(value => /^(room|wall|electrical|plumbing|fixture)$/i.test(value))).toBe(false);
});

test('wall tool supports single-click placement for immediate feedback', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const beforeCount = await page.locator('.floorplan-wall').count();
  await page.click('.floorplan-svg', { position: { x: 220, y: 180 } });
  const afterCount = await page.locator('.floorplan-wall').count();

  expect(afterCount).toBe(beforeCount + 1);
});

test('auto walls generates perimeter walls from rooms', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const beforeCount = await page.locator('.floorplan-wall').count();
  await page.click('.floorplan-auto-wall-btn');
  const afterCount = await page.locator('.floorplan-wall').count();

  expect(afterCount).toBeGreaterThan(beforeCount);
});

test('layer menu toggles room visibility', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('.floorplan-room')).toHaveCount(9);
  await page.click('.floorplan-menu-summary:has-text("Layers")');
  await page.click('.floorplan-layer-toggle[data-layer="room"]');
  await expect(page.locator('.floorplan-room')).toHaveCount(0);
  await page.click('.floorplan-layer-toggle[data-layer="room"]');
  await expect(page.locator('.floorplan-room')).toHaveCount(9);
});

test('symbols menu places household fixtures quickly', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const beforeGlyphs = await page.locator('.floorplan-symbol-glyph').count();
  await page.click('.floorplan-menu-summary:has-text("Symbols")');
  await page.click('.floorplan-symbol-choice[data-symbol-key="tv"]');
  await page.click('.floorplan-svg', { position: { x: 420, y: 260 } });

  await expect(page.locator('.floorplan-symbol-glyph')).toHaveCount(beforeGlyphs + 1);
});

test('floor controls switch levels and align below overlay', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('.floorplan-floor-indicator')).toContainText('Floor 1');
  await page.click('.floorplan-floor-btn:has-text("+ Floor")');
  await expect(page.locator('.floorplan-floor-indicator')).toContainText('Floor 2');
  await expect(page.locator('.floorplan-room')).toHaveCount(0);

  await page.click('.floorplan-floor-btn:has-text("Align Below")');
  await expect(page.locator('.floorplan-room')).toHaveCount(9);
});

test('door and window tools snap openings onto nearby walls', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const wallBox = await page.locator('.floorplan-wall').first().boundingBox();
  if (!wallBox) throw new Error('Wall geometry missing');
  const targetX = wallBox.x + (wallBox.width / 2);
  const targetY = wallBox.y + (wallBox.height / 2);

  const beforeDoors = await page.locator('.floorplan-door').count();
  const beforeWindows = await page.locator('.floorplan-window').count();

  await chooseTool(page, 'Draw', 'door');
  await page.mouse.click(targetX, targetY);
  await chooseTool(page, 'Draw', 'window');
  await page.mouse.click(targetX + 30, targetY);

  await expect(page.locator('.floorplan-door')).toHaveCount(beforeDoors + 1);
  await expect(page.locator('.floorplan-window')).toHaveCount(beforeWindows + 1);
});

test('select mode supports room resize handles', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await chooseTool(page, 'Edit', 'select');
  await page.locator('.floorplan-room').first().click({ position: { x: 14, y: 14 } });

  const beforeWidth = await page.locator('.floorplan-room').first().evaluate(node => Number(node.getAttribute('width') || '0'));
  const handle = page.locator('.floorplan-resize-handle[data-floorplan-handle="room-se"]').first();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Resize handle not visible');

  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 55, { steps: 12 });
  await page.mouse.up();

  const afterWidth = await page.locator('.floorplan-room').first().evaluate(node => Number(node.getAttribute('width') || '0'));
  expect(afterWidth).toBeGreaterThan(beforeWidth);
});

test('created-sheet fallback still opens floor plan canvas in local mode', async ({ page }) => {
  await setupApp(page, { hash: '#/sheet/created-sheet-e2e-fallback' });
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Floor Plan');
  await expect(page.locator('.floorplan-svg')).toBeVisible();
});

test('ai space render opens concept modal with mock output', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WAYMARK_FLOORPLAN_RENDER_MOCK = {
      spaceTitle: 'Family Concept',
      overallMood: 'Warm and practical',
      palette: ['#dbeafe', '#bbf7d0', '#fde68a'],
      lighting: 'Layered ambient + task',
      rooms: [{ name: 'Living Room', color: '#dbeafe' }],
      renderPrompt: 'Warm family living room with layered lighting.',
      designActions: ['Anchor seating around focal point'],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await page.click('.floorplan-ai-render-btn');
  await page.click('.floorplan-ai-render-modal .floorplan-ai-btn-primary:has-text("Generate Visual")');
  await expect(page.locator('.floorplan-ai-render-svg')).toBeVisible();
  await expect(page.locator('.floorplan-ai-render-details')).toContainText('Family Concept');
});

test('export button triggers print workflow for PDF output', async ({ page }) => {
  await page.addInitScript(() => {
    window.__PRINT_CALLED__ = false;
    window.print = () => {
      window.__PRINT_CALLED__ = true;
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-export-btn', { timeout: 5_000 });

  await page.click('.floorplan-export-btn');
  const called = await page.evaluate(() => window.__PRINT_CALLED__ === true);
  expect(called).toBe(true);
});
