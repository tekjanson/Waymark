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
  await expect(page.locator('.floorplan-wall')).toHaveCount(12);
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

test('space bar can be used while typing in floorplan inputs', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-symbol-search', { timeout: 5_000 });

  const input = page.locator('.floorplan-symbol-search');
  await input.focus();
  await page.keyboard.type('living room');

  await expect(input).toHaveValue('living room');
  await expect(page.locator('.floorplan-board')).not.toHaveClass(/floorplan-space-panning/);
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

test('ai space render generates a photorealistic image through the router', async ({ page }) => {
  await page.addInitScript(() => {
    // 1x1 transparent PNG — stands in for the OpenAI image result.
    window.__WAYMARK_FLOORPLAN_IMAGE_MOCK =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    window.__WAYMARK_FLOORPLAN_ENRICH_MOCK = 'A single rectangular room with two walls, one door and one window.';
    window.__WAYMARK_FLOORPLAN_RENDER_MOCK = {
      spaceTitle: 'Concept', overallMood: 'warm', palette: ['#dbeafe'],
      lighting: 'ambient', rooms: [], renderPrompt: 'Cozy living room', designActions: ['x'],
    };
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });

  await page.click('.floorplan-ai-render-btn');
  // The modal shows the geometry-locked seed badge.
  await expect(page.locator('.floorplan-ai-seed-chip')).toContainText('Seed #');
  await page.click('.floorplan-ai-photoreal-btn');
  await expect(page.locator('.floorplan-ai-photoreal-img')).toBeVisible({ timeout: 5_000 });
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
  // Target the first placed symbol's hit area directly so the click reliably
  // lands on the fixture (and never a sliver of an adjacent room edge).
  const fixtureId = await page.locator('.floorplan-symbol-graphic').first()
    .evaluate(node => node.closest('[data-floorplan-item]').getAttribute('data-floorplan-item'));
  const fixtureHit = page.locator(`[data-floorplan-item="${fixtureId}"] .floorplan-hit`);

  await page.click('.floorplan-layer-lock[data-layer="fixture"]');
  await expect(page.locator('.floorplan-layer-lock[data-layer="fixture"]')).toHaveClass(/locked/);

  await selectTool(page, 'select');
  await fixtureHit.click();
  await expect(page.locator('.floorplan-prop-toolbar')).toBeHidden();

  // Unlock and confirm the same object becomes selectable again.
  await page.click('.floorplan-layer-lock[data-layer="fixture"]');
  await fixtureHit.click();
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

/* ============================================================
   Iteration 2 — focus-view accuracy, measure, systems, 3D view
   ============================================================ */

test('objects place under the cursor in fullscreen focus view', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-board')).toHaveClass(/floorplan-fullscreen/);
  await page.click('.floorplan-symbol-choice[data-symbol-key="couch"]');
  const svg = await page.locator('.floorplan-svg').boundingBox();
  if (!svg) throw new Error('Canvas not visible');
  const clickX = svg.x + svg.width * 0.28;
  const clickY = svg.y + svg.height * 0.72;
  const expected = await page.evaluate(({ cx, cy }) => {
    const el = document.querySelector('.floorplan-svg');
    const pt = el.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const l = pt.matrixTransform(el.getScreenCTM().inverse());
    return { x: Math.round(l.x / 10) * 10, y: Math.round(l.y / 10) * 10 };
  }, { cx: clickX, cy: clickY });
  await page.mouse.click(clickX, clickY);
  const t = await page.locator('.floorplan-fixture').last().getAttribute('transform');
  const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t || '');
  if (!m) throw new Error('No fixture transform found');
  expect(Math.abs(Number(m[1]) - expected.x)).toBeLessThan(12);
  expect(Math.abs(Number(m[2]) - expected.y)).toBeLessThan(12);
});

test('measure tool tapes a distance between two points', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-measure-dim')).toHaveCount(0);
  await selectTool(page, 'measure');
  const svg = await page.locator('.floorplan-svg').boundingBox();
  if (!svg) throw new Error('Canvas not visible');
  await page.mouse.move(svg.x + 200, svg.y + 210);
  await page.mouse.down();
  await page.mouse.move(svg.x + 360, svg.y + 210, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.floorplan-measure-dim')).toHaveCount(1);
});

test('electrical and plumbing sections place system symbols', async ({ page }) => {
  await openPlan(page);
  const svg = await page.locator('.floorplan-svg').boundingBox();
  if (!svg) throw new Error('Canvas not visible');

  await page.click('.floorplan-symbol-choice[data-symbol-key="outlet"]');
  await expect(page.locator('.floorplan-symbol-choice[data-symbol-key="outlet"]')).toHaveClass(/active/);
  await page.mouse.click(svg.x + 300, svg.y + 250);
  await expect(page.locator('g.floorplan-electrical .floorplan-symbol-graphic')).toHaveCount(1);

  await page.click('.floorplan-symbol-choice[data-symbol-key="kitchen-sink"]');
  await page.mouse.click(svg.x + 340, svg.y + 250);
  await expect(page.locator('g.floorplan-plumbing .floorplan-symbol-graphic')).toHaveCount(1);
});

test('render space modal renders a 3D viewpoint with a camera map', async ({ page }) => {
  await openPlan(page);
  await page.click('.floorplan-ai-render-btn');
  await page.waitForSelector('.floorplan-cam-map', { timeout: 5_000 });
  await page.click('.floorplan-ai-view-btn');
  await expect(page.locator('.floorplan-view-svg')).toBeVisible();
});

test('camera map responds to clicks without error', async ({ page }) => {
  await openPlan(page);
  await page.click('.floorplan-ai-render-btn');
  const map = await page.waitForSelector('.floorplan-cam-map', { timeout: 5_000 });
  const box = await map.boundingBox();
  if (!box) throw new Error('Camera map not visible');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.click('.floorplan-ai-view-btn');
  await expect(page.locator('.floorplan-view-svg')).toBeVisible();
});

/* ============================================================
   Feature upgrades (rows 17–28) — parametric editing, zoom,
   trim/join, grouping, custom layers, line/circle tools.
   ============================================================ */

async function svgBox(page) {
  const box = await page.locator('.floorplan-svg').boundingBox();
  if (!box) throw new Error('Canvas not visible');
  return box;
}

async function clickWall(page, nth, opts = {}) {
  const id = await page.locator('.floorplan-wall').nth(nth).getAttribute('data-floorplan-item');
  await page.locator(`rect.floorplan-hit[data-floorplan-item="${id}"]`).click(opts);
}

async function placeSymbolId(page, key, pos) {
  await placeAndSelectSymbol(page, key, pos);
  return page.locator('.floorplan-fixture.floorplan-selected').getAttribute('data-floorplan-item');
}

// Row 18 — zoom in/out, reset, and zoom to fit
test('zoom controls change the viewport and support zoom to fit (row 18)', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-zoom-toolbar')).toBeVisible();
  const readViewBox = () => page.locator('.floorplan-svg').getAttribute('viewBox');
  expect(await readViewBox()).toBe('0 0 960 620');

  await page.click('.floorplan-zoom-in');
  const zoomed = await readViewBox();
  expect(Number(zoomed.split(' ')[2])).toBeLessThan(960);
  await expect(page.locator('.floorplan-zoom-readout')).not.toHaveText('100%');

  await page.click('.floorplan-zoom-readout');
  expect(await readViewBox()).toBe('0 0 960 620');

  await page.click('.floorplan-zoom-fit');
  expect(await readViewBox()).not.toBe('0 0 960 620');
});

