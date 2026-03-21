#!/usr/bin/env bash
# heartbeat-watcher.sh — Monitors VS Code extension host log activity.
#
# Every 30 seconds, checks if any VS Code log files under ~/.config/Code/logs/
# have been written since the previous check. If so, the agent session is live
# and /tmp/agent-heartbeat is touched to tell the watchdog not to re-inject.
#
# When the agent ends (Copilot session closes, error, timeout), log writes stop
# and the heartbeat goes stale — the watchdog detects this and re-injects.
set -euo pipefail

HEARTBEAT_FILE="/tmp/agent-heartbeat"
PREV_CHECK_FILE="/tmp/.hbw-previous-check"
LOG_DIR="/root/.config/Code/logs"

log() { echo "[heartbeat $(date +%T)] $*"; }

# Initialize both sentinel files
touch "$PREV_CHECK_FILE"
touch "$HEARTBEAT_FILE"

log "Heartbeat watcher started — monitoring ${LOG_DIR}"

while true; do
    sleep 30

    # Count how many VS Code log files have been modified since our last check
    ACTIVE=$(find "$LOG_DIR" -type f -name "*.log" -newer "$PREV_CHECK_FILE" 2>/dev/null | wc -l)

    # Update the sentinel so next iteration measures from now
    touch "$PREV_CHECK_FILE"

    if [[ "$ACTIVE" -gt 0 ]]; then
        touch "$HEARTBEAT_FILE"
        log "${ACTIVE} log file(s) updated — agent session active"
    else
        AGE=$(( $(date +%s) - $(stat -c %Y "$HEARTBEAT_FILE") ))
        log "No new log activity — heartbeat is ${AGE}s old"
    fi
done
