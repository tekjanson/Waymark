#!/usr/bin/env bash
# entrypoint.sh — Container initialization
# Runs as pid 1 → sets up environment → hands off to supervisord
set -euo pipefail

log() { echo "[entrypoint $(date +%T)] $*"; }

# ── 1. VNC (no password required) ───────────────────────────────────────────
# The VNC port is bound to 127.0.0.1 only in docker-compose.yml, so no
# password is needed. TigerVNC is started with -SecurityTypes None.
mkdir -p /root/.vnc
# Clean stale X lock files from previous container runs — if these exist,
# Xtigervnc refuses to start with "Server is already active for display :1"
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
log "VNC ready (no password — localhost-only, stale locks cleaned)"

# ── 2. Seed VS Code user config from the host mount ──────────────────────────
# The host's ~/.config/Code/User is mounted read-only at /host-vscode-user.
# We copy it into the container so VS Code can write freely (auth tokens,
# extension state, workspace storage, etc.) without clobbering the host.
if [[ -d /host-vscode-user ]]; then
    log "Seeding VS Code user config from host mount (no-clobber, no globalStorage)..."
    # Seed settings, keybindings, snippets, etc. from the host profile.
    # CRITICAL: we explicitly exclude the host's globalStorage directory.
    # Host tokens are encrypted with the host's gnome-keyring / safeStorage key.
    # Copying them here causes: "Error while decrypting the ciphertext provided
    # to safeStorage.decryptString" because no keyring exists in the container.
    # The named Docker volume at globalStorage/ starts empty on first run and is
    # populated only by VS Code auth done via the host browser (BROWSER= flow).
    for item in /host-vscode-user/*; do
        name="$(basename "$item")"
        [[ "$name" == "globalStorage" ]]   && continue  # never copy encrypted tokens
        [[ "$name" == "workspaceStorage" ]] && continue  # can be gigabytes — not needed
        [[ "$name" == "History" ]]          && continue  # large edit history — not needed
        dest="/root/.config/Code/User/$name"
        if [[ ! -e "$dest" ]]; then
            cp -r "$item" "$dest" 2>/dev/null || true
        fi
    done
    log "VS Code config seeded (globalStorage excluded)"
else
    log "No host VS Code config mounted — starting with fresh profile"
fi

# ── 2b. Archive-and-wipe workspaceStorage ────────────────────────────────────
# workspaceStorage is bind-mounted to agent-logs/vscode-workspace-storage on
# the host so Copilot chat debug logs are visible in real time. But we never
# want a previous run's data to bleed into the current session — VS Code must
# always start with an empty directory so state is deterministic.
#
# Strategy: if anything already exists there, move it into a timestamped
# archive subdirectory (keeping it on the host for inspection), then let VS
# Code recreate the directory fresh.
WS_DIR="/root/.config/Code/User/workspaceStorage"
if [[ -d "$WS_DIR" ]] && [[ -n "$(ls -A "$WS_DIR" 2>/dev/null)" ]]; then
    ARCHIVE_TS="$(date -u +%Y-%m-%d-%H%M%S)"
    ARCHIVE_DIR="$WS_DIR/archive/$ARCHIVE_TS"
    mkdir -p "$ARCHIVE_DIR"
    # Move all entries except the archive folder itself
    for entry in "$WS_DIR"/*; do
        name="$(basename "$entry")"
        [[ "$name" == "archive" ]] && continue
        mv "$entry" "$ARCHIVE_DIR/" 2>/dev/null || true
    done
    log "workspaceStorage archived to archive/$ARCHIVE_TS — container starts clean"
else
    log "workspaceStorage is empty — nothing to archive"
fi
mkdir -p "$WS_DIR"

# ── 3. Openbox autostart ──────────────────────────────────────────────────────
mkdir -p /root/.config/openbox
cp /config/openbox-autostart /root/.config/openbox/autostart
chmod +x /root/.config/openbox/autostart

# ── 3b. VS Code keybindings (dynamic — embeds AGENT_COMMAND) ─────────────────
# Keybindings:
#   Ctrl+Shift+F9  → acceptTool   (clears stuck "Allow" confirmations)
#   Ctrl+Shift+F10 → /autoApprove (legacy fallback — autopilot mode handles this now)
#   Ctrl+Shift+F12 → agent chat mode + auto-submit prompt
#   Ctrl+Shift+F11 → agent chat mode + partial query (for debugging)
#
# IMPORTANT: If AGENT_COMMAND starts with "@agentName prompt", we split it so
# that "agentName" becomes the chat *mode* and "prompt" becomes the query text.
# This prevents VS Code from wrapping the session in a runSubagent call, which
# would mean the agent runs nested and cannot itself call runSubagent.
AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
mkdir -p /root/.config/Code/User
python3 -c "
import json, os, re
cmd = os.environ.get('AGENT_COMMAND', '@waymark-builder start')

# Parse '@agentName rest' syntax into a mode + query pair
m = re.match(r'^@(\S+)\s*(.*)', cmd.strip())
if m:
    agent_mode = m.group(1)   # e.g. 'waymark-orchestrator'
    query      = m.group(2)   # e.g. 'start'
else:
    agent_mode = 'agent'
    query      = cmd

kb = [
    {
        'key': 'ctrl+shift+f9',
        'command': 'workbench.action.chat.acceptTool'
    },
    {
        'key': 'ctrl+shift+f10',
        'command': 'workbench.action.chat.open',
        'args': {'mode': 'autopilot', 'query': '/autoApprove', 'isPartialQuery': False}
    },
    {
        'key': 'ctrl+shift+f12',
        'command': 'workbench.action.chat.open',
        'args': {'mode': agent_mode, 'query': query, 'isPartialQuery': False}
    },
    {
        'key': 'ctrl+shift+f11',
        'command': 'workbench.action.chat.open',
        'args': {'mode': agent_mode, 'query': query, 'isPartialQuery': True}
    }
]
with open('/root/.config/Code/User/keybindings.json', 'w') as f:
    json.dump(kb, f, indent=4)
print(f'[entrypoint] Keybindings: mode={agent_mode!r} query={query!r}')
"
log "VS Code keybindings installed (F12→mode submit: ${AGENT_COMMAND})"

# ── 4. Git identity ───────────────────────────────────────────────────────────
GIT_EMAIL="${GIT_EMAIL:-waymark-agent@container.local}"
GIT_NAME="${GIT_NAME:-Waymark Agent}"
git config --global user.email "$GIT_EMAIL"
git config --global user.name  "$GIT_NAME"
git config --global safe.directory /workspace
log "Git identity: ${GIT_NAME} <${GIT_EMAIL}>"

# ── 4b. Checkout base branch (so agent work forks from it, not main) ─────────
if [[ -n "${AGENT_BASE_BRANCH:-}" ]]; then
    if git -C /workspace rev-parse --verify "${AGENT_BASE_BRANCH}" >/dev/null 2>&1; then
        git -C /workspace checkout "${AGENT_BASE_BRANCH}" 2>&1 || true
        log "Checked out base branch: ${AGENT_BASE_BRANCH}"
    else
        log "WARN: AGENT_BASE_BRANCH=${AGENT_BASE_BRANCH} not found — staying on current branch"
    fi
fi

# ── 5. Write /etc/agent-env.sh for child scripts ─────────────────────────────
# supervisord doesn't forward the container's environment to child processes,
# so we write the dynamic vars to a file that all scripts source at runtime.
AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
AGENT_NAME="${AGENT_NAME:-}"
WAYMARK_WORKBOARD_URL="${WAYMARK_WORKBOARD_URL:-}"
cat > /etc/agent-env.sh <<EOF
# Written by entrypoint.sh — sourced by watchdog and inject scripts
export AGENT_COMMAND="${AGENT_COMMAND}"
export AGENT_NAME="${AGENT_NAME}"
export AGENT_BASE_BRANCH="${AGENT_BASE_BRANCH:-feat/p2p-server-notification-pipeline}"
export CONTAINER_NAME="${CONTAINER_NAME:-waymark-dev-worker}"
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-/credentials/gsa-key.json}"
export WAYMARK_WORKBOARD_URL="${WAYMARK_WORKBOARD_URL}"
export DISPLAY=":1"
export HOME="/root"
# BROWSER= (empty) prevents VS Code from opening a browser inside the container.
# On auth requests VS Code falls back to showing a "Copy Link" notification
# with the GitHub device-auth URL — paste it into your host browser to sign in.
export BROWSER=""
EOF
chmod 644 /etc/agent-env.sh
log "Agent env written: AGENT_COMMAND=${AGENT_COMMAND}, AGENT_NAME=${AGENT_NAME:-<unset>}, CONTAINER_NAME=${CONTAINER_NAME:-waymark-dev-worker}, WAYMARK_WORKBOARD_URL=${WAYMARK_WORKBOARD_URL:-<unset>}"

# ── 5b. Symlink Google credential for MCP server + agent terminal commands ────
# Two paths reference the service-account key:
#   1. .vscode/mcp.json uses ${userHome}/.config/gcloud/waymark-service-account-key.json
#      → resolves to /root/.config/gcloud/... inside the container
#   2. Agent instructions hardcode /home/tekjanson/.config/gcloud/waymark-service-account-key.json
#      (the host path, used in terminal commands like `GOOGLE_APPLICATION_CREDENTIALS=... node ...`)
# The actual credential is mounted at /credentials/gsa-key.json.
# Create symlinks so BOTH paths resolve inside the container.
if [[ -f /credentials/gsa-key.json ]]; then
    mkdir -p /root/.config/gcloud
    ln -sf /credentials/gsa-key.json /root/.config/gcloud/waymark-service-account-key.json
    mkdir -p /home/tekjanson/.config/gcloud
    ln -sf /credentials/gsa-key.json /home/tekjanson/.config/gcloud/waymark-service-account-key.json
    log "Google SA credential symlinked → /root/.config/gcloud/ + /home/tekjanson/.config/gcloud/"
fi

# ── 5d. Symlink OAuth user token for Drive uploads ───────────────────────────
# generate-test-report.js --upload and generate-examples.js use a user OAuth
# token (not the SA key) because service accounts have no Drive quota.
# The token is mounted read-only at /root/.config/gcloud/waymark-oauth-token.json
# but the script resolves HOME dynamically — also symlink the tekjanson path.
if [[ -f /root/.config/gcloud/waymark-oauth-token.json ]]; then
    mkdir -p /home/tekjanson/.config/gcloud
    ln -sf /root/.config/gcloud/waymark-oauth-token.json \
        /home/tekjanson/.config/gcloud/waymark-oauth-token.json
    log "OAuth user token symlinked → /home/tekjanson/.config/gcloud/waymark-oauth-token.json"
else
    log "WARN: waymark-oauth-token.json not mounted — Drive uploads will fail. Run: node scripts/get-oauth-token.js"
fi

# ── 6. SSH key permissions ────────────────────────────────────────────────────
# The host ~/.ssh is mounted read-only. Copy to a writable directory so SSH
# can use the keys without errors about insecure permissions on a read-only overlay.
if [[ -d /root/.ssh ]]; then
    mkdir -p /root/.ssh-rw
    cp -r /root/.ssh/. /root/.ssh-rw/
    chmod 700 /root/.ssh-rw
    find /root/.ssh-rw -type f -name "id_*" ! -name "*.pub" -exec chmod 600 {} \;
    # Append to agent-env.sh so child scripts inherit the SSH override
    echo "export GIT_SSH_COMMAND='ssh -i /root/.ssh-rw/id_rsa -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/root/.ssh-rw/known_hosts'" \
        >> /etc/agent-env.sh
    log "SSH keys copied to /root/.ssh-rw with correct permissions"
fi

# ── 7. Write agent VS Code settings ──────────────────────────────────────────
# Merge /config/vscode-settings.json into the live settings.json.
# This always wins over the host seed so agent-critical settings are guaranteed:
#   - chat.defaultMode = autopilot (highest permission level, auto-approves all tools)
#   - chat.tools.global.autoApprove + edits/terminal auto-approve (legacy fallback)
#   - claudeAgent.enabled + allowDangerouslySkipPermissions (claude agent bypass)
#   - askAgent/exploreAgent/implementAgent/planAgent model = claude-sonnet-4.6
SETTINGS_FILE="/root/.config/Code/User/settings.json"
AGENT_SETTINGS="/config/vscode-settings.json"
python3 - <<'PYEOF'
import json, os
settings_path = os.environ.get('SETTINGS_FILE', '/root/.config/Code/User/settings.json')
agent_path    = '/config/vscode-settings.json'
try:
    with open(settings_path) as f:
        settings = json.load(f)
except Exception:
    settings = {}
with open(agent_path) as f:
    agent = json.load(f)
settings.update(agent)
os.makedirs(os.path.dirname(settings_path), exist_ok=True)
with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=4)
print(f"[entrypoint] VS Code agent settings applied to {settings_path}")
PYEOF
log "VS Code agent settings applied"

# ── 8. Seed state.vscdb with model selection + autopilot mode ──────────────
# The main agent model and permission level are stored in VS Code's SQLite
# state database, NOT in settings.json. We pre-seed these so the agent starts
# with the correct model and autopilot mode is active from the first session.
STATE_DB="/root/.config/Code/User/globalStorage/state.vscdb"
AGENT_MODEL="${AGENT_MODEL:-copilot/claude-sonnet-4.6}"
# Derive the chat mode from AGENT_COMMAND (strip leading '@' if present)
CHAT_MODE=$(python3 -c "
import os, re
cmd = os.environ.get('AGENT_COMMAND', '@waymark-builder start')
m = re.match(r'^@(\S+)', cmd.strip())
print(m.group(1) if m else 'agent')
")
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$STATE_DB" ]]; then
    log "Seeding state.vscdb: model=${AGENT_MODEL}, mode=${CHAT_MODE}"
    sqlite3 "$STATE_DB" <<SQL
INSERT OR REPLACE INTO ItemTable (key, value) VALUES
    ('chat.currentLanguageModel.panel', '${AGENT_MODEL}'),
    ('chat.currentLanguageModel.panel.isDefault', 'false'),
    ('chat.tools.terminal.autoApprove.warningAccepted', 'true'),
    ('chat.tools.global.autoApprove.optIn', 'true'),
    ('chat.lastChatMode', '${CHAT_MODE}');
SQL
elif command -v sqlite3 >/dev/null 2>&1; then
    # state.vscdb doesn't exist yet; VS Code will create it on first launch.
    # Create the database and table so the settings are ready.
    log "Creating state.vscdb with model=${AGENT_MODEL}, mode=${CHAT_MODE}"
    mkdir -p "$(dirname "$STATE_DB")"
    sqlite3 "$STATE_DB" <<SQL
CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT);
INSERT OR REPLACE INTO ItemTable (key, value) VALUES
    ('chat.currentLanguageModel.panel', '${AGENT_MODEL}'),
    ('chat.currentLanguageModel.panel.isDefault', 'false'),
    ('chat.tools.terminal.autoApprove.warningAccepted', 'true'),
    ('chat.tools.global.autoApprove.optIn', 'true'),
    ('chat.lastChatMode', '${CHAT_MODE}');
SQL
else
    log "WARN: sqlite3 not available — cannot seed model/chat mode into state.vscdb"
fi

# ── 9. Ensure log directory exists ───────────────────────────────────────────
mkdir -p /var/log/supervisor /tmp

log "Initialization complete — starting supervisord"
exec supervisord -n -c /etc/supervisord.conf
