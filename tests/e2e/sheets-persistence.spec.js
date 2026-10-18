const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

const source = fs.readFileSync(path.resolve(__dirname, '../../public/js/sheets.js'), 'utf8');
const planFixture = require('../fixtures/sheets/floorplan-house.json');
const STATE_TAB = 'Waymark Floor Plan';

function cellValue(value) {
  if (value == null) return {};
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
}

// A shared remote workbook implementing the Google operations used by these
// tests. Validate a batch before committing so rejected saves preserve data.
function googleWorkbook(initialTabs) {
  const remote = {
    tabs: structuredClone(initialTabs),
    calls: [],
    addError: null,
    saveError: null,
    beforeAdd: null,
    beforeSave: null,
  };
  const error = (status, message) => ({ status, body: { error: { code: status, message } } });
  const properties = tab => ({
    sheetId: tab.numericSheetId,
    title: tab.title,
    gridProperties: tab.gridProperties || { rowCount: 1000, columnCount: 26 },
  });
  remote.request = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    remote.calls.push({ url: String(url), method, body });
    if (method === 'GET') {
      return { status: 200, body: {
        properties: { title: 'House Layout' },
        sheets: remote.tabs.map(tab => ({
          properties: properties(tab),
          data: [{ rowData: tab.values.map(row => ({ values: row.map(cellValue) })) }],
        })),
      } };
    }
    if (!String(url).endsWith(':batchUpdate')) return error(500, 'Unexpected non-atomic write');
    if (body.requests.some(request => request.addSheet)) {
      if (remote.beforeAdd) await remote.beforeAdd();
      if (remote.addError) return error(remote.addError.status, remote.addError.message);
    }
    if (body.requests.some(request => request.updateCells)) {
      if (remote.beforeSave) await remote.beforeSave();
      if (remote.saveError) return error(remote.saveError.status, remote.saveError.message);
    }
    const next = structuredClone(remote.tabs);
    const replies = [];
    for (const request of body.requests) {
      if (request.addSheet) {
        const title = request.addSheet.properties.title;
        if (next.some(tab => tab.title.toLowerCase() === title.toLowerCase())) {
          return error(400, `A sheet with the name "${title}" already exists.`);
        }
        const tab = { title, numericSheetId: Math.max(0, ...next.map(t => t.numericSheetId)) + 1, values: [] };
        next.push(tab);
        replies.push({ addSheet: { properties: properties(tab) } });
      } else if (request.updateSheetProperties) {
        const props = request.updateSheetProperties.properties;
        const tab = next.find(t => t.numericSheetId === props.sheetId);
        if (!tab) return error(400, `No grid with id: ${props.sheetId}`);
        tab.gridProperties = props.gridProperties;
        replies.push({});
      } else if (request.updateCells) {
        const update = request.updateCells;
        const tab = next.find(t => t.numericSheetId === update.range?.sheetId);
        if (!tab) return error(400, `No grid with id: ${update.range?.sheetId}`);
        if (update.fields !== 'userEnteredValue') return error(400, 'Unexpected cell field mask');
        tab.values = (update.rows || []).map(row => (row.values || []).map(cell => {
          const value = cell.userEnteredValue || {};
          return value.stringValue ?? value.numberValue ?? value.boolValue ?? '';
        }));
        replies.push({});
      } else {
        return error(400, 'Unsupported batch operation');
      }
    }
    remote.tabs = next;
    return { status: 200, body: { replies } };
  };
  remote.creates = () => remote.calls.filter(call => call.body?.requests.some(request => request.addSheet));
  remote.saves = () => remote.calls.filter(call => call.body?.requests.some(request => request.updateCells));
  return remote;
}

