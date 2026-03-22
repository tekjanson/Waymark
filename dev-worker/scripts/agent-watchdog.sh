#!/usr/bin/env bash
# agent-watchdog.sh — Boots the Copilot agent and writes initial heartbeat.
#
# Runs once at container start (via supervisord, autorestart=false).
# The original three-tier health model (HEALTHY/STUCK/DEAD) has been
# replaced by an external host-side watchdog that reads the Heartbeat
# sheet tab. This script now handles BOOT ONLY — the proven boot
# sequence is preserved exactly as it was.
#
# Boot flow:
#   1. Wait for X display
#   2. Ensure VS Code is running
#   3. Inject the agent command via xdotool (with status reporting)
#   4. Write initial heartbeat to the workboard
#   5. Exit (monitoring is external via host-watchdog.sh)

source /etc/agent-env.sh 2>/dev/null || true

HEARTBEAT_FILE="/tmp/agent-heartbeat"
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

    # Touch local heartbeat for backward compat with test.sh
    touch "$HEARTBEAT_FILE"
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

# ── Write initial heartbeat to workboard ──────────────────────────────────────
# The agent's persistent loop handles ongoing heartbeats (see §0.5 HEARTBEAT
# in waymark-builder.agent.md). This is just the "I'm alive" signal at boot.
if [[ -n "$AGENT_NAME" ]]; then
    log "Writing initial heartbeat for agent: $AGENT_NAME"
    cd /workspace && node scripts/update-workboard.js heartbeat "$AGENT_NAME" --status booting 2>&1 || \
        log "WARNING: Initial heartbeat write failed (non-fatal)"
fi

log "Boot complete — monitoring is handled externally by host-watchdog.sh"
