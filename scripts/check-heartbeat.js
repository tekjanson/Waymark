#!/usr/bin/env node
/* ============================================================
   check-heartbeat.js — Read agent heartbeats from the Workboard
   ============================================================
   Reads the "Heartbeat" sheet tab from the Waymark Workboard and
   reports the age (in minutes) of each agent's last heartbeat.

   Designed to be called by the host-side watchdog script to detect
   stale agents that need container restarts.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
       node scripts/check-heartbeat.js [--stale-minutes 30] [--agent <name>]

   Flags:
     --stale-minutes <n>  Threshold in minutes (default: 30)
     --agent <name>       Check only this agent (default: all agents)

   Output (stdout, single line JSON):
     {
       "agents": [
         { "name": "alpha", "age": 5, "status": "working", "container": "waymark-agent-alpha", "stale": false },
         { "name": "beta",  "age": 45, "status": "idle", "container": "waymark-agent-beta", "stale": true }
       ],
       "staleCount": 1,
       "threshold": 30
     }

   Exit codes:
     0 = no stale agents (or no heartbeat tab found)
     2 = at least one agent is stale (past threshold)
     1 = error
   ============================================================ */

const { resolveWorkboardConfig } = require('./workboard-config');

const DEFAULT_SPREADSHEET_ID = '1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4';
const WORKBOARD = resolveWorkboardConfig({
  defaultSpreadsheetId: DEFAULT_SPREADSHEET_ID,
  defaultRange: 'Heartbeat!A:D',
});
const SPREADSHEET_ID = WORKBOARD.spreadsheetId;
const SHEETS_BASE    = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- CLI flags ---------- */

const rawArgs = process.argv.slice(2);

function extractFlag(args, flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

const STALE_MINUTES = parseInt(extractFlag(rawArgs, '--stale-minutes', '30'), 10);
const AGENT_FILTER  = extractFlag(rawArgs, '--agent', null);

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

    // First check if Heartbeat tab exists
    const metaUrl = `${SHEETS_BASE}/${SPREADSHEET_ID}?fields=sheets.properties`;
    const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!metaRes.ok) {
      console.error(`Sheets API ${metaRes.status}: ${await metaRes.text()}`);
      process.exit(1);
    }
    const meta = await metaRes.json();
    const hasHeartbeat = meta.sheets.some(s => s.properties.title === 'Heartbeat');
    if (!hasHeartbeat) {
      // No heartbeat tab yet — no agents have ever reported
      console.log(JSON.stringify({ agents: [], staleCount: 0, threshold: STALE_MINUTES }));
      process.exit(0);
    }

    // Read all heartbeat rows
    const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent('Heartbeat!A:D')}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`Sheets API ${res.status}: ${await res.text()}`);
      process.exit(1);
    }

    const data = await res.json();
    const rows = data.values || [];
    const now = Date.now();

    const agents = [];
    for (let i = 1; i < rows.length; i++) {
      const name      = (rows[i][0] || '').trim();
      const timestamp = (rows[i][1] || '').trim();
      const status    = (rows[i][2] || '').trim();
      const container = (rows[i][3] || '').trim();

      if (!name) continue;
      if (AGENT_FILTER && name !== AGENT_FILTER) continue;

      const ts = new Date(timestamp).getTime();
      const ageMs = isNaN(ts) ? Infinity : now - ts;
      const ageMinutes = Math.round(ageMs / 60000);
      const stale = ageMinutes >= STALE_MINUTES;

      agents.push({ name, age: ageMinutes, status, container, stale });
    }

    const staleCount = agents.filter(a => a.stale).length;

    console.log(JSON.stringify({ agents, staleCount, threshold: STALE_MINUTES }));
    process.exit(staleCount > 0 ? 2 : 0);

  } catch (err) {
    console.error(`check-heartbeat error: ${err.message}`);
    process.exit(1);
  }
})();
