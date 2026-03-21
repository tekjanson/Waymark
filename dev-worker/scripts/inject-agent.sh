#!/usr/bin/env bash
# inject-agent.sh — Deterministic Copilot Chat agent launcher with verification.
#
# Strategy:
#   1. Lock the display to a known resolution (1920x1080)
#   2. Maximize VS Code to fill the entire screen (known pixel geometry)
#   3. Open agent-mode chat via a dedicated hotkey (ctrl+shift+F12)
#      — bound in keybindings.json to workbench.action.chat.open {"mode":"agent"}
#   4. Type and submit $AGENT_COMMAND
#   5. Take annotated screenshots at every step → /tmp/inject-screenshots/
#   6. Write structured status to /tmp/inject-status for machine-readable feedback
#
# The screenshot trail means you NEVER need to watch VNC to debug injection.
# Just check: docker exec waymark-dev-worker ls /tmp/inject-screenshots/
# Or copy them out: docker cp waymark-dev-worker:/tmp/inject-screenshots/ ./
#
# Called by: agent-watchdog.sh on boot and after each detected session death.

set -uo pipefail

source /etc/agent-env.sh 2>/dev/null || true

AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
export DISPLAY=":1"

# ── Tunables ──────────────────────────────────────────────────────────────────
MAX_ATTEMPTS=3              # total injection attempts
SCREEN_W=1920               # must match TigerVNC -geometry
SCREEN_H=1080
WINDOW_WAIT=120             # max seconds to wait for VS Code window
EXTENSION_SETTLE=15         # seconds to wait for Copilot Chat extension activation
CHAT_SETTLE=4               # seconds after hotkey before chat panel is ready
TYPE_DELAY=60               # ms between keystrokes
SCREENSHOT_DIR="/tmp/inject-screenshots"
STATUS_FILE="/tmp/inject-status"

log() { echo "[inject $(date +%T)] $*"; }

# ── Status reporting ──────────────────────────────────────────────────────────
# Machine-readable status file: read by watchdog & test.sh
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

# ── Screenshot helpers ────────────────────────────────────────────────────────
mkdir -p "$SCREENSHOT_DIR"

# Take a screenshot tagged with step name. Uses ImageMagick 'import'.
screenshot() {
    local step="$1"
    local ts
    ts=$(date +%H%M%S)
    local path="${SCREENSHOT_DIR}/${CURRENT_ATTEMPT}-${ts}-${step}.png"
    import -window root -display :1 "$path" 2>/dev/null && \
        log "  📸 ${step} → $(basename "$path")" || \
        log "  📸 ${step} — screenshot failed (non-fatal)"
}

# ── Window helpers ────────────────────────────────────────────────────────────

# Return the WID of the best VS Code window.
find_vscode_win() {
    local wid
    wid=$(xdotool search --name "Visual Studio Code" 2>/dev/null | tail -1)
    [[ -n "$wid" ]] && echo "$wid" && return
    wid=$(xdotool search --class "Code" 2>/dev/null | tail -1)
    echo "$wid"
}

# Set the window to exactly fill the screen. Verify geometry afterwards.
maximize_window() {
    local wid="$1"
    xdotool windowmove --sync "$wid" 0 0 2>/dev/null || true
    xdotool windowsize --sync "$wid" "$SCREEN_W" "$SCREEN_H" 2>/dev/null || true
    sleep 0.5
    # Verify
    local geom
    geom=$(xdotool getwindowgeometry "$wid" 2>/dev/null) || return 1
    local w h
    w=$(echo "$geom" | grep -oP 'Geometry: \K[0-9]+(?=x)' || echo "0")
    h=$(echo "$geom" | grep -oP 'Geometry: [0-9]+x\K[0-9]+' || echo "0")
    log "  Window geometry: ${w}x${h} (target: ${SCREEN_W}x${SCREEN_H})"
    # Allow 10px tolerance for window decorations
    [[ $w -gt $(( SCREEN_W - 10 )) && $h -gt $(( SCREEN_H - 10 )) ]]
}

# Focus with verification loop
focus_window() {
    local wid="$1" tries=5
    for (( i=1; i<=tries; i++ )); do
        xdotool windowraise "$wid" 2>/dev/null || true
        xdotool windowactivate --sync "$wid" 2>/dev/null || true
        xdotool windowfocus --sync "$wid" 2>/dev/null || true
        sleep 0.3
        local active
        active=$(xdotool getactivewindow 2>/dev/null || echo "0")
        if [[ "$active" == "$wid" ]]; then
            log "  Focus confirmed on attempt $i"
            return 0
        fi
        # Fallback: click at center of window
        xdotool mousemove $(( SCREEN_W / 2 )) $(( SCREEN_H / 2 ))
        xdotool click 1
        sleep 0.3
    done
    log "  WARNING: Focus not confirmed after $tries attempts"
    return 1
}

