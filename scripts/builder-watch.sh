#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# builder-watch.sh — Keepalive workboard watcher runner
# ============================================================
# Runs scripts/watch-workboard.js in agent mode and keeps it alive
# as a background process, writing output to a log file.
#
# This does NOT implement tasks by itself; it exists to keep a
# live, zero-token view of NEW_WORK markers even if a chat-based
# agent run stops.
#
# Usage:
#   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json ./scripts/builder-watch.sh start
#   ./scripts/builder-watch.sh status
#   ./scripts/builder-watch.sh stop
#   ./scripts/builder-watch.sh tail
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.waymark-builder-watch.pid"
LOG_FILE="$ROOT_DIR/.waymark-builder-watch.log"

cmd="${1:-}"

require_creds() {
  if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    echo "ERROR: GOOGLE_APPLICATION_CREDENTIALS is not set." >&2
    echo "Example:" >&2
    echo "  GOOGLE_APPLICATION_CREDENTIALS=/home/tekjanson/.config/gcloud/waymark-service-account-key.json ./scripts/builder-watch.sh start" >&2
    exit 1
  fi
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

start() {
  require_creds
  if is_running; then
    echo "Watcher already running (pid $(cat "$PID_FILE"))."
    exit 0
  fi

  cd "$ROOT_DIR"
  : > "$LOG_FILE"

  # Run in background, detach from terminal.
  # shellcheck disable=SC2091
  nohup node scripts/watch-workboard.js --agent --backoff --interval 60 >>"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "Watcher started (pid $!). Log: $LOG_FILE"
}

status() {
  if is_running; then
    echo "Watcher running (pid $(cat "$PID_FILE")). Log: $LOG_FILE"
  else
    echo "Watcher not running."
    exit 1
  fi
}

stop() {
  if ! is_running; then
    echo "Watcher not running."
    rm -f "$PID_FILE" 2>/dev/null || true
    exit 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  rm -f "$PID_FILE" 2>/dev/null || true
  echo "Watcher stopped (pid $pid)."
}

tail_log() {
  cd "$ROOT_DIR"
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "No log file yet: $LOG_FILE"
    exit 1
  fi
  tail -n 200 -f "$LOG_FILE"
}

case "$cmd" in
  start) start ;;
  status) status ;;
  stop) stop ;;
  tail) tail_log ;;
  *)
    echo "Usage: $0 {start|status|stop|tail}" >&2
    exit 2
    ;;
esac
