#!/usr/bin/env bash
# on-stop.sh — Called when Claude Code session ends (Stop hook).
# Marks agent as Idle in the registry sheet.

AGENT="${AGENT_HUMAN_NAME:-dev-worker}"
CREDS="${GOOGLE_APPLICATION_CREDENTIALS:-/credentials/gsa-key.json}"
SHEET_ID="${AGENTS_SHEET_ID:-}"

[[ -z "$SHEET_ID" ]] && exit 0
[[ ! -f "$CREDS" ]] && exit 0

echo "[on-stop] Session ended for ${AGENT} — marking Idle"
