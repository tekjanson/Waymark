/* ============================================================
   sheets.js — Google Sheets REST API wrapper (production mode)
   ============================================================ */

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Get spreadsheet metadata + cell values for the first sheet.
 * @param {string} token
 * @param {string} spreadsheetId
 * @returns {Promise<Object>}  { properties, sheets, values }
 */
export async function getSpreadsheet(token, spreadsheetId) {
  // Fetch metadata
  const metaRes = await fetch(`${BASE}/${spreadsheetId}?fields=properties,sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Sheets API ${metaRes.status}`);
  const meta = await metaRes.json();

  // Fetch values from the first sheet
  const sheetTitle = meta.sheets?.[0]?.properties?.title || 'Sheet1';
  const valRes = await fetch(
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
    const moveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}?addParents=${parentId}&removeParents=root&fields=id,parents`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!moveRes.ok) {
      throw new Error(`Failed to move sheet to folder (${moveRes.status})`);
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
