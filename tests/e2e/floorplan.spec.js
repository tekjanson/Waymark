// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

async function selectTool(page, tool) {
  await page.click(`.floorplan-tool-button[data-tool="${tool}"]`);
}

async function openPlan(page) {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });
}

async function placeAndSelectSymbol(page, key, offset) {
  await page.click(`.floorplan-symbol-choice[data-symbol-key="${key}"]`);
  const svg = await page.locator('.floorplan-svg').boundingBox();
  if (!svg) throw new Error('Canvas not visible');
  const px = svg.x + offset.x;
  const py = svg.y + offset.y;
  await page.mouse.click(px, py);
  await selectTool(page, 'select');
  await page.mouse.click(px, py);
  await expect(page.locator('.floorplan-fixture.floorplan-selected')).toHaveCount(1);
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

  const beforeSymbols = await page.locator('.floorplan-symbol-graphic').count();
  await page.click('.floorplan-symbol-choice[data-symbol-key="tv"]');
  await expect(page.locator('.floorplan-symbol-choice[data-symbol-key="tv"]')).toHaveClass(/active/);
  await page.click('.floorplan-svg', { position: { x: 420, y: 260 } });

  await expect(page.locator('.floorplan-symbol-graphic')).toHaveCount(beforeSymbols + 1);
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

/* ============================================================
   Parametric upgrade — new feature coverage
   ============================================================ */

test('top-down symbols render for furniture loaded from the sheet', async ({ page }) => {
  await openPlan(page);
  // Sofa, Dining Table, and Main Stairs all resolve to top-down symbols.
  const count = await page.locator('.floorplan-symbol-graphic').count();
  expect(count).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.floorplan-symbol-graphic').first()).toBeVisible();
});

test('placed doors default to a 3 ft opening', async ({ page }) => {
  await openPlan(page);
  const wallBox = await page.locator('.floorplan-wall').first().boundingBox();
  if (!wallBox) throw new Error('Wall geometry missing');
  await selectTool(page, 'door');
  await page.mouse.click(wallBox.x + (wallBox.width / 2), wallBox.y + Math.max(2, wallBox.height / 2));
  await selectTool(page, 'select');
  await page.locator('.floorplan-door').last().click();
  await expect(page.locator('.floorplan-prop-dims')).toContainText("3'");
});

test('placed windows default to a 2 ft opening', async ({ page }) => {
  await openPlan(page);
  const wallBox = await page.locator('.floorplan-wall').first().boundingBox();
  if (!wallBox) throw new Error('Wall geometry missing');
  await selectTool(page, 'window');
  await page.mouse.click(wallBox.x + (wallBox.width / 2), wallBox.y + Math.max(2, wallBox.height / 2));
  await selectTool(page, 'select');
  await page.locator('.floorplan-window').last().click();
  await expect(page.locator('.floorplan-prop-dims')).toContainText("2'");
});

test('doors render a swing arc that can be flipped', async ({ page }) => {
  await openPlan(page);
  const wallBox = await page.locator('.floorplan-wall').first().boundingBox();
  if (!wallBox) throw new Error('Wall geometry missing');
  await selectTool(page, 'door');
  await page.mouse.click(wallBox.x + (wallBox.width / 2), wallBox.y + Math.max(2, wallBox.height / 2));
  await selectTool(page, 'select');
  await page.locator('.floorplan-door').last().click();

  const arc = page.locator('.floorplan-door.floorplan-selected .floorplan-door-arc');
  await expect(arc).toHaveCount(1);
  const before = await arc.getAttribute('points');
  await page.click('.floorplan-prop-swing');
  const after = await page.locator('.floorplan-door.floorplan-selected .floorplan-door-arc').getAttribute('points');
  expect(after).not.toBe(before);
});

test('selected objects can be rotated from the properties toolbar', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });

  const before = await page.locator('.floorplan-fixture.floorplan-selected').getAttribute('transform');
  expect(before).toContain('rotate(0)');
  await page.click('.floorplan-prop-rotate-right');
  const after = await page.locator('.floorplan-fixture.floorplan-selected').getAttribute('transform');
  expect(after).toContain('rotate(15)');
});

test('keyboard shortcut rotates the selected object', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });

  await page.keyboard.press('r');
  const after = await page.locator('.floorplan-fixture.floorplan-selected').getAttribute('transform');
  expect(after).toContain('rotate(15)');
});

