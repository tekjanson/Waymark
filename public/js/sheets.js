/* ============================================================
   sheets.js — Google Sheets REST API wrapper (production mode)
   ============================================================ */

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- Error classification ---------- */

/**
 * Build a descriptive error from a failed Sheets API response.
 * Attaches a `status` property so callers can distinguish auth
 * failures (401/403) from not-found (404) and other errors.
 * @param {string} label  human context (e.g. 'Sheets read', 'Sheets create')
 * @param {Response} res  fetch Response object
 * @returns {Error}
 */
function sheetsError(label, res) {
  let msg = `${label} ${res.status}`;
  if (res.status === 401) msg = 'Session expired — please sign in again';
  else if (res.status === 403) msg = 'Permission denied — open this sheet via the Drive picker to grant access';
  else if (res.status === 404) msg = 'Sheet not found — it may have been deleted or moved';
  const err = new Error(msg);
  err.status = res.status;
  return err;
}

/* ---------- Global throttled request queue ---------- */

// Google Sheets API quota: 60 read requests/user/minute, 60 write/user/minute.
// We allow at most MAX_CONCURRENT in-flight requests and enforce a
// minimum gap of MIN_GAP_MS between request starts to stay well
// under the quota.  All reads AND writes go through this queue.
const MAX_CONCURRENT = 3;
const MIN_GAP_MS = 1000;

let _inFlight = 0;
let _lastRequestTime = 0;
const _queue = [];        // Array of { resolve }

/**
 * Acquire a slot from the global throttle.  Returns a promise that
 * resolves once the caller is allowed to fire a request.  Call
 * `releaseSlot()` when the response is received.
 */
function acquireSlot() {
  return new Promise(resolve => {
    _queue.push({ resolve });
    _drain();
  });
}

function releaseSlot() {
  _inFlight = Math.max(0, _inFlight - 1);
  _drain();
}

function _drain() {
  while (_queue.length > 0 && _inFlight < MAX_CONCURRENT) {
    const now = Date.now();
    const wait = Math.max(0, _lastRequestTime + MIN_GAP_MS - now);
    if (wait > 0) {
      setTimeout(() => _drain(), wait);
      return;   // will re-enter after the gap elapses
    }
    const next = _queue.shift();
    _inFlight++;
    _lastRequestTime = Date.now();
    next.resolve();
  }
}

/* ---------- Rate-limit retry helper ---------- */

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

/**
 * Fetch with automatic retry on 429 (rate-limit) responses.
 * Uses exponential backoff with jitter and the global throttle queue.
 * @param {string} url
 * @param {RequestInit} opts
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, opts) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await acquireSlot();
    let res;
    try {
      res = await fetch(url, opts);
    } finally {
      releaseSlot();
    }

    if (res.status !== 429) return res;

    if (attempt === MAX_RETRIES) return res; // give up, let caller handle

    // Respect Retry-After header if present, otherwise exponential backoff
    const retryAfter = res.headers.get('Retry-After');
    const delay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;

    console.warn(`[sheets] 429 on attempt ${attempt + 1}, retrying in ${Math.round(delay)}ms`);
    await new Promise(r => setTimeout(r, delay));
  }
}

/**
 * Get spreadsheet metadata + cell values for the first sheet.
 * @param {string} token
 * @param {string} spreadsheetId
 * @returns {Promise<Object>}  { properties, sheets, values }
 */
