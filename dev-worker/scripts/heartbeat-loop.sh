#!/usr/bin/env bash
# heartbeat-loop.sh — Activity-gated heartbeat for the Waymark agent.
#
# Runs inside the container via supervisord. Every HEARTBEAT_INTERVAL seconds,
# checks whether the agent has ACTUALLY DONE WORK since the last check. Only
# writes a heartbeat if real activity is detected. If the agent is stuck, frozen,
# or dead, heartbeats stop — the host-side watchdog sees a stale timestamp and
# restarts the container.
#
# Activity signals (any one is sufficient):
#   - Files modified in /workspace since last check
#   - New git commits since last check
#   - VS Code extension host is running (process alive)
#
# If VS Code isn't running at all, no heartbeat is written. If VS Code is running
# but producing no file changes or commits, no heartbeat is written. This ensures
# a stuck/frozen agent gets detected and restarted — not kept alive by a dumb loop.

source /etc/agent-env.sh 2>/dev/null || true

AGENT_NAME="${AGENT_NAME:-default}"
CONTAINER_NAME="${CONTAINER_NAME:-waymark-dev-worker}"
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-300}"  # 5 minutes
ACTIVITY_MARKER="/tmp/.heartbeat-last-activity"

log() { echo "[heartbeat $(date +%T)] $*"; }

# Wait for VS Code to be running before starting.
log "Waiting for VS Code to start..."
until pgrep -x "code" >/dev/null 2>&1; do sleep 5; done
log "VS Code detected — starting activity-gated heartbeat (interval: ${HEARTBEAT_INTERVAL}s)"

# Initialize activity marker
touch "$ACTIVITY_MARKER"

while true; do
    sleep "$HEARTBEAT_INTERVAL"

    # Gate 1: VS Code must be running
    if ! pgrep -x "code" >/dev/null 2>&1; then
        log "VS Code not running — skipping heartbeat"
        continue
    fi

    # Gate 2: Check for actual agent activity since last heartbeat
    has_activity=false

    # Check for recently modified files in /workspace (excluding .git, node_modules, logs)
    if find /workspace -newer "$ACTIVITY_MARKER" -type f \
        ! -path '*/.git/*' ! -path '*/node_modules/*' ! -path '*/test-results/*' \
        ! -path '*/*.log' ! -name '*.pyc' \
        -print -quit 2>/dev/null | grep -q .; then
        has_activity=true
    fi

    # Check for new git commits since last check
    if ! $has_activity; then
        if [[ -d /workspace/.git ]]; then
            local_marker_ts=$(stat -c %Y "$ACTIVITY_MARKER" 2>/dev/null || echo 0)
            last_commit_ts=$(git -C /workspace log -1 --format=%ct 2>/dev/null || echo 0)
            if (( last_commit_ts > local_marker_ts )); then
                has_activity=true
            fi
        fi
    fi

    if $has_activity; then
        log "Activity detected — writing heartbeat"
        touch "$ACTIVITY_MARKER"
        cd /workspace && node scripts/update-workboard.js heartbeat "$AGENT_NAME" \
            --status working --container "$CONTAINER_NAME" 2>&1 || \
            log "WARNING: Heartbeat write failed (will retry next interval)"
    else
        log "No activity detected — NOT heartbeating (agent may be stuck)"
    fi
done
