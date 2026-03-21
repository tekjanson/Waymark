#!/usr/bin/env bash
# agent-watchdog.sh — Keeps the Copilot agent alive with rate-limit-aware cooldown.
#
# Strategy:
#   1. On first boot: launch VS Code (if not running), then inject AGENT_COMMAND.
#   2. Every POLL_INTERVAL: check that VS Code is running AND heartbeat is fresh.
#      - VS Code gone → relaunch it, then re-inject (with cooldown).
#      - Heartbeat stale (>STALE_THRESHOLD) → session ended (likely rate-limited)
#        → wait COOLDOWN_SECONDS before re-injecting to avoid re-triggering limits.
#   3. Cooldown: after any re-inject, enforce a minimum wait before the next one.
#      Each consecutive re-inject without a healthy run doubles the cooldown (capped).
#
# The heartbeat file is maintained by heartbeat-watcher.sh, which monitors VS
# Code's extension host logs for write activity.

source /etc/agent-env.sh 2>/dev/null || true

HEARTBEAT_FILE="/tmp/agent-heartbeat"
INJECT_STATUS="/tmp/inject-status"
LAST_INJECT_FILE="/tmp/watchdog-last-inject"
CONSECUTIVE_FILE="/tmp/watchdog-consecutive-reinjects"
export DISPLAY=":1"

# ── Tunables ──────────────────────────────────────────────────────────────────
POLL_INTERVAL=30          # seconds between health checks
STALE_THRESHOLD=300       # 5 min — if no log activity, agent is dead
COOLDOWN_SECONDS=1800     # 30 min — base wait after detecting agent death
MAX_COOLDOWN=7200         # 2 hour cap on exponential backoff
BOOT_GRACE=120            # 2 min — don't check heartbeat right after injection

log() { echo "[watchdog $(date +%T)] $*"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

get_consecutive() {
    cat "$CONSECUTIVE_FILE" 2>/dev/null || echo 0
}

set_consecutive() {
    echo "$1" > "$CONSECUTIVE_FILE"
}

seconds_since_last_inject() {
    if [[ -f "$LAST_INJECT_FILE" ]]; then
        local last now
        last=$(cat "$LAST_INJECT_FILE")
        now=$(date +%s)
        echo $(( now - last ))
    else
        echo 999999  # never injected
    fi
}

# Calculate cooldown with exponential backoff: base * 2^(consecutive-1), capped
calc_cooldown() {
    local consecutive="$1"
    if (( consecutive <= 1 )); then
        echo "$COOLDOWN_SECONDS"
        return
    fi
    local multiplier=$(( 1 << (consecutive - 1) ))  # 2^(n-1)
    local cooldown=$(( COOLDOWN_SECONDS * multiplier ))
    if (( cooldown > MAX_COOLDOWN )); then
        cooldown=$MAX_COOLDOWN
    fi
    echo "$cooldown"
}

inject() {
    local reason="$1"
    local consecutive
    consecutive=$(get_consecutive)

    # Check cooldown — don't re-inject too soon
    local since_last cooldown
    since_last=$(seconds_since_last_inject)
    cooldown=$(calc_cooldown "$consecutive")

    if (( since_last < cooldown )) && (( consecutive > 0 )); then
        local remaining=$(( cooldown - since_last ))
        local remaining_min=$(( remaining / 60 ))
        log "COOLDOWN: ${remaining_min}m${remaining:+$(( remaining % 60 ))s} remaining (${since_last}s since last inject, need ${cooldown}s, consecutive=${consecutive})"
        return 0
    fi

    log "Injecting agent command (reason: ${reason}, consecutive=${consecutive}): ${AGENT_COMMAND}"
    date +%s > "$LAST_INJECT_FILE"

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

    # Increment consecutive counter (reset only when agent runs healthy)
    set_consecutive $(( consecutive + 1 ))

    # Reset heartbeat so we don't immediately see it as stale
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

# Reset consecutive counter on fresh boot
set_consecutive 0

ensure_vscode_running || true
inject "boot"

# ── Main loop ─────────────────────────────────────────────────────────────────
while true; do
    sleep "$POLL_INTERVAL"

    # --- Check 1: Is VS Code running? ---
    if ensure_vscode_running; then
        inject "vscode-relaunch"
        continue
    fi

    # --- Check 2: Grace period after injection ---
    local_since=$(seconds_since_last_inject)
    if (( local_since < BOOT_GRACE )); then
        log "Grace period (${local_since}s/${BOOT_GRACE}s since inject) — skipping heartbeat check"
        continue
    fi

    # --- Check 3: Is the agent session still active? ---
    if [[ -f "$HEARTBEAT_FILE" ]]; then
        NOW=$(date +%s)
        LAST=$(stat -c %Y "$HEARTBEAT_FILE")
        AGE=$(( NOW - LAST ))

        if [[ $AGE -gt $STALE_THRESHOLD ]]; then
            log "Heartbeat stale (${AGE}s old, threshold ${STALE_THRESHOLD}s) — agent stopped (likely rate-limited)"
            inject "stale-heartbeat"
        else
            # Agent is healthy — reset consecutive counter
            if (( $(get_consecutive) > 0 )); then
                log "Agent healthy (heartbeat ${AGE}s ago) — resetting consecutive reinject counter"
                set_consecutive 0
            fi
        fi
    else
        log "No heartbeat file yet — still initializing"
    fi
done
