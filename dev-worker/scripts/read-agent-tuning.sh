#!/usr/bin/env bash
# read-agent-tuning.sh — Fetch this agent's tuning string from the Agent Registry sheet.
#
# The Agent Registry is a Waymark sheet where the operator controls each agent's
# personality, model, and behavior. This script reads it on boot so the agent
# starts every session with the right tuning string prepended to its prompt.
#
# Usage:
#   source <(bash /scripts/read-agent-tuning.sh)   # exports AGENT_TUNING to caller
#   bash /scripts/read-agent-tuning.sh             # prints export statements
#
# Required env:
#   AGENT_HUMAN_NAME              — human name of this agent (Alex, Sam, Jordan…)
#   AGENTS_SHEET_ID               — Google Sheets ID of the Agent Registry sheet
#   GOOGLE_APPLICATION_CREDENTIALS — path to service account key
#
# Outputs (exported):
#   AGENT_TUNING    — the tuning string from the sheet (or empty if not found)
#   AGENT_MODEL     — model override from sheet (if set, replaces env AGENT_MODEL)
#   AGENT_PROVIDER  — provider override from sheet (if set, replaces env AI_PROVIDER)

set -uo pipefail

HUMAN_NAME="${AGENT_HUMAN_NAME:-}"
SHEET_ID="${AGENTS_SHEET_ID:-}"
SA_KEY="${GOOGLE_APPLICATION_CREDENTIALS:-/root/.config/gcloud/waymark-service-account-key.json}"

log() { echo "[read-agent-tuning $(date +%T)] $*" >&2; }

# Nothing to do if no name or no sheet configured
if [[ -z "$HUMAN_NAME" || -z "$SHEET_ID" ]]; then
    log "AGENT_HUMAN_NAME='${HUMAN_NAME}' AGENTS_SHEET_ID='${SHEET_ID}' — skipping tuning read"
    echo "export AGENT_TUNING=''"
    exit 0
fi

if [[ ! -f "$SA_KEY" ]]; then
    log "SA key not found at ${SA_KEY} — skipping tuning read"
    echo "export AGENT_TUNING=''"
    exit 0
fi

log "Reading tuning for agent '${HUMAN_NAME}' from sheet ${SHEET_ID}..."

# Read the sheet via a small inline Node.js script.
# We use the same Google Sheets REST API pattern as the Waymark app.
RESULT=$(node --input-type=module <<'EOF'
import { GoogleAuth } from 'google-auth-library';

const sheetId   = process.env.AGENTS_SHEET_ID;
const agentName = process.env.AGENT_HUMAN_NAME;
const keyFile   = process.env.GOOGLE_APPLICATION_CREDENTIALS;

async function main() {
  // Authenticate
  const auth = new GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  // Fetch the first sheet (all data)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:Z`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    process.stderr.write(`Sheets API error: ${res.status} ${await res.text()}\n`);
    process.exit(1);
  }

  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) {
    process.stderr.write('Sheet is empty or has no data rows\n');
    process.exit(0);
  }

  const headers = rows[0].map(h => h.toLowerCase().trim());
  const nameIdx      = headers.findIndex(h => /^(name|agent|worker)$/.test(h));
  const tuningIdx    = headers.findIndex(h => /^(tuning|personality|prompt|system prompt|flavor)/.test(h));
  const modelIdx     = headers.findIndex(h => /^(model|ai model)/.test(h));
  const providerIdx  = headers.findIndex(h => /^(provider|engine|backend)/.test(h));
  const statusIdx    = headers.findIndex(h => /^(status|state)/.test(h));
  const heartbeatIdx  = headers.findIndex(h => /^(heartbeat|last seen|ping)/.test(h));
  const workboardIdx  = headers.findIndex(h => /^(workboard|sheet id|board id|target)/.test(h));
  const commandIdx    = headers.findIndex(h => /^(command|cmd|initial command|start command)/.test(h));

  if (nameIdx === -1) {
    process.stderr.write('No Name column found in Agent Registry sheet\n');
    process.exit(1);
  }

  // Find this agent's row
  const row = rows.slice(1).find(r => {
    const n = (r[nameIdx] || '').trim().toLowerCase();
    return n === agentName.toLowerCase();
  });

  if (!row) {
    process.stderr.write(`Agent '${agentName}' not found in registry — using defaults\n`);
    // Output empty values so the agent still boots
    console.log(JSON.stringify({ tuning: '', model: '', provider: '', status: '' }));
    return;
  }

  const result = {
    tuning:    (tuningIdx    !== -1 ? row[tuningIdx]    : '') || '',
    model:     (modelIdx     !== -1 ? row[modelIdx]     : '') || '',
    provider:  (providerIdx  !== -1 ? row[providerIdx]  : '') || '',
    status:    (statusIdx    !== -1 ? row[statusIdx]    : '') || '',
    heartbeat: (heartbeatIdx !== -1 ? row[heartbeatIdx] : '') || '',
    workboard: (workboardIdx !== -1 ? row[workboardIdx] : '') || '',
    command:   (commandIdx   !== -1 ? row[commandIdx]   : '') || '',
  };

  process.stderr.write(`Found agent '${agentName}': status=${result.status}, model=${result.model}, tuning=${result.tuning.substring(0,60)}...\n`);
  console.log(JSON.stringify(result));
}

main().catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
EOF
2>/dev/null) || {
    log "Failed to read agent registry — using empty tuning"
    echo "export AGENT_TUNING=''"
    exit 0
}

# Parse the JSON result and emit export statements
TUNING=$(echo "$RESULT"     | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.tuning||'')"     2>/dev/null || echo "")
MODEL=$(echo "$RESULT"      | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.model||'')"      2>/dev/null || echo "")
PROVIDER=$(echo "$RESULT"   | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.provider||'')"   2>/dev/null || echo "")
WORKBOARD=$(echo "$RESULT"  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.workboard||'')"  2>/dev/null || echo "")
COMMAND=$(echo "$RESULT"    | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.command||'')"    2>/dev/null || echo "")

if [[ -n "$TUNING" ]]; then
    log "Tuning loaded: ${TUNING:0:80}..."
else
    log "No tuning string found for '${HUMAN_NAME}'"
fi

# Emit export statements (caller does: source <(bash read-agent-tuning.sh))
printf "export AGENT_TUNING=%q\n" "$TUNING"
[[ -n "$MODEL"     ]] && printf "export AGENT_MODEL=%q\n"             "$MODEL"
[[ -n "$PROVIDER"  ]] && printf "export AI_PROVIDER=%q\n"             "$PROVIDER"
[[ -n "$WORKBOARD" ]] && printf "export WAYMARK_WORKBOARD_ID=%q\n"    "$WORKBOARD"
[[ -n "$COMMAND"   ]] && printf "export AGENT_COMMAND=%q\n"           "$COMMAND"
