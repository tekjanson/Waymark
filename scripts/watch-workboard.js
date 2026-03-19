#!/usr/bin/env node
/* ============================================================
   watch-workboard.js — Zero-token workboard poller
   ============================================================
   Polls the Waymark Workboard Google Sheet every N seconds for
   new "To Do" items. Uses the same service-account credentials
   as the MCP server — no LLM tokens consumed.

   Two modes:
     STANDALONE — human-readable colored output with terminal bell
     AGENT      — outputs JSON markers that the waymark-builder
                  agent parses via get_terminal_output

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/watch-workboard.js
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/watch-workboard.js --agent
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/watch-workboard.js --agent --backoff
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/watch-workboard.js --interval 30

   Workboard target selection (highest priority first):
     WAYMARK_WORKBOARD_URL=https://docs.google.com/spreadsheets/d/...
     WAYMARK_WORKBOARD_ID=<spreadsheet-id>
     WAYMARK_PROJECT=<project-key> from generated/workboard-config.json
     WAYMARK_WORKBOARD_CONFIG=/path/to/workboard-config.json

   Flags:
     --agent       Output JSON markers for agent consumption (@@WATCHER:)
     --backoff     Exponential backoff: double poll interval on each idle cycle,
                   reset to base interval when new work appears. Caps at 10 min.
     --interval N  Set the base poll interval in seconds (default: 60, min: 10)

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

/* ---------- Parse args ---------- */

const args = process.argv.slice(2);
let intervalSec = 60;
const idxInterval = args.indexOf('--interval');
if (idxInterval !== -1 && args[idxInterval + 1]) {
  intervalSec = Math.max(10, parseInt(args[idxInterval + 1], 10) || 60);
}
const AGENT_MODE = args.includes('--agent');
const BACKOFF_MODE = args.includes('--backoff');

/* ---------- Backoff state ---------- */
// When --backoff is enabled, the poll interval doubles on each idle cycle
// and resets to the base interval when new work is found.
const BASE_INTERVAL = intervalSec;
const MAX_INTERVAL  = 600; // Cap at 10 minutes
let currentInterval = intervalSec;
let consecutiveIdles = 0;
let pollTimer = null;

/* ---------- Auth ---------- */

let GoogleAuth;
try {
  ({ GoogleAuth } = require('google-auth-library'));
} catch {
  console.error('ERROR: google-auth-library not found. Run: cd mcp && npm install');
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

async function getToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/* ---------- Sheets fetch ---------- */

async function fetchWorkboard() {
  const token = await getToken();
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(RANGE)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

/* ---------- Parse tasks ---------- */

function parseTasks(rows) {
  // Row 0 = headers, skip
  const tasks = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const task     = (r[0] || '').trim();
    if (!task) continue; // sub-row, skip

    const desc     = (r[1] || '').trim();
    const stage    = (r[2] || '').trim();
    const project  = (r[3] || '').trim();
    const assignee = (r[4] || '').trim();
    const priority = (r[5] || '').trim();
    const due      = (r[6] || '').trim();
    const label    = (r[7] || '').trim();

    tasks.push({ row: i + 1, task, desc, stage, project, assignee, priority, due, label });
  }
  return tasks;
}

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

function sortByPriority(tasks) {
  return tasks.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    return pa - pb;
  });
}

/* ---------- State ---------- */

let firstRun = true;

/* ---------- Display helpers ---------- */

function fmtTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function priorityColor(p) {
  if (p === 'P0') return '\x1b[31m';  // red
  if (p === 'P1') return '\x1b[33m';  // yellow
  if (p === 'P2') return '\x1b[36m';  // cyan
  return '\x1b[37m';                   // white
}

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const GREEN = '\x1b[32m';

/* ---------- Agent-mode JSON markers ---------- */
// The agent parses these from get_terminal_output to decide what to do.
// Markers are on their own line, prefixed with @@WATCHER: for easy grep.

function agentMarker(type, data) {
  console.log(`@@WATCHER:${JSON.stringify({ type, ts: Date.now(), ...data })}`);
}

/* ---------- Poll ---------- */