// Row 18 — keyboard zoom shortcuts
test('keyboard shortcuts zoom the floor plan (row 18)', async ({ page }) => {
  await openPlan(page);
  await page.keyboard.press('Control+Equal');
  await expect(page.locator('.floorplan-zoom-readout')).not.toHaveText('100%');
  await page.keyboard.press('Control+Digit0');
  await expect(page.locator('.floorplan-zoom-readout')).toHaveText('100%');
});

// Row 20 — rectangular dining table symbol
test('rectangular dining table symbol places, selects, and rotates (row 20)', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-symbol-choice[data-symbol-key="dining-table-rect"]')).toHaveCount(1);
  const before = await page.locator('.floorplan-symbol-graphic').count();
  await placeAndSelectSymbol(page, 'dining-table-rect', { x: 520, y: 360 });
  expect(await page.locator('.floorplan-symbol-graphic').count()).toBe(before + 1);

  const angleBefore = await page.locator('.floorplan-fixture.floorplan-selected')
    .evaluate(n => Number(/rotate\(([-\d.]+)/.exec(n.getAttribute('transform'))[1]));
  await page.click('.floorplan-prop-rotate-right');
  const angleAfter = await page.locator('.floorplan-fixture.floorplan-selected')
    .evaluate(n => Number(/rotate\(([-\d.]+)/.exec(n.getAttribute('transform'))[1]));
  expect(angleAfter).not.toBe(angleBefore);
});

// Row 26 — circle tool
test('circle tool draws a circle with radius controls (row 26)', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'circle');
  const box = await svgBox(page);
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 560, box.y + 300, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.floorplan-circle')).toHaveCount(1);

  await selectTool(page, 'select');
  await page.mouse.click(box.x + 560, box.y + 300);
  await expect(page.locator('.floorplan-insp-input[data-field="radius"]')).toHaveCount(1);
  await expect(page.locator('.floorplan-resize-handle[data-floorplan-handle="circ-e"]')).toHaveCount(1);
});

