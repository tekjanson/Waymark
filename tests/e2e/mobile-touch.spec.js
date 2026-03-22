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
