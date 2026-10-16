// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

const SHEET = 'sheet-076';

async function openOrganizer(page) {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.organizer-root', { timeout: 5_000 });
}

test('drive cleanup sheet detected as Drive Organizer template', async ({ page }) => {
  await openOrganizer(page);
  await expect(page.locator('#template-badge')).toContainText('Organizer');
});

test('organizer renders a triage row per file', async ({ page }) => {
  await openOrganizer(page);
  await expect(page.locator('.organizer-file')).toHaveCount(7);
});

test('organizer groups files into domain clusters', async ({ page }) => {
  await openOrganizer(page);
  const clusters = page.locator('.organizer-cluster');
  expect(await clusters.count()).toBeGreaterThanOrEqual(4);
  // Finance has two bank statements, so it is the largest (first) cluster.
  await expect(page.locator('.organizer-cluster-name').first()).toContainText('Finance');
});

test('organizer surfaces duplicate and stale flags', async ({ page }) => {
  await openOrganizer(page);
  await expect(page.locator('.organizer-flag-duplicate')).toHaveCount(2);
  await expect(page.locator('.organizer-flag-stale')).toHaveCount(1);
});

test('organizer shows AI insight chips', async ({ page }) => {
  await openOrganizer(page);
  const chips = page.locator('.organizer-insight-chip');
  expect(await chips.count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.organizer-insights')).toContainText('duplicate');
});

test('organizer toolbar exposes the five control-plane actions', async ({ page }) => {
  await openOrganizer(page);
  await expect(page.locator('.organizer-btn-scan')).toBeVisible();
  await expect(page.locator('.organizer-btn-propose')).toBeVisible();
  await expect(page.locator('.organizer-btn-approveall')).toBeVisible();
  await expect(page.locator('.organizer-btn-togglediff')).toBeVisible();
  await expect(page.locator('.organizer-btn-run')).toBeVisible();
  await expect(page.locator('.organizer-btn-undo')).toBeVisible();
});

test('AI Propose fills proposed folder, name and confidence and persists', async ({ page }) => {
  await openOrganizer(page);
  await page.click('.organizer-btn-propose');
  await page.waitForSelector('.organizer-conf-num', { timeout: 3_000 });

  // First file (a Finance bank statement) gets a clean destination folder.
  await expect(page.locator('.organizer-file-to').first()).toContainText('/Finance/2026');
  await expect(page.locator('.organizer-conf-num').first()).toContainText('%');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update')).toBe(true);
});

test('cycling a file action changes its disposition and persists', async ({ page }) => {
  await openOrganizer(page);
  const action = page.locator('.organizer-action').first();
  await expect(action).toContainText('Set action');
  await action.click();
  await expect(action).toContainText('Move');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update')).toBe(true);
});

test('dry-run preview shows a before to after move tree', async ({ page }) => {
  await openOrganizer(page);
  await page.click('.organizer-btn-propose');
  await page.click('.organizer-btn-approveall');
  await page.click('.organizer-btn-togglediff');
  await page.waitForSelector('.organizer-diff', { timeout: 3_000 });
  expect(await page.locator('.organizer-diff-move').count()).toBeGreaterThan(0);
});

test('running a batch marks files done and writes an audit log', async ({ page }) => {
  await openOrganizer(page);
  await page.click('.organizer-btn-propose');
  await page.click('.organizer-btn-approveall');
  await page.click('.organizer-btn-run');
  await page.waitForSelector('.organizer-action-done', { timeout: 5_000 });
  expect(await page.locator('.organizer-action-done').count()).toBeGreaterThan(0);

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'tab-write' && r.tabTitle === 'Audit Log')).toBe(true);
  await expect(page.locator('.toast').first()).toBeVisible();
});

test('undo batch reverses the moves', async ({ page }) => {
  await openOrganizer(page);
  await page.click('.organizer-btn-propose');
  await page.click('.organizer-btn-approveall');
  await page.click('.organizer-btn-run');
  await page.waitForSelector('.organizer-action-done', { timeout: 5_000 });

  await page.click('.organizer-btn-undo');
  await page.waitForFunction(
    () => document.querySelectorAll('.organizer-action-done').length === 0,
    undefined,
    { timeout: 5_000 },
  );
  expect(await page.locator('.organizer-action-done').count()).toBe(0);
});

test('scan drive appends newly discovered files to the board', async ({ page }) => {
  await openOrganizer(page);
  await expect(page.locator('.organizer-file')).toHaveCount(7);
  await page.click('.organizer-btn-scan');
  await page.waitForFunction(
    () => document.querySelectorAll('.organizer-file').length > 7,
    undefined,
    { timeout: 5_000 },
  );
  expect(await page.locator('.organizer-file').count()).toBeGreaterThan(7);

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'row-append')).toBe(true);
});