export async function getSpreadsheet(token, spreadsheetId) {
  // Single API call: fetch metadata + all cell data for the first sheet.
  // Uses includeGridData to avoid a separate values request (halves API usage).
  const res = await fetchWithRetry(
    `${BASE}/${spreadsheetId}?fields=properties.title,sheets.properties.title,sheets.data.rowData.values.userEnteredValue`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw sheetsError('Sheets read', res);
  const body = await res.json();

  const title = body.properties?.title || 'Untitled';
  const sheetTitle = body.sheets?.[0]?.properties?.title || 'Sheet1';

  // Convert gridData into simple 2D string array (same format as values endpoint)
  const rowData = body.sheets?.[0]?.data?.[0]?.rowData || [];
  const values = rowData.map(row =>
    (row.values || []).map(cell => {
      const v = cell?.userEnteredValue;
      if (!v) return '';
      return v.stringValue ?? v.numberValue?.toString() ?? v.boolValue?.toString() ?? '';
    })
  );

  return { id: spreadsheetId, title, sheetTitle, values };
}

/**
 * Get only the header row and first data row of a spreadsheet.
 * Uses a single API call with a limited range, much cheaper than getSpreadsheet.
 * Sufficient for template detection and directory-view metadata.
 * @param {string} token
 * @param {string} spreadsheetId
 * @returns {Promise<Object>}  { id, title, sheetTitle, values }
 */
export async function getSpreadsheetSummary(token, spreadsheetId) {
  // Fetch just the first two rows via includeGridData with a limited range
  const res = await fetchWithRetry(
    `${BASE}/${spreadsheetId}?ranges=Sheet1!1:2&fields=properties.title,sheets.properties.title,sheets.data.rowData.values.userEnteredValue`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw sheetsError('Sheets summary', res);
  const body = await res.json();

  const title = body.properties?.title || 'Untitled';
  const sheetTitle = body.sheets?.[0]?.properties?.title || 'Sheet1';

  // Extract values from the grid data format into a simple 2D array
  const rowData = body.sheets?.[0]?.data?.[0]?.rowData || [];
  const values = rowData.map(row =>
    (row.values || []).map(cell => {
      const v = cell?.userEnteredValue;
      if (!v) return '';
      return v.stringValue ?? v.numberValue?.toString() ?? v.boolValue?.toString() ?? '';
    })
  );

  return { id: spreadsheetId, title, sheetTitle, values };
}

/**
 * Create a new spreadsheet with initial data.
 * @param {string} token
 * @param {string} title      spreadsheet title
 * @param {string[][]} rows   2D array of cell values
 * @param {string} [parentId] optional parent folder ID
 * @returns {Promise<Object>}
 */
export async function createSpreadsheet(token, title, rows = [], parentId) {
  const body = {
    properties: { title },
    sheets: [{
      properties: { title: 'Sheet1' },
      data: rows.length ? [{
        startRow: 0,
        startColumn: 0,
        rowData: rows.map(row => ({
          values: row.map(cell => ({ userEnteredValue: { stringValue: String(cell) } }))
        })),
      }] : [],
    }],
  };

  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw sheetsError('Sheets create', res);
  const created = await res.json();

  // Move to parent folder if specified (requires drive.file scope)
  if (parentId) {
    const moveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}?addParents=${parentId}&fields=id`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!moveRes.ok) {
      console.warn(`[sheets] Failed to move sheet to folder (${moveRes.status}) — sheet created at Drive root`);
    }
  }

  return created;
}

/**
 * Append one or more rows to the end of a sheet.
 * Uses the Sheets API values:append endpoint.
 * @param {string}     token
 * @param {string}     spreadsheetId
 * @param {string}     sheetTitle     e.g. 'Sheet1'
 * @param {string[][]} rows           array of row arrays (each row is string[])
 * @returns {Promise<Object>}
 */
export async function appendRows(token, spreadsheetId, sheetTitle, rows) {
  const range = `${sheetTitle}!A1`;
  const res = await fetchWithRetry(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!res.ok) throw sheetsError('Sheets append', res);
  return res.json();
}

/**
 * Update a single cell value in a spreadsheet.
 * @param {string} token
 * @param {string} spreadsheetId
 * @param {string} sheetTitle   e.g. 'Sheet1'
 * @param {number} row          0-based row index (includes header row)
 * @param {number} col          0-based column index
 * @param {string} value        new cell value
 */
export async function updateCell(token, spreadsheetId, sheetTitle, row, col, value) {
  const colLetter = String.fromCharCode(65 + col);  // A-Z
  const range = `${sheetTitle}!${colLetter}${row + 1}`;
  const res = await fetchWithRetry(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [[value]] }),
    }
  );
  if (!res.ok) throw sheetsError('Sheets update', res);
  return res.json();
}

/**
 * Replace all sheet data: clears the sheet then writes new rows.
 * Used by re-sync to overwrite a sheet with fresh content.
 * @param {string}     token
 * @param {string}     spreadsheetId
 * @param {string}     sheetTitle   e.g. 'Sheet1'
 * @param {string[][]} rows         2D array including header row
 */
export async function replaceSheetData(token, spreadsheetId, sheetTitle, rows) {
  // Clear existing data
  await fetch(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  // Write new data starting at A1
  const range = `${sheetTitle}!A1`;
  const res = await fetch(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!res.ok) throw sheetsError('Sheets replace', res);
  return res.json();
}
