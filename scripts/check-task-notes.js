#!/usr/bin/env node
/* ============================================================
   check-task-notes.js — Poll for new notes on an In Progress task

   Checks if a task (in a specific row) has any new notes that haven't
   been read yet by the agent. Returns note info so the agent can
   respond inline or pause the current task.

   The workboard uses the sub-row format (AI_LAWS §15):
   - Task row: column A non-empty (the task title)
   - Note sub-row: column A empty, column I has note text

   This script:
   1. Reads the task row + all sub-rows below it
   2. Returns any notes (column I non-empty) that haven't been seen
   3. Tracks "last seen" notes per agent/task in a state file

   Usage:
      GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
        node scripts/check-task-notes.js \
          --row 42 \
          --agent alex \
          [--state-dir ~/.waymark-notes]

   Output (stdout, JSON):
      {"hasNewNotes":false,"notes":[]}
      {"hasNewNotes":true,"notes":[{row,author,date,text,isAck},...]}

   Exit codes:
      0 = success (JSON printed)
      1 = error (message on stderr)
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { resolveWorkboardConfig } = require('./workboard-config');

const DEFAULT_SPREADSHEET_ID = '1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4';
const DEFAULT_RANGE          = 'Sheet1!A:I';
const WORKBOARD = resolveWorkboardConfig({
  defaultSpreadsheetId: DEFAULT_SPREADSHEET_ID,
  defaultRange: DEFAULT_RANGE,
});
const SPREADSHEET_ID = WORKBOARD.spreadsheetId;
const RANGE = WORKBOARD.range;
const SHEETS_BASE    = 'https://sheets.googleapis.com/v4/spreadsheets';

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch {
  console.error('ERROR: google-auth-library not found. Run: npm install google-auth-library');
  process.exit(1);
}

// Parse CLI args
let taskRow = null;
let agentName = 'ai';
let stateDir = path.join(process.env.HOME || '/tmp', '.waymark-notes');

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--row' && i + 1 < process.argv.length) {
    taskRow = parseInt(process.argv[++i], 10);
  } else if (process.argv[i] === '--agent' && i + 1 < process.argv.length) {
    agentName = process.argv[++i];
  } else if (process.argv[i] === '--state-dir' && i + 1 < process.argv.length) {
    stateDir = process.argv[++i];
  }
}

if (!taskRow || taskRow < 1) {
  console.error('check-task-notes: --row required and must be > 0');
  process.exit(1);
}

// Ensure state dir exists
if (!fs.existsSync(stateDir)) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch (err) {
    // Ignore if already created
  }
}

// State file: tracks last-seen note indices per task/agent
const stateFile = path.join(stateDir, `notes-${taskRow}-${agentName}.json`);
let seenState = {};
if (fs.existsSync(stateFile)) {
  try {
    seenState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (err) {
    // Ignore parse errors
  }
}
seenState.lastSeenRows = seenState.lastSeenRows || [];

async function main() {
  try {
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credsPath) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set');
    }

    const auth = new GoogleAuth({
      keyFile: credsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    // Fetch the full workboard
    const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(RANGE)}?valueRenderOption=UNFORMATTED_VALUE`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Sheets API ${response.status}: ${body}`);
    }

    const data = await response.json();
    const values = data.values || [];

    if (values.length <= taskRow) {
      // Task row doesn't exist
      console.log(JSON.stringify({ hasNewNotes: false, notes: [] }));
      process.exit(0);
    }

    // Check if row at taskRow has column A non-empty (is a task row, not sub-row)
    const taskRowData = values[taskRow - 1] || []; // 0-indexed
    if (!taskRowData[0] || taskRowData[0].toString().trim() === '') {
      console.error('check-task-notes: row ${taskRow} is a sub-row or empty (not a task row)');
      process.exit(1);
    }

    // Collect all notes (sub-rows below this task until next non-empty column A)
    const notes = [];
    for (let i = taskRow; i < values.length; i++) {
      const row = values[i] || [];
      // Check if this is a sub-row (column A empty) and has note text (column I non-empty)
      if ((!row[0] || row[0].toString().trim() === '') && (row[8] || '').toString().trim() !== '') {
        // This is a note sub-row
        const author = (row[4] || '').toString().trim() || 'unknown';
        const date = (row[6] || '').toString().trim() || new Date().toISOString().split('T')[0];
        const text = (row[8] || '').toString().trim();
        const isAck = text.toLowerCase().startsWith('ack:') || text.toLowerCase().startsWith('acknowledged');

        notes.push({
          row: i + 1, // 1-indexed row number in sheet
          author,
          date,
          text,
          isAck,
        });
      } else if (row[0] && row[0].toString().trim() !== '') {
        // Hit another task row, stop collecting
        break;
      }
    }

    // Filter to only NEW notes (not in seenState.lastSeenRows)
    const newNotes = notes.filter(n => !seenState.lastSeenRows.includes(n.row));

    // Update state file
    seenState.lastSeenRows = notes.map(n => n.row);
    seenState.lastChecked = new Date().toISOString();
    fs.writeFileSync(stateFile, JSON.stringify(seenState, null, 2));

    // Output
    console.log(
      JSON.stringify({
        hasNewNotes: newNotes.length > 0,
        notes: newNotes,
        totalNotes: notes.length,
      })
    );
    process.exit(0);
  } catch (err) {
    console.error(`check-task-notes error: ${err.message}`);
    process.exit(1);
  }
}

main();
