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
     WAYMARK_WORKBOARD_ID=<spreadsheet-id> (direct override)
     WAYMARK_WORKBOARD_URL=https://docs.google.com/spreadsheets/d/... (direct override)
     WAYMARK_PROJECT=<project-key> (from generated/workboard-config.json)
     WAYMARK_WORKBOARD_CONFIG=/path/to/workboard-config.json (optional config path)

   Output (stdout, single line JSON):
     {"todo":[],"inProgress":[],"qa":0,"done":73}

   Exit codes:
     0 = success (JSON printed)
     1 = error (message on stderr)
   ============================================================ */

const { resolveWorkboardConfig } = require('./workboard-config');

const DEFAULT_SPREADSHEET_ID = '1OSOsGds0IAW_UP4iMvLdWbwffrRacbVmYn9FrtF1tbI';
const DEFAULT_RANGE          = 'Sheet1!A1:I500';
const WORKBOARD = resolveWorkboardConfig({
  defaultSpreadsheetId: DEFAULT_SPREADSHEET_ID,
  defaultRange: DEFAULT_RANGE,
});
const SPREADSHEET_ID = WORKBOARD.spreadsheetId;
const RANGE = WORKBOARD.range;
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

    // First pass: identify task rows and their indices
    const taskIndices = [];
    for (let i = 1; i < rows.length; i++) {
      const task = (rows[i][0] || '').trim();
      if (task) taskIndices.push(i);
    }

    for (let t = 0; t < taskIndices.length; t++) {
      const i = taskIndices[t];
      const r = rows[i];
      const task = (r[0] || '').trim();

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

      if (stage === 'To Do') {
        // Collect sub-row notes for To Do items so the agent can detect
        // QA rejections (human moved task back to To Do with feedback notes)
        const nextTaskIdx = t + 1 < taskIndices.length ? taskIndices[t + 1] : rows.length;
        const notes = [];
        for (let j = i + 1; j < nextTaskIdx; j++) {
          const note = (rows[j][8] || '').trim();
          const noteAuthor = (rows[j][4] || '').trim();
          if (note) notes.push({ row: j + 1, author: noteAuthor, text: note });
        }
        if (notes.length) item.notes = notes;

        // Detect QA rejection: has notes from non-AI author AFTER an AI note
        const hasAINotes = notes.some(n => n.author === 'AI');
        const hasQARevert = notes.some(n => n.text.includes('⟳ QA → To Do'));
        const hasHumanFeedback = notes.some(n =>
          n.author !== 'AI' && !n.text.startsWith('⟳') && n.author
        );
        if (hasAINotes && (hasQARevert || hasHumanFeedback)) {
          item.rejected = true;
        }

        todo.push(item);
      } else if (stage === 'In Progress') inProgress.push(item);
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
