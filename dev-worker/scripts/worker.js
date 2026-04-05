#!/usr/bin/env node
/**
 * worker.js — Waymark Backend Job Runner
 *
 * Polls a "worker" template Google Sheet for pending/scheduled jobs,
 * dispatches them to the appropriate handler, and updates the Status,
 * Last Run, and Result columns.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *   WORKER_SHEET_ID=<sheetId> \
 *   node scripts/worker.js
 *
 * Required environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS — path to service account key JSON
 *   WORKER_SHEET_ID                — Google Sheets ID of the jobs sheet
 *
 * Optional:
 *   WORKER_POLL_INTERVAL_MS        — check interval (default: 30000)
 *   WORKER_SHEET_TAB               — tab name inside the sheet (default: Sheet1)
 *   WORKER_DRY_RUN                 — if set, print actions without writing results
 */

'use strict';

const { GoogleAuth } = require('google-auth-library');
const https = require('https');

/* ---------- Config ---------- */

const SHEET_ID    = process.env.WORKER_SHEET_ID;
const TAB         = process.env.WORKER_SHEET_TAB || 'Sheet1';
const INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '30000', 10);
const DRY_RUN     = !!process.env.WORKER_DRY_RUN;

if (!SHEET_ID) {
  console.error('[worker] WORKER_SHEET_ID is required');
  process.exit(1);
}

/* ---------- Sheets API client ---------- */

let _auth;
async function getToken() {
  if (!_auth) {
    _auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  const client = await _auth.getClient();
  const token  = await client.getAccessToken();
  return token.token;
}

async function sheetsGet(range) {
  const token = await getToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
  return jsonRequest('GET', url, null, token);
}

async function sheetsUpdate(range, values) {
  if (DRY_RUN) {
    console.log(`[dry-run] PUT ${range} =`, JSON.stringify(values));
    return;
  }
  const token = await getToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  return jsonRequest('PUT', url, { range, majorDimension: 'ROWS', values }, token);
}

function jsonRequest(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u  = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
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

/* ---------- Column detection ---------- */

function detectColumns(headers) {
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  return {
    job:      lower.findIndex(h => /^(job|task|worker)$/.test(h)),
    handler:  lower.findIndex(h => /^(handler|runner|type|kind)$/.test(h)),
    config:   lower.findIndex(h => /^(config|params|args|options|settings?)$/.test(h)),
    status:   lower.findIndex(h => /^(status|state)$/.test(h)),
    schedule: lower.findIndex(h => /^(schedule|cron|interval|frequency|every)/.test(h)),
    lastRun:  lower.findIndex(h => /^(last.?run|ran.?at|updated|timestamp|executed)/.test(h)),
    result:   lower.findIndex(h => /^(result|output|log|message)$/.test(h)),
  };
}

/* ---------- Job execution ---------- */

async function runJob(jobName, handler, config, cols, rowIndex) {
  const handlerKey = (handler || '').toLowerCase().trim();
  let parsedConfig = {};
  try { parsedConfig = JSON.parse(config || '{}'); } catch { /* use empty */ }

  console.log(`[worker] Running job "${jobName}" (handler: ${handlerKey})`);

  // Mark as running
  await updateRow(rowIndex, cols, 'running', new Date().toISOString(), 'Starting…');

  try {
    let result;
    if (handlerKey.startsWith('poll')) {
      result = await require('./handlers/poll-watch').run(parsedConfig);
    } else if (handlerKey.startsWith('sync')) {
      result = await require('./handlers/data-sync').run(parsedConfig);
    } else if (handlerKey === 'metrics' || handlerKey === 'content-metrics' || handlerKey.startsWith('metrics')) {
      result = await require('./handlers/content-metrics').run(parsedConfig);
    } else if (handlerKey.startsWith('notify')) {
      result = `Notify handler not yet implemented`;
    } else if (handlerKey.startsWith('webhook')) {
      result = `Webhook handler not yet implemented`;
    } else if (handlerKey.startsWith('script')) {
      result = `Script handler not yet implemented`;
    } else {
      result = `Unknown handler: ${handlerKey}`;
    }

    console.log(`[worker] Job "${jobName}" done: ${result}`);
    await updateRow(rowIndex, cols, 'done', new Date().toISOString(), String(result).slice(0, 200));
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`[worker] Job "${jobName}" failed: ${msg}`);
    await updateRow(rowIndex, cols, 'failed', new Date().toISOString(), `Error: ${msg}`.slice(0, 200));
  }
}

async function updateRow(rowIndex, cols, status, lastRun, result) {
  // rowIndex is 1-based (header = row 1, first data row = row 2)
  const row = rowIndex + 1;
  const writes = [];

  if (cols.status >= 0) {
    const col = colLetter(cols.status);
    writes.push(sheetsUpdate(`${TAB}!${col}${row}`, [[status]]));
  }
  if (cols.lastRun >= 0) {
    const col = colLetter(cols.lastRun);
    writes.push(sheetsUpdate(`${TAB}!${col}${row}`, [[lastRun]]));
  }
  if (cols.result >= 0) {
    const col = colLetter(cols.result);
    writes.push(sheetsUpdate(`${TAB}!${col}${row}`, [[result]]));
  }

  await Promise.all(writes);
}

function colLetter(index) {
  // Convert 0-based column index to A1 letter notation (A–ZZ)
  let result = '';
  let n = index;
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

/* ---------- Schedule check ---------- */

function isDue(schedule) {
  if (!schedule) return false;
  // Very simple cron-like check: if schedule contains */N, check if time mod N === 0
  // Full cron parsing is out of scope for this runner — real deployments should use
  // a proper cron daemon (systemd, node-cron, etc.) and set status="pending" on schedule.
  // For Waymark, "scheduled" means the human or another tool will set status=pending.
  return false;
}

/* ---------- Main poll loop ---------- */

async function checkJobs() {
  let data;
  try {
    data = await sheetsGet(`${TAB}!A1:Z1000`);
  } catch (err) {
    console.error('[worker] Failed to read sheet:', err.message || err);
    return;
  }

  const rows = (data && data.values) || [];
  if (rows.length < 2) {
    console.log('[worker] No data rows found');
    return;
  }

  const headers = rows[0];
  const cols    = detectColumns(headers);

  if (cols.job < 0 || (cols.handler < 0 && cols.schedule < 0)) {
    console.warn('[worker] Sheet does not look like a worker-jobs sheet (missing Job/Handler columns). Skipping.');
    return;
  }

  for (let i = 1; i < rows.length; i++) {
    const row     = rows[i];
    const jobName = (row[cols.job] || '').trim();
    if (!jobName) continue;

    const handler  = cols.handler >= 0 ? (row[cols.handler] || '') : '';
    const config   = cols.config  >= 0 ? (row[cols.config]  || '') : '';
    const rawStatus = cols.status >= 0 ? (row[cols.status]  || '').toLowerCase().trim() : '';

    const isPending   = /^(pending|todo|queue|wait)/.test(rawStatus) || rawStatus === '';
    const isScheduled = /^(sched|next|cron)/.test(rawStatus);

    if (isPending || (isScheduled && isDue((row[cols.schedule] || '')))) {
      await runJob(jobName, handler, config, cols, i);
    }
  }
}

async function main() {
  console.log(`[worker] Starting — sheet: ${SHEET_ID} | tab: ${TAB} | interval: ${INTERVAL_MS}ms${DRY_RUN ? ' | DRY RUN' : ''}`);
  await checkJobs();
  setInterval(checkJobs, INTERVAL_MS);
}

main().catch(err => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
