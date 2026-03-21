/* ============================================================
   api-client.js — THE critical abstraction layer
   
   In production mode → delegates to drive.js, sheets.js,
   auth.js (which call real Google APIs).
   
   In local/mock mode → fetches fixture data from the
   server's /__fixtures/ endpoint and uses canned responses.
   Created records are stored in window.__WAYMARK_RECORDS
   for test assertions via page.evaluate().
   ============================================================ */

import * as clientAuth from './auth.js';

const isLocal = window.__WAYMARK_LOCAL === true;
const BASE = window.__WAYMARK_BASE || '';

/* ---------- Dynamic imports for production ---------- */
let driveApi, sheetsApi, pickerApi;
if (!isLocal) {
  [driveApi, sheetsApi, pickerApi] = await Promise.all([
    import('./drive.js'),
    import('./sheets.js'),
    import('./picker.js'),
  ]);
}

/* ---------- Mock state ---------- */
let mockFixtures = null;

async function loadFixtures() {
  if (mockFixtures) return mockFixtures;
  const [folders, users] = await Promise.all([
    fetch(BASE + '/__fixtures/folders.json').then(r => r.json()),
    fetch(BASE + '/__fixtures/users.json').then(r => r.json()),
  ]);
  mockFixtures = { folders, users, sheets: {} };
  return mockFixtures;
}

async function loadMockSheet(sheetId) {
  const fix = await loadFixtures();
  if (fix.sheets[sheetId]) return fix.sheets[sheetId];

  // Try to load a fixture file for this sheet
  const mapping = {
    'sheet-001': 'groceries',
    'sheet-002': 'home-projects',
    'sheet-003': 'shared-chores',
    'sheet-004': 'groceries-categorized',
    'sheet-010': 'tracker-fitness',
    'sheet-011': 'schedule-weekly',
    'sheet-012': 'inventory-pantry',
    'sheet-013': 'contacts-emergency',
    'sheet-014': 'log-workout',
    'sheet-015': 'testcases-login',
    'sheet-016': 'budget-personal',
    'sheet-017': 'kanban-project',
    'sheet-018': 'habit-morning',
    'sheet-019': 'grading-math',
    'sheet-020': 'timesheet-weekly',
    'sheet-021': 'poll-team',
    'sheet-022': 'changelog-app',
    'sheet-023': 'crm-sales',
    'sheet-024': 'meal-weekly',
    'sheet-025': 'travel-europe',
    'sheet-034': 'meal-next-week',
    'sheet-026': 'roster-team',
    'sheet-027': 'recipe-spaghetti-bolognese',
    'sheet-028': 'kanban-waymark',
    'sheet-029': 'flow-login',
    'sheet-030': 'social-wall',
    'sheet-031': 'flow-large',
    'sheet-032': 'recipe-legacy',
    'sheet-033': 'budget-april',
    'sheet-035': 'grading-science',
    'sheet-036': 'automation-workflow',
    'sheet-037': 'testcases-api',
    'sheet-038': 'habit-multiweek',
    'sheet-039': 'kanban-many-projects',
    'sheet-040': 'habit-nonmonday',
    'sheet-043': 'kanban-ai-status',
    'sheet-044': 'knowledge-devops',
    'sheet-045': 'knowledge-waymark',
    'sheet-046': 'notification-waymark',
    'sheet-049': 'guide-composting',
    'sheet-047': 'iot-sensor-dashboard',
    'sheet-048': 'iot-sensor-log',
    'sheet-050': 'checklist-ai-demo',
    'sheet-iot-blank': 'iot-blank',
  };
  const filename = mapping[sheetId];
  if (!filename) return null;

  try {
    const data = await fetch(BASE + `/__fixtures/sheets/${filename}.json`).then(r => r.json());
    fix.sheets[sheetId] = data;
    return data;
  } catch {
    return null;
  }
}

/* Init records store for test assertions */
if (isLocal) {
  window.__WAYMARK_RECORDS = window.__WAYMARK_RECORDS || [];
}

/* ---------- Unified API ---------- */