// Row 23 — single open line finished with Enter
test('line tool draws a single open line finished with Enter (row 23)', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'line');
  const box = await svgBox(page);
  await page.mouse.click(box.x + 150, box.y + 150);
  await page.mouse.click(box.x + 320, box.y + 150);
  await page.keyboard.press('Enter');
  await expect(page.locator('polyline.floorplan-line')).toHaveCount(1);
  await expect(page.locator('polygon.floorplan-line')).toHaveCount(0);
});

// Row 23 — open polyline finished via the Finish Line button
test('line tool finishes an open polyline via the Finish Line button (row 23)', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'line');
  const box = await svgBox(page);
  await page.mouse.click(box.x + 150, box.y + 420);
  await page.mouse.click(box.x + 250, box.y + 470);
  await page.mouse.click(box.x + 360, box.y + 420);
  await page.click('.floorplan-line-finish-btn');
  await expect(page.locator('polyline.floorplan-line')).toHaveCount(1);
});

// Row 24 — stroke style (type/weight/color) controls
test('line tool exposes stroke style controls applied to new lines (row 24)', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'line');
  await expect(page.locator('.floorplan-line-toolbar')).toBeVisible();
  await page.selectOption('.floorplan-line-toolbar .floorplan-line-type', 'dashed');
  const box = await svgBox(page);
  await page.mouse.click(box.x + 150, box.y + 200);
  await page.mouse.click(box.x + 330, box.y + 200);
  await page.keyboard.press('Enter');
  const dash = await page.locator('polyline.floorplan-line').first().getAttribute('stroke-dasharray');
  expect((dash || '').trim().length).toBeGreaterThan(0);
});

// Row 25 — post-draw vertex editing
test('selected line shows vertex handles that can be deleted (row 25)', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'line');
  const box = await svgBox(page);
  await page.mouse.click(box.x + 160, box.y + 250);
  await page.mouse.click(box.x + 300, box.y + 250);
  await page.mouse.click(box.x + 300, box.y + 380);
  await page.keyboard.press('Enter');

  await selectTool(page, 'select');
  await page.mouse.click(box.x + 230, box.y + 250); // on the first horizontal segment
  await expect(page.locator('.floorplan-vertex-handle')).toHaveCount(3);

  await page.locator('.floorplan-vertex-handle').nth(1).click({ button: 'right' });
  await expect(page.locator('.floorplan-vertex-handle')).toHaveCount(2);
});

// Row 27 — arrow-key nudging
test('arrow keys nudge the selected object (row 27)', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });
  const readX = () => page.locator('.floorplan-fixture.floorplan-selected')
    .evaluate(n => Number(/translate\(([-\d.]+)/.exec(n.getAttribute('transform'))[1]));
  const x1 = await readX();
  await page.keyboard.press('ArrowRight');
  const x2 = await readX();
  expect(x2).toBeGreaterThan(x1);
  await page.keyboard.press('Shift+ArrowRight');
  const x3 = await readX();
  expect(x3 - x2).toBeGreaterThan(x2 - x1);
});

// Row 28 — wall length via numeric input
test('wall length can be changed via the inspector input (row 28)', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'select');
  await clickWall(page, 0);
  const input = page.locator('.floorplan-insp-input[data-field="length"]');
  await expect(input).toHaveCount(1);
  const len = () => page.locator('.floorplan-wall.floorplan-selected').first().evaluate((n) => {
    const x1 = Number(n.getAttribute('x1')); const y1 = Number(n.getAttribute('y1'));
    const x2 = Number(n.getAttribute('x2')); const y2 = Number(n.getAttribute('y2'));
    return Math.hypot(x2 - x1, y2 - y1);
  });
  const before = await len();
  await input.fill('8');
  await input.press('Enter');
  const after = await len();
  expect(Math.round(after)).not.toBe(Math.round(before));
});

// Row 21 — grouping so selecting one member selects the group
test('symbols can be grouped so selecting one selects the whole group (row 21)', async ({ page }) => {
  await openPlan(page);
  const couchId = await placeSymbolId(page, 'couch', { x: 460, y: 330 });
  const armId = await placeSymbolId(page, 'armchair', { x: 560, y: 330 });

  await selectTool(page, 'select');
  await page.locator(`[data-floorplan-item="${couchId}"] .floorplan-hit`).click();
  await page.locator(`[data-floorplan-item="${armId}"] .floorplan-hit`).click({ modifiers: ['Shift'] });
  await expect(page.locator('.floorplan-fixture.floorplan-selected')).toHaveCount(2);

  await page.click('.floorplan-insp-group');
  await page.keyboard.press('Escape');
  await page.locator(`[data-floorplan-item="${couchId}"] .floorplan-hit`).click();
  await expect(page.locator('.floorplan-fixture.floorplan-selected')).toHaveCount(2);
});

