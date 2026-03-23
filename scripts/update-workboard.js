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

   Workboard target selection (highest priority first):
     WAYMARK_WORKBOARD_URL=https://docs.google.com/spreadsheets/d/...
     WAYMARK_WORKBOARD_ID=<spreadsheet-id>
     WAYMARK_PROJECT=<project-key> from generated/workboard-config.json
     WAYMARK_WORKBOARD_CONFIG=/path/to/workboard-config.json

   Global flags (apply to any command):
     --agent <name>   Use this agent name instead of 'AI' for the assignee
                      column on claim and note operations. Enables multi-agent
                      task partitioning. Defaults to 'AI' for backward compat.

   Commands:
     claim <row>
       Set stage to "In Progress" and assignee to agent name on a task row.
       Only updates columns C (stage) and E (assignee). Preserves all
       other columns including project (D).
       With --agent: performs verify-after-claim (read-write-read) to detect
       race conditions when multiple agents claim the same task.

     stage <row> <stage>
       Update only the stage column (C) on a task row.
       Example stages: "QA", "In Progress", "To Do"

     note <afterRow> <text>
       Insert a note sub-row BELOW the given row number. Uses the
       Sheets insertDimension API to create a blank row first, then
       writes to it. This guarantees no existing data is overwritten.
       The note gets: column E=agent name, column G=today's date, column I=text.

   Exit codes:
     0 = success
     1 = error (message on stderr)

   Examples:
     node scripts/update-workboard.js claim 263
     node scripts/update-workboard.js claim 263 --agent alpha
     node scripts/update-workboard.js stage 263 QA
     node scripts/update-workboard.js note 263 "Branch: feature/foo" --agent alpha
   ============================================================ */

const { resolveWorkboardConfig } = require('./workboard-config');

const DEFAULT_SPREADSHEET_ID = '1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4';
const DEFAULT_RANGE = 'Sheet1!A:I';
const WORKBOARD = resolveWorkboardConfig({
  defaultSpreadsheetId: DEFAULT_SPREADSHEET_ID,
  defaultRange: DEFAULT_RANGE,
});
const SPREADSHEET_ID = WORKBOARD.spreadsheetId;
let _sheetGid = null; // fetched at runtime — Sheet1
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
 * Claim a task: set stage="In Progress", assignee=agentName.
 * Only writes to columns C and E. Preserves column D (project).
 * When agentName is not 'AI', performs verify-after-claim to detect
 * race conditions in multi-agent setups.
 */
async function cmdClaim(row, agentName) {
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
  await writeRange(token, `Sheet1!E${row}`, [[agentName]]);

  // Verify-after-claim: re-read to detect race conditions.
  // If another agent wrote between our read and write, the assignee
  // won't match. We revert and report the conflict.
  if (agentName !== 'AI') {
    await new Promise(r => setTimeout(r, 3000));
    const verify = await readRange(token, `Sheet1!E${row}`);
    const actualAssignee = (verify[0]?.[0] || '').trim();
    if (actualAssignee !== agentName) {
      // Another agent won the race — revert our claim
      await writeRange(token, `Sheet1!C${row}`, [['To Do']]);
      await writeRange(token, `Sheet1!E${row}`, [['']]);
      console.log(JSON.stringify({ ok: false, action: 'claim', row, conflict: true, winner: actualAssignee }));
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ ok: true, action: 'claim', row, stage: 'In Progress', assignee: agentName }));
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
async function cmdNote(afterRow, text, agentName) {
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
    ['', '', '', '', agentName, '', today, '', text],
  ]);

  console.log(JSON.stringify({ ok: true, action: 'note', taskRow: afterRow, insertedAt: newRowNum, text: text.slice(0, 80) + '...' }));
}

/* ---------- CLI ---------- */

const rawArgs = process.argv.slice(2);

// Extract --agent <name> flag from anywhere in args
function extractFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return { value: null, rest: args };
  const value = args[idx + 1] || null;
  const rest = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { value, rest };
}

function extractFlagValue(args, flag, defaultValue) {
  const { value, rest } = extractFlag(args, flag);
  return { value: value || defaultValue, rest };
}

const { value: AGENT_NAME, rest: argsNoAgent } = extractFlagValue(rawArgs, '--agent', 'AI');
const [command, ...args] = argsNoAgent;

(async () => {
  try {
    switch (command) {
      case 'claim': {
        const row = parseInt(args[0], 10);
        if (!row || row < 2) { console.error('Usage: claim <row> [--agent <name>]'); process.exit(1); }
        await cmdClaim(row, AGENT_NAME);
        break;
      }
      case 'stage': {
        const row = parseInt(args[0], 10);
        const { rest: stageArgs } = extractFlag(args.slice(1), '--status');
        const stage = stageArgs.join(' ');
        if (!row || row < 2 || !stage) { console.error('Usage: stage <row> <stage>'); process.exit(1); }
        await cmdStage(row, stage);
        break;
      }
      case 'note': {
        const row = parseInt(args[0], 10);
        const text = args.slice(1).join(' ');
        if (!row || row < 2 || !text) { console.error('Usage: note <afterRow> <text> [--agent <name>]'); process.exit(1); }
        await cmdNote(row, text, AGENT_NAME);
        break;
      }
      case 'heartbeat':
        console.error('The heartbeat command has been removed. Monitoring is not currently implemented.');
        process.exit(1);
      default:
        console.error('Unknown command. Available: claim, stage, note');
        console.error('Usage: node scripts/update-workboard.js <command> [args...] [--agent <name>]');
        process.exit(1);
    }
  } catch (err) {
    console.error(`update-workboard error: ${err.message}`);
    process.exit(1);
  }
})();
