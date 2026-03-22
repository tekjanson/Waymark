#!/usr/bin/env bash
# ============================================================
# host-watchdog.sh — External watchdog for agent containers
# ============================================================
# Runs on the HOST machine (not inside the container). Reads the
# Heartbeat sheet tab via check-heartbeat.js and restarts any
# container whose agent hasn't checked in within STALE_MINUTES.
#
# Reliability features:
#   - Post-restart cooldown: Skips a container for COOLDOWN_MINUTES
#     after a restart, giving it time to boot and send a heartbeat.
#   - Container dedup: Multiple heartbeat rows pointing to the same
#     container only trigger one restart per cycle.
#   - Circuit breaker: After MAX_RESTARTS restarts of the same
#     container within CIRCUIT_WINDOW_MINUTES, stops restarting
#     and logs an alert.
#
# Designed to run as a cron job or standalone loop. Two modes:
#
#   1. Cron mode (default, no flags):
#      Runs once, checks all agents, restarts stale ones, exits.
#
#   2. Loop mode (--loop):
#      Runs forever, checking every CHECK_INTERVAL seconds.
#
# Environment:
#   GOOGLE_APPLICATION_CREDENTIALS  Path to service account key
#   STALE_MINUTES                   Threshold (default: 30)
#   CHECK_INTERVAL                  Loop mode interval in seconds (default: 300)
#   COOLDOWN_MINUTES                Post-restart grace period (default: 15)
#   MAX_RESTARTS                    Circuit breaker limit (default: 3)
#   CIRCUIT_WINDOW_MINUTES          Circuit breaker window (default: 60)
#   WAYMARK_DIR                     Path to Waymark repo (default: script's grandparent)
#   DRY_RUN                         Set to "1" to log but not restart
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAYMARK_DIR="${WAYMARK_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
STALE_MINUTES="${STALE_MINUTES:-30}"
CHECK_INTERVAL="${CHECK_INTERVAL:-300}"
COOLDOWN_MINUTES="${COOLDOWN_MINUTES:-15}"
MAX_RESTARTS="${MAX_RESTARTS:-3}"
CIRCUIT_WINDOW_MINUTES="${CIRCUIT_WINDOW_MINUTES:-60}"
DRY_RUN="${DRY_RUN:-0}"
LOOP_MODE=false

# State directory for restart tracking (cooldown + circuit breaker)
STATE_DIR="/tmp/waymark-watchdog-state"
mkdir -p "$STATE_DIR"

for arg in "$@"; do
  case "$arg" in
    --loop) LOOP_MODE=true ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [host-watchdog] $*"; }

# Record a restart timestamp for a container (for circuit breaker)
record_restart() {
  local container="$1"
  echo "$(date +%s)" >> "$STATE_DIR/${container}.restarts"
}

# Get post-restart cooldown: returns 0 (true) if container was restarted recently
in_cooldown() {
  local container="$1"
  local cooldown_file="$STATE_DIR/${container}.last-restart"
  [[ ! -f "$cooldown_file" ]] && return 1  # no restart recorded → not in cooldown

  local last_restart now elapsed
  last_restart=$(cat "$cooldown_file")
  now=$(date +%s)
  elapsed=$(( (now - last_restart) / 60 ))

  if (( elapsed < COOLDOWN_MINUTES )); then
    log "COOLDOWN: Container '$container' was restarted ${elapsed}m ago (cooldown: ${COOLDOWN_MINUTES}m). Skipping."
    return 0
  fi
  return 1
}

# Circuit breaker: returns 0 (true) if too many restarts in the window
circuit_open() {
  local container="$1"
  local restart_file="$STATE_DIR/${container}.restarts"
  [[ ! -f "$restart_file" ]] && return 1  # no restarts recorded → circuit closed

  local window_start now count
  now=$(date +%s)
  window_start=$(( now - CIRCUIT_WINDOW_MINUTES * 60 ))

  # Count restarts within the circuit window
  count=0
  while IFS= read -r ts; do
    [[ -z "$ts" ]] && continue
    if (( ts >= window_start )); then
      count=$(( count + 1 ))
    fi
  done < "$restart_file"

  if (( count >= MAX_RESTARTS )); then
    log "CIRCUIT BREAKER: Container '$container' restarted ${count} times in last ${CIRCUIT_WINDOW_MINUTES}m (limit: ${MAX_RESTARTS}). NOT restarting."
    return 0
  fi
  return 1
}

check_and_restart() {
  log "Checking agent heartbeats (stale threshold: ${STALE_MINUTES}m)..."

  # Get list of running containers to filter against — only watch containers that are actually up
  local running_containers
  running_containers=$(docker ps --format '{{.Names}}' 2>/dev/null | tr '\n' ',' | sed 's/,$//')

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

  # Parse JSON output — extract stale agents, filter to running containers, and deduplicate by container name
  local stale_lines
  stale_lines=$(echo "$output" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const running = new Set('${running_containers}'.split(',').filter(Boolean));
    const stale = d.agents.filter(a => a.stale && running.has(a.container));
    // Deduplicate by container — keep only the most recently seen entry per container
    const byContainer = {};
    stale.forEach(a => {
      const key = a.container || 'unknown';
      if (!byContainer[key] || a.age < byContainer[key].age) {
        byContainer[key] = a;
      }
    });
    Object.values(byContainer).forEach(a => console.log(a.container + ' ' + a.name + ' ' + a.age));
    process.exit(0);
  " 2>/dev/null) || {
    log "ERROR: Failed to parse heartbeat JSON"
    return 1
  }

  if [ -z "$stale_lines" ]; then
    log "All agents healthy."
    return 0
  fi

  # Restart each stale container (with cooldown + circuit breaker checks)
  while IFS=' ' read -r container agent_name age; do
    [ -z "$container" ] && continue
    log "STALE: Agent '$agent_name' last seen ${age}m ago (container: $container)"

    # Skip containers still in post-restart cooldown
    if in_cooldown "$container"; then
      continue
    fi

    # Skip containers that hit the circuit breaker
    if circuit_open "$container"; then
      continue
    fi

    if [ "$DRY_RUN" = "1" ]; then
      log "DRY RUN: Would restart container '$container'"
    else
      if docker ps --format '{{.Names}}' | grep -qx "$container"; then
        log "Restarting container '$container'..."
        if docker restart "$container"; then
          log "Container '$container' restarted successfully."
          # Record restart for cooldown and circuit breaker
          echo "$(date +%s)" > "$STATE_DIR/${container}.last-restart"
          record_restart "$container"
        else
          log "ERROR: Failed to restart '$container'"
        fi
      else
        log "WARNING: Container '$container' not running. Skipping restart."
      fi
    fi
  done <<< "$stale_lines"
}

# ---- Main ----

if [ "$LOOP_MODE" = true ]; then
  log "Starting in loop mode (interval: ${CHECK_INTERVAL}s, cooldown: ${COOLDOWN_MINUTES}m, circuit: ${MAX_RESTARTS}x/${CIRCUIT_WINDOW_MINUTES}m)"
  while true; do
    check_and_restart || true
    sleep "$CHECK_INTERVAL"
  done
else
  check_and_restart
fi
