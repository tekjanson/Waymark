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
  await expect(page.locator('.organizer-file')).toHaveCount(8);
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

test('AI Propose creates structured destinations instead of one dump bucket', async ({ page }) => {
  await openOrganizer(page);
  await page.click('.organizer-btn-propose');
  await page.waitForSelector('.organizer-file-to', { timeout: 3_000 });

  const targets = await page.locator('.organizer-file:not(.organizer-file-protected) .organizer-file-to').allTextContents();
  const uniqueTargets = [...new Set(targets.map(t => t.trim()).filter(Boolean))];
  expect(uniqueTargets.length).toBeGreaterThanOrEqual(3);
  expect(uniqueTargets).not.toContain('/Archive/Unsorted');
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
  await expect(page.locator('.organizer-file')).toHaveCount(8);
  await page.click('.organizer-btn-scan');
  await page.waitForFunction(
    () => document.querySelectorAll('.organizer-file').length > 8,
    undefined,
    { timeout: 5_000 },
  );
  expect(await page.locator('.organizer-file').count()).toBeGreaterThan(8);

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'row-append')).toBe(true);
});

/* ---------- Protection: Waymark system files must never be moved or archived ---------- */

test('organizer marks Waymark system files as protected', async ({ page }) => {
  await openOrganizer(page);
  // The .waymark-data.json fixture row must render as protected and locked.
  await expect(page.locator('.organizer-flag-protected')).toHaveCount(1);
  await expect(page.locator('.organizer-action-protected')).toHaveCount(1);
  await expect(page.locator('.organizer-file-protected')).toContainText('.waymark-data.json');
});

test('AI Propose never suggests moving or archiving a protected Waymark file', async ({ page }) => {
  await openOrganizer(page);
  await page.click('.organizer-btn-propose');
  await page.waitForSelector('.organizer-conf-num', { timeout: 3_000 });

  const protectedRow = page.locator('.organizer-file-protected');
  // Still locked, still "keep in place", never an actionable Move/Archive button.
  await expect(protectedRow.locator('.organizer-action-protected')).toHaveCount(1);
  await expect(protectedRow.locator('.organizer-file-keep')).toHaveCount(1);
  await expect(protectedRow.locator('.organizer-action-move, .organizer-action-archive, .organizer-action-rename')).toHaveCount(0);
});

test('running a batch never moves a protected Waymark file', async ({ page }) => {
  await openOrganizer(page);
  await page.click('.organizer-btn-propose');
  await page.click('.organizer-btn-approveall');
  await page.click('.organizer-btn-run');
  await page.waitForSelector('.organizer-action-done', { timeout: 5_000 });

  const records = await getCreatedRecords(page);
  const movedProtected = records.filter(r => r.type === 'drive-move' && r.fileId === 'file-008');
  expect(movedProtected).toHaveLength(0);
  // The protected file is still shown as protected (never marked Done).
  await expect(page.locator('.organizer-action-protected')).toHaveCount(1);
});