test('selected objects can be flipped horizontally', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });

  await page.click('.floorplan-prop-flip-h');
  const graphic = page.locator('.floorplan-fixture.floorplan-selected .floorplan-symbol-graphic');
  await expect(graphic).toHaveAttribute('transform', /scale\(-1 1\)/);
});

test('placed symbols are parametric and resize from corner handles', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });

  const boxBefore = await page.locator('.floorplan-selection-box').first().evaluate(node => Number(node.getAttribute('width') || '0'));
  const handle = page.locator('.floorplan-resize-handle[data-floorplan-handle="fx-se"]');
  const hbox = await handle.boundingBox();
  if (!hbox) throw new Error('Resize handle not visible');
  await page.mouse.move(hbox.x + (hbox.width / 2), hbox.y + (hbox.height / 2));
  await page.mouse.down();
  await page.mouse.move(hbox.x + 60, hbox.y + 50, { steps: 12 });
  await page.mouse.up();

  const boxAfter = await page.locator('.floorplan-selection-box').first().evaluate(node => Number(node.getAttribute('width') || '0'));
  expect(boxAfter).toBeGreaterThan(boxBefore);
});

test('duplicate and delete manage the selected object', async ({ page }) => {
  await openPlan(page);
  const start = await page.locator('.floorplan-symbol-graphic').count();
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });
  expect(await page.locator('.floorplan-symbol-graphic').count()).toBe(start + 1);

  await page.click('.floorplan-prop-duplicate');
  expect(await page.locator('.floorplan-symbol-graphic').count()).toBe(start + 2);

  await page.keyboard.press('Delete');
  expect(await page.locator('.floorplan-symbol-graphic').count()).toBe(start + 1);
});

test('layers can be locked to prevent selection', async ({ page }) => {
  await openPlan(page);
  const sym = await page.locator('.floorplan-symbol-graphic').first().boundingBox();
  if (!sym) throw new Error('No symbol to target');
  const cx = sym.x + (sym.width / 2);
  const cy = sym.y + (sym.height / 2);

  await page.click('.floorplan-layer-lock[data-layer="fixture"]');
  await expect(page.locator('.floorplan-layer-lock[data-layer="fixture"]')).toHaveClass(/locked/);

  await selectTool(page, 'select');
  await page.mouse.click(cx, cy);
  await expect(page.locator('.floorplan-prop-toolbar')).toBeHidden();

  // Unlock and confirm the same object becomes selectable again.
  await page.click('.floorplan-layer-lock[data-layer="fixture"]');
  await page.mouse.click(cx, cy);
  await expect(page.locator('.floorplan-prop-toolbar')).toBeVisible();
});

test('line tool draws a custom multi-point shape', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-line')).toHaveCount(0);

  await selectTool(page, 'line');
  const svg = await page.locator('.floorplan-svg').boundingBox();
  if (!svg) throw new Error('Canvas not visible');
  await page.mouse.click(svg.x + 120, svg.y + 120);
  await page.mouse.click(svg.x + 230, svg.y + 150);
  await page.mouse.click(svg.x + 200, svg.y + 250);
  await page.keyboard.press('Enter');

  await expect(page.locator('.floorplan-line')).toHaveCount(1);
});

test('properties toolbar appears on selection and hides on escape', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'select');
  await expect(page.locator('.floorplan-prop-toolbar')).toBeHidden();

  const room = await page.locator('.floorplan-room').first().boundingBox();
  if (!room) throw new Error('Room geometry missing');
  await page.mouse.click(room.x + 12, room.y + 12);
  await expect(page.locator('.floorplan-prop-toolbar')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.floorplan-prop-toolbar')).toBeHidden();
});

test('new line layer can be toggled off and on', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'line');
  const svg = await page.locator('.floorplan-svg').boundingBox();
  if (!svg) throw new Error('Canvas not visible');
  await page.mouse.click(svg.x + 120, svg.y + 120);
  await page.mouse.click(svg.x + 230, svg.y + 150);
  await page.keyboard.press('Enter');

  await expect(page.locator('.floorplan-line')).toHaveCount(1);
  await page.click('.floorplan-layer-toggle[data-layer="line"]');
  await expect(page.locator('.floorplan-line')).toHaveCount(0);
  await page.click('.floorplan-layer-toggle[data-layer="line"]');
  await expect(page.locator('.floorplan-line')).toHaveCount(1);
});
