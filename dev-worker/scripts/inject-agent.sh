#!/usr/bin/env bash
# inject-agent.sh — Opens a new Copilot Chat panel and sends $AGENT_COMMAND.
# Uses xdotool to drive VS Code's UI on DISPLAY=:1.
# Called by agent-watchdog on first boot and after every detected session death.
set -euo pipefail

source /etc/agent-env.sh 2>/dev/null || true

AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
export DISPLAY=":1"

log() { echo "[inject $(date +%T)] $*"; }

# ── 1. Wait for a VS Code window ──────────────────────────────────────────────
# xdotool search does not support --timeout; use a manual poll loop instead.
log "Waiting for VS Code window..."
WINDOW_TIMEOUT=60
WINDOW_COUNT=0
until xdotool search --class "Code" >/dev/null 2>&1; do
    sleep 1
    WINDOW_COUNT=$((WINDOW_COUNT + 1))
    if [[ $WINDOW_COUNT -ge $WINDOW_TIMEOUT ]]; then
        log "ERROR: VS Code window not found after ${WINDOW_TIMEOUT}s — aborting inject"
        exit 1
    fi
done
log "VS Code window found (waited ${WINDOW_COUNT}s)"
sleep 2

# ── 2. Focus the VS Code window ───────────────────────────────────────────────
WID=$(xdotool search --class "Code" | tail -1)
xdotool windowactivate --sync "$WID"
sleep 1

# ── 3. Open a new Copilot Chat via the command palette ───────────────────────
# Using the command palette is more reliable than keyboard shortcuts which
# can change between VS Code versions.
log "Opening command palette..."
xdotool key --clearmodifiers ctrl+shift+p
sleep 1

# Clear any stale text in the palette, type the command, execute it
xdotool key --clearmodifiers ctrl+a
xdotool type --clearmodifiers --delay 40 "GitHub Copilot Chat: New Chat"
sleep 0.5
xdotool key Return
sleep 3    # wait for chat panel to open and focus its input box

# ── 4. Type and submit the agent command ─────────────────────────────────────
log "Typing agent command: ${AGENT_COMMAND}"

# Clear any residual text in the chat input just in case
xdotool key --clearmodifiers ctrl+a
sleep 0.3

xdotool type --clearmodifiers --delay 40 "${AGENT_COMMAND}"
sleep 0.5
xdotool key Return

log "Done — sent: ${AGENT_COMMAND}"
