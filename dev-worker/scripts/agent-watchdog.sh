#!/usr/bin/env bash
# agent-watchdog.sh — Boots the Copilot agent (one-shot).
#
# Runs once at container start (via supervisord, autorestart=false).
#
# Boot flow:
#   1. Wait for X display
#   2. Ensure VS Code is running
#   3. Inject the agent command via xdotool (with status reporting)
#   4. Exit

source /etc/agent-env.sh 2>/dev/null || true

INJECT_STATUS="/tmp/inject-status"
export DISPLAY=":1"

log() { echo "[watchdog $(date +%T)] $*"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

inject() {
    local reason="$1"

    log "Injecting agent command (reason: ${reason}): ${AGENT_COMMAND}"

    /scripts/inject-agent.sh || log "WARNING: inject-agent.sh exited with error"

    # Report inject result
    if [[ -f "$INJECT_STATUS" ]]; then
        local status msg
        status=$(grep "^status=" "$INJECT_STATUS" 2>/dev/null | cut -d= -f2)
        msg=$(grep "^message=" "$INJECT_STATUS" 2>/dev/null | cut -d= -f2-)
        log "Inject result: ${status} — ${msg}"
        if [[ "$status" == "failed" ]]; then
            log "Screenshots: docker cp waymark-dev-worker:/tmp/inject-screenshots/ ./"
        fi
    fi
}

ensure_vscode_running() {
    if ! pgrep -x "code" >/dev/null 2>&1; then
        log "VS Code not running — launching..."
        /scripts/start-vscode.sh
        return 0  # just launched, needs inject
    fi
    return 1  # already running
}

# ── Boot ──────────────────────────────────────────────────────────────────────
log "Watchdog started — waiting for X display..."
until xdpyinfo -display :1 >/dev/null 2>&1; do sleep 2; done
log "X display ready"

ensure_vscode_running || true
inject "boot"

log "Boot complete."
