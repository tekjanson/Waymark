#!/usr/bin/env bash
# ============================================================
# run-waymark.sh — Local Bare-Metal Waymark Web App Launcher
#
# Usage:
#   ./run-waymark.sh                  # Start Waymark web server (default PORT=3000)
#   ./run-waymark.sh --with-wayside   # Start Waymark web server + Wayside AI Orchestrator
#   PORT=3005 ./run-waymark.sh        # Custom port
# ============================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env if present
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

export PORT="${PORT:-3000}"
export GITHUB_SOURCE_LOCAL="${GITHUB_SOURCE_LOCAL:-true}"
export AGY_MODEL="${AGY_MODEL:-gemini-3.8-flash-high}"

# Ensure local browser login redirects back to this machine rather than a remote production URL in .env
LOCAL_HOST="${HOST:-localhost}"
if [ "${KEEP_REMOTE_REDIRECT_URI:-0}" != "1" ]; then
  if [ -n "${GOOGLE_REDIRECT_URI:-}" ] && [[ "${GOOGLE_REDIRECT_URI}" != *"://localhost"* ]] && [[ "${GOOGLE_REDIRECT_URI}" != *"://127."* ]]; then
    export GOOGLE_REDIRECT_URI="http://${LOCAL_HOST}:${PORT}${BASE_PATH:-}/auth/callback"
  fi
  if [[ "${GOOGLE_REDIRECT_URI:-http://${LOCAL_HOST}}" == http://* ]]; then
    export NODE_ENV="development"
  fi
fi

WITH_WAYSIDE="${WITH_WAYSIDE:-0}"
LEDGER_ID="${WAYSIDE_LEDGER_ID:-${WAYMARK_SHEET_ID:-}}"

for arg in "$@"; do
  case "$arg" in
    --with-wayside|-w)
      WITH_WAYSIDE="1"
      ;;
    --sheet=*)
      LEDGER_ID="${arg#*=}"
      ;;
  esac
done

WAYSIDE_PID=""
cleanup() {
  if [ -n "$WAYSIDE_PID" ] && kill -0 "$WAYSIDE_PID" 2>/dev/null; then
    echo "Stopping Wayside Orchestrator (PID $WAYSIDE_PID)..."
    kill "$WAYSIDE_PID" 2>/dev/null || true
    wait "$WAYSIDE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ "$WITH_WAYSIDE" = "1" ]; then
  echo "Starting Wayside AGY Orchestrator in background..."
  if [ -n "$LEDGER_ID" ]; then
    node scripts/wayside-orchestrator.mjs --sheet "$LEDGER_ID" &
  else
    node scripts/wayside-orchestrator.mjs &
  fi
  WAYSIDE_PID=$!
fi

echo "Starting Waymark local server at http://localhost:${PORT} (GITHUB_SOURCE_LOCAL=${GITHUB_SOURCE_LOCAL})..."
node server/index.js
