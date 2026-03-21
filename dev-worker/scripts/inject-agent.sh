#!/usr/bin/env bash
# inject-agent.sh — Bulletproof Copilot Chat agent launcher.
#
# Drives VS Code on DISPLAY=:1 via xdotool to:
#   1. Hard-focus the VS Code window (multiple methods + verification)
#   2. Dismiss stale overlays/notifications
#   3. Open a new Copilot Chat via command palette
#   4. Type and submit $AGENT_COMMAND
#
# Retries the whole sequence up to MAX_ATTEMPTS times with increasing backoff.
#
# Called by: agent-watchdog.sh on boot and after each detected session death.

# NOTE: no -e — explicit return code handling throughout
set -uo pipefail

source /etc/agent-env.sh 2>/dev/null || true

AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
export DISPLAY=":1"

MAX_ATTEMPTS=5
WINDOW_WAIT=90     # max seconds to wait for VS Code window on startup
PALETTE_SETTLE=1.8 # seconds for command palette animation
CHAT_SETTLE=5.0    # seconds for Copilot Chat panel to open + reach focus
TYPE_DELAY=80      # ms between keystrokes (generous for special chars like @)

log() { echo "[inject $(date +%T)] $*"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

# Poll cmd until it exits 0 or timeout seconds pass
wait_until() {
    local timeout="$1"; shift
    local i=0
    until "$@" >/dev/null 2>&1; do
        sleep 1; i=$(( i + 1 ))
        [[ $i -ge $timeout ]] && return 1
    done
    return 0
}

# Return the WID of the best VS Code window.
# Prefers the window titled "workspace" (our mounted folder) over any Code window.
find_vscode_win() {
    local wid
    # Try workspace-specific title first
    wid=$(xdotool search --name "workspace.*Visual Studio Code" 2>/dev/null | tail -1)
    [[ -n "$wid" ]] && echo "$wid" && return
    # Any VS Code window by name
    wid=$(xdotool search --name "Visual Studio Code" 2>/dev/null | tail -1)
    [[ -n "$wid" ]] && echo "$wid" && return
    # Fallback: WM_CLASS
    wid=$(xdotool search --class "Code" 2>/dev/null | tail -1)
    echo "$wid"
}

# Aggressively focus a window; confirm with getactivewindow; click title bar on failure
hard_focus() {
    local wid="$1"
    # First pass
    xdotool windowraise   "$wid" 2>/dev/null || true
    xdotool windowactivate --sync "$wid" 2>/dev/null || true
    xdotool windowfocus   --sync "$wid" 2>/dev/null || true
    sleep 0.5

    # Verify
    local active
    active=$(xdotool getactivewindow 2>/dev/null || echo "0")
    [[ "$active" == "$wid" ]] && return 0

    # Second pass: click on the window's title bar area to force focus
    local pos
    pos=$(xdotool getwindowgeometry "$wid" 2>/dev/null | grep Position || true)
    local wx wy
    wx=$(echo "$pos" | grep -oP '\K[0-9]+(?=,)' || echo "100")
    wy=$(echo "$pos" | grep -oP ',[0-9]+' | tr -d ',' || echo "20")
    xdotool mousemove "$(( wx + 200 ))" "$(( wy + 15 ))"
    sleep 0.1
    xdotool click 1
    sleep 0.3
    xdotool windowactivate --sync "$wid" 2>/dev/null || true
    sleep 0.4
    return 0
}

# Click inside the chat input area (bottom-left of the VS Code window)
# This is the primary sidebar area where Copilot Chat input lives.
click_chat_input() {
    local wid="$1"
    local geom
    geom=$(xdotool getwindowgeometry "$wid" 2>/dev/null) || return
    local wx wy ww wh
    wx=$(echo "$geom" | grep -oP 'Position: \K[0-9]+' || echo "0")
    wy=$(echo "$geom" | grep -oP 'Position: [0-9]+,\K[0-9]+' || echo "0")
    ww=$(echo "$geom" | grep -oP 'Geometry: \K[0-9]+(?=x)' || echo "1920")
    wh=$(echo "$geom" | grep -oP 'Geometry: [0-9]+x\K[0-9]+' || echo "1080")

    # Chat input is at the bottom of the left sidebar (primary sidebar).
    # Target: ~15% from left, ~94% from top — bottom of the chat sidebar.
    local cx cy
    cx=$(( wx + ww * 15 / 100 ))
    cy=$(( wy + wh * 94 / 100 ))
    xdotool mousemove "$cx" "$cy"
    sleep 0.2
    xdotool click 1
    sleep 0.3
}

# ── One complete injection attempt ────────────────────────────────────────────
do_inject() {
    local attempt="$1"
    log "--- Attempt ${attempt}/${MAX_ATTEMPTS} ---"

    # 1. Find window
    local WID
    WID=$(find_vscode_win)
    if [[ -z "$WID" ]]; then
        log "No VS Code window — skipping attempt"
        return 1
    fi
    log "Window: $WID"

    # 2. Maximize window for consistent geometry (idempotent)
    xdotool windowsize "$WID" 1920 1080 2>/dev/null || true
    xdotool windowmove "$WID" 0 0 2>/dev/null || true
    sleep 0.3

    # 3. Hard focus
    hard_focus "$WID"

    # 4. Dismiss any open overlays / notifications / modals
    xdotool key --clearmodifiers Escape; sleep 0.2
    xdotool key --clearmodifiers Escape; sleep 0.2
    xdotool key --clearmodifiers Escape; sleep 0.2

    # 5. Re-focus after escaping
    hard_focus "$WID"

    # ── Open Command Palette ─────────────────────────────────────────────────
    log "Opening command palette..."
    xdotool key --clearmodifiers ctrl+shift+p
    sleep "$PALETTE_SETTLE"

    # If palette failed to open (e.g. focus was stolen), retry once
    xdotool key --clearmodifiers Escape
    sleep 0.3
    hard_focus "$WID"
    xdotool key --clearmodifiers ctrl+shift+p
    sleep "$PALETTE_SETTLE"

    # Clear any stale text from a previous attempt or auto-populated content
    xdotool key --clearmodifiers ctrl+a
    sleep 0.2
    xdotool key --clearmodifiers Delete
    sleep 0.2

    # Type the command name slowly for reliable autocomplete
    xdotool type --clearmodifiers --delay "$TYPE_DELAY" "GitHub Copilot Chat: New Chat"
    sleep 1.2

    # Confirm
    xdotool key --clearmodifiers Return
    log "Command palette: submitted 'GitHub Copilot Chat: New Chat'"

    # ── Wait for Chat Panel ───────────────────────────────────────────────────
    sleep "$CHAT_SETTLE"

    # ── Ensure Chat Input Has Focus ───────────────────────────────────────────
    # Re-focus the main window, then click into the chat input area.
    # "New Chat" should auto-focus the input, but a click is a safety net.
    hard_focus "$WID"
    sleep 0.3
    click_chat_input "$WID"

    # Dismiss any autocomplete or suggestion overlay in the chat input
    xdotool key --clearmodifiers Escape
    sleep 0.2

    # ── Type and Submit the Agent Command ────────────────────────────────────
    # Do NOT ctrl+a here — we have a fresh empty input from "New Chat".
    # ctrl+a in the wrong context would select all editor text.
    log "Typing: ${AGENT_COMMAND}"
    xdotool type --clearmodifiers --delay "$TYPE_DELAY" "${AGENT_COMMAND}"
    sleep 0.5

    # Submit
    xdotool key --clearmodifiers Return
    log "Sent: ${AGENT_COMMAND}"
    return 0
}

# ── Main: wait for VS Code, then inject with retries ─────────────────────────
log "Waiting for VS Code window (up to ${WINDOW_WAIT}s)..."
if ! wait_until "$WINDOW_WAIT" xdotool search --class "Code"; then
    log "ERROR: VS Code window not found after ${WINDOW_WAIT}s — aborting"
    exit 1
fi

# Extra settle time: VS Code loads extensions asynchronously.
# Copilot Chat must be fully activated before "New Chat" is available in the palette.
log "VS Code window found — waiting for extensions to settle (10s)..."
sleep 10

# Retry loop
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    if do_inject "$attempt"; then
        log "SUCCESS on attempt ${attempt}"
        exit 0
    fi
    BACKOFF=$(( attempt * 5 ))
    log "Attempt ${attempt} failed — backing off ${BACKOFF}s before retry"
    sleep "$BACKOFF"
done

log "ERROR: All ${MAX_ATTEMPTS} injection attempts failed"
exit 1
