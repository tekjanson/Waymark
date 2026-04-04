/**
 * handlers/poll-watch.js — Poll a Google Sheet column for changes
 *
 * Config shape (JSON in the Config column):
 * {
 *   "sheetId": "spreadsheet-id",
 *   "tab": "Sheet1",          // optional, defaults to Sheet1
 *   "column": "B",            // column letter to watch
 *   "threshold": 0,           // alert if any value >= this (optional)
 *   "resultSheetId": "...",   // sheet to append change records (optional)
 *   "resultTab": "Sheet1"     // tab in result sheet (optional)
 * }
 *
 * Returns a result string describing what was found.
 */

'use strict';

const https = require('https');
const { GoogleAuth } = require('google-auth-library');

let _auth;
async function getToken(scopes) {
  if (!_auth) {
    _auth = new GoogleAuth({ scopes });
  }
  const client = await _auth.getClient();
  const token  = await client.getAccessToken();
  return token.token;
}

function jsonRequest(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function readRange(sheetId, range) {
  const token = await getToken(['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const res   = await jsonRequest('GET', url, null, token);
  return (res && res.values) || [];
}

async function appendRows(sheetId, tab, rows) {
  const token = await getToken(['https://www.googleapis.com/auth/spreadsheets']);
  const range = `${tab}!A:Z`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return jsonRequest('POST', url, { majorDimension: 'ROWS', values: rows }, token);
}

/**
 * Run the poll-watch handler.
 * @param {object} config — parsed from Config column
 * @returns {string} result message
 */
async function run(config) {
  const { sheetId, tab = 'Sheet1', column = 'A', threshold, resultSheetId, resultTab = 'Sheet1' } = config;

  if (!sheetId) return 'Error: config.sheetId is required';

  const range = `${tab}!${column}:${column}`;
  const values = await readRange(sheetId, range);

  if (!values.length) return `No data in column ${column} of sheet ${sheetId}`;

  // Skip header row
  const dataRows = values.slice(1).map(r => (r[0] || '').trim()).filter(Boolean);
  const total    = dataRows.length;

  let alertCount = 0;
  const alerts   = [];

  if (threshold !== undefined && threshold !== null) {
    for (let i = 0; i < dataRows.length; i++) {
      const num = parseFloat(dataRows[i]);
      if (!isNaN(num) && num >= Number(threshold)) {
        alertCount++;
        alerts.push(`row ${i + 2}: ${dataRows[i]}`);
      }
    }
  }

  // Append change records if a result sheet is specified
  if (resultSheetId && alerts.length > 0) {
    const ts    = new Date().toISOString();
    const rows  = alerts.map(a => [ts, sheetId, column, a, 'threshold exceeded']);
    await appendRows(resultSheetId, resultTab, rows);
  }

  if (threshold !== undefined) {
    return alertCount > 0
      ? `${alertCount}/${total} rows >= threshold (${threshold}): ${alerts.slice(0, 3).join('; ')}${alerts.length > 3 ? '…' : ''}`
      : `Watching ${total} rows in col ${column} — no threshold alerts`;
  }

  return `Read ${total} rows from column ${column}`;
}

module.exports = { run };