// Row 21 — locking prevents moving the selection
test('locked objects cannot be nudged until unlocked (row 21)', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });
  await page.click('.floorplan-insp-lock');
  const readX = () => page.locator('.floorplan-fixture.floorplan-selected')
    .evaluate(n => Number(/translate\(([-\d.]+)/.exec(n.getAttribute('transform'))[1]));
  const x1 = await readX();
  await page.keyboard.press('ArrowRight');
  expect(await readX()).toBe(x1);
});

// Row 22 — custom layers create + assign + visibility
test('custom layers can be created and hide their assigned items (row 22)', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-custom-layer-row')).toHaveCount(0);
  await page.click('.floorplan-add-layer-btn');
  await expect(page.locator('.floorplan-custom-layer-row')).toHaveCount(1);

  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });
  const layerName = await page.locator('.floorplan-custom-layer-name').first().inputValue();
  await page.selectOption('.floorplan-insp-layer', layerName);

  const before = await page.locator('.floorplan-symbol-graphic').count();
  await page.click('.floorplan-custom-visible');
  expect(await page.locator('.floorplan-symbol-graphic').count()).toBeLessThan(before);
});

// Row 19 — trim tool present + join action for two walls
test('trim tool is available and join appears for two selected walls (row 19)', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-tool-button[data-tool="trim"]')).toHaveCount(1);
  await selectTool(page, 'trim');
  await expect(page.locator('.floorplan-tool-button[data-tool="trim"]')).toHaveClass(/active/);

  await selectTool(page, 'select');
  await clickWall(page, 0);
  await clickWall(page, 1, { modifiers: ['Shift'] });
  await expect(page.locator('.floorplan-insp-join')).toHaveCount(1);
});

// Row 19 — trim cuts an overhanging wall at an intersection
test('trim cuts an overhanging wall at the intersection (row 19)', async ({ page }) => {
  await openPlan(page);
  const box = await svgBox(page);
  const beforeWalls = await page.locator('.floorplan-wall').count();

  await selectTool(page, 'wall');
  await page.mouse.move(box.x + 200, box.y + 470); await page.mouse.down();
  await page.mouse.move(box.x + 430, box.y + 470, { steps: 10 }); await page.mouse.up();
  await page.mouse.move(box.x + 360, box.y + 410); await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 540, { steps: 10 }); await page.mouse.up();
  expect(await page.locator('.floorplan-wall').count()).toBe(beforeWalls + 2);

  await selectTool(page, 'trim');
  await page.mouse.click(box.x + 415, box.y + 470); // on the overhang beyond the crossing
  await expect(page.locator('.floorplan-feedback')).toContainText(/Trimmed|No intersection/i);
  expect(await page.locator('.floorplan-wall').count()).toBe(beforeWalls + 2);
});

// Row 17 — windows resize via a numeric width input
test('windows resize via a numeric width input (row 17)', async ({ page }) => {
  await openPlan(page);
  const wallBox = await page.locator('.floorplan-wall').first().boundingBox();
  if (!wallBox) throw new Error('Wall geometry missing');
  const tx = wallBox.x + (wallBox.width / 2);
  const ty = wallBox.y + (wallBox.height / 2);

  await selectTool(page, 'window');
  await page.mouse.click(tx, ty);
  await selectTool(page, 'select');
  await page.mouse.click(tx, ty);

  const input = page.locator('.floorplan-insp-input[data-field="width"]');
  await expect(input).toHaveCount(1);
  await input.fill('5');
  await input.press('Enter');
  await expect(page.locator('.floorplan-prop-dims')).toContainText('5');
});

test('feature 1 wheel zoom uses dampened cursor-centered changes', async ({ page }) => {
  await openPlan(page);
  const svg = page.locator('.floorplan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Canvas not visible');
  const before = await svg.getAttribute('viewBox');
  await page.mouse.move(box.x + 180, box.y + 140);
  await page.mouse.wheel(0, -120);
  const after = await svg.getAttribute('viewBox');
  expect(after).not.toBe(before);
  const widthBefore = Number(before.split(' ')[2]);
  const widthAfter = Number(after.split(' ')[2]);
  expect(widthBefore - widthAfter).toBeGreaterThan(10);
  expect(widthBefore - widthAfter).toBeLessThan(180);
});

test('feature 2 space drag pans an unbounded dynamic grid', async ({ page }) => {
  await openPlan(page);
  const svg = page.locator('.floorplan-svg');
  await expect(page.locator('.floorplan-grid-line[data-dynamic-grid="true"]')).toHaveCount(await page.locator('.floorplan-grid-line[data-dynamic-grid="true"]').count());
  const before = await svg.getAttribute('viewBox');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Canvas not visible');
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 370, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const after = await svg.getAttribute('viewBox');
  expect(after).toBeTruthy();
  expect(await page.locator('.floorplan-grid-line[data-dynamic-grid="true"]').count()).toBeGreaterThan(20);
});

