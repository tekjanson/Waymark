#!/usr/bin/env bash
# inject-agent.sh v3 — Bulletproof Copilot Chat agent launcher.
#
# Architecture:
#   The agent command is baked into keybindings.json by entrypoint.sh:
#     Ctrl+Shift+F12 → workbench.action.chat.open {mode:"agent", query:AGENT_COMMAND}
#   VS Code's own code handles setInput() + acceptInput() — no xdotool typing needed.
#
#   This script just needs to:
#     1. Find and focus the VS Code window
#     2. Press the hotkey
#     3. As a safety net, press Enter (harmless if already submitted)
#
#   Every external command is wrapped in `timeout` — this script NEVER hangs.
#
# Called by: agent-watchdog.sh on boot and after each detected session death.

set -uo pipefail

source /etc/agent-env.sh 2>/dev/null || true

AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
export DISPLAY=":1"

# ── Tunables ────────────────────────────────────────────────────────────────
MAX_ATTEMPTS=3
SCREEN_W=1920
SCREEN_H=1080
WINDOW_WAIT=120        # max seconds to wait for VS Code window
EXTENSION_SETTLE=15    # seconds for Copilot Chat extension activation
CHAT_SETTLE=5          # seconds after hotkey before chat panel is ready
SCREENSHOT_DIR="/tmp/inject-screenshots"
STATUS_FILE="/tmp/inject-status"

log() { echo "[inject $(date +%T)] $*"; }

# ── Status file (read by watchdog & test.sh) ────────────────────────────────
write_status() {
    local status="$1" msg="$2"
    cat > "$STATUS_FILE" <<EOF
timestamp=$(date -Iseconds)
status=$status
message=$msg
agent_command=$AGENT_COMMAND
attempt=$CURRENT_ATTEMPT
EOF
    log "STATUS: $status — $msg"
}
CURRENT_ATTEMPT=0

# ── Safe xdotool wrapper — NEVER hangs ──────────────────────────────────────
xdo() { timeout 5 xdotool "$@" 2>/dev/null; }

# ── Screenshot helper ────────────────────────────────────────────────────────
mkdir -p "$SCREENSHOT_DIR"
screenshot() {
    local step="$1" ts path
    ts=$(date +%H%M%S)
    path="${SCREENSHOT_DIR}/${CURRENT_ATTEMPT}-${ts}-${step}.png"
    timeout 5 import -window root -display :1 "$path" 2>/dev/null && \
        log "  screenshot: ${step}" || true
}

# ── Window helpers ───────────────────────────────────────────────────────────
find_vscode_win() {
    local wid
    wid=$(xdo search --name "Visual Studio Code" | tail -1)
    [[ -n "$wid" ]] && echo "$wid" && return
    wid=$(xdo search --class "Code" | tail -1)
    echo "$wid"
}

maximize_window() {
    local wid="$1"
    xdo windowmove --sync "$wid" 0 0 || true
    xdo windowsize --sync "$wid" "$SCREEN_W" "$SCREEN_H" || true
    sleep 0.3
}

focus_window() {
    local wid="$1" tries=5
    for (( i=1; i<=tries; i++ )); do
        xdo windowraise "$wid" || true
        xdo windowactivate --sync "$wid" || true
        xdo windowfocus --sync "$wid" || true
        sleep 0.3
        local active
        active=$(xdo getactivewindow || echo "0")
        if [[ "$active" == "$wid" ]]; then
            return 0
        fi
        xdo mousemove $(( SCREEN_W / 2 )) $(( SCREEN_H / 2 ))
        xdo click 1
        sleep 0.3
    done
    log "  WARNING: focus not confirmed after $tries tries"
    return 1
}

# ── Clipboard paste fallback ────────────────────────────────────────────────
clipboard_paste_and_submit() {
    local text="$1"
    log "  Fallback: clipboard paste"
    if ! command -v xclip >/dev/null 2>&1; then
        log "  xclip not available, using xdotool type"
        xdo type --clearmodifiers --delay 40 "$text"
    else
        echo -n "$text" | timeout 3 xclip -selection clipboard 2>/dev/null
        sleep 0.2
        xdo key --clearmodifiers ctrl+v
    fi
    sleep 0.5
    xdo key --clearmodifiers Return
    sleep 0.5
    xdo key --clearmodifiers Return
}

