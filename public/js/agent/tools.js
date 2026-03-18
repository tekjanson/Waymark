/* ============================================================
   tools.js — Agent tool execution helpers
   Google Sheets tool implementations and lightweight execution UI.
   ============================================================ */

import { el } from '../ui.js';
import { api } from '../api-client.js';
import { KNOWN_HEADERS } from './config.js';

/* ---------- Tool Execution ---------- */

/**
 * Execute a registered tool function.
 * @param {string} name
 * @param {Object} args
 * @returns {Promise<Object>}
 */
export async function executeTool(name, args) {
  if (name === 'create_sheet') {
    return toolCreateSheet(args);
  }
  if (name === 'read_sheet') {
    return toolReadSheet(args);
  }
  if (name === 'search_sheets') {
    return toolSearchSheets(args);
  }
  if (name === 'update_sheet') {
    return toolUpdateSheet(args);
  }
  throw new Error(`Unknown tool: ${name}`);
}

/**
 * Tool: create_sheet — creates a new Google Sheet.
 * @param {{ template: string, title: string, data: string[][] }} args
 * @returns {Promise<Object>}
 */
export async function toolCreateSheet({ template, title, data }) {
  if (!title || !data || !data.length) {
    throw new Error('Missing title or data');
  }

  const headers = KNOWN_HEADERS[template];
  if (!headers) {
    throw new Error(`Unknown template "${template}". Use one of: ${Object.keys(KNOWN_HEADERS).join(', ')}`);
  }

  const headerCount = headers.length;
  const cleanData = data.map(row => {
    const clean = (Array.isArray(row) ? row : []).map(cell => String(cell ?? ''));
    while (clean.length < headerCount) clean.push('');
    return clean.slice(0, headerCount);
  });

  const allRows = [headers, ...cleanData];
  const result = await api.sheets.createSpreadsheet(title, allRows);

  return {
    spreadsheetId: result.spreadsheetId,
    title,
    template,
    rowCount: cleanData.length,
    columns: headers,
  };
}

/**
 * Tool: read_sheet — reads contents of an existing Google Sheet.
 * @param {{ spreadsheet_id: string }} args
 * @returns {Promise<Object>}
 */
export async function toolReadSheet({ spreadsheet_id }) {
  if (!spreadsheet_id) {
    throw new Error('Missing spreadsheet_id');
  }

  const sheet = await api.sheets.getSpreadsheet(spreadsheet_id);
  const headers = sheet.values?.[0] || [];
  const dataRows = (sheet.values || []).slice(1);
  const MAX_ROWS = 100;
  const truncated = dataRows.length > MAX_ROWS;
  const rows = truncated ? dataRows.slice(0, MAX_ROWS) : dataRows;

  return {
    spreadsheetId: spreadsheet_id,
    title: sheet.title,
    sheetTitle: sheet.sheetTitle,
    headers,
    rows,
    totalRows: dataRows.length,
    truncated,
  };
}

/**
 * Tool: search_sheets — search user's Drive for spreadsheets by name.
 * @param {{ query: string }} args
 * @returns {Promise<Object>}
 */
export async function toolSearchSheets({ query }) {
  if (!query) {
    throw new Error('Missing search query');
  }

  const allSheets = await api.drive.getAllSheets();
  const lowerQuery = query.toLowerCase();
  const matches = allSheets.filter(sheet => sheet.name.toLowerCase().includes(lowerQuery));

  return {
    query,
    results: matches.slice(0, 20).map(sheet => ({
      id: sheet.id,
      name: sheet.name,
      folder: sheet.folder || '',
    })),
    totalMatches: matches.length,
  };
}

/**
 * Tool: update_sheet — modifies an existing Google Sheet.
 * @param {{ spreadsheet_id: string, operation: string, rows?: string[][], updates?: Array }} args
 * @returns {Promise<Object>}
 */
