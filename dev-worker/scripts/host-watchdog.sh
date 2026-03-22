#!/usr/bin/env bash
# ============================================================
# host-watchdog.sh — External watchdog for agent containers
# ============================================================
# Runs on the HOST machine (not inside the container). Reads the
# Heartbeat sheet tab via check-heartbeat.js and restarts any
# container whose agent hasn't checked in within STALE_MINUTES.
#
# Designed to run as a cron job or standalone loop. Two modes:
#
#   1. Cron mode (default, no flags):
#      Runs once, checks all agents, restarts stale ones, exits.
#      Add to crontab:  */5 * * * * /path/to/host-watchdog.sh
#
#   2. Loop mode (--loop):
#      Runs forever, checking every CHECK_INTERVAL seconds.
#      Useful for docker-compose or systemd deployment.
#
# Environment:
#   GOOGLE_APPLICATION_CREDENTIALS  Path to service account key
#   STALE_MINUTES                   Threshold (default: 30)
#   CHECK_INTERVAL                  Loop mode interval in seconds (default: 300)
#   WAYMARK_DIR                     Path to Waymark repo (default: script's grandparent)
#   DRY_RUN                         Set to "1" to log but not restart
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAYMARK_DIR="${WAYMARK_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
STALE_MINUTES="${STALE_MINUTES:-30}"
CHECK_INTERVAL="${CHECK_INTERVAL:-300}"
DRY_RUN="${DRY_RUN:-0}"
LOOP_MODE=false

for arg in "$@"; do
  case "$arg" in
    --loop) LOOP_MODE=true ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [host-watchdog] $*"; }

check_and_restart() {
  log "Checking agent heartbeats (stale threshold: ${STALE_MINUTES}m)..."

  local output
  output=$(node "$WAYMARK_DIR/scripts/check-heartbeat.js" --stale-minutes "$STALE_MINUTES" 2>&1) || {
    local exit_code=$?
    if [ "$exit_code" -eq 2 ]; then
      # Exit code 2 means stale agents detected — output is still valid JSON
      :
    else
      log "ERROR: check-heartbeat.js failed (exit $exit_code): $output"
      return 1
    fi
  }

  # Parse JSON output to find stale agents
  local stale_count
  stale_count=$(echo "$output" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const stale = d.agents.filter(a => a.stale);
    stale.forEach(a => console.log(a.container + ' ' + a.name + ' ' + a.age));
    process.exit(0);
  " 2>/dev/null) || {
    log "ERROR: Failed to parse heartbeat JSON"
    return 1
  }

  if [ -z "$stale_count" ]; then
    log "All agents healthy."
    return 0
  fi

  # Restart each stale container
  while IFS=' ' read -r container agent_name age; do
    [ -z "$container" ] && continue
    log "STALE: Agent '$agent_name' last seen ${age}m ago (container: $container)"

    if [ "$DRY_RUN" = "1" ]; then
      log "DRY RUN: Would restart container '$container'"
    else
      if docker ps --format '{{.Names}}' | grep -qx "$container"; then
        log "Restarting container '$container'..."
        docker restart "$container" && \
          log "Container '$container' restarted successfully." || \
          log "ERROR: Failed to restart '$container'"
      else
        log "WARNING: Container '$container' not running. Skipping restart."
      fi
    fi
  done <<< "$stale_count"
}

# ---- Main ----

if [ "$LOOP_MODE" = true ]; then
  log "Starting in loop mode (interval: ${CHECK_INTERVAL}s)"
  while true; do
    check_and_restart || true
    sleep "$CHECK_INTERVAL"
  done
else
  check_and_restart
fi