export const api = {

  /* ---- Auth ---- */
  auth: {
    login() {
      if (isLocal) {
        // Set mock state and reload
        window.location.href = BASE + '/auth/login';
        return;
      }
      clientAuth.login();
    },

    async init() {
      if (isLocal) {
        // call server mock auth
        const res = await fetch(BASE + '/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!res.ok) return null;
        await loadFixtures();
        return mockFixtures.users[0];
      }
      return clientAuth.init();
    },

    async logout() {
      if (isLocal) {
        await fetch(BASE + '/auth/logout', { method: 'POST', credentials: 'include' });
        window.location.reload();
        return;
      }
      await clientAuth.logout();
    },

    getUser() {
      if (isLocal) return mockFixtures?.users?.[0] || null;
      return clientAuth.getUser();
    },

    isLoggedIn() {
      if (isLocal) return !!mockFixtures;
      return clientAuth.isLoggedIn();
    },

    async getToken() {
      if (isLocal) return 'mock-access-token';
      return clientAuth.getToken();
    },
  },

  /* ---- Drive ---- */
  drive: {
    async listRootFolders() {
      if (isLocal) {
        if (window.__WAYMARK_MOCK_ERROR === 'drive') throw new Error('Mock Drive error');
        const fix = await loadFixtures();
        return { files: fix.folders.myDrive };
      }
      const token = await clientAuth.getToken();
      return driveApi.listRootFolders(token);
    },

    async listChildren(folderId) {
      if (isLocal) {
        if (window.__WAYMARK_MOCK_ERROR === 'drive') throw new Error('Mock Drive error');
        const fix = await loadFixtures();
        // Search all folders for matching ID and return its children
        const find = (folders) => {
          for (const f of folders) {
            if (f.id === folderId) return f.children || [];
            if (f.children) {
              const found = find(f.children.filter(c => c.mimeType === 'application/vnd.google-apps.folder'));
              if (found) return found;
            }
          }
          return null;
        };
        const children = find([...fix.folders.myDrive, ...fix.folders.sharedWithMe]) || [];
        return { files: children };
      }
      const token = await clientAuth.getToken();
      return driveApi.listChildren(token, folderId);
    },

    async getSharedWithMe() {
      if (isLocal) {
        if (window.__WAYMARK_MOCK_ERROR === 'drive') throw new Error('Mock Drive error');
        const fix = await loadFixtures();
        return { files: fix.folders.sharedWithMe };
      }
      const token = await clientAuth.getToken();
      return driveApi.getSharedWithMe(token);
    },

    async createFile(name, mimeType, parents) {
      if (isLocal) {
        const record = {
          id: `created-${Date.now()}`,
          name,
          mimeType,
          parents,
          createdAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        return record;
      }
      const token = await clientAuth.getToken();
      return driveApi.createFile(token, name, mimeType, parents);
    },

    async findFolder(name, parentId) {
      if (isLocal) {
        const fix = await loadFixtures();
        const search = (folders) => {
          for (const f of folders) {
            if (f.name === name && f.mimeType === 'application/vnd.google-apps.folder') return f;
            if (f.children) {
              const found = search(f.children);
              if (found) return found;
            }
          }
          return null;
        };
        return search(fix.folders.myDrive) || null;
      }
      const token = await clientAuth.getToken();
      return driveApi.findFolder(token, name, parentId);
    },

    async listSpreadsheets(query) {
      if (isLocal) {
        const fix = await loadFixtures();
        // Return all sheets from mock data
        const sheets = [];
        const collect = (items) => {
          for (const item of items) {
            if (item.mimeType === 'application/vnd.google-apps.spreadsheet') sheets.push(item);
            if (item.children) collect(item.children);
          }
        };
        collect([...fix.folders.myDrive, ...fix.folders.sharedWithMe]);
        return { files: sheets };
      }
      const token = await clientAuth.getToken();
      return driveApi.listSpreadsheets(token, query);
    },

    async listImportableFiles() {
      if (isLocal) {
        const fix = await loadFixtures();
        // Return all sheets and docs from mock data
        const files = [];
        const collect = (items) => {
          for (const item of items) {
            if (item.mimeType === 'application/vnd.google-apps.spreadsheet' ||
                item.mimeType === 'application/vnd.google-apps.document') {
              files.push(item);
            }
            if (item.children) collect(item.children);
          }
        };
        collect([...fix.folders.myDrive, ...fix.folders.sharedWithMe]);
        return { files };
      }
      const token = await clientAuth.getToken();
      return driveApi.listImportableFiles(token);
    },

    /**
     * Get all sheets (for search context).
     * In local mode walks the fixture folder tree.
     * In production queries Drive for all spreadsheets.
     * @returns {Promise<{id:string, name:string, folder:string}[]>}
     */
    async getAllSheets() {
      if (isLocal) {
        const fix = await loadFixtures();
        const sheets = [];
        const collect = (items, folder) => {
          for (const item of items) {
            if (item.mimeType === 'application/vnd.google-apps.spreadsheet') {
              sheets.push({ id: item.id, name: item.name, folder: folder || '' });
            }
            if (item.children) collect(item.children, item.name);
          }
        };
        collect([...fix.folders.myDrive, ...(fix.folders.sharedWithMe || [])], '');
        return sheets;
      }
      const token = await clientAuth.getToken();
      const res = await driveApi.listSpreadsheets(token);
      return (res.files || []).map(f => ({ id: f.id, name: f.name, folder: '' }));
    },

    async exportDoc(fileId) {
      if (isLocal) {
        // In mock mode return a simple table-like text
        return 'Item\tStatus\tNotes\nTask 1\tDone\tSample note\nTask 2\tPending\tAnother note\n';
      }
      const token = await clientAuth.getToken();
      return driveApi.exportDoc(token, fileId);
    },

    async getFile(fileId) {
      if (isLocal) {
        return { id: fileId, name: 'Mock File', mimeType: 'application/vnd.google-apps.spreadsheet' };
      }
      const token = await clientAuth.getToken();
      return driveApi.getFile(token, fileId);
    },

    async findFile(name, parentId) {
      if (isLocal) {
        const fix = await loadFixtures();
        const search = (folders) => {
          for (const f of folders) {
            if (f.name === name) return f;
            if (f.children) {
              const found = search(f.children);
              if (found) return found;
            }
          }
          return null;
        };
        return search(fix.folders.myDrive) || null;
      }
      const token = await clientAuth.getToken();
      return driveApi.findFile(token, name, parentId);
    },

    async createJsonFile(name, content, parents) {
      if (isLocal) {
        const record = {
          id: `json-${Date.now()}`,
          name,
          mimeType: 'application/json',
          content,
          parents,
          createdAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        // Store in a local map for subsequent reads
        if (!window.__WAYMARK_JSON_FILES) window.__WAYMARK_JSON_FILES = {};
        window.__WAYMARK_JSON_FILES[record.id] = content;
        return record;
      }
      const token = await clientAuth.getToken();
      return driveApi.createJsonFile(token, name, content, parents);
    },

    async readJsonFile(fileId) {
      if (isLocal) {
        if (window.__WAYMARK_JSON_FILES?.[fileId]) {
          return window.__WAYMARK_JSON_FILES[fileId];
        }
        return {};
      }
      const token = await clientAuth.getToken();
      return driveApi.readJsonFile(token, fileId);
    },

    async updateJsonFile(fileId, content) {
      if (isLocal) {
        if (!window.__WAYMARK_JSON_FILES) window.__WAYMARK_JSON_FILES = {};
        window.__WAYMARK_JSON_FILES[fileId] = content;
        const record = {
          type: 'json-update',
          fileId,
          content,
          updatedAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        return { id: fileId, name: 'updated', mimeType: 'application/json' };
      }
      const token = await clientAuth.getToken();
      return driveApi.updateJsonFile(token, fileId, content);
    },

    /**
     * Read plain text content from a Drive file.
     * @param {string} fileId
     * @returns {Promise<string>}
     */
    async readTextFile(fileId) {
      if (isLocal) {
        // In mock mode, check for stored text files
        if (window.__WAYMARK_TEXT_FILES?.[fileId]) {
          return window.__WAYMARK_TEXT_FILES[fileId];
        }
        return '';
      }
      const token = await clientAuth.getToken();
      return driveApi.readTextFile(token, fileId);
    },

    /**
     * Find a file by name inside a specific folder.
     * Looks for any MIME type. Returns null if not found.
     * @param {string} name       file name to find
     * @param {string} parentId   parent folder ID
     * @returns {Promise<Object|null>}
     */
    async findFileInFolder(name, parentId) {
      if (isLocal) {
        const fix = await loadFixtures();

        // 'root' means the top level of myDrive
        if (parentId === 'root') {
          return fix.folders.myDrive.find(c => c.name === name) || null;
        }

        const search = (items) => {
          for (const item of items) {
            if (item.id === parentId && item.children) {
              return item.children.find(c => c.name === name) || null;
            }
            if (item.children) {
              const found = search(item.children);
              if (found) return found;
            }
          }
          return null;
        };
        return search([...fix.folders.myDrive, ...fix.folders.sharedWithMe]);
      }
      const token = await clientAuth.getToken();
      return driveApi.findFile(token, name, parentId);
    },

    /**
     * Create a plain text file in Drive.
     * @param {string} name       file name
     * @param {string} content    plain text content
     * @param {string[]} parents  parent folder IDs
     * @returns {Promise<Object>}  created file metadata
     */
    async createTextFile(name, content, parents) {
      if (isLocal) {
        const record = {
          id: `text-${Date.now()}`,
          name,
          mimeType: 'text/plain',
          content,
          parents,
          createdAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        if (!window.__WAYMARK_TEXT_FILES) window.__WAYMARK_TEXT_FILES = {};
        window.__WAYMARK_TEXT_FILES[record.id] = content;

        // Inject into fixture tree so findFileInFolder/listChildren find it
        if (parents && parents.length > 0) {
          const fix = await loadFixtures();

          if (parents[0] === 'root') {
            // Root-level file — add to top of myDrive
            fix.folders.myDrive.push({ id: record.id, name, mimeType: 'text/plain' });
          } else {
            const inject = (items) => {
              for (const item of items) {
                if (item.id === parents[0]) {
                  if (!item.children) item.children = [];
                  item.children.push({ id: record.id, name, mimeType: 'text/plain' });
                  return true;
                }
                if (item.children) {
                  if (inject(item.children)) return true;
                }
              }
              return false;
            };
            inject([...fix.folders.myDrive, ...fix.folders.sharedWithMe]);
          }
        }

        return record;
      }
      const token = await clientAuth.getToken();
      return driveApi.createTextFile(token, name, content, parents);
    },

    /**
     * Update plain text content of an existing Drive file.
     * @param {string} fileId
     * @param {string} content  plain text content
     * @returns {Promise<Object>}  updated file metadata
     */
    async updateTextFile(fileId, content) {
      if (isLocal) {
        if (!window.__WAYMARK_TEXT_FILES) window.__WAYMARK_TEXT_FILES = {};
        window.__WAYMARK_TEXT_FILES[fileId] = content;
        const record = {
          type: 'text-update',
          fileId,
          content,
          updatedAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        return { id: fileId, name: 'updated', mimeType: 'text/plain' };
      }
      const token = await clientAuth.getToken();
      return driveApi.updateTextFile(token, fileId, content);
    },
  },

  /* ---- Picker ---- */
  picker: {
    /**
     * Open Google Picker to select spreadsheets.
     * In local mode, returns a mock selection from fixtures.
     * @param {Object} [opts]  { multiSelect, includeDocs, includeSharedDrives }
     * @returns {Promise<Object[]|null>}
     */
    async pickSpreadsheets(opts = {}) {
      if (isLocal) {
        const fix = await loadFixtures();
        const sheets = [];
        const collect = (items) => {
          for (const item of items) {
            if (item.mimeType === 'application/vnd.google-apps.spreadsheet') sheets.push(item);
            if (item.children) collect(item.children);
          }
        };
        collect([...fix.folders.myDrive, ...fix.folders.sharedWithMe]);
        // Simulate picking the first sheet
        return sheets.length ? [{ id: sheets[0].id, name: sheets[0].name, mimeType: sheets[0].mimeType }] : null;
      }
      const token = await clientAuth.getToken();
      return pickerApi.pickSpreadsheets(token, opts);
    },

    /**
     * Open Google Picker to select a folder.
     * @returns {Promise<Object|null>}  { id, name } or null
     */
    async pickFolder() {
      if (isLocal) {
        const fix = await loadFixtures();
        const first = fix.folders.myDrive.find(f => f.mimeType === 'application/vnd.google-apps.folder');
        return first ? { id: first.id, name: first.name } : null;
      }
      const token = await clientAuth.getToken();
      return pickerApi.pickFolder(token);
    },

    /**
     * Open Google Picker for import (spreadsheets + docs).
     * @returns {Promise<Object[]|null>}
     */
    async pickFilesForImport() {
      if (isLocal) {
        const fix = await loadFixtures();
        const files = [];
        const collect = (items) => {
          for (const item of items) {
            if (item.mimeType === 'application/vnd.google-apps.spreadsheet' ||
                item.mimeType === 'application/vnd.google-apps.document') {
              files.push(item);
            }
            if (item.children) collect(item.children);
          }
        };
        collect([...fix.folders.myDrive, ...fix.folders.sharedWithMe]);
        return files.length ? [{ id: files[0].id, name: files[0].name, mimeType: files[0].mimeType }] : null;
      }
      const token = await clientAuth.getToken();
      return pickerApi.pickFilesForImport(token);
    },
  },

  /* ---- Sheets ---- */
  sheets: {
    async getSpreadsheet(spreadsheetId) {
      if (isLocal) {
        if (window.__WAYMARK_MOCK_ERROR === 'sheets') throw new Error('Mock Sheets error');
        const data = await loadMockSheet(spreadsheetId);
        if (!data) throw new Error(`No fixture for sheet ${spreadsheetId}`);
        return data;
      }
      const token = await clientAuth.getToken();
      return sheetsApi.getSpreadsheet(token, spreadsheetId);
    },

    /**
     * Get only the header + first data row (for template detection and directory views).
     * Much cheaper than getSpreadsheet — single API call, minimal data.
     * @param {string} spreadsheetId
     * @returns {Promise<Object>}  { id, title, sheetTitle, values }
     */
    async getSpreadsheetSummary(spreadsheetId) {
      if (isLocal) {
        if (window.__WAYMARK_MOCK_ERROR === 'sheets') throw new Error('Mock Sheets error');
        const data = await loadMockSheet(spreadsheetId);
        if (!data) throw new Error(`No fixture for sheet ${spreadsheetId}`);
        // Return only first two rows to mirror production behavior
        return { ...data, values: (data.values || []).slice(0, 2) };
      }
      const token = await clientAuth.getToken();
      return sheetsApi.getSpreadsheetSummary(token, spreadsheetId);
    },

    async createSpreadsheet(title, rows, parentId) {
      if (isLocal) {
        const sheetId = `created-sheet-${Date.now()}`;
        const record = {
          spreadsheetId: sheetId,
          title,
          rows,
          parentId,
          createdAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);

        // Register in fixture cache so getSpreadsheet can find it
        const fix = await loadFixtures();
        fix.sheets[sheetId] = {
          id: sheetId,
          title,
          sheetTitle: 'Sheet1',
          values: rows,
        };

        return record;
      }
      const token = await clientAuth.getToken();
      return sheetsApi.createSpreadsheet(token, title, rows, parentId);
    },

    /**
     * Append one or more rows to the end of a sheet.
     * @param {string}     spreadsheetId
     * @param {string}     sheetTitle     e.g. 'Sheet1'
     * @param {string[][]} rows           array of row arrays
     * @returns {Promise<Object>}
     */
    async appendRows(spreadsheetId, sheetTitle, rows) {
      if (isLocal) {
        if (window.__WAYMARK_MOCK_ERROR === 'sheets') throw new Error('Mock Sheets error');
        const fix = await loadFixtures();
        const data = fix.sheets[spreadsheetId];
        if (data && data.values) {
          for (const row of rows) data.values.push(row);
        }
        const record = {
          type: 'row-append',
          spreadsheetId, sheetTitle, rows,
          createdAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        return record;
      }
      const token = await clientAuth.getToken();
      return sheetsApi.appendRows(token, spreadsheetId, sheetTitle, rows);
    },

    /**
     * Update a single cell in a spreadsheet.
     * @param {string} spreadsheetId
     * @param {string} sheetTitle   e.g. 'Sheet1'
     * @param {number} row          0-based row index (includes header)
     * @param {number} col          0-based column index
     * @param {string} value        new cell value
     */
    async updateCell(spreadsheetId, sheetTitle, row, col, value) {
      if (isLocal) {
        // In mock mode, update the cached fixture data
        const fix = await loadFixtures();
        const data = fix.sheets[spreadsheetId];
        if (data && data.values && data.values[row]) {
          data.values[row][col] = value;
        }
        const record = {
          type: 'cell-update',
          spreadsheetId, sheetTitle, row, col, value,
          createdAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        return record;
      }
      const token = await clientAuth.getToken();
      return sheetsApi.updateCell(token, spreadsheetId, sheetTitle, row, col, value);
    },

    /**
     * Replace all data in a sheet (clear + write).
     * Used for recipe re-sync from source URL.
     * @param {string}     spreadsheetId
     * @param {string}     sheetTitle  e.g. 'Sheet1'
     * @param {string[][]} rows        2D array including header row
     */
    async replaceSheetData(spreadsheetId, sheetTitle, rows) {
      if (isLocal) {
        if (window.__WAYMARK_MOCK_ERROR === 'sheets') throw new Error('Mock Sheets error');
        const fix = await loadFixtures();
        // Replace the cached fixture data entirely
        if (fix.sheets[spreadsheetId]) {
          fix.sheets[spreadsheetId].values = rows;
        }
        const record = {
          type: 'sheet-replace',
          spreadsheetId, sheetTitle, rows,
          createdAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        return record;
      }
      const token = await clientAuth.getToken();
      return sheetsApi.replaceSheetData(token, spreadsheetId, sheetTitle, rows);
    },
  },
};
