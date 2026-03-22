// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows } = require('../helpers/test-utils');

const MOBILE = { width: 375, height: 812 };

/* ─── Tap targets: header icon buttons ─── */

test('sidebar-toggle btn-icon is ≥44px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  const btn = page.locator('#sidebar-toggle');
  await btn.waitFor({ state: 'visible' });
  const box = await btn.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('back-btn btn-icon is ≥44px on mobile in sheet view', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);
  const btn = page.locator('#back-btn');
  await btn.waitFor({ state: 'visible' });
  const box = await btn.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('open-in-sheets btn-header-icon is ≥44px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);
  const btn = page.locator('#open-in-sheets-btn');
  await btn.waitFor({ state: 'visible' });
  const box = await btn.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

/* ─── iOS zoom prevention: font-size ≥16px on mobile ─── */

test('search input font-size is ≥16px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  const px = await page.locator('#search-input').evaluate(
    el => parseFloat(getComputedStyle(el).fontSize)
  );
  expect(px).toBeGreaterThanOrEqual(16);
});

test('add-row field input font-size is ≥16px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-field-input', { timeout: 3_000 });
  const px = await page.locator('.add-row-field-input').first().evaluate(
    el => parseFloat(getComputedStyle(el).fontSize)
  );
  expect(px).toBeGreaterThanOrEqual(16);
});

test('add-row field select font-size is ≥16px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  // sheet-017 (kanban-project) has a Stage select field in the add-row form
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.add-row-trigger', { timeout: 5_000 });
  await page.click('.add-row-trigger');
  await page.waitForSelector('.add-row-field-select', { timeout: 3_000 });
  const px = await page.locator('.add-row-field-select').first().evaluate(
    el => parseFloat(getComputedStyle(el).fontSize)
  );
  expect(px).toBeGreaterThanOrEqual(16);
});

/* ─── No horizontal overflow ─── */

test('checklist view has no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);
  const overflows = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('#checklist-view *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 3) {
        issues.push((el.className || el.tagName).toString().slice(0, 60));
      }
    });
    return issues;
  });
  expect(overflows).toHaveLength(0);
});

/* ─── Checklist template touch targets ─── */

test('checklist checkbox is ≥40px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);
  const box = await page.locator('.checklist-checkbox').first().boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);
});

test('checklist row height is ≥44px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await waitForChecklistRows(page);
  const box = await page.locator('.checklist-row').first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

/* ─── Kanban template touch targets ─── */

test('kanban card expand button is ≥32px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  // sheet-028 has a Description column so cards render with expand buttons
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card-expand', { timeout: 5_000 });
  const box = await page.locator('.kanban-card-expand').first().boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(32);
  expect(box.height).toBeGreaterThanOrEqual(32);
});

test('kanban stage button min-height is ≥32px on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-stage-btn', { timeout: 5_000 });
  const box = await page.locator('.kanban-stage-btn').first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(32);
});

/* ─── Roster template touch targets ─── */

test('roster nav buttons are ≥44px tall on mobile', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-026');
  await page.waitForSelector('.roster-nav-btn', { timeout: 5_000 });
  const box = await page.locator('.roster-nav-btn').first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

/* ─── Swipe gestures: advance/retreat stage ─── */

/**
 * Synthesize touchstart → touchmove (steps) → touchend on an element.
 * Events bubble so they reach boardEl listeners attached to the kanban board.
 */
async function simulateSwipe(page, selectorOrBox, { dx, dy = 0 }) {
  await page.evaluate(({ sel, box, dx, dy }) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : null;
    const startX = box ? box.x + box.width / 2 : el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2;
    const startY = box ? box.y + box.height / 2 : el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2;
    const endX = startX + dx;
    const endY = startY + dy;

    function touch(x, y, target) {
      return new Touch({ identifier: 1, target, clientX: x, clientY: y, radiusX: 2, radiusY: 2, rotationAngle: 0, force: 1 });
    }
    function fire(el2, type, x, y) {
      const t = touch(x, y, el2);
      el2.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [t],
        changedTouches: [t],
        targetTouches: type === 'touchend' ? [] : [t],
      }));
    }
    const target = typeof sel === 'string' ? document.querySelector(sel) : document.elementFromPoint(startX, startY);
    if (!target) return;
    fire(target, 'touchstart', startX, startY);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const x = startX + (dx / steps) * i;
      const y = startY + (dy / steps) * i;
      fire(target, 'touchmove', x, y);
    }
    fire(target, 'touchend', endX, endY);
  }, { sel: typeof selectorOrBox === 'string' ? selectorOrBox : null, box: typeof selectorOrBox === 'object' ? selectorOrBox : null, dx, dy });
}