# ── One complete injection attempt ──────────────────────────────────────────
do_inject() {
    CURRENT_ATTEMPT="$1"
    log "━━━ Attempt ${CURRENT_ATTEMPT}/${MAX_ATTEMPTS} ━━━"
    write_status "injecting" "attempt ${CURRENT_ATTEMPT} starting"

    # Step 1: Find VS Code window
    local WID
    WID=$(find_vscode_win)
    if [[ -z "$WID" ]]; then
        log "FAIL: No VS Code window found"
        write_status "error" "no VS Code window"
        return 1
    fi
    log "Step 1: VS Code window $WID"

    # Step 2: Maximize and focus
    maximize_window "$WID"
    focus_window "$WID"
    screenshot "01-focused"

    # Step 3: Clear any overlays (notifications, dialogs, walkthroughs)
    xdo key --clearmodifiers Escape; sleep 0.3
    xdo key --clearmodifiers Escape; sleep 0.3
    xdo key --clearmodifiers Escape; sleep 0.3
    focus_window "$WID"
    screenshot "02-cleared"

    # Step 4: Set permission level to "All" (auto-approve all tools)
    #
    # Ctrl+Shift+F10 fires /autoApprove slash command via:
    #   workbench.action.chat.open {
    #     mode: "agent",
    #     query: "/autoApprove",
    #     isPartialQuery: false
    #   }
    # This is silent (executeImmediately + silent) — sets the dropdown
    # to "All" without showing any message in chat.
    log "Step 4: Hotkey → /autoApprove (set permission level)"
    xdo key --clearmodifiers ctrl+shift+F10
    sleep 3
    screenshot "03-autoapprove"

    # Step 5: Open agent chat + auto-submit agent command via hotkey
    #
    # Ctrl+Shift+F12 is bound (by entrypoint.sh) to:
    #   workbench.action.chat.open {
    #     mode: "agent",
    #     query: "$AGENT_COMMAND",
    #     isPartialQuery: false   ← VS Code auto-calls acceptInput()
    #   }
    #
    # VS Code waits for the viewModel, calls setInput(query), then
    # acceptInput(). No xdotool typing needed, no Enter key needed.
    log "Step 5: Hotkey → agent chat + auto-submit"
    xdo key --clearmodifiers ctrl+shift+F12
    sleep "$CHAT_SETTLE"
    screenshot "04-hotkey-fired"

    # Step 6: Re-fire hotkey — if first was swallowed by a notification.
    # If command was already submitted, this opens the same chat panel
    # and auto-submits an empty query (no-op).
    xdo key --clearmodifiers ctrl+shift+F12
    sleep 3
    screenshot "05-confirmed"

    # Step 7: Safety net — press Enter twice with pauses.
    # If auto-submit worked: chat input is empty → Enter is a no-op.
    # If auto-submit failed but text was pre-filled → Enter submits it.
    xdo key --clearmodifiers Return
    sleep 1
    xdo key --clearmodifiers Return
    sleep 2
    screenshot "06-submitted"

    # Step 8: Check VS Code is still alive
    if ! find_vscode_win | grep -q .; then
        log "WARNING: VS Code window disappeared"
        write_status "error" "VS Code window lost"
        return 1
    fi

    write_status "success" "agent command injected on attempt ${CURRENT_ATTEMPT}"
    log "✓ Injection complete"
    return 0
}

# ── Main ────────────────────────────────────────────────────────────────────

# Clean previous screenshots
rm -f "${SCREENSHOT_DIR}"/*.png 2>/dev/null || true

write_status "starting" "waiting for VS Code window"

# Wait for VS Code window
log "Waiting for VS Code window (up to ${WINDOW_WAIT}s)..."
WAIT_COUNT=0
until find_vscode_win | grep -q .; do
    sleep 1; WAIT_COUNT=$(( WAIT_COUNT + 1 ))
    if [[ $WAIT_COUNT -ge $WINDOW_WAIT ]]; then
        write_status "error" "VS Code window not found after ${WINDOW_WAIT}s"
        exit 1
    fi
done
log "VS Code window found (waited ${WAIT_COUNT}s)"

# Wait for extensions to settle
log "Waiting ${EXTENSION_SETTLE}s for extensions to settle..."
sleep "$EXTENSION_SETTLE"
screenshot "00-pre-inject"

# Retry loop with backoff
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    if do_inject "$attempt"; then
        log "━━━ SUCCESS on attempt ${attempt} ━━━"
        log "Screenshots: ls $SCREENSHOT_DIR/"
        exit 0
    fi
    BACKOFF=$(( attempt * 5 ))
    log "Attempt ${attempt} failed — backing off ${BACKOFF}s"
    write_status "retrying" "attempt ${attempt} failed, backing off ${BACKOFF}s"
    sleep "$BACKOFF"
done

write_status "failed" "all ${MAX_ATTEMPTS} attempts failed"
log "━━━ FAILED: All ${MAX_ATTEMPTS} injection attempts failed ━━━"
log "Screenshots: docker cp waymark-dev-worker:/tmp/inject-screenshots/ ./"
exit 1
