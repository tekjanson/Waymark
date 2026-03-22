/**
 * waymark-index-conflict.spec.js — E2E tests for duplicate .waymark-index
 * file resolution in shared/multi-session folders.
 *
 * When multiple sessions independently create a .waymark-index file in the
 * same folder, the app must:
 * 1. Find ALL index files (not just the first)
 * 2. Merge their sheet data together
 * 3. Delete duplicate index files to consolidate
 * 4. Continue rendering all sheets correctly
 */

const { test, expect } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../helpers/test-utils');

/** Pre-populate mock JSON file store with two conflicting index files */
async function seedConflictingIndices(page) {
  await page.evaluate(() => {
    if (!window.__WAYMARK_JSON_FILES) window.__WAYMARK_JSON_FILES = {};
    // First index: has data for sheet-001
    window.__WAYMARK_JSON_FILES['idx-conflict-1'] = {
      v: 1,
      sheets: {
        'sheet-001': {
          name: 'Grocery List',
          headers: ['Item', 'Status', 'Quantity', 'Notes'],
          firstRow: ['Milk', 'done', '2', 'Whole milk'],
          modified: '2025-01-01T00:00:00.000Z',
          templateKey: 'checklist',
          icon: '✅',
        },
      },
    };
    // Second index (created by a concurrent session): has data for sheet-002
    window.__WAYMARK_JSON_FILES['idx-conflict-2'] = {
      v: 1,
      sheets: {
        'sheet-002': {
          name: 'Home Repairs',
          headers: ['Task', 'Done', 'Due', 'Notes'],
          firstRow: ['Fix leaky faucet', 'yes', '2025-02-15', 'Kitchen sink'],
          modified: '2025-01-01T00:00:00.000Z',
          templateKey: 'checklist',
          icon: '✅',
        },
      },
    };
  });
}

/** Navigate to the conflict test folder */
async function navigateToConflictFolder(page) {
  await page.evaluate(() => {
    window.location.hash = '#/folder/f-index-conflict/Recipe Collection';
  });
  await page.waitForSelector('#folder-title', { timeout: 8000 });
  await expect(page.locator('#folder-title')).toContainText('Recipe Collection');
}

/* ─── Merge behavior ─── */

test('folder with duplicate .waymark-index files loads all sheets', async ({ page }) => {
  await setupApp(page);
  await seedConflictingIndices(page);
  await navigateToConflictFolder(page);

  // Wait for sheets to render (both from the two merged indices)
  await page.waitForSelector('.sheet-list-item', { timeout: 10000 });
  const sheetCount = await page.locator('.sheet-list-item').count();
  // Both sheet-001 and sheet-002 should be visible
  expect(sheetCount).toBeGreaterThanOrEqual(2);
});

test('duplicate index file is deleted when two .waymark-index files exist', async ({ page }) => {
  await setupApp(page);
  await seedConflictingIndices(page);
  await navigateToConflictFolder(page);

  // Wait for sheets and give fire-and-forget delete time to run
  await page.waitForSelector('.sheet-list-item', { timeout: 10000 });
  await page.waitForTimeout(600);

  // A file-delete record should have been created for the second (duplicate) index
  const records = await getCreatedRecords(page);
  const deleteRecords = records.filter(r => r.type === 'file-delete');
  expect(deleteRecords.length).toBeGreaterThanOrEqual(1);
  // The duplicate (idx-conflict-2) should be the deleted one
  const deletedIds = deleteRecords.map(r => r.fileId);
  expect(deletedIds).toContain('idx-conflict-2');
});

test('no file deletions when only one .waymark-index file exists', async ({ page }) => {
  await setupApp(page);
  // f-index-single has exactly one .waymark-index file in the fixture tree
  await page.evaluate(() => {
    if (!window.__WAYMARK_JSON_FILES) window.__WAYMARK_JSON_FILES = {};
    window.__WAYMARK_JSON_FILES['idx-single-1'] = {
      v: 1,
      sheets: {
        'sheet-003': {
          name: 'Task List',
          headers: ['Task', 'Done', 'Notes'],
          firstRow: ['Buy groceries', 'no', ''],
          modified: '2025-01-01T00:00:00.000Z',
          templateKey: 'checklist',
          icon: '✅',
        },
      },
    };
  });

  await page.evaluate(() => {
    window.location.hash = '#/folder/f-index-single/Single Index Folder';
  });
  await page.waitForSelector('#folder-title', { timeout: 8000 });
  await page.waitForSelector('.sheet-list-item', { timeout: 10000 });
  await page.waitForTimeout(400);

  const records = await getCreatedRecords(page);
  const deleteRecords = records.filter(r => r.type === 'file-delete');
  // No file deletion should occur when there's only one index
  expect(deleteRecords.length).toBe(0);
});

/* ─── Sheet count integrity after merge ─── */

test('folder title shows correctly after navigating to conflict folder', async ({ page }) => {
  await setupApp(page);
  await seedConflictingIndices(page);
  await navigateToConflictFolder(page);
  await expect(page.locator('#folder-title')).toContainText('Recipe Collection');
});

test('folder view renders sheet cards (not empty state) with merged index', async ({ page }) => {
  await setupApp(page);
  await seedConflictingIndices(page);
  await navigateToConflictFolder(page);
  await page.waitForSelector('.sheet-list-item', { timeout: 10000 });
  // No empty-state message should appear
  await expect(page.locator('#no-sheets')).toBeHidden();
});

/* ─── api-client mock methods work correctly ─── */

test('api.drive.findAllFiles returns all matching entries from fixture tree', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    // Both idx-conflict-1 and idx-conflict-2 are named '.waymark-index' in the tree
    return await api.drive.findAllFiles('.waymark-index', 'f-index-conflict');
  });
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(2);
  const ids = result.map(f => f.id);
  expect(ids).toContain('idx-conflict-1');
  expect(ids).toContain('idx-conflict-2');
});

test('api.drive.findAllFiles returns empty array when folder does not exist', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    // Parent ID that does not exist anywhere in the fixture tree
    return await api.drive.findAllFiles('.waymark-index', 'nonexistent-folder-xyz');
  });
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(0);
});

test('api.drive.deleteFile creates a file-delete record in mock mode', async ({ page }) => {
  await setupApp(page);
  const countBefore = (await getCreatedRecords(page)).length;
  await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    await api.drive.deleteFile('idx-conflict-2');
  });
  const records = await getCreatedRecords(page);
  expect(records.length).toBe(countBefore + 1);
  const deleteRecord = records[records.length - 1];
  expect(deleteRecord.type).toBe('file-delete');
  expect(deleteRecord.fileId).toBe('idx-conflict-2');
});
