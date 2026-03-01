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
let driveApi, sheetsApi;
if (!isLocal) {
  [driveApi, sheetsApi] = await Promise.all([
    import('./drive.js'),
    import('./sheets.js'),
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
    'sheet-026': 'roster-team',
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

    async createSpreadsheet(title, rows, parentId) {
      if (isLocal) {
        const record = {
          spreadsheetId: `created-sheet-${Date.now()}`,
          title,
          rows,
          parentId,
          createdAt: new Date().toISOString(),
        };
        window.__WAYMARK_RECORDS.push(record);
        return record;
      }
      const token = await clientAuth.getToken();
      return sheetsApi.createSpreadsheet(token, title, rows, parentId);
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
  },
};
