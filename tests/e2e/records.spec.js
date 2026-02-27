// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../helpers/test-utils');

/*
 * Records (CR-only) tests — each test gets a fresh browser context
 * with an empty __WAYMARK_RECORDS array. No cross-test accumulation.
 */

test('__WAYMARK_RECORDS is initialised empty in local mode', async ({ page }) => {
  await setupApp(page);

  const records = await getCreatedRecords(page);
  expect(Array.isArray(records)).toBe(true);
  expect(records.length).toBe(0);
});

test('created file records have correct metadata', async ({ page }) => {
  await setupApp(page);

  await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    await api.drive.createFile('test-log.json', 'application/json', ['folder-123']);
  });

  const records = await getCreatedRecords(page);
  expect(records.length).toBe(1);
  expect(records[0]).toHaveProperty('id');
  expect(records[0]).toHaveProperty('name', 'test-log.json');
  expect(records[0]).toHaveProperty('mimeType', 'application/json');
  expect(records[0]).toHaveProperty('createdAt');
});

test('created spreadsheet records are tracked', async ({ page }) => {
  await setupApp(page);

  await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    await api.sheets.createSpreadsheet('Test Snapshot', [['col1', 'col2'], ['a', 'b']], 'parent-1');
  });

  const records = await getCreatedRecords(page);
  expect(records.length).toBe(1);
  expect(records[0]).toHaveProperty('title', 'Test Snapshot');
  expect(records[0]).toHaveProperty('spreadsheetId');
  expect(records[0]).toHaveProperty('rows');
  expect(records[0].rows).toHaveLength(2);
});

test('multiple records accumulate within a single test', async ({ page }) => {
  await setupApp(page);

  await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    await api.drive.createFile('file-1.json', 'application/json', []);
    await api.drive.createFile('file-2.json', 'application/json', []);
    await api.sheets.createSpreadsheet('Sheet Log', [], null);
  });

  const records = await getCreatedRecords(page);
  expect(records.length).toBe(3);
});

test('records have unique IDs', async ({ page }) => {
  await setupApp(page);

  await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    await api.drive.createFile('a.json', 'application/json', []);
    await new Promise(r => setTimeout(r, 5));
    await api.drive.createFile('b.json', 'application/json', []);
  });

  const records = await getCreatedRecords(page);
  expect(records.length).toBe(2);
  expect(records[0].id).not.toBe(records[1].id);
});

test('records have ISO timestamps', async ({ page }) => {
  await setupApp(page);

  await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    await api.drive.createFile('timestamped.json', 'application/json', []);
  });

  const records = await getCreatedRecords(page);
  const ts = records[0].createdAt;
  expect(new Date(ts).toISOString()).toBe(ts);
});

test('records do NOT leak between tests (isolation check)', async ({ page }) => {
  // Fresh context: records array must be empty even if other
  // tests in this file created records in their own contexts
  await setupApp(page);
  const records = await getCreatedRecords(page);
  expect(records.length).toBe(0);
});
