#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LEDGER_ID="${1:-${WAYSIDE_LEDGER_ID:-$WAYMARK_SHEET_ID}}"
export AGY_MODEL="${AGY_MODEL:-gemini-3.8-flash-high}"

if [ -n "$LEDGER_ID" ]; then
  exec node scripts/wayside-orchestrator.mjs --sheet "$LEDGER_ID"
else
  exec node scripts/wayside-orchestrator.mjs
fi