test('off-center rooms stay off-center after resize updates', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'room');
  const box = await page.locator('.floorplan-svg').boundingBox();
  if (!box) throw new Error('Canvas not visible');
  await page.mouse.move(box.x + 520, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 640, box.y + 350, { steps: 8 });
  await page.mouse.up();

  await selectTool(page, 'select');
  await page.mouse.click(box.x + 580, box.y + 300);
  const selectedRoom = page.locator('.floorplan-room.floorplan-selected').first();
  await expect(selectedRoom).toHaveCount(1);
  const roomId = await selectedRoom.getAttribute('data-floorplan-item');
  if (!roomId) throw new Error('Selected room id missing');

  await expect.poll(async () => page.evaluate((id) => {
    const raw = localStorage.getItem('waymark_floorplan_draft_sheet-075');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean((parsed.items || []).find(item => String(item.id) === id));
  }, roomId)).toBe(true);

  await page.evaluate((id) => {
    const key = 'waymark_floorplan_draft_sheet-075';
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : { items: [] };
    const updated = (parsed.items || []).map((item) => {
      if (String(item.id) !== id) return item;
      return { ...item, x: 1200, y: 260, width: 140, height: 100 };
    });
    localStorage.setItem(key, JSON.stringify({ ...parsed, items: updated }));
  }, roomId);

  await page.reload();
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });
  await page.locator('.floorplan-svg').evaluate((svg) => svg.setAttribute('viewBox', '900 120 960 620'));
  await selectTool(page, 'select');
  await page.click(`[data-floorplan-item="${roomId}"]`);

  const handle = page.locator('.floorplan-resize-handle[data-floorplan-handle="room-nw"]').first();
  await expect(handle).toHaveCount(1);
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Resize handle not visible');
  await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 28, handleBox.y - 20, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => page.evaluate((id) => {
    const raw = localStorage.getItem('waymark_floorplan_draft_sheet-075');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const found = (parsed.items || []).find(item => String(item.id) === id);
    return found ? Number(found.x) : null;
  }, roomId)).toBeGreaterThan(1000);
});

test('feature 3 copy paste places duplicates near the current cursor', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });
  const before = await page.locator('.floorplan-symbol-graphic').count();
  const svg = await svgBox(page);
  await page.mouse.move(svg.x + 700, svg.y + 430);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  expect(await page.locator('.floorplan-symbol-graphic').count()).toBe(before + 1);
  const t = await page.locator('.floorplan-fixture.floorplan-selected').last().getAttribute('transform');
  expect(t).toContain('translate(');
  expect(t).not.toContain('520 360');
});

test('feature 4 custom layer names render with tooltip and persist locally', async ({ page }) => {
  await openPlan(page);
  await page.click('.floorplan-add-layer-btn');
  const input = page.locator('.floorplan-custom-layer-name').first();
  await input.fill('Very Long Electrical And Plumbing Coordination Layer');
  await input.press('Enter');
  await expect(page.locator('.floorplan-custom-layer-name').first()).toHaveValue('Very Long Electrical And Plumbing Coordination Layer');
  await expect(page.locator('.floorplan-custom-layer-name').first()).toHaveAttribute('title', /Very Long Electrical/);
});

