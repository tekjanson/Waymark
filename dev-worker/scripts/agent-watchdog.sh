#!/usr/bin/env bash
# agent-watchdog.sh — Keeps the Copilot agent alive indefinitely.
#
# Strategy:
#   1. On first boot: launch VS Code (if not running), then inject AGENT_COMMAND.
#   2. Every 60s: check that VS Code is running AND that the heartbeat file is fresh.
#      - VS Code gone → relaunch it, then re-inject.
#      - Heartbeat stale (>STALE_THRESHOLD seconds) → session ended → re-inject.
#
# The heartbeat file is maintained by heartbeat-watcher.sh, which monitors VS
# Code's extension host logs for write activity.
# NOTE: set -e is intentionally NOT used here — this is a persistent loop that
# must survive inject failures and other transient errors.

source /etc/agent-env.sh 2>/dev/null || true

HEARTBEAT_FILE="/tmp/agent-heartbeat"
INJECT_STATUS="/tmp/inject-status"
STALE_THRESHOLD=600   # 10 minutes — if no log activity, consider session dead
export DISPLAY=":1"

log() { echo "[watchdog $(date +%T)] $*"; }

inject() {
    log "Injecting agent command: ${AGENT_COMMAND}"
    /scripts/inject-agent.sh || log "WARNING: inject-agent.sh exited with error — will retry next cycle"
    # Report inject result
    if [[ -f "$INJECT_STATUS" ]]; then
        local status msg
        status=$(grep "^status=" "$INJECT_STATUS" 2>/dev/null | cut -d= -f2)
        msg=$(grep "^message=" "$INJECT_STATUS" 2>/dev/null | cut -d= -f2-)
        log "Inject result: ${status} — ${msg}"
        if [[ "$status" == "failed" ]]; then
            log "Screenshots available: docker cp waymark-dev-worker:/tmp/inject-screenshots/ ./"
        fi
    fi
    # Reset heartbeat so we don't immediately re-fire after injection
    touch "$HEARTBEAT_FILE"
}

ensure_vscode_running() {
    if ! pgrep -x "code" >/dev/null 2>&1; then
        log "VS Code not running — launching..."
        /scripts/start-vscode.sh
        return 0  # just launched, needs inject
    fi
    return 1  # already running, no inject needed from this check
}

# ── Boot: wait for the display, then start VS Code and inject ─────────────────
log "Watchdog started — waiting for X display..."
until xdpyinfo -display :1 >/dev/null 2>&1; do sleep 2; done
log "X display ready"

ensure_vscode_running || true
# NOTE: inject-agent.sh itself waits 10s for extensions to settle before
# sending any keystrokes, so no extra sleep is needed here on boot.
inject

# ── Main loop ─────────────────────────────────────────────────────────────────
while true; do
    sleep 60

    # --- Check 1: Is VS Code running? ---
    if ensure_vscode_running; then
        # VS Code was just relaunched; inject-agent.sh will wait for the
        # window to appear and for extensions to settle before sending keys.
        inject
        continue
    fi

    # --- Check 2: Is the agent session still active? ---
    if [[ -f "$HEARTBEAT_FILE" ]]; then
        NOW=$(date +%s)
        LAST=$(stat -c %Y "$HEARTBEAT_FILE")
        AGE=$(( NOW - LAST ))

        if [[ $AGE -gt $STALE_THRESHOLD ]]; then
            log "Heartbeat stale (${AGE}s old, threshold ${STALE_THRESHOLD}s) — session ended, reinjecting"
            inject
        else
            log "Heartbeat fresh (${AGE}s ago) — agent alive"
        fi
    else
        log "No heartbeat file yet — agent still initializing (will check again next cycle)"
    fi
done
