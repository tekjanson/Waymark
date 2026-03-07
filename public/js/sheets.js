/* ============================================================
   sheets.js — Google Sheets REST API wrapper (production mode)
   ============================================================ */

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- Rate-limit retry helper ---------- */

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;

/**
 * Fetch with automatic retry on 429 (rate-limit) responses.
 * Uses exponential backoff with jitter.
 * @param {string} url
 * @param {RequestInit} opts
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, opts) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429) return res;

    if (attempt === MAX_RETRIES) return res; // give up, let caller handle

    // Respect Retry-After header if present, otherwise exponential backoff
    const retryAfter = res.headers.get('Retry-After');
    const delay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;

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
  // Fetch metadata (with 429 retry)
  const metaRes = await fetchWithRetry(`${BASE}/${spreadsheetId}?fields=properties,sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Sheets API ${metaRes.status}`);
  const meta = await metaRes.json();

  // Fetch values from the first sheet (with 429 retry)
  const sheetTitle = meta.sheets?.[0]?.properties?.title || 'Sheet1';
  const valRes = await fetchWithRetry(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  let values = [];
  if (valRes.ok) {
    const data = await valRes.json();
    values = data.values || [];
  }

  return {
    id: spreadsheetId,
    title: meta.properties?.title || 'Untitled',
    sheetTitle,
    values,
  };
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
  if (!res.ok) throw new Error(`Sheets API ${res.status}`);
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
  if (!res.ok) throw new Error(`Sheets create ${res.status}`);
  const created = await res.json();

  // Move to parent folder if specified (requires drive.file scope)
  if (parentId) {
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}?addParents=${parentId}&fields=id`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
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
  const res = await fetch(
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
  if (!res.ok) throw new Error(`Sheets append ${res.status}`);
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
  const res = await fetch(
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
  if (!res.ok) throw new Error(`Sheets update ${res.status}`);
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
  if (!res.ok) throw new Error(`Sheets replace ${res.status}`);
  return res.json();
}