export async function toolUpdateSheet({ spreadsheet_id, operation, rows, updates }) {
  if (!spreadsheet_id) {
    throw new Error('Missing spreadsheet_id');
  }
  if (!operation) {
    throw new Error('Missing operation — use "append_rows" or "update_cells"');
  }

  const sheet = await api.sheets.getSpreadsheet(spreadsheet_id);
  const sheetTitle = sheet.sheetTitle || 'Sheet1';
  const headers = sheet.values?.[0] || [];

  if (operation === 'append_rows') {
    if (!rows || !rows.length) {
      throw new Error('append_rows requires a non-empty "rows" array');
    }

    const cleanRows = rows.map(row => {
      const clean = (Array.isArray(row) ? row : []).map(cell => String(cell ?? ''));
      while (clean.length < headers.length) clean.push('');
      return clean.slice(0, headers.length);
    });

    await api.sheets.appendRows(spreadsheet_id, sheetTitle, cleanRows);

    return {
      spreadsheetId: spreadsheet_id,
      title: sheet.title,
      operation: 'append_rows',
      rowsAdded: cleanRows.length,
    };
  }

  if (operation === 'update_cells') {
    if (!updates || !updates.length) {
      throw new Error('update_cells requires a non-empty "updates" array');
    }

    let cellsUpdated = 0;
    for (const update of updates) {
      const dataRow = Number(update.row);
      if (!Number.isFinite(dataRow) || dataRow < 1) {
        throw new Error(`Invalid row number: ${update.row} — must be 1-based data row`);
      }

      let colIdx;
      const colNum = Number(update.column);
      if (Number.isFinite(colNum)) {
        colIdx = colNum;
      } else {
        colIdx = headers.findIndex(header =>
          header.toLowerCase() === String(update.column).toLowerCase()
        );
        if (colIdx === -1) {
          throw new Error(`Unknown column "${update.column}". Available: ${headers.join(', ')}`);
        }
      }

      const sheetRow = dataRow;
      await api.sheets.updateCell(spreadsheet_id, sheetTitle, sheetRow, colIdx, String(update.value ?? ''));
      cellsUpdated++;
    }

    return {
      spreadsheetId: spreadsheet_id,
      title: sheet.title,
      operation: 'update_cells',
      cellsUpdated,
    };
  }

  throw new Error(`Unknown operation "${operation}". Use "append_rows" or "update_cells".`);
}

/* ---------- Tool Status UI ---------- */

/**
 * Show an inline indicator that a tool is executing.
 * @param {HTMLElement | null} chatBody
 * @param {string} toolName
 * @param {Object} args
 */
export function showToolIndicator(chatBody, toolName, args) {
  if (!chatBody) return;
  let label;
  if (toolName === 'create_sheet') {
    label = `Creating ${args.template || ''} sheet "${args.title || 'Untitled'}"...`;
  } else if (toolName === 'read_sheet') {
    label = 'Reading sheet...';
  } else if (toolName === 'search_sheets') {
    label = 'Searching for sheets...';
  } else if (toolName === 'update_sheet') {
    label = 'Updating sheet...';
  } else {
    label = `Running ${toolName}...`;
  }
  const indicator = el('div', { className: 'agent-tool-indicator' }, [
    el('span', { className: 'agent-tool-icon' }, ['🔧']),
    el('span', {}, [label]),
  ]);
  chatBody.appendChild(indicator);
  chatBody.scrollTop = chatBody.scrollHeight;
}

/**
 * Remove the active tool indicator.
 * @param {HTMLElement | null} chatBody
 */
export function removeToolIndicator(chatBody) {
  if (!chatBody) return;
  const indicator = chatBody.querySelector('.agent-tool-indicator');
  if (indicator) indicator.remove();
}

/**
 * Show a retry indicator in the chat body.
 * @param {HTMLElement | null} chatBody
 * @param {number} seconds
 * @param {boolean} rotating
 */
export function showRetryIndicator(chatBody, seconds, rotating) {
  if (!chatBody) return;
  const msg = rotating
    ? 'Rate limited — switching to next key…'
    : `Rate limited — retrying in ${seconds}s...`;
  const indicator = el('div', { className: 'agent-tool-indicator', id: 'agent-retry-indicator' }, [
    el('span', { className: 'agent-tool-icon' }, ['⏳']),
    el('span', {}, [msg]),
  ]);
  chatBody.appendChild(indicator);
  chatBody.scrollTop = chatBody.scrollHeight;
}

/** Remove the retry indicator. */
export function removeRetryIndicator() {
  document.getElementById('agent-retry-indicator')?.remove();
}