#!/usr/bin/env bash
# agent-watchdog.sh — Keeps the Copilot agent alive with rate-limit-aware cooldown.
#
# Three-tier health model:
#   HEALTHY  (heartbeat < STUCK_THRESHOLD)  → agent working, do nothing
#   STUCK    (STUCK_THRESHOLD..STALE_THRESHOLD) → likely hung on confirmation dialog
#            → fire acceptTool keybinding + Enter to clear it (throttled)
#   DEAD     (heartbeat > STALE_THRESHOLD)  → agent gone (likely rate-limited)
#            → wait cooldown then full re-inject
#
# Cooldown: after any re-inject, enforce a minimum wait before the next one.
# Each consecutive re-inject without a healthy run doubles the cooldown (capped).
#
# The heartbeat file is maintained by heartbeat-watcher.sh, which monitors VS
# Code's extension host logs for write activity.

source /etc/agent-env.sh 2>/dev/null || true

HEARTBEAT_FILE="/tmp/agent-heartbeat"
INJECT_STATUS="/tmp/inject-status"
LAST_INJECT_FILE="/tmp/watchdog-last-inject"
CONSECUTIVE_FILE="/tmp/watchdog-consecutive-reinjects"
LAST_UNSTICK_FILE="/tmp/watchdog-last-unstick"
export DISPLAY=":1"

# ── Tunables ──────────────────────────────────────────────────────────────────
POLL_INTERVAL=30          # seconds between health checks
STUCK_THRESHOLD=120       # 2 min — agent may be stuck on a confirmation dialog
STALE_THRESHOLD=1800      # 30 min — if no log activity, agent is dead
COOLDOWN_SECONDS=1800     # 30 min — base wait after detecting agent death
MAX_COOLDOWN=7200         # 2 hour cap on exponential backoff
BOOT_GRACE=120            # 2 min — don't check heartbeat right after injection
UNSTICK_COOLDOWN=60       # 1 min — minimum between unstick attempts

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

# Try to clear a stuck confirmation dialog (acceptTool + Enter)
unstick() {
    local age="$1"
    local since_last_unstick now

    # Throttle: don't unstick more often than UNSTICK_COOLDOWN
    now=$(date +%s)
    if [[ -f "$LAST_UNSTICK_FILE" ]]; then
        local last_unstick
        last_unstick=$(cat "$LAST_UNSTICK_FILE")
        since_last_unstick=$(( now - last_unstick ))
        if (( since_last_unstick < UNSTICK_COOLDOWN )); then
            log "STUCK (${age}s) — unstick throttled (${since_last_unstick}s/${UNSTICK_COOLDOWN}s since last attempt)"
            return 0
        fi
    fi

    log "STUCK (${age}s) — firing acceptTool keybinding to clear pending confirmation"
    echo "$now" > "$LAST_UNSTICK_FILE"

    # Fire Ctrl+Shift+F9 (workbench.action.chat.acceptTool) to accept any pending tool confirmation
    timeout 5 xdotool key --clearmodifiers ctrl+shift+F9 2>/dev/null || true
    sleep 1
    # Follow up with Enter in case the dialog needs an extra confirmation
    timeout 5 xdotool key --clearmodifiers Return 2>/dev/null || true
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

    # --- Check 3: Three-tier health model ---
    if [[ -f "$HEARTBEAT_FILE" ]]; then
        NOW=$(date +%s)
        LAST=$(stat -c %Y "$HEARTBEAT_FILE")
        AGE=$(( NOW - LAST ))

        if (( AGE > STALE_THRESHOLD )); then
            # DEAD: agent gone, likely rate-limited — full re-inject with cooldown
            log "Heartbeat stale (${AGE}s old, threshold ${STALE_THRESHOLD}s) — agent stopped (likely rate-limited)"
            inject "stale-heartbeat"
        elif (( AGE > STUCK_THRESHOLD )); then
            # STUCK: agent may be hung on a confirmation dialog — try to clear it
            unstick "$AGE"
        else
            # HEALTHY: agent is working — reset consecutive counter
            if (( $(get_consecutive) > 0 )); then
                log "Agent healthy (heartbeat ${AGE}s ago) — resetting consecutive reinject counter"
                set_consecutive 0
            fi
        fi
    else
        log "No heartbeat file yet — still initializing"
    fi
done
