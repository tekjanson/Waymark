#!/usr/bin/env bash
# heartbeat-loop.sh — Writes periodic heartbeats to the Workboard Heartbeat tab.
#
# Runs inside the container via supervisord. Writes a heartbeat every
# HEARTBEAT_INTERVAL seconds (default: 300 = 5 minutes). This is the
# RELIABLE heartbeat mechanism — it does NOT depend on the LLM agent
# remembering to write heartbeats from its prompt instructions.
#
# The host-side watchdog reads the Heartbeat tab and restarts containers
# whose agents haven't checked in within 30 minutes.

source /etc/agent-env.sh 2>/dev/null || true

AGENT_NAME="${AGENT_NAME:-default}"
CONTAINER_NAME="${CONTAINER_NAME:-waymark-dev-worker}"
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-300}"  # 5 minutes

log() { echo "[heartbeat $(date +%T)] $*"; }

# Wait for VS Code to be running before starting heartbeat loop.
# No point heartbeating if the agent hasn't booted yet.
log "Waiting for VS Code to start..."
until pgrep -x "code" >/dev/null 2>&1; do sleep 5; done
log "VS Code detected — starting heartbeat loop (interval: ${HEARTBEAT_INTERVAL}s)"

while true; do
    # Determine status based on whether VS Code is still running
    if pgrep -x "code" >/dev/null 2>&1; then
        status="working"
    else
        status="idle"
    fi

    cd /workspace && node scripts/update-workboard.js heartbeat "$AGENT_NAME" \
        --status "$status" --container "$CONTAINER_NAME" 2>&1 || \
        log "WARNING: Heartbeat write failed (will retry next interval)"

    sleep "$HEARTBEAT_INTERVAL"
done
