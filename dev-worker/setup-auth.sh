#!/usr/bin/env bash
# setup-auth.sh — Authenticate GitHub Copilot for the dev-worker container.
#
# Runs on your HOST machine (not inside the container).
#
# How it works:
#   1. Opens a temporary isolated VS Code on your desktop with --password-store=basic
#      so tokens are written to plain files (not encrypted with gnome-keyring)
#   2. You sign into GitHub Copilot — your host browser opens normally
#   3. You close VS Code once Copilot shows as active
#   4. This script injects the token files into the container's named auth volume
#   5. VS Code inside the container restarts and picks up the tokens
#
# Usage:
#   bash dev-worker/setup-auth.sh
#
# Re-auth when tokens expire:
#   bash dev-worker/setup-auth.sh   (same command every time)

set -euo pipefail

CONTAINER="waymark-dev-worker"
COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"
TEMP_DIR=""

cleanup() {
    [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]] && rm -rf "$TEMP_DIR"
}
# Only register cleanup after successful injection so the temp dir is
# preserved on failure for manual inspection.

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       Waymark Dev Worker — GitHub Copilot Auth Setup         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
if ! command -v code >/dev/null 2>&1; then
    echo "ERROR: 'code' (VS Code) is not in your PATH on the host."
    exit 1
fi

if ! docker ps --filter "name=^${CONTAINER}$" --filter "status=running" \
        --format "{{.Names}}" 2>/dev/null | grep -q "^${CONTAINER}$"; then
    echo "Container '${CONTAINER}' is not running — starting it..."
    docker compose -f "$COMPOSE_FILE" up -d
    sleep 12
fi

# ── Step 1: Open isolated VS Code on your desktop ────────────────────────────
TEMP_DIR=$(mktemp -d /tmp/vscode-auth-XXXXXX)

echo "→ Opening an isolated VS Code window for authentication..."
echo "  Your host extensions are loaded (Copilot Chat is available)."
echo ""
echo "  ┌─ What to do in the VS Code window ──────────────────────────────────┐"
echo "  │  1. Wait for VS Code to fully load (~10–20s)                        │"
echo "  │  2. Press Ctrl+Shift+P → type: GitHub Copilot: Sign in → Enter      │"
echo "  │  3. Your HOST browser opens GitHub OAuth — sign in there             │"
echo "  │  4. Wait for the VS Code status bar Copilot icon to turn active/blue │"
echo "  │  5. CLOSE this VS Code window                                         │"
echo "  └─────────────────────────────────────────────────────────────────────┘"
echo ""
echo "  Waiting for VS Code to close..."
echo ""

# --password-store=basic : tokens go to plain files, not gnome-keyring
# --extensions-dir       : reuse your host extensions (so Copilot Chat is present)
# --wait                 : block until VS Code window is closed
code \
    --user-data-dir     "$TEMP_DIR" \
    --extensions-dir    "${HOME}/.vscode/extensions" \
    --password-store=basic \
    --new-window \
    --wait
echo ""
echo "→ VS Code window closed."

# ── Step 2: Verify sign-in actually happened ──────────────────────────────────
GLOBAL_STORAGE="$TEMP_DIR/User/globalStorage"

if [[ ! -d "$GLOBAL_STORAGE" ]]; then
    echo ""
    echo "ERROR: VS Code did not create a globalStorage directory."
    echo "  The window may have closed too fast, or VS Code failed to start."
    echo "  → Re-run setup-auth.sh and keep VS Code open until Copilot is active."
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "  Sign-in storage found. Contents:"
ls "$GLOBAL_STORAGE" | sed 's/^/    /'
echo ""

# Tokens land in two possible places depending on VS Code version:
#   A. globalStorage/vscode.github-authentication/  (newer builds)
#   B. globalStorage/state.vscdb SQLite rows         (some builds on Linux)
# We check both; if either has data we proceed.
AUTH_DIR="$GLOBAL_STORAGE/vscode.github-authentication"
VSCDB="$GLOBAL_STORAGE/state.vscdb"

AUTH_OK=false
if [[ -d "$AUTH_DIR" ]]; then
    AUTH_OK=true
    echo "  ✓ vscode.github-authentication/ directory present"
fi
if [[ -f "$VSCDB" ]]; then
    DB_SIZE=$(stat -c%s "$VSCDB" 2>/dev/null || echo "0")
    if [[ "$DB_SIZE" -gt 16384 ]]; then      # a populated vscdb is well above 16 KB
        AUTH_OK=true
        echo "  ✓ state.vscdb present and non-empty (${DB_SIZE} bytes)"
    fi
fi

if ! $AUTH_OK; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  SIGN-IN INCOMPLETE — no token data found                    ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Signs that sign-in is COMPLETE:                             ║"
    echo "║   ✓ VS Code status bar Copilot icon is filled/blue           ║"
    echo "║   ✓ Toast notification: 'GitHub Copilot is ready'           ║"
    echo "║   ✓ GitHub.com OAuth page says 'You are now signed in'      ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  → Close VS Code, then re-run:  bash dev-worker/setup-auth.sh║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  Temp dir preserved for inspection: $TEMP_DIR"
    exit 1
fi

# ── Step 3: Inject into the container auth volume ─────────────────────────────
echo "→ Injecting token files into the container's auth volume..."

# Copy the entire globalStorage into the container's named volume.
# --overwrite ensures state.vscdb is replaced with the auth-bearing version.
tar -C "$GLOBAL_STORAGE" -cf - . \
    | docker exec -i "$CONTAINER" \
        tar -C /root/.config/Code/User/globalStorage -xf - --overwrite

echo "  ✓ Tokens injected."

# ── Step 4: Restart VS Code inside the container ─────────────────────────────
echo "→ Restarting VS Code inside the container..."
docker exec "$CONTAINER" pkill -f "code.*--no-sandbox" 2>/dev/null || true
echo "  Watchdog will relaunch VS Code within ~15 seconds..."
sleep 20

# ── Step 5: Verify ────────────────────────────────────────────────────────────
echo "→ Running verification tests..."
bash "$(dirname "$0")/test.sh" auth

echo ""
echo "  Open http://localhost:6080/vnc.html and check the Copilot"
echo "  icon in the VS Code status bar to confirm it's active."

# Temp dir cleanup only after successful run
trap cleanup EXIT
