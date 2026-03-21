#!/usr/bin/env bash
# start-vscode.sh — Launch VS Code on the virtual display and wait for its window.
# Called by the agent-watchdog whenever VS Code is not running.
set -euo pipefail

source /etc/agent-env.sh 2>/dev/null || true

export DISPLAY=":1"
log() { echo "[start-vscode $(date +%T)] $*"; }

# ── Wait for the X display to be ready ───────────────────────────────────────
log "Waiting for X display :1..."
TIMEOUT=60
COUNT=0
until xdpyinfo -display :1 >/dev/null 2>&1; do
    sleep 1
    COUNT=$((COUNT + 1))
    if [[ $COUNT -ge $TIMEOUT ]]; then
        log "ERROR: X display :1 not ready after ${TIMEOUT}s — aborting"
        exit 1
    fi
done
log "X display ready"

# ── Launch VS Code ────────────────────────────────────────────────────────────
# --no-sandbox         : required when running as root inside a container
# --disable-gpu        : prevents GPU-related crashes on virtual displays
# --user-data-dir      : required by VS Code when running as root with --no-sandbox
# --password-store=basic : store auth tokens (GitHub Copilot OAuth) in a plain
#                          JSON file under globalStorage/ instead of gnome-keyring
#                          (which does not exist in the container). The globalStorage
#                          dir is a named Docker volume so tokens survive rebuilds.
log "Launching VS Code on /workspace..."
# BROWSER= : no browser inside container; VS Code shows a copyable auth URL instead
BROWSER="" code \
    --no-sandbox \
    --disable-gpu \
    --user-data-dir /root/.config/Code \
    --password-store=basic \
    /workspace &
VSCODE_PID=$!
log "VS Code launched (pid: ${VSCODE_PID})"

# ── Wait for the VS Code window to appear ────────────────────────────────────
TIMEOUT=90
COUNT=0
until xdotool search --class "Code" >/dev/null 2>&1; do
    sleep 1
    COUNT=$((COUNT + 1))
    if [[ $COUNT -ge $TIMEOUT ]]; then
        log "ERROR: VS Code window not detected after ${TIMEOUT}s"
        exit 1
    fi
done

log "VS Code window detected (waited ${COUNT}s)"
