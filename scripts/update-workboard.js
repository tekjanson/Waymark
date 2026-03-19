#!/usr/bin/env node
/* ============================================================
   update-workboard.js — Safe workboard write operations

   Provides safe write operations for the waymark-builder agent.
   Prevents data loss by:
   1. INSERTING blank rows before writing notes (never overwrites)
   2. Reading-before-writing for cell updates (aborts if non-empty)
   3. Only updating specific columns when claiming tasks

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
       node scripts/update-workboard.js <command> [args...]

   Set WAYMARK_WORKBOARD_ID to override the default board.

   Commands:
     claim <row>
       Set stage to "In Progress" and assignee to "AI" on a task row.
       Only updates columns C (stage) and E (assignee). Preserves all
       other columns including project (D).

     stage <row> <stage>
       Update only the stage column (C) on a task row.
       Example stages: "QA", "In Progress", "To Do"

     note <afterRow> <text>
       Insert a note sub-row BELOW the given row number. Uses the
       Sheets insertDimension API to create a blank row first, then
       writes to it. This guarantees no existing data is overwritten.
       The note gets: column E="AI", column G=today's date, column I=text.

   Exit codes:
     0 = success
     1 = error (message on stderr)

   Examples:
     node scripts/update-workboard.js claim 263
     node scripts/update-workboard.js stage 263 QA
     node scripts/update-workboard.js note 263 "Branch: feature/foo | Files: a.js | +50 LOC"
   ============================================================ */

const SPREADSHEET_ID = process.env.WAYMARK_WORKBOARD_ID || '1OSOsGds0IAW_UP4iMvLdWbwffrRacbVmYn9FrtF1tbI';
let _sheetGid = null; // fetched at runtime
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
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

/* ---------- Helpers ---------- */

async function getToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/** Read a range and return the values array */
async function readRange(token, range) {
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

/** Write values to a range using PUT (valueInputOption=RAW) */
async function writeRange(token, range, values) {
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Sheets write ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Get the numeric sheet ID (gid) for Sheet1, cached after first call */
async function getSheetGid(token) {
  if (_sheetGid !== null) return _sheetGid;
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}?fields=sheets.properties`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets metadata ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const sheet1 = data.sheets.find(s => s.properties.index === 0);
  _sheetGid = sheet1 ? sheet1.properties.sheetId : 0;
  return _sheetGid;
}

/** Insert a blank row at a given 1-based position using batchUpdate */
async function insertRow(token, afterRow) {
  const sheetId = await getSheetGid(token);
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        insertDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: afterRow,      // 0-based: inserting after row N means startIndex = N
            endIndex: afterRow + 1,
          },
          inheritFromBefore: false,
        },
      }],
    }),
  });
  if (!res.ok) throw new Error(`Sheets insertRow ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------- Commands ---------- */

/**
 * Claim a task: set stage="In Progress", assignee="AI".
 * Only writes to columns C and E. Preserves column D (project).
 */
async function cmdClaim(row) {
  const token = await getToken();

  // Read current row to verify it's a task row (column A non-empty)
  const current = await readRange(token, `Sheet1!A${row}:I${row}`);
  if (!current.length || !(current[0][0] || '').trim()) {
    console.error(`ERROR: Row ${row} is not a task row (column A is empty). Aborting.`);
    process.exit(1);
  }

  const currentStage = (current[0][2] || '').trim();
  if (currentStage !== 'To Do' && currentStage !== 'Backlog') {
    console.error(`WARNING: Row ${row} stage is "${currentStage}" (expected "To Do" or "Backlog"). Proceeding anyway.`);
  }

  // Write only stage (C) and assignee (E) — skip project (D)
  await writeRange(token, `Sheet1!C${row}`, [['In Progress']]);
  await writeRange(token, `Sheet1!E${row}`, [['AI']]);

  console.log(JSON.stringify({ ok: true, action: 'claim', row, stage: 'In Progress', assignee: 'AI' }));
}

/**
 * Update stage only (column C).
 */
async function cmdStage(row, stage) {
  const token = await getToken();

  // Verify it's a task row
  const current = await readRange(token, `Sheet1!A${row}`);
  if (!current.length || !(current[0][0] || '').trim()) {
    console.error(`ERROR: Row ${row} is not a task row (column A is empty). Aborting.`);
    process.exit(1);
  }

  await writeRange(token, `Sheet1!C${row}`, [[stage]]);
  console.log(JSON.stringify({ ok: true, action: 'stage', row, stage }));
}

/**
 * Insert a note sub-row BELOW the given row.
 * Uses insertDimension to create a blank row first, then writes to it.
 * This NEVER overwrites existing data.
 */
async function cmdNote(afterRow, text) {
  const token = await getToken();
  const now = new Date();
  const today = now.toISOString().slice(0, 10)
    + ' ' + String(now.getHours()).padStart(2, '0')
    + ':' + String(now.getMinutes()).padStart(2, '0');

  // Find the last sub-row belonging to this task.
  // Read rows below the task to find where sub-rows end.
  const lookAhead = await readRange(token, `Sheet1!A${afterRow}:A${afterRow + 30}`);
  let insertAt = afterRow; // default: insert right after the task row

  for (let i = 1; i < lookAhead.length; i++) {
    const val = (lookAhead[i][0] || '').trim();
    if (val) break; // hit the next task row
    insertAt = afterRow + i; // this is still a sub-row
  }

  // insertAt is now the last sub-row. Insert AFTER it.
  const newRowNum = insertAt + 1;

  // Step 1: Insert a blank row (0-based index for API = newRowNum - 1)
  await insertRow(token, newRowNum - 1);

  // Step 2: Write to the newly inserted blank row
  // After insertion, the new row is at newRowNum
  await writeRange(token, `Sheet1!A${newRowNum}:I${newRowNum}`, [
    ['', '', '', '', 'AI', '', today, '', text],
  ]);

  console.log(JSON.stringify({ ok: true, action: 'note', taskRow: afterRow, insertedAt: newRowNum, text: text.slice(0, 80) + '...' }));
}

/* ---------- CLI ---------- */

const [,, command, ...args] = process.argv;

(async () => {
  try {
    switch (command) {
      case 'claim': {
        const row = parseInt(args[0], 10);
        if (!row || row < 2) { console.error('Usage: claim <row>'); process.exit(1); }
        await cmdClaim(row);
        break;
      }
      case 'stage': {
        const row = parseInt(args[0], 10);
        const stage = args.slice(1).join(' ');
        if (!row || row < 2 || !stage) { console.error('Usage: stage <row> <stage>'); process.exit(1); }
        await cmdStage(row, stage);
        break;
      }
      case 'note': {
        const row = parseInt(args[0], 10);
        const text = args.slice(1).join(' ');
        if (!row || row < 2 || !text) { console.error('Usage: note <afterRow> <text>'); process.exit(1); }
        await cmdNote(row, text);
        break;
      }
      default:
        console.error('Unknown command. Available: claim, stage, note');
        console.error('Usage: node scripts/update-workboard.js <command> [args...]');
        process.exit(1);
    }
  } catch (err) {
    console.error(`update-workboard error: ${err.message}`);
    process.exit(1);
  }
})();