# ── One complete injection attempt ────────────────────────────────────────────
do_inject() {
    CURRENT_ATTEMPT="$1"
    log "━━━ Attempt ${CURRENT_ATTEMPT}/${MAX_ATTEMPTS} ━━━"
    write_status "injecting" "attempt ${CURRENT_ATTEMPT} starting"

    # ── Step 1: Find the VS Code window ───────────────────────────────────────
    local WID
    WID=$(find_vscode_win)
    if [[ -z "$WID" ]]; then
        log "FAIL: No VS Code window found"
        write_status "error" "no VS Code window"
        return 1
    fi
    log "Step 1: Found VS Code window $WID"

    # ── Step 2: Set known geometry ────────────────────────────────────────────
    if ! maximize_window "$WID"; then
        log "WARNING: Could not verify window geometry"
    fi
    screenshot "01-window-found"

    # ── Step 3: Focus ─────────────────────────────────────────────────────────
    focus_window "$WID"
    screenshot "02-focused"

    # ── Step 4: Clear any overlays ────────────────────────────────────────────
    log "Step 4: Clearing overlays..."
    xdotool key --clearmodifiers Escape; sleep 0.3
    xdotool key --clearmodifiers Escape; sleep 0.3
    xdotool key --clearmodifiers Escape; sleep 0.3
    screenshot "03-overlays-cleared"

    # ── Step 5: Re-focus after escaping ───────────────────────────────────────
    focus_window "$WID"

    # ── Step 6: Open Copilot Chat in Agent mode via hotkey ────────────────────
    # ctrl+shift+F12 is bound to workbench.action.chat.open {"mode":"agent"}
    # This is FAR more reliable than typing in the command palette:
    #   - No palette search/autocomplete ambiguity
    #   - No risk of partial text match selecting the wrong command
    #   - Deterministic — the command is always the same
    log "Step 6: Opening agent-mode chat (Ctrl+Shift+F12)..."
    xdotool key --clearmodifiers ctrl+shift+F12
    sleep "$CHAT_SETTLE"
    screenshot "04-chat-opened"

    # ── Step 7: Verify chat panel is visible ──────────────────────────────────
    # The chat panel appears in the secondary sidebar or primary sidebar.
    # We can verify by checking for a window title change or by taking a
    # screenshot and checking for the chat panel. For now, the screenshot
    # serves as the verification — the human or test.sh can inspect it.
    # If the hotkey failed, the second attempt's screenshot will show the same
    # state as "overlays-cleared" instead of a chat panel.
    
    # Extra: try the hotkey a second time in case the first was swallowed
    # by a notification or animation. If chat is already open, this is harmless
    # (it just focuses the existing chat input).
    xdotool key --clearmodifiers ctrl+shift+F12
    sleep 2
    screenshot "05-chat-confirmed"

    # ── Step 8: Click into the chat input area ────────────────────────────────
    # The chat input is at the bottom of the Copilot panel.
    # After opening with the hotkey, focus should already be in the input, but
    # clicking provides a guaranteed final safety net.
    #
    # Default VS Code layout with the chat panel open:
    # The chat occupies the secondary sidebar on the right side, or the
    # primary sidebar on the left. Input box is near the bottom.
    #
    # Since we control the window geometry (1920x1080), we know exactly where
    # the chat input should be. Try clicking near the center-bottom area
    # of the expected chat panel location.
    #
    # The chat input spans the full width of the panel. We click at a safe spot
    # that won't accidentally hit a button or link.
    log "Step 8: Clicking chat input area..."
    # Try the bottom-center of the panel (right side sidebar layout)
    # VS Code default: panel is ~350px wide on the right side
    local chat_x chat_y
    chat_x=$(( SCREEN_W - 175 ))    # center of a 350px right sidebar
    chat_y=$(( SCREEN_H - 80 ))     # near the bottom, above the status bar
    xdotool mousemove "$chat_x" "$chat_y"
    sleep 0.2
    xdotool click 1
    sleep 0.3
    screenshot "06-input-clicked"

    # ── Step 9: Type the agent command ────────────────────────────────────────
    # Do NOT use ctrl+a — the chat input from "New Chat" / agent-mode open is
    # always empty. ctrl+a would be catastrophic if focus landed on the editor.
    log "Step 9: Typing command: ${AGENT_COMMAND}"
    xdotool type --clearmodifiers --delay "$TYPE_DELAY" "${AGENT_COMMAND}"
    sleep 0.5
    screenshot "07-command-typed"

    # ── Step 10: Submit ───────────────────────────────────────────────────────
    log "Step 10: Submitting..."
    xdotool key --clearmodifiers Return
    sleep 2
    screenshot "08-submitted"

    write_status "success" "agent command submitted on attempt ${CURRENT_ATTEMPT}"
    log "✓ Injection complete"
    return 0
}

# ── Main ──────────────────────────────────────────────────────────────────────

# Clean up screenshots from previous run
rm -f "${SCREENSHOT_DIR}"/*.png 2>/dev/null || true

write_status "starting" "waiting for VS Code window"

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

# Wait for Copilot Chat extension to activate.
# The hotkey won't work until the extension registers its keybinding handler.
log "Waiting ${EXTENSION_SETTLE}s for extensions to settle..."
sleep "$EXTENSION_SETTLE"
screenshot "00-pre-inject"

# Retry loop with backoff
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    if do_inject "$attempt"; then
        log "━━━ SUCCESS on attempt ${attempt} ━━━"
        log "Screenshots: ls /tmp/inject-screenshots/"
        exit 0
    fi
    BACKOFF=$(( attempt * 8 ))
    log "Attempt ${attempt} failed — backing off ${BACKOFF}s"
    write_status "retrying" "attempt ${attempt} failed, backing off ${BACKOFF}s"
    sleep "$BACKOFF"
done

write_status "failed" "all ${MAX_ATTEMPTS} attempts failed"
log "━━━ FAILED: All ${MAX_ATTEMPTS} injection attempts failed ━━━"
log "Inspect screenshots: docker cp waymark-dev-worker:/tmp/inject-screenshots/ ./"
exit 1
