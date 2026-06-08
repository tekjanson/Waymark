#!/usr/bin/env bash
# read-agent-tuning.sh — Fetch this agent's tuning string from the Agent Registry sheet.
#
# Uses pure bash + curl + openssl + jq (no Node.js google-auth-library).
# Same JWT pattern as write-agent-sheet.sh.
#
# Usage:
#   source <(bash /scripts/read-agent-tuning.sh)   # exports vars to caller
#   bash /scripts/read-agent-tuning.sh             # prints export statements
#
# Required env:
#   AGENT_HUMAN_NAME              — human name of this agent (Alex, Sam, Jordan…)
#   AGENTS_SHEET_ID               — Google Sheets ID of the Agent Registry sheet
#   GOOGLE_APPLICATION_CREDENTIALS — path to service account key
#
# Outputs (exported):
#   AGENT_TUNING          — tuning string from sheet (or empty)
#   AGENT_MODEL           — model override from sheet (if set)
#   AI_PROVIDER           — provider override from sheet (if set)
#   WAYMARK_WORKBOARD_ID  — workboard Sheet ID from sheet (if set)
#   AGENT_COMMAND         — start command from sheet (if set)

set -uo pipefail

HUMAN_NAME="${AGENT_HUMAN_NAME:-}"
SHEET_ID="${AGENTS_SHEET_ID:-}"
SA_KEY="${GOOGLE_APPLICATION_CREDENTIALS:-/credentials/gsa-key.json}"

log() { echo "[read-agent-tuning $(date +%T)] $*" >&2; }

# ── Guards ────────────────────────────────────────────────────────────────────
if [[ -z "$HUMAN_NAME" || -z "$SHEET_ID" ]]; then
    log "AGENT_HUMAN_NAME or AGENTS_SHEET_ID not set — skipping"
    echo "export AGENT_TUNING=''"
    exit 0
fi

if [[ ! -f "$SA_KEY" ]]; then
    log "SA key not found at ${SA_KEY} — skipping"
    echo "export AGENT_TUNING=''"
    exit 0
fi

log "Reading tuning for agent '${HUMAN_NAME}' from sheet ${SHEET_ID}..."

# ── Build SA JWT and get access token ────────────────────────────────────────
b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }

CLIENT_EMAIL=$(jq -r .client_email "$SA_KEY")
PRIVATE_KEY=$(jq -r .private_key "$SA_KEY")
NOW=$(date +%s)
EXP=$((NOW + 3600))

HDR=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
PAY=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/spreadsheets.readonly","aud":"https://oauth2.googleapis.com/token","exp":%d,"iat":%d}' \
    "$CLIENT_EMAIL" "$EXP" "$NOW" | b64url)
SIG=$(printf '%s.%s' "$HDR" "$PAY" | \
    openssl dgst -sha256 -sign <(printf '%s' "$PRIVATE_KEY") | b64url)

TOKEN_RESP=$(curl -sf -X POST https://oauth2.googleapis.com/token \
    -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${HDR}.${PAY}.${SIG}" 2>/dev/null)
TOKEN=$(printf '%s' "$TOKEN_RESP" | jq -r '.access_token // empty' 2>/dev/null)

if [[ -z "$TOKEN" ]]; then
    log "Failed to get access token — skipping"
    echo "export AGENT_TUNING=''"
    exit 0
fi

# ── Fetch sheet data ──────────────────────────────────────────────────────────
SHEET_DATA=$(curl -sf \
    -H "Authorization: Bearer $TOKEN" \
    "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1" 2>/dev/null)

if [[ -z "$SHEET_DATA" ]]; then
    log "Empty response from Sheets API — skipping"
    echo "export AGENT_TUNING=''"
    exit 0
fi

# ── Parse headers and find this agent's row using jq ─────────────────────────
RESULT=$(printf '%s' "$SHEET_DATA" | jq -r \
    --arg name "$HUMAN_NAME" '
    .values as $rows |
    if ($rows | length) < 2 then error("empty sheet") else . end |
    ($rows[0] | map(ascii_downcase | ltrimstr(" ") | rtrimstr(" "))) as $h |
    ($h | index("name") // ($h | index("agent")) // 0)                      as $ni |
    ($h | map(test("^(tuning|personality|prompt)")) | index(true) // -1)    as $ti |
    ($h | map(test("^(model|ai model)"))            | index(true) // -1)    as $mi |
    ($h | map(test("^(provider|engine|backend)"))   | index(true) // -1)    as $pi |
    ($h | map(test("^(workboard|sheet id|board)"))  | index(true) // -1)    as $wi |
    ($h | map(test("^(command|cmd|start command)")) | index(true) // -1)    as $ci |
    ($rows[1:] | map(select(.[($ni)] != null and (.[($ni)] | ascii_downcase) == ($name | ascii_downcase))) | first) as $row |
    if $row == null then {tuning:"",model:"",provider:"",workboard:"",command:""}
    else {
      tuning:    (if $ti >= 0 then ($row[$ti] // "") else "" end),
      model:     (if $mi >= 0 then ($row[$mi] // "") else "" end),
      provider:  (if $pi >= 0 then ($row[$pi] // "") else "" end),
      workboard: (if $wi >= 0 then ($row[$wi] // "") else "" end),
      command:   (if $ci >= 0 then ($row[$ci] // "") else "" end)
    }
    end
' 2>/dev/null)

if [[ -z "$RESULT" ]]; then
    log "Failed to parse sheet data — skipping"
    echo "export AGENT_TUNING=''"
    exit 0
fi

# ── Extract fields ────────────────────────────────────────────────────────────
TUNING=$(printf '%s' "$RESULT"    | jq -r '.tuning    // ""')
MODEL=$(printf '%s' "$RESULT"     | jq -r '.model     // ""')
PROVIDER=$(printf '%s' "$RESULT"  | jq -r '.provider  // ""')
WORKBOARD=$(printf '%s' "$RESULT" | jq -r '.workboard // ""')
COMMAND=$(printf '%s' "$RESULT"   | jq -r '.command   // ""')

if [[ -n "$TUNING" ]]; then
    log "Tuning loaded: ${TUNING:0:80}..."
else
    log "No tuning string found for '${HUMAN_NAME}'"
fi
[[ -n "$WORKBOARD" ]] && log "Workboard: $WORKBOARD"
[[ -n "$COMMAND"   ]] && log "Command:   $COMMAND"

# ── Emit export statements ────────────────────────────────────────────────────
printf "export AGENT_TUNING=%q\n" "$TUNING"
[[ -n "$MODEL"     ]] && printf "export AGENT_MODEL=%q\n"            "$MODEL"
[[ -n "$PROVIDER"  ]] && printf "export AI_PROVIDER=%q\n"            "$PROVIDER"
[[ -n "$WORKBOARD" ]] && printf "export WAYMARK_WORKBOARD_ID=%q\n"   "$WORKBOARD"
[[ -n "$COMMAND"   ]] && printf "export AGENT_COMMAND=%q\n"          "$COMMAND"
