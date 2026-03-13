#!/usr/bin/env node
/* ============================================================
   check-workboard.js — One-shot workboard query
   ============================================================
   Queries Google Sheets ONCE and prints a JSON summary to stdout.
   Exits immediately. No background process, no polling, no stale data.

   The waymark-builder agent calls this each time it wakes up from
   sleep, getting LIVE data every cycle instead of parsing stale
   terminal output from a background watcher.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/check-workboard.js

   Output (stdout, single line JSON):
     {"todo":[],"inProgress":[],"qa":0,"done":73}

   Exit codes:
     0 = success (JSON printed)
     1 = error (message on stderr)
   ============================================================ */

const SPREADSHEET_ID = '1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4';
const RANGE          = 'Sheet1!A1:I500';
const SHEETS_BASE    = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- Auth ---------- */

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch {
  console.error('ERROR: google-auth-library not found. Run: npm install google-auth-library');
  process.exit(1);
}

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service-account key JSON.');
  process.exit(1);
}

const auth = new GoogleAuth({
  keyFile: credPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

/* ---------- Main ---------- */

(async () => {
  try {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(RANGE)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(`Sheets API ${res.status}: ${await res.text()}`);
      process.exit(1);
    }

    const data = await res.json();
    const rows = data.values || [];

    // Parse task rows (column A non-empty = task row, empty = sub-row)
    const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const todo = [];
    const inProgress = [];
    let qaCount = 0;
    let doneCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const task = (r[0] || '').trim();
      if (!task) continue; // sub-row

      const stage    = (r[2] || '').trim();
      const project  = (r[3] || '').trim();
      const assignee = (r[4] || '').trim();
      const priority = (r[5] || '').trim();
      const label    = (r[7] || '').trim();
      const desc     = (r[1] || '').trim();

      const item = {
        row: i + 1, task, stage, project, assignee,
        priority, label, desc: desc.slice(0, 200),
      };

      if (stage === 'To Do') todo.push(item);
      else if (stage === 'In Progress') inProgress.push(item);
      else if (stage === 'QA') qaCount++;
      else if (stage === 'Done') doneCount++;
    }

    // Sort To Do by priority (P0 first)
    todo.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));
    inProgress.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

    // Single-line JSON to stdout — agent parses this directly
    console.log(JSON.stringify({ todo, inProgress, qa: qaCount, done: doneCount }));

  } catch (err) {
    console.error(`check-workboard error: ${err.message}`);
    process.exit(1);
  }
})();
