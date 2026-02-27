/* ============================================================
   api-client.js — THE critical abstraction layer
   
   In production mode → delegates to drive.js, sheets.js,
   gemini.js, auth.js (which call real Google APIs).
   
   In local/mock mode → fetches fixture data from the
   server's /__fixtures/ endpoint and uses canned responses.
   Created records are stored in window.__WAYMARK_RECORDS
   for test assertions via page.evaluate().
   ============================================================ */

import * as clientAuth from './auth.js';

const isLocal = window.__WAYMARK_LOCAL === true;

/* ---------- Dynamic imports for production ---------- */
let driveApi, sheetsApi, geminiApi;
if (!isLocal) {
  [driveApi, sheetsApi, geminiApi] = await Promise.all([
    import('./drive.js'),
    import('./sheets.js'),
    import('./gemini.js'),
  ]);
}

/* ---------- Mock state ---------- */
let mockFixtures = null;

async function loadFixtures() {
  if (mockFixtures) return mockFixtures;
  const [folders, users] = await Promise.all([
    fetch('/__fixtures/folders.json').then(r => r.json()),
    fetch('/__fixtures/users.json').then(r => r.json()),
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
    const data = await fetch(`/__fixtures/sheets/${filename}.json`).then(r => r.json());
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

/* ---------- Canned Gemini responses for local mode ---------- */
const CANNED_AI = {
  grocery:  { matches: [{ sheetId: 'sheet-001', sheetName: 'Grocery List',  reason: 'Sheet name matches grocery query' }], summary: 'Found your grocery list.' },
  chore:    { matches: [{ sheetId: 'sheet-003', sheetName: 'Weekly Chores', reason: 'Sheet name matches chores query' }], summary: 'Found the weekly chores list.' },
  home:     { matches: [{ sheetId: 'sheet-002', sheetName: 'Home Repairs',  reason: 'Sheet name matches home query' }],   summary: 'Found the home repairs list.' },
  repair:   { matches: [{ sheetId: 'sheet-002', sheetName: 'Home Repairs',  reason: 'Sheet name matches repair query' }], summary: 'Found the home repairs list.' },
  task:     { matches: [{ sheetId: 'sheet-002', sheetName: 'Home Repairs',  reason: 'General task match' }],              summary: 'Here are task-related sheets.' },
  shop:     { matches: [{ sheetId: 'sheet-001', sheetName: 'Grocery List',  reason: 'Shopping relates to groceries' }],   summary: 'Found shopping-related lists.' },
};

function mockGeminiQuery(userQuery) {
  // simulate error if injected
  if (window.__WAYMARK_MOCK_ERROR === 'gemini') throw new Error('Mock Gemini error');

  const q = userQuery.toLowerCase();
  for (const [keyword, response] of Object.entries(CANNED_AI)) {
    if (q.includes(keyword)) return { ...response };
  }
  return { matches: [], summary: 'No matching sheets found.' };
}

/* ---------- Unified API ---------- */

export const api = {

  /* ---- Auth ---- */
  auth: {
    login() {
      if (isLocal) {
        // Set mock state and reload
        window.location.href = '/auth/login';
        return;
      }
      clientAuth.login();
    },

    async init() {
      if (isLocal) {
        // call server mock auth
        const res = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!res.ok) return null;
        await loadFixtures();
        return mockFixtures.users[0];
      }
      return clientAuth.init();
    },

    async logout() {
      if (isLocal) {
        await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
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

  /* ---- Gemini AI ---- */
  gemini: {
    async query(userQuery, context) {
      if (isLocal) {
        return mockGeminiQuery(userQuery);
      }
      const token = await clientAuth.getToken();
      return geminiApi.query(token, userQuery, context);
    },

    async isAvailable() {
      if (isLocal) return true;
      const token = await clientAuth.getToken();
      return geminiApi.isAvailable(token);
    },
  },
};
