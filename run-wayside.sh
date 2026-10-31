#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LEDGER_ID="${1:-${WAYSIDE_LEDGER_ID:-$WAYMARK_SHEET_ID}}"
if [ -z "$LEDGER_ID" ]; then
  echo "Usage: ./run-wayside.sh <ledgerSpreadsheetId>"
  echo "   or: WAYSIDE_LEDGER_ID=<id> ./run-wayside.sh"
  exit 1
fi

export AGY_MODEL="${AGY_MODEL:-gemini-3.8-flash-high}"
exec node scripts/wayside-orchestrator.mjs --sheet "$LEDGER_ID"
