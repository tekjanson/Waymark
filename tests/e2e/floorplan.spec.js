// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

async function selectTool(page, tool) {
  await page.click(`.floorplan-tool-button[data-tool="${tool}"]`);
}

test('floor plan is detected and rendered', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Floor Plan');
  await expect(page.locator('.floorplan-title')).toHaveText('House Plan');
  await expect(page.locator('.floorplan-room')).toHaveCount(8);
  await expect(page.locator('.floorplan-wall')).toHaveCount(8);
  await expect(page.locator('.floorplan-board')).toHaveClass(/floorplan-fullscreen/);
});

test('workspace shows a persistent tool rail, canvas, and side panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('.floorplan-rail')).toBeVisible();
  await expect(page.locator('.floorplan-svg')).toBeVisible();
  await expect(page.locator('.floorplan-panel')).toBeVisible();
  await expect(page.locator('.floorplan-tool-button[data-tool="wall"]')).toHaveClass(/active/);
});

test('floor plan does not render generic placeholder wall labels', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const genericText = await page.locator('.floorplan-svg text').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
  expect(genericText.some(value => /^(room|wall|electrical|plumbing|fixture)$/i.test(value))).toBe(false);
});

test('selecting a tool from the rail activates it', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await selectTool(page, 'room');
  await expect(page.locator('.floorplan-tool-button[data-tool="room"]')).toHaveClass(/active/);
  await expect(page.locator('.floorplan-tool-button[data-tool="wall"]')).not.toHaveClass(/active/);
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

test('room tool draws a new room by dragging', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const before = await page.locator('.floorplan-room').count();
  await selectTool(page, 'room');
  const svg = await page.locator('.floorplan-svg').boundingBox();
  if (!svg) throw new Error('Canvas not visible');
  await page.mouse.move(svg.x + 120, svg.y + 60);
  await page.mouse.down();
  await page.mouse.move(svg.x + 230, svg.y + 150, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('.floorplan-room')).toHaveCount(before + 1);
});

test('rectangle wall tool draws connected wall loops', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const beforeCount = await page.locator('.floorplan-wall').count();
  await selectTool(page, 'wall-rect');
  await page.mouse.move(420, 230);
  await page.mouse.down();
  await page.mouse.move(560, 330, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('.floorplan-wall')).toHaveCount(beforeCount + 4);
});

test('select mode supports multi-select drag moves', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await selectTool(page, 'select');
  const room = page.locator('.floorplan-room').first();
  const wall = page.locator('.floorplan-wall').first();
  const roomBefore = await room.boundingBox();
  const wallBefore = await wall.boundingBox();
  if (!roomBefore || !wallBefore) throw new Error('Expected geometry before drag');

  await page.mouse.click(roomBefore.x + (roomBefore.width / 2), roomBefore.y + (roomBefore.height / 2));
  await page.keyboard.down('Shift');
  await page.mouse.click(wallBefore.x + (wallBefore.width / 2), wallBefore.y + Math.max(2, wallBefore.height / 2));
  await page.keyboard.up('Shift');

  await page.mouse.move(roomBefore.x + 12, roomBefore.y + 12);
  await page.mouse.down();
  await page.mouse.move(roomBefore.x + 52, roomBefore.y + 52, { steps: 10 });
  await page.mouse.up();

  const roomAfter = await room.boundingBox();
  if (!roomAfter) throw new Error('Expected room geometry after drag');
  expect(roomAfter.x).toBeGreaterThan(roomBefore.x + 20);
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

test('layer panel toggles room visibility', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('.floorplan-room')).toHaveCount(8);
  await page.click('.floorplan-layer-toggle[data-layer="room"]');
  await expect(page.locator('.floorplan-room')).toHaveCount(0);
  await page.click('.floorplan-layer-toggle[data-layer="room"]');
  await expect(page.locator('.floorplan-room')).toHaveCount(8);
});

test('symbol panel places household fixtures quickly', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const beforeGlyphs = await page.locator('.floorplan-symbol-glyph').count();
  await page.click('.floorplan-symbol-choice[data-symbol-key="tv"]');
  await expect(page.locator('.floorplan-symbol-choice[data-symbol-key="tv"]')).toHaveClass(/active/);
  await page.click('.floorplan-svg', { position: { x: 420, y: 260 } });

  await expect(page.locator('.floorplan-symbol-glyph')).toHaveCount(beforeGlyphs + 1);
});

test('floor controls switch levels and align below overlay', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('.floorplan-floor-indicator')).toContainText('Floor 1');
  await page.click('.floorplan-floor-next');
  await expect(page.locator('.floorplan-floor-indicator')).toContainText('Floor 2');
  await expect(page.locator('.floorplan-room')).toHaveCount(0);

  await page.click('.floorplan-align-btn');
  await expect(page.locator('.floorplan-align-btn')).toHaveClass(/active/);
  await expect(page.locator('.floorplan-room')).toHaveCount(8);
});

test('undo via ctrl+z removes last draw action', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  const beforeCount = await page.locator('.floorplan-wall').count();
  await page.click('.floorplan-svg', { position: { x: 260, y: 210 } });
  await expect(page.locator('.floorplan-wall')).toHaveCount(beforeCount + 1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.floorplan-wall')).toHaveCount(beforeCount);
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

  await selectTool(page, 'door');
  await page.mouse.click(targetX, targetY);
  await selectTool(page, 'window');
  await page.mouse.click(targetX, targetY);

  await expect(page.locator('.floorplan-door')).toHaveCount(beforeDoors + 1);
  await expect(page.locator('.floorplan-window')).toHaveCount(beforeWindows + 1);
});

test('select mode supports room resize handles', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await selectTool(page, 'select');
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

test('3D interior toggle reveals the interior box panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await expect(page.locator('.floorplan-interior-panel')).toBeHidden();
  await page.click('.floorplan-interior-toggle-btn');
  await expect(page.locator('.floorplan-interior-panel')).toBeVisible();
  await expect(page.locator('.floorplan-interior-toggle-btn')).toHaveClass(/active/);
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
