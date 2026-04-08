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

   Flags:
     --agent <name>   Filter tasks for this named agent. When set:
                      - To Do shows: unassigned tasks OR tasks assigned to this agent
                      - In Progress shows: only tasks assigned to this agent
                      - QA rejection detects notes from this agent (not just 'AI')
                      Without --agent, all tasks are shown (backward compatible).
     --qa-details     Include full QA item details with sub-row notes in output.
                      Instead of just a count, the `qa` field becomes an array of
                      items with row, task, priority, assignee, notes, branch, and
                      testingInstructions. Used by the QA patrol agent.

   Output (stdout, single line JSON):
     {"todo":[],"inProgress":[],"qa":0,"done":73}
     With --qa-details:
     {"todo":[],"inProgress":[],"qa":[{row,task,notes,...}],"done":73}

   Exit codes:
     0 = success (JSON printed)
     1 = error (message on stderr)
   ============================================================ */

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

/* ---------- CLI flags ---------- */

const rawArgs = process.argv.slice(2);
let AGENT_NAME = null; // null = show everything (backward compat)
let QA_DETAILS = false; // when true, return full QA items instead of count
const agentIdx = rawArgs.indexOf('--agent');
if (agentIdx !== -1 && rawArgs[agentIdx + 1]) {
  AGENT_NAME = rawArgs[agentIdx + 1];
}
if (rawArgs.includes('--qa-details')) {
  QA_DETAILS = true;
}

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
    const qaItems = [];     // full QA items when --qa-details
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

      // Extract a Google Sheets spreadsheet ID from desc or label if present.
      // A task row may contain a Sheets URL like:
      //   https://docs.google.com/spreadsheets/d/{ID}/edit
      // or a bare ID (44-char alphanumeric) in the label column.
      // Emitting this as `sheetId` lets the router skip template detection API calls.
      const SHEETS_URL_RE = /\/spreadsheets\/d\/([\w-]{20,})/;
      const BARE_ID_RE    = /\b([\w-]{44})\b/;
      let sheetId = null;
      const sheetUrlMatch = SHEETS_URL_RE.exec(desc) || SHEETS_URL_RE.exec(label);
      if (sheetUrlMatch) {
        sheetId = sheetUrlMatch[1];
      } else {
        const bareMatch = BARE_ID_RE.exec(label);
        if (bareMatch) sheetId = bareMatch[1];
      }

      const item = {
        row: i + 1, task, stage, project, assignee,
        priority, label, desc: desc.slice(0, 200),
      };
      if (sheetId) item.sheetId = sheetId;

      if (stage === 'To Do') {
        // When filtering by agent, only show unassigned or own tasks
        if (AGENT_NAME && assignee && assignee !== AGENT_NAME) continue;

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

        // Detect QA rejection: has notes from this agent (or 'AI') AFTER
        // a human note or QA revert marker
        const agentNames = AGENT_NAME ? [AGENT_NAME, 'AI'] : ['AI'];
        const hasAgentNotes = notes.some(n => agentNames.includes(n.author));
        const hasQARevert = notes.some(n => n.text.includes('⟳ QA → To Do'));
        const hasHumanFeedback = notes.some(n =>
          !agentNames.includes(n.author) && !n.text.startsWith('⟳') && n.author
        );
        if (hasAgentNotes && (hasQARevert || hasHumanFeedback)) {
          item.rejected = true;
        }

        todo.push(item);
      } else if (stage === 'In Progress') {
        // When filtering by agent, only show own in-progress tasks
        if (AGENT_NAME && assignee !== AGENT_NAME) continue;
        inProgress.push(item);
      }
      else if (stage === 'QA') {
        qaCount++;
        if (QA_DETAILS) {
          // Collect sub-row notes for QA items (branch info, testing instructions, etc.)
          const nextTaskIdx = t + 1 < taskIndices.length ? taskIndices[t + 1] : rows.length;
          const notes = [];
          let branch = '';
          let testingInstructions = '';
          let testReportUrl = '';
          for (let j = i + 1; j < nextTaskIdx; j++) {
            const note = (rows[j][8] || '').trim();
            const noteAuthor = (rows[j][4] || '').trim();
            if (note) {
              notes.push({ row: j + 1, author: noteAuthor, text: note });
              // Extract branch from completion notes
              const branchMatch = note.match(/Branch:\s*(feature\/[^\s|]+)/);
              if (branchMatch) branch = branchMatch[1];
              // Extract test report URL
              const urlMatch = note.match(/Test report:\s*(https:\/\/[^\s]+)/);
              if (urlMatch) testReportUrl = urlMatch[1];
              // Detect QA testing instructions
              if (note.startsWith('QA:')) testingInstructions = note;
            }
          }
          const qaItem = { ...item, notes };
          if (branch) qaItem.branch = branch;
          if (testingInstructions) qaItem.testingInstructions = testingInstructions;
          if (testReportUrl) qaItem.testReportUrl = testReportUrl;
          qaItems.push(qaItem);
        }
      }
      else if (stage === 'Done') doneCount++;
    }

    // Sort To Do by priority (P0 first)
    todo.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));
    inProgress.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

    // Single-line JSON to stdout — agent parses this directly
    const qaOutput = QA_DETAILS ? qaItems : qaCount;
    console.log(JSON.stringify({ todo, inProgress, qa: qaOutput, done: doneCount }));

  } catch (err) {
    console.error(`check-workboard error: ${err.message}`);
    process.exit(1);
  }
})();