async function poll() {
  try {
    const rows = await fetchWorkboard();
    const allTasks = parseTasks(rows);

    const todoItems = allTasks.filter(t =>
      t.stage === 'To Do' || t.stage === 'Backlog'
    );
    const inProgress = allTasks.filter(t => t.stage === 'In Progress');
    const qa = allTasks.filter(t => t.stage === 'QA');
    const done = allTasks.filter(t => t.stage === 'Done');

    if (firstRun) {
      if (AGENT_MODE) {
        agentMarker('STATUS', {
          todo: todoItems.length,
          inProgress: inProgress.length,
          qa: qa.length,
          done: done.length,
          items: sortByPriority(todoItems).map(t => ({
            row: t.row, task: t.task, priority: t.priority,
            project: t.project, label: t.label, desc: t.desc.slice(0, 200),
          })),
        });
      } else {
        console.log(`\n${BOLD}═══════════════════════════════════════════════════════${RESET}`);
        console.log(`${BOLD}  📋 Waymark Workboard Watcher${RESET}`);
        console.log(`${DIM}  Polling every ${intervalSec}s | ${todoItems.length} To Do | ${inProgress.length} In Progress | ${qa.length} QA | ${done.length} Done${RESET}`);
        console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}\n`);

        if (todoItems.length === 0) {
          console.log(`${DIM}[${fmtTime()}]${RESET} ${GREEN}✓ No To Do items — board is clear.${RESET}\n`);
        } else {
          const sorted = sortByPriority(todoItems);
          console.log(`${BOLD}  Pending items:${RESET}`);
          for (const t of sorted) {
            const pc = priorityColor(t.priority);
            console.log(`    ${pc}${t.priority}${RESET} ${BOLD}${t.task}${RESET} ${DIM}(row ${t.row}, ${t.label || 'no label'})${RESET}`);
            if (t.desc) console.log(`         ${DIM}${t.desc.slice(0, 100)}${t.desc.length > 100 ? '…' : ''}${RESET}`);
          }
          console.log();
        }
      }

      firstRun = false;
      // Reset backoff after initial run — agent will process existing items
      if (BACKOFF_MODE) {
        consecutiveIdles = 0;
        currentInterval = BASE_INTERVAL;
      }
      return;
    }

    // Check for ACTIONABLE To Do items — items with stage "To Do" that
    // aren't already claimed by AI. This uses LIVE data every poll,
    // no caching. Backlog items are excluded — only "To Do" is actionable.
    const actionableItems = todoItems.filter(t =>
      t.stage === 'To Do' && t.assignee !== 'AI'
    );

    if (actionableItems.length === 0) {
      if (AGENT_MODE) {
        if (BACKOFF_MODE) {
          consecutiveIdles++;
          currentInterval = Math.min(BASE_INTERVAL * Math.pow(2, consecutiveIdles), MAX_INTERVAL);
        }
        agentMarker('IDLE', {
          todo: todoItems.length,
          consecutiveIdles,
          nextInterval: BACKOFF_MODE ? currentInterval : intervalSec,
        });
      } else {
        process.stdout.write(`${DIM}.${RESET}`);
      }
      if (BACKOFF_MODE) reschedule();
      return;
    }

    // ACTIONABLE WORK FOUND — reset backoff
    if (BACKOFF_MODE) {
      consecutiveIdles = 0;
      currentInterval = BASE_INTERVAL;
    }
    const sorted = sortByPriority(actionableItems);

    if (AGENT_MODE) {
      agentMarker('NEW_WORK', {
        items: sorted.map(t => ({
          row: t.row, task: t.task, priority: t.priority,
          project: t.project, label: t.label, desc: t.desc.slice(0, 200),
        })),
        intervalReset: BACKOFF_MODE,
        nextInterval: BASE_INTERVAL,
      });
    } else {
      console.log(`\n\x07`); // terminal bell
      console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
      console.log(`${BOLD}  🆕 ACTIONABLE WORK — ${fmtTime()}${RESET}`);
      console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
      for (const t of sorted) {
        const pc = priorityColor(t.priority);
        console.log(`  ${pc}${t.priority}${RESET} ${BOLD}${t.task}${RESET}`);
        console.log(`    ${DIM}Row ${t.row} | ${t.project || 'No project'} | ${t.label || 'no label'}${RESET}`);
        if (t.desc) console.log(`    ${DIM}${t.desc.slice(0, 120)}${t.desc.length > 120 ? '…' : ''}${RESET}`);
      }
      console.log();
    }

  } catch (err) {
    if (AGENT_MODE) {
      agentMarker('ERROR', { message: err.message });
    } else {
      console.error(`\n${DIM}[${fmtTime()}]${RESET} \x1b[31m✗ Poll failed: ${err.message}${RESET}`);
    }
  }
}

/* ---------- Reschedule (backoff mode) ---------- */
// Clears the existing timer and sets a new one with the current interval.
function reschedule() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setTimeout(async () => {
    await poll();
    // If not in backoff mode, setInterval handles repeats.
    // In backoff mode, poll() calls reschedule() on each cycle.
    if (!BACKOFF_MODE) {
      pollTimer = setInterval(poll, intervalSec * 1000);
    }
  }, currentInterval * 1000);
}

/* ---------- Main ---------- */

if (AGENT_MODE) {
  agentMarker('STARTED', {
    interval: intervalSec,
    backoff: BACKOFF_MODE,
    maxInterval: BACKOFF_MODE ? MAX_INTERVAL : intervalSec,
  });
} else {
  console.log(`${DIM}Starting workboard watcher (interval: ${intervalSec}s${BACKOFF_MODE ? ', backoff enabled' : ''})…${RESET}`);
}

poll().then(() => {
  if (BACKOFF_MODE) {
    // In backoff mode, use dynamic scheduling via reschedule()
    reschedule();
  } else {
    // Fixed interval mode
    pollTimer = setInterval(poll, intervalSec * 1000);
  }
});

/* Graceful shutdown */
process.on('SIGINT', () => {
  if (!AGENT_MODE) console.log(`\n${DIM}Watcher stopped.${RESET}`);
  process.exit(0);
});

