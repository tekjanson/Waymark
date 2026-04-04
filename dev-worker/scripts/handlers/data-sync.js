/**
 * handlers/data-sync.js — Load data from an external source into a Google Sheet
 *
 * Config shape (JSON in the Config column):
 * {
 *   "source": "https://api.example.com/data",   // URL to fetch JSON from
 *   "sheetId": "target-spreadsheet-id",
 *   "tab": "Sheet1",                             // optional, defaults to Sheet1
 *   "headers": ["Col1", "Col2", "Col3"],         // optional: write headers first
 *   "clearFirst": true,                          // optional: clear tab before writing
 *   "jsonPath": "items",                         // optional: dot-path inside JSON to the array
 *   "fields": ["id", "name", "value"]            // optional: which keys to extract per item
 * }
 *
 * The handler fetches the URL, parses JSON, and appends (or overwrites) rows to the sheet.
 * Returns a result string describing the write outcome.
 */

'use strict';

const https = require('https');
const http  = require('http');
const { GoogleAuth } = require('google-auth-library');

let _auth;
async function getToken() {
  if (!_auth) {
    _auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  const client = await _auth.getClient();
  const token  = await client.getAccessToken();
  return token.token;
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${res.statusCode} ${res.statusMessage}`));
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    }).on('error', reject);
  });
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

async function clearTab(sheetId, tab, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}:clear`;
  return jsonRequest('POST', url, {}, token);
}

async function writeRows(sheetId, tab, rows, token) {
  const range = `${tab}!A1`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  return jsonRequest('PUT', url, { range, majorDimension: 'ROWS', values: rows }, token);
}

function getPath(obj, path) {
  if (!path) return obj;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function extractRow(item, fields) {
  if (!fields || fields.length === 0) {
    if (typeof item !== 'object' || item === null) return [String(item)];
    return Object.values(item).map(v => v === null || v === undefined ? '' : String(v));
  }
  return fields.map(f => {
    const v = item[f];
    return v === null || v === undefined ? '' : String(v);
  });
}

/**
 * Run the data-sync handler.
 * @param {object} config — parsed from Config column
 * @returns {string} result message
 */
async function run(config) {
  const { source, sheetId, tab = 'Sheet1', headers, clearFirst, jsonPath, fields } = config;

  if (!source)  return 'Error: config.source (URL) is required';
  if (!sheetId) return 'Error: config.sheetId is required';

  // 1. Fetch data
  let raw;
  try {
    raw = await fetch(source);
  } catch (err) {
    return `Error fetching ${source}: ${err.message}`;
  }

  // 2. Extract array to write
  let items = Array.isArray(raw) ? raw : getPath(raw, jsonPath);
  if (!Array.isArray(items)) {
    // If the root object isn't an array and jsonPath failed, treat entire object as one row
    items = [raw];
  }

  if (items.length === 0) return `Source returned 0 items — nothing to write`;

  // 3. Build rows
  const rowsToWrite = [];
  if (headers && headers.length > 0) {
    rowsToWrite.push(headers);
  }
  for (const item of items) {
    rowsToWrite.push(extractRow(item, fields));
  }

  // 4. Write to sheet
  const token = await getToken();
  if (clearFirst) await clearTab(sheetId, tab, token);
  await writeRows(sheetId, tab, rowsToWrite, token);

  const dataRows = rowsToWrite.length - (headers ? 1 : 0);
  return `Synced ${dataRows} records from ${source}`;
}

module.exports = { run };