test('feature 5 multi selection exposes batch layer reassignment', async ({ page }) => {
  await openPlan(page);
  await page.click('.floorplan-add-layer-btn');
  await selectTool(page, 'select');
  const room = await page.locator('.floorplan-room').first().boundingBox();
  const wall = await page.locator('.floorplan-wall').first().boundingBox();
  if (!room || !wall) throw new Error('Expected selectable geometry');
  await page.mouse.click(room.x + room.width / 2, room.y + room.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.click(wall.x + wall.width / 2, wall.y + Math.max(2, wall.height / 2));
  await page.keyboard.up('Shift');
  await expect(page.locator('.floorplan-batch-layer')).toBeVisible();
  await page.selectOption('.floorplan-batch-layer', 'Layer 1');
  await expect(page.locator('.floorplan-prop-dims')).toContainText('2 selected');
});

test('feature 6 hidden and locked layers do not hit test objects', async ({ page }) => {
  await openPlan(page);
  const id = await placeSymbolId(page, 'couch', { x: 520, y: 360 });
  await page.click('.floorplan-layer-toggle[data-layer="fixture"]');
  await selectTool(page, 'select');
  await page.locator('.floorplan-svg').click({ position: { x: 520, y: 360 } });
  await expect(page.locator(`[data-floorplan-item="${id}"].floorplan-selected`)).toHaveCount(0);
});

test('hidden layer objects cannot be clicked or marquee-selected and do not block visible rooms', async ({ page }) => {
  await openPlan(page);
  const id = await placeSymbolId(page, 'couch', { x: 605, y: 215 });
  await page.click('.floorplan-layer-toggle[data-layer="fixture"]');
  await selectTool(page, 'select');

  const svg = await svgBox(page);
  await page.mouse.move(svg.x + 560, svg.y + 170);
  await page.mouse.down();
  await page.mouse.move(svg.x + 660, svg.y + 260, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(`[data-floorplan-item="${id}"].floorplan-selected`)).toHaveCount(0);

  await page.mouse.click(svg.x + 605, svg.y + 215);
  await expect(page.locator(`[data-floorplan-item="${id}"].floorplan-selected`)).toHaveCount(0);
  await expect(page.locator('.floorplan-room.floorplan-selected')).toHaveCount(1);
});

test('custom layer renders as one unified layer row like default layers', async ({ page }) => {
  await openPlan(page);
  await page.click('.floorplan-add-layer-btn');
  const row = page.locator('.floorplan-custom-layer-row').first();
  await expect(row.locator('.floorplan-custom-layer-main.floorplan-layer-toggle')).toHaveCount(1);
  await expect(row.locator(':scope > .floorplan-custom-visible')).toHaveCount(0);
  await expect(row.locator('.floorplan-custom-layer-main .floorplan-custom-layer-name')).toHaveCount(1);
  await expect(row.locator(':scope > .floorplan-layer-lock')).toHaveCount(1);
});

test('feature 7 context menu exposes z-index controls', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });
  await page.locator('.floorplan-fixture.floorplan-selected').click({ button: 'right' });
  await expect(page.locator('.floorplan-context-menu')).toBeVisible();
  await page.click('.floorplan-context-front');
  await page.keyboard.press('Control+BracketLeft');
  await expect(page.locator('.floorplan-context-menu')).toHaveCount(0);
});

test('selected-object toolbar z-order buttons reorder SVG draw order', async ({ page }) => {
  await openPlan(page);
  await placeSymbolId(page, 'couch', { x: 520, y: 360 });
  await placeSymbolId(page, 'coffee-table', { x: 680, y: 360 });
  const orderBefore = await page.locator('.floorplan-layer-fixture > g[data-floorplan-item]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-floorplan-item')));
  const couchId = orderBefore.at(-2);
  const tableId = orderBefore.at(-1);
  expect(orderBefore.lastIndexOf(tableId)).toBeGreaterThan(orderBefore.lastIndexOf(couchId));

  await page.click('.floorplan-z-back');
  const orderAfter = await page.locator('.floorplan-layer-fixture > g[data-floorplan-item]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-floorplan-item')));
  expect(orderAfter.lastIndexOf(tableId)).toBeLessThan(orderAfter.lastIndexOf(couchId));
  await expect.poll(async () => page.locator('.floorplan-board').evaluate((node, ids) => {
    const saved = JSON.parse(localStorage.getItem('waymark_floorplan_draft_sheet-075') || '{"items":[]}').items;
    const couch = saved.find(item => String(item.id) === ids.couchId);
    const table = saved.find(item => String(item.id) === ids.tableId);
    return Number(table?.zIndex || 0) < Number(couch?.zIndex || 0);
  }, { couchId, tableId })).toBe(true);
});

test('feature 8 export menu provides JPEG and PDF report actions', async ({ page }) => {
  await openPlan(page);
  await page.click('.floorplan-export-menu-btn');
  await expect(page.locator('.floorplan-export-menu')).toBeVisible();
  await page.click('.floorplan-export-jpeg');
  const last = await page.locator('.floorplan-board').evaluate(node => node.dataset.lastExport);
  expect(last).toBe('jpeg-2x');
});

test('3D render export actions are discoverable and create download intents', async ({ page }) => {
  await openPlan(page);
  await page.click('.floorplan-export-menu-btn');
  await expect(page.locator('.floorplan-export-3d-jpeg')).toBeVisible();
  await expect(page.locator('.floorplan-export-3d-pdf')).toBeVisible();
  await page.click('.floorplan-export-3d-jpeg');
  const result = await page.locator('.floorplan-board').evaluate(node => ({
    last: node.dataset.lastExport,
    url: node.dataset.lastExportUrl,
    count: window.__WAYMARK_FLOORPLAN_EXPORTS__?.length || 0,
  }));
  expect(result.last).toBe('3d-jpeg');
  expect(result.url).toContain('data:image/svg+xml');
  expect(result.count).toBeGreaterThan(0);
});

