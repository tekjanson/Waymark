#!/usr/bin/env bash
# write-agent-sheet.sh — Write heartbeat / status / task back to the Agent Registry sheet.
#
# Called by agent-runner.sh to keep the Google Sheet in sync with the live agent state.
# Uses the Service Account JSON key to authenticate with the Sheets API via curl + openssl,
# so no extra Node packages or gcloud are required.
#
# Usage:
#   /scripts/write-agent-sheet.sh --heartbeat
#   /scripts/write-agent-sheet.sh --status Online
#   /scripts/write-agent-sheet.sh --status Busy --task "Working on issue #42"
#   /scripts/write-agent-sheet.sh --status Idle  --task "" --heartbeat
#
# Required env:
#   AGENTS_SHEET_ID          — Google Sheet ID of the Agent Registry
#   AGENT_HUMAN_NAME         — This agent's display name (matches Name column)
#   GOOGLE_APPLICATION_CREDENTIALS — Path to SA JSON key (default: /credentials/gsa-key.json)
#
# All present in dev-worker container: curl, jq, openssl, base64

set -uo pipefail

SA_KEY="${GOOGLE_APPLICATION_CREDENTIALS:-/credentials/gsa-key.json}"
SHEET_ID="${AGENTS_SHEET_ID:-}"
AGENT_NAME="${AGENT_HUMAN_NAME:-}"
SHEET_TAB="Sheet1"

log() { echo "[write-agent-sheet $(date +%T)] $*" >&2; }

# ── Guard: skip gracefully if not configured ──────────────────────────────────
if [[ -z "$SHEET_ID" ]]; then  log "AGENTS_SHEET_ID not set — skip"; exit 0; fi
if [[ -z "$AGENT_NAME" ]]; then log "AGENT_HUMAN_NAME not set — skip"; exit 0; fi
if [[ ! -f "$SA_KEY" ]];  then log "SA key not found at $SA_KEY — skip"; exit 0; fi

# ── Build Google API access token via Service Account JWT ─────────────────────
CLIENT_EMAIL=$(jq -r .client_email "$SA_KEY")
PRIVATE_KEY=$(jq -r .private_key "$SA_KEY")
NOW=$(date +%s)
EXP=$((NOW + 3600))

b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }

HDR=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
PAY=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/spreadsheets","aud":"https://oauth2.googleapis.com/token","exp":%d,"iat":%d}' \
    "$CLIENT_EMAIL" "$EXP" "$NOW" | b64url)

TMP_KEY=$(mktemp)
printf '%s' "$PRIVATE_KEY" > "$TMP_KEY"
SIG=$(printf '%s' "${HDR}.${PAY}" | openssl dgst -sha256 -sign "$TMP_KEY" -binary | b64url)
rm -f "$TMP_KEY"

JWT="${HDR}.${PAY}.${SIG}"

TOKEN_JSON=$(curl -s -X POST https://oauth2.googleapis.com/token \
    --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
    --data-urlencode "assertion=${JWT}")
ACCESS_TOKEN=$(printf '%s' "$TOKEN_JSON" | jq -r '.access_token // empty')

if [[ -z "$ACCESS_TOKEN" ]]; then
    log "Failed to get access token: $(printf '%s' "$TOKEN_JSON" | jq -r '.error_description // .error // "unknown"')"
    exit 1
fi

# ── Discover column positions from header row ─────────────────────────────────
HEADERS_JSON=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_TAB}!1:1")

# Returns 0-based column index for a lowercased header name, or -1 if not found.
col_idx() {
    printf '%s' "$HEADERS_JSON" | jq -r --arg h "$1" \
        '([(.values[0] // []) | .[] | ascii_downcase] | index($h)) // -1'
}

# Convert 0-based column index to sheet column letter (A–Z only; 26 cols max)
col_letter() {
    local idx=$1
    printf "\\x$(printf '%02x' $((65 + idx)))"
}

NAME_IDX=$(col_idx "name")
STATUS_IDX=$(col_idx "status")
TASK_IDX=$(col_idx "task")
HEARTBEAT_IDX=$(col_idx "heartbeat")

if [[ "$NAME_IDX" == "-1" ]]; then
    log "No 'name' column found in sheet — wrong sheet or wrong tab?"; exit 1; fi

# ── Find agent's row number in the sheet ─────────────────────────────────────
NAME_COL=$(col_letter "$NAME_IDX")
NAME_COL_DATA=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_TAB}!${NAME_COL}:${NAME_COL}")

# values[0] = header row; values[1] = row 2; values[N] = row N+1
VALUES_IDX=$(printf '%s' "$NAME_COL_DATA" | jq -r --arg name "$AGENT_NAME" \
    '(.values // []) | to_entries | map(select(.value[0] == $name)) | .[0].key // -1')

if [[ "$VALUES_IDX" == "-1" ]]; then
    log "Agent '$AGENT_NAME' not found in sheet column '${NAME_COL}' — check AGENT_HUMAN_NAME"
    exit 0
fi

# Sheet row number (1-based): jq key 0 → sheet row 1 (header), key 1 → sheet row 2, etc.
SHEET_ROW=$((VALUES_IDX + 1))
log "Agent '${AGENT_NAME}' at sheet row ${SHEET_ROW}"

# ── Single-cell update via Sheets API ────────────────────────────────────────
update_cell() {
    local idx="$1"
    local value="$2"
    [[ "$idx" == "-1" ]] && return   # column not present in this sheet
    local letter=$(col_letter "$idx")
    local range="${SHEET_TAB}!${letter}${SHEET_ROW}"
    local escaped=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')
    curl -s -X PUT \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"range\":\"${range}\",\"majorDimension\":\"ROWS\",\"values\":[[\"${escaped}\"]]}" \
        "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=RAW" \
        -o /dev/null
}

# ── Parse arguments and apply writes ─────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --heartbeat)
            TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            update_cell "$HEARTBEAT_IDX" "$TS"
            log "Heartbeat → $TS"
            shift ;;
        --status)
            update_cell "$STATUS_IDX" "$2"
            log "Status → $2"
            shift 2 ;;
        --task)
            update_cell "$TASK_IDX" "$2"
            log "Task → ${2:0:80}"
            shift 2 ;;
        *)
            shift ;;
    esac
done