test('swipe left on kanban card advances its stage', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Find a Backlog card
  const backlogCard = page.locator('.kanban-lane-backlog .kanban-card').first();
  await backlogCard.waitFor({ timeout: 5_000 });
  const stageBadge = backlogCard.locator('.kanban-stage-btn');
  const initialStage = await stageBadge.textContent();

  // Swipe left (advance to To Do)
  const box = await backlogCard.boundingBox();
  await simulateSwipe(page, box, { dx: -100, dy: 0 });
  await page.waitForTimeout(100); // allow async badge update

  // Stage badge should change from Backlog to To Do
  const newStage = await stageBadge.textContent();
  expect(newStage).not.toBe(initialStage);
  expect(newStage.trim()).toBe('To Do');
});

test('swipe right on kanban card retreats its stage', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-card', { timeout: 5_000 });

  // Find a To Do card (stage badge text = "To Do")
  const todoCard = page.locator('.kanban-lane-todo .kanban-card').first();
  await todoCard.waitFor({ timeout: 5_000 });
  const stageBadge = todoCard.locator('.kanban-stage-btn');

  // Swipe right (retreat to Backlog)
  const box = await todoCard.boundingBox();
  await simulateSwipe(page, box, { dx: 100, dy: 0 });
  await page.waitForTimeout(100);

  const newStage = await stageBadge.textContent();
  expect(newStage.trim()).toBe('Backlog');
});

test('swipe left emits a cell-update record for the stage column', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-lane-backlog .kanban-card', { timeout: 5_000 });

  const backlogCard = page.locator('.kanban-lane-backlog .kanban-card').first();
  const box = await backlogCard.boundingBox();
  await simulateSwipe(page, box, { dx: -100, dy: 0 });
  await page.waitForTimeout(100);

  const records = await page.evaluate(() => window.__WAYMARK_RECORDS || []);
  const stageUpdate = records.find(r => r.type === 'cell-update' && r.value === 'To Do');
  expect(stageUpdate).toBeTruthy();
});

test('vertical swipe does not change stage', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-lane-backlog .kanban-card', { timeout: 5_000 });

  const backlogCard = page.locator('.kanban-lane-backlog .kanban-card').first();
  const stageBadge = backlogCard.locator('.kanban-stage-btn');
  const initialStage = await stageBadge.textContent();

  const box = await backlogCard.boundingBox();
  // Swipe mostly down (should scroll, not change stage)
  await simulateSwipe(page, box, { dx: 5, dy: 60 });
  await page.waitForTimeout(100);

  const newStage = await stageBadge.textContent();
  expect(newStage.trim()).toBe(initialStage.trim());
});

test('swipe too short does not change stage', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-lane-backlog .kanban-card', { timeout: 5_000 });

  const backlogCard = page.locator('.kanban-lane-backlog .kanban-card').first();
  const stageBadge = backlogCard.locator('.kanban-stage-btn');
  const initialStage = await stageBadge.textContent();

  const box = await backlogCard.boundingBox();
  // Swipe only 30px — below threshold
  await simulateSwipe(page, box, { dx: -30, dy: 0 });
  await page.waitForTimeout(100);

  const newStage = await stageBadge.textContent();
  expect(newStage.trim()).toBe(initialStage.trim());
});

test('swiping left on a Done card does not change stage (boundary)', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-lane-done .kanban-card', { timeout: 5_000 });

  const doneCard = page.locator('.kanban-lane-done .kanban-card').first();
  const stageBadge = doneCard.locator('.kanban-stage-btn');

  const box = await doneCard.boundingBox();
  await simulateSwipe(page, box, { dx: -100, dy: 0 });
  await page.waitForTimeout(100);

  // Stage should still be Done (no stage beyond Done in swipe flow)
  expect((await stageBadge.textContent()).trim()).toBe('Done');
});