test('feature 9 selected objects carry AI prompt and seed photo descriptors', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });
  await expect(page.locator('.floorplan-ai-prompt-input')).toBeVisible();
  await page.fill('.floorplan-ai-prompt-input', 'linen sofa, warm oak, soft lighting');
  await page.fill('.floorplan-ai-ref-input', 'seed-photo.jpg');
  await page.setInputFiles('.floorplan-ai-seed-file', {
    name: 'seed-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([1, 2, 3, 4]),
  });
  await expect(page.locator('.floorplan-ai-prompt-input')).toHaveValue(/linen sofa/);
  const records = await page.evaluate(() => window.__WAYMARK_RECORDS__ || []);
  expect(records.some(record => record.type === 'floorplan-object-metadata' && record.field === 'referencePhoto' && record.value === 'seed-photo.jpg')).toBe(true);
});

test('off-origin placed objects keep world coordinates after re-render', async ({ page }) => {
  await openPlan(page);
  await page.locator('.floorplan-svg').evaluate(svg => svg.setAttribute('viewBox', '-520 -320 960 620'));
  await page.click('.floorplan-symbol-choice[data-symbol-key="chair"]');
  const svg = await svgBox(page);
  await page.mouse.click(svg.x + 120, svg.y + 120);
  const placed = page.locator('.floorplan-fixture').last();
  const before = await placed.getAttribute('transform');
  expect(before).toMatch(/translate\(-/);
  await selectTool(page, 'select');
  await page.click('.floorplan-layer-toggle[data-layer="fixture"]');
  await page.click('.floorplan-layer-toggle[data-layer="fixture"]');
  const after = await placed.getAttribute('transform');
  expect(after).toBe(before);
});

test('3D render uses bumpout wall geometry and opens object details from render objects', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'fridge', { x: 700, y: 120 });
  await page.click('.floorplan-ai-render-btn');
  await page.waitForSelector('.floorplan-ai-render-modal .floorplan-view-svg', { timeout: 5_000 });
  expect(await page.locator('.floorplan-view-wall').count()).toBeGreaterThan(4);
  await page.locator('.floorplan-view-object').first().click();
  await expect(page.locator('.floorplan-object-details')).toBeVisible();
  await page.fill('.floorplan-render-ai-prompt-input', 'french door bottom freezer silver whirlpool fridge');
  await page.press('.floorplan-render-ai-prompt-input', 'Tab');
  await page.setInputFiles('.floorplan-render-ai-seed-file', {
    name: 'fridge-seed.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([5, 6, 7, 8]),
  });
  const records = await page.evaluate(() => window.__WAYMARK_RECORDS__ || []);
  expect(records.some(record => record.type === 'floorplan-object-metadata' && record.field === 'aiPrompt' && /french door/.test(record.value))).toBe(true);
  expect(records.some(record => record.type === 'floorplan-object-metadata' && record.field === 'referencePhoto' && record.value === 'fridge-seed.jpg')).toBe(true);
});

test('feature 10 alt temporarily switches to select tool', async ({ page }) => {
  await openPlan(page);
  await selectTool(page, 'line');
  await page.keyboard.down('Alt');
  await expect(page.locator('.floorplan-tool-button[data-tool="select"]')).toHaveClass(/active/);
  await page.keyboard.up('Alt');
  await expect(page.locator('.floorplan-tool-button[data-tool="line"]')).toHaveClass(/active/);
});

test('feature 11 electrical and plumbing live in the symbols library', async ({ page }) => {
  await openPlan(page);
  expect(await page.locator('.floorplan-rail-heading').evaluateAll(nodes => nodes.map(n => n.textContent))).not.toContain('Systems');
  await page.click('.floorplan-symbol-jump[data-category="electrical"]');
  await expect(page.locator('.floorplan-symbol-choice[data-symbol-key="outlet"]')).toBeVisible();
  await page.click('.floorplan-symbol-jump[data-category="plumbing"]');
  await expect(page.locator('.floorplan-symbol-choice[data-symbol-key="kitchen-sink"]')).toBeVisible();
});

test('feature 12 aspect-ratio lock can be toggled in the inspector', async ({ page }) => {
  await openPlan(page);
  await placeAndSelectSymbol(page, 'couch', { x: 520, y: 360 });
  await expect(page.locator('.floorplan-aspect-lock')).toContainText('Aspect locked');
  await page.click('.floorplan-aspect-lock');
  await expect(page.locator('.floorplan-aspect-lock')).toContainText('Freeform stretch');
});

test('feature 13 state toggles, layers tab, and clear guard are separated', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-panel-tab[data-tab="symbols"]')).toHaveClass(/active/);
  await page.click('.floorplan-panel-tab[data-tab="layers"]');
  await expect(page.locator('.floorplan-panel-tab[data-tab="layers"]')).toHaveClass(/active/);
  await page.click('.floorplan-clear-guard-btn');
  await expect(page.locator('.floorplan-clear-popover')).toBeVisible();
});

