#!/usr/bin/env bash
# post-bash.sh — Called after every Bash tool use in Claude Code.
# Heartbeat updates are burst-throttled to avoid write-rate spikes.
# Failures are silently ignored (called with `|| true`).

SHEET_ID="${AGENTS_SHEET_ID:-}"
AGENT="${AGENT_HUMAN_NAME:-dev-worker}"
CREDS="${GOOGLE_APPLICATION_CREDENTIALS:-/credentials/gsa-key.json}"

# Only run if we have a sheet ID and credentials
[[ -z "$SHEET_ID" ]] && exit 0
[[ ! -f "$CREDS" ]] && exit 0

# Burst throttle (seconds) between heartbeat writes; default 5 minutes.
HEARTBEAT_INTERVAL="${AGENT_HEARTBEAT_INTERVAL_SEC:-300}"
STAMP_FILE="/tmp/waymark-heartbeat-${AGENT}.stamp"
NOW="$(date +%s)"
LAST=0
if [[ -f "$STAMP_FILE" ]]; then
    LAST="$(cat "$STAMP_FILE" 2>/dev/null || echo 0)"
fi
DELTA=$((NOW - LAST))
[[ "$DELTA" -lt "$HEARTBEAT_INTERVAL" ]] && exit 0

# Update heartbeat timestamp via the workboard script if available
if [[ -f /workspace/scripts/update-workboard.js ]]; then
    GOOGLE_APPLICATION_CREDENTIALS="$CREDS" \
        node /workspace/scripts/update-workboard.js \
        --agent "$AGENT" \
        --heartbeat "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        2>/dev/null || true
    echo "$NOW" > "$STAMP_FILE" 2>/dev/null || true
fi