async function useProductionSheets(remote) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const { status, body } = await remote.request(url, opts);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const sheets = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${test.info().testId}`);
  return { sheets, restore: () => { globalThis.fetch = originalFetch; } };
}

test('production saves reuse an existing tab and replace older chunks without a clear request', async () => {
  const remote = googleWorkbook([{ title: "Plan's state", numericSheetId: 0, values: [['old'], ['stale chunk']] }]);
  const { sheets, restore } = await useProductionSheets(remote);
  try {
    await sheets.getSpreadsheet('test-token', 'existing-plan');
    await sheets.writeTabData('test-token', 'existing-plan', "Plan's state", [['header'], ['first'], ['extra']]);
    await sheets.writeTabData('test-token', 'existing-plan', "Plan's state", [['header'], ['latest']]);
    expect(remote.creates()).toHaveLength(0);
    expect(remote.saves()).toHaveLength(2);
    expect(remote.calls).toHaveLength(3);
    expect(remote.tabs[0].values).toEqual([['header'], ['latest']]);
  } finally { restore(); }
});

test('concurrent first saves create a missing tab only once', async () => {
  const remote = googleWorkbook([{ title: 'Sheet1', numericSheetId: 0, values: [['original data']] }]);
  const { sheets, restore } = await useProductionSheets(remote);
  try {
    await Promise.all([
      sheets.writeTabData('test-token', 'new-plan', STATE_TAB, [['header'], ['first']]),
      sheets.writeTabData('test-token', 'new-plan', STATE_TAB, [['header'], ['latest']]),
    ]);
    expect(remote.creates()).toHaveLength(1);
    expect(remote.calls.filter(call => call.method === 'GET')).toHaveLength(1);
    expect(remote.tabs.find(tab => tab.title === STATE_TAB).values).toEqual([['header'], ['latest']]);
    expect(remote.tabs[0].values).toEqual([['original data']]);
  } finally { restore(); }
});

test('a collaborator creating the missing tab is confirmed before recovering from a duplicate error', async () => {
  const remote = googleWorkbook([{ title: 'Sheet1', numericSheetId: 0, values: [] }]);
  remote.beforeAdd = () => {
    remote.tabs.push({ title: STATE_TAB, numericSheetId: 12, values: [['peer state']] });
    remote.beforeAdd = null;
  };
  const { sheets, restore } = await useProductionSheets(remote);
  try {
    await sheets.writeTabData('test-token', 'racing-plan', STATE_TAB, [['saved state']]);
    expect(remote.creates()).toHaveLength(1);
    expect(remote.tabs).toHaveLength(2);
    expect(remote.tabs[1].numericSheetId).toBe(12);
    expect(remote.tabs[1].values).toEqual([['saved state']]);
  } finally { restore(); }
});

test('an unrelated creation error is surfaced with Google details and never clears existing data', async () => {
  const remote = googleWorkbook([{ title: 'Sheet1', numericSheetId: 0, values: [['keep me']] }]);
  remote.addError = { status: 400, message: 'Maximum number of cells exceeded.' };
  const { sheets, restore } = await useProductionSheets(remote);
  try {
    await expect(sheets.writeTabData('test-token', 'invalid-plan', STATE_TAB, [['new']]))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('Maximum number of cells exceeded') });
    expect(remote.saves()).toHaveLength(0);
    expect(remote.tabs[0].values).toEqual([['keep me']]);
  } finally { restore(); }
});

test('a failed save preserves the previous state and a later save succeeds without recreating the tab', async () => {
  const remote = googleWorkbook([{ title: STATE_TAB, numericSheetId: 9, values: [['last good state']] }]);
  remote.saveError = { status: 503, message: 'Temporarily unavailable' };
  const { sheets, restore } = await useProductionSheets(remote);
  try {
    await expect(sheets.writeTabData('test-token', 'failed-plan', STATE_TAB, [['new']]))
      .rejects.toMatchObject({ status: 503 });
    expect(remote.tabs[0].values).toEqual([['last good state']]);
    remote.saveError = null;
    await sheets.writeTabData('test-token', 'failed-plan', STATE_TAB, [['recovered']]);
    expect(remote.creates()).toHaveLength(0);
    expect(remote.tabs[0].values).toEqual([['recovered']]);
  } finally { restore(); }
});

test('a tab recreated by a collaborator is resolved again before retrying the save', async () => {
  const remote = googleWorkbook([{ title: STATE_TAB, numericSheetId: 9, values: [['old']] }]);
  const { sheets, restore } = await useProductionSheets(remote);
  try {
    await sheets.getSpreadsheet('test-token', 'recreated-plan');
    remote.tabs[0].numericSheetId = 19;
    await sheets.writeTabData('test-token', 'recreated-plan', STATE_TAB, [['new']]);
    expect(remote.creates()).toHaveLength(0);
    expect(remote.saves()).toHaveLength(2);
    expect(remote.tabs[0].values).toEqual([['new']]);
  } finally { restore(); }
});

test('metadata tab writes expand the grid and keep RAW numbers, booleans and formula-like text', async () => {
  const remote = googleWorkbook([{
    title: 'Profile', numericSheetId: 4, values: [['old']], gridProperties: { rowCount: 1, columnCount: 1 },
  }]);
  const { sheets, restore } = await useProductionSheets(remote);
  const rows = [['name', 'value'], ['=literal', 42], [true, false], [null, '']];
  try {
    await sheets.writeTabData('test-token', 'profile', 'Profile', rows);
    expect(remote.tabs[0].gridProperties).toEqual({ rowCount: 4, columnCount: 2 });
    expect(remote.tabs[0].values).toEqual([['name', 'value'], ['=literal', 42], [true, false], ['', '']]);
    expect(remote.saves()).toHaveLength(1);
    await sheets.writeTabData('test-token', 'profile', 'Profile', []);
    expect(remote.tabs[0].values).toEqual([]);
  } finally { restore(); }
});

async function connectPlanToRemote(page, remote) {
  await page.route('https://sheets.googleapis.com/v4/spreadsheets/**', async route => {
    const request = route.request();
    const response = await remote.request(request.url(), { method: request.method(), body: request.postData() });
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  await setupApp(page, { autoRefresh: false });
  await page.evaluate(async () => {
    const { api } = await import('/js/api-client.js');
    const sheets = await import('/js/sheets.js');
    const originalGet = api.sheets.getSpreadsheet;
    api.sheets.getSpreadsheet = id => id === 'sheet-075'
      ? sheets.getSpreadsheet('test-token', id) : originalGet(id);
    api.sheets.writeTab = (id, title, rows) => sheets.writeTabData('test-token', id, title, rows);
  });
  await navigateToSheet(page, 'sheet-075');
  await expect(page.locator('.floorplan-board')).toBeVisible();
}

test('floor plan coalesces edits during a slow save and loads the latest shared state in a fresh browser', async ({ page, browser }) => {
  const remote = googleWorkbook([{ title: 'Sheet1', numericSheetId: 0, values: planFixture.values }]);
  let releaseSave;
  const firstSave = new Promise(resolve => { releaseSave = resolve; });
  let holdFirstSave = true;
  remote.beforeSave = async () => {
    if (holdFirstSave) {
      holdFirstSave = false;
      await firstSave;
    }
  };
  await connectPlanToRemote(page, remote);
  const initialWalls = await page.locator('.floorplan-wall').count();
  try {
    for (let index = 0; index < 3; index += 1) {
      await page.locator('.floorplan-svg').click({ position: { x: 220 + index * 90, y: 180 + index * 60 } });
      await expect(page.locator('.floorplan-wall')).toHaveCount(initialWalls + index + 1);
      await expect.poll(() => page.evaluate(() => {
        const draft = JSON.parse(localStorage.getItem('waymark_floorplan_draft_sheet-075') || 'null');
        return draft?.items.filter(item => item.kind === 'wall').length;
      })).toBe(initialWalls + index + 1);
      if (index === 0) await expect.poll(() => remote.saves().length).toBe(1);
    }
  } finally { releaseSave(); }
  await expect(page.locator('.floorplan-feedback')).toHaveText('Saved to sheet', { timeout: 15_000 });
  expect(remote.creates()).toHaveLength(1);
  expect(remote.saves()).toHaveLength(2);
  const savedRows = remote.tabs.find(tab => tab.title === STATE_TAB).values;
  const saved = JSON.parse(savedRows.slice(1).map(row => row[0]).join(''));
  expect(saved.items.filter(item => item.kind === 'wall')).toHaveLength(initialWalls + 3);

  const collaborator = await browser.newPage();
  try {
    await connectPlanToRemote(collaborator, remote);
    expect(await collaborator.evaluate(() => localStorage.getItem('waymark_floorplan_draft_sheet-075'))).toBeNull();
    await expect(collaborator.locator('.floorplan-wall')).toHaveCount(initialWalls + 3);
    expect(remote.creates()).toHaveLength(1);
  } finally { await collaborator.close(); }
});