test('feature 14 symbols search and jump pills filter the icon grid', async ({ page }) => {
  await openPlan(page);
  await page.fill('.floorplan-symbol-search', 'microwave');
  await expect(page.locator('.floorplan-symbol-choice[data-symbol-key="microwave"]')).toBeVisible();
  const hidden = await page.locator('.floorplan-symbol-choice.hidden').count();
  expect(hidden).toBeGreaterThan(5);
});

test('feature 15 room label pills show dimensions and snap dropdown cycles', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-room-label-pill')).toHaveCount(8);
  await expect(page.locator('.floorplan-room-label-sub').first()).toContainText('sq ft');
  await page.click('.floorplan-snap-pill');
  await expect(page.locator('.floorplan-snap-pill')).toContainText('6 in');
});

test('feature 16 grouped action bar and floating HUD are present', async ({ page }) => {
  await openPlan(page);
  await expect(page.locator('.floorplan-view-switcher')).toBeVisible();
  await expect(page.locator('.floorplan-floating-hud')).toBeVisible();
  await page.click('.floorplan-view-btn[data-view="interior"]');
  await expect(page.locator('.floorplan-view-btn[data-view="interior"]')).toHaveClass(/active/);
});

test('feature 17 clearance lighting overlays and BoM export render', async ({ page }) => {
  await openPlan(page);
  await page.click('.floorplan-clearance-toggle');
  await page.click('.floorplan-lighting-toggle');
  await expect(page.locator('.floorplan-clearance-arc')).toHaveCount(await page.locator('.floorplan-clearance-arc').count());
  await expect(page.locator('.floorplan-lighting-throw')).toHaveCount(await page.locator('.floorplan-lighting-throw').count());
  await page.click('.floorplan-bom-btn');
  await expect(page.locator('.floorplan-bom-table')).toBeVisible();
  await expect(page.locator('.floorplan-bom-table')).toContainText('Room square feet');
});

test('feature 18 mobile viewport uses docked slide-up panels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-075');
  await page.waitForSelector('.floorplan-board', { timeout: 5_000 });
  await expect(page.locator('.floorplan-mobile-dock')).toBeVisible();
  await page.click('.floorplan-dock-btn');
  await expect(page.locator('.floorplan-panel')).toHaveClass(/floorplan-panel-open/);
  const overflow = await page.locator('.floorplan-board').evaluate(node => getComputedStyle(node).overflow);
  expect(overflow).toBe('hidden');
});

/* ---------- Regression: the floating status HUD must never cover or block toolbar buttons ---------- */

test('floating HUD never covers or blocks the top toolbar buttons', async ({ page }) => {
  await openPlan(page);
  await page.waitForSelector('.floorplan-floating-hud', { timeout: 5_000 });

  const result = await page.evaluate(() => {
    const hud = document.querySelector('.floorplan-floating-hud');
    const topbar = document.querySelector('.floorplan-topbar');
    const buttons = [...document.querySelectorAll(
      '.floorplan-view-btn, .floorplan-secondary-btn, .floorplan-export-btn'
    )];
    const coveredButtons = [];
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden (e.g. mobile overflow)
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      // Only the HUD covering a button is a regression — the HUD must never sit on top of a control.
      if (hud && topEl && hud.contains(topEl)) {
        coveredButtons.push((btn.textContent || '').trim());
      }
    }
    const hudRect = hud ? hud.getBoundingClientRect() : null;
    const barRect = topbar ? topbar.getBoundingClientRect() : null;
    return {
      hudPointerEvents: hud ? getComputedStyle(hud).pointerEvents : 'MISSING',
      coveredButtons,
      hudBelowToolbar: !!(hudRect && barRect) && hudRect.top >= barRect.bottom - 1,
    };
  });

  // The HUD must not intercept pointer input...
  expect(result.hudPointerEvents).toBe('none');
  // ...must sit below the toolbar row (not overlapping the button area)...
  expect(result.hudBelowToolbar).toBe(true);
  // ...and must never visually sit on top of any toolbar button.
  expect(result.coveredButtons).toEqual([]);
});

test('view-switcher buttons remain clickable (not blocked by the HUD)', async ({ page }) => {
  await openPlan(page);
  await page.waitForSelector('.floorplan-floating-hud', { timeout: 5_000 });

  const interior = page.locator('.floorplan-view-btn[data-view="interior"]');
  await interior.click();
  await expect(interior).toHaveClass(/active/);

  const blueprint = page.locator('.floorplan-view-btn[data-view="blueprint"]');
  await blueprint.click();
  await expect(blueprint).toHaveClass(/active/);
});
