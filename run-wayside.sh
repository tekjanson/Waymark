#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

export AGY_MODEL="${AGY_MODEL:-gemini-3.8-flash-high}"

if [ $# -gt 0 ]; then
  if [[ "$1" == -* ]]; then
    exec node scripts/wayside-orchestrator.mjs "$@"
  else
    LEDGER_ID="$1"
    shift
    exec node scripts/wayside-orchestrator.mjs --sheet "$LEDGER_ID" "$@"
  fi
fi

LEDGER_ID="${WAYSIDE_LEDGER_ID:-${WAYMARK_SHEET_ID:-}}"
if [ -n "$LEDGER_ID" ]; then
  exec node scripts/wayside-orchestrator.mjs --sheet "$LEDGER_ID"
else
  exec node scripts/wayside-orchestrator.mjs
fi
