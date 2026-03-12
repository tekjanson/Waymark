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
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/watch-workboard.js --interval 30

   ============================================================ */

const SPREADSHEET_ID = '1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4';
const RANGE          = 'Sheet1!A1:I500';
const SHEETS_BASE    = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- Parse args ---------- */

const args = process.argv.slice(2);
let intervalSec = 60;
const idxInterval = args.indexOf('--interval');
if (idxInterval !== -1 && args[idxInterval + 1]) {
  intervalSec = Math.max(10, parseInt(args[idxInterval + 1], 10) || 60);
}
const AGENT_MODE = args.includes('--agent');

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

let knownTodoIds = new Set();  // track row numbers we've already announced
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
    const done = allTasks.filter(t => t.stage === 'Done');

    if (firstRun) {
      if (AGENT_MODE) {
        agentMarker('STATUS', {
          todo: todoItems.length,
          inProgress: inProgress.length,
          done: done.length,
          items: sortByPriority(todoItems).map(t => ({
            row: t.row, task: t.task, priority: t.priority,
            project: t.project, label: t.label, desc: t.desc.slice(0, 200),
          })),
        });
      } else {
        console.log(`\n${BOLD}═══════════════════════════════════════════════════════${RESET}`);
        console.log(`${BOLD}  📋 Waymark Workboard Watcher${RESET}`);
        console.log(`${DIM}  Polling every ${intervalSec}s | ${todoItems.length} To Do | ${inProgress.length} In Progress | ${done.length} Done${RESET}`);
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

      todoItems.forEach(t => knownTodoIds.add(t.row));
      firstRun = false;
      return;
    }

    // Check for NEW To Do items we haven't seen before
    const currentTodoRows = new Set(todoItems.map(t => t.row));
    const newItems = todoItems.filter(t => !knownTodoIds.has(t.row));

    // Clean up items no longer in To Do (completed or moved)
    for (const id of knownTodoIds) {
      if (!currentTodoRows.has(id)) knownTodoIds.delete(id);
    }

    if (newItems.length === 0) {
      if (AGENT_MODE) {
        agentMarker('IDLE', { todo: todoItems.length });
      } else {
        process.stdout.write(`${DIM}.${RESET}`);
      }
      return;
    }

    // NEW WORK FOUND
    const sorted = sortByPriority(newItems);

    if (AGENT_MODE) {
      agentMarker('NEW_WORK', {
        items: sorted.map(t => ({
          row: t.row, task: t.task, priority: t.priority,
          project: t.project, label: t.label, desc: t.desc.slice(0, 200),
        })),
      });
    } else {
      console.log(`\n\x07`); // terminal bell
      console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
      console.log(`${BOLD}  🆕 NEW WORK DETECTED — ${fmtTime()}${RESET}`);
      console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
      for (const t of sorted) {
        const pc = priorityColor(t.priority);
        console.log(`  ${pc}${t.priority}${RESET} ${BOLD}${t.task}${RESET}`);
        console.log(`    ${DIM}Row ${t.row} | ${t.project || 'No project'} | ${t.label || 'no label'}${RESET}`);
        if (t.desc) console.log(`    ${DIM}${t.desc.slice(0, 120)}${t.desc.length > 120 ? '…' : ''}${RESET}`);
      }
      console.log();
    }

    sorted.forEach(t => knownTodoIds.add(t.row));

  } catch (err) {
    if (AGENT_MODE) {
      agentMarker('ERROR', { message: err.message });
    } else {
      console.error(`\n${DIM}[${fmtTime()}]${RESET} \x1b[31m✗ Poll failed: ${err.message}${RESET}`);
    }
  }
}

/* ---------- Main ---------- */

if (AGENT_MODE) {
  agentMarker('STARTED', { interval: intervalSec });
} else {
  console.log(`${DIM}Starting workboard watcher (interval: ${intervalSec}s)…${RESET}`);
}

poll().then(() => {
  setInterval(poll, intervalSec * 1000);
});

/* Graceful shutdown */
process.on('SIGINT', () => {
  if (!AGENT_MODE) console.log(`\n${DIM}Watcher stopped.${RESET}`);
  process.exit(0);
});

