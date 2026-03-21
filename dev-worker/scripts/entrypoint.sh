#!/usr/bin/env bash
# entrypoint.sh — Container initialization
# Runs as pid 1 → sets up environment → hands off to supervisord
set -euo pipefail

log() { echo "[entrypoint $(date +%T)] $*"; }

# ── 1. VNC (no password required) ───────────────────────────────────────────
# The VNC port is bound to 127.0.0.1 only in docker-compose.yml, so no
# password is needed. TigerVNC is started with -SecurityTypes None.
mkdir -p /root/.vnc
log "VNC ready (no password — localhost-only)"

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
        [[ "$name" == "globalStorage" ]] && continue  # never copy encrypted tokens
        dest="/root/.config/Code/User/$name"
        if [[ ! -e "$dest" ]]; then
            cp -r "$item" "$dest" 2>/dev/null || true
        fi
    done
    log "VS Code config seeded (globalStorage excluded)"
else
    log "No host VS Code config mounted — starting with fresh profile"
fi

# ── 3. Openbox autostart ──────────────────────────────────────────────────────
mkdir -p /root/.config/openbox
cp /config/openbox-autostart /root/.config/openbox/autostart
chmod +x /root/.config/openbox/autostart

# ── 3b. VS Code keybindings ──────────────────────────────────────────────────
# Install deterministic hotkeys for xdotool to drive Copilot Chat:
#   Ctrl+Shift+F12  →  Open agent-mode chat (workbench.action.chat.open {"mode":"agent"})
# These are installed every boot so they always win over any host-seeded bindings.
mkdir -p /root/.config/Code/User
cp /config/keybindings.json /root/.config/Code/User/keybindings.json
log "VS Code keybindings installed (Ctrl+Shift+F12 → agent chat)"

# ── 4. Git identity ───────────────────────────────────────────────────────────
GIT_EMAIL="${GIT_EMAIL:-waymark-agent@container.local}"
GIT_NAME="${GIT_NAME:-Waymark Agent}"
git config --global user.email "$GIT_EMAIL"
git config --global user.name  "$GIT_NAME"
git config --global safe.directory /workspace
log "Git identity: ${GIT_NAME} <${GIT_EMAIL}>"

# ── 5. Write /etc/agent-env.sh for child scripts ─────────────────────────────
# supervisord doesn't forward the container's environment to child processes,
# so we write the dynamic vars to a file that all scripts source at runtime.
AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
cat > /etc/agent-env.sh <<EOF
# Written by entrypoint.sh — sourced by watchdog and inject scripts
export AGENT_COMMAND="${AGENT_COMMAND}"
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-/credentials/gsa-key.json}"
export DISPLAY=":1"
export HOME="/root"
# BROWSER= (empty) prevents VS Code from opening a browser inside the container.
# On auth requests VS Code falls back to showing a "Copy Link" notification
# with the GitHub device-auth URL — paste it into your host browser to sign in.
export BROWSER=""
EOF
chmod 644 /etc/agent-env.sh
log "Agent env written: AGENT_COMMAND=${AGENT_COMMAND}"

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
#   - chat.tools.global.autoApprove + edits/terminal auto-approve (bypass all approvals)
#   - claudeAgent.enabled + allowDangerouslySkipPermissions (claude agent bypass)
#   - askAgent/exploreAgent/implementAgent/planAgent model = claude-sonnet-4.6
#   - chat.defaultMode = agent (always start in agent mode)
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

# ── 8. Seed state.vscdb with model selection + auto-approve state ────────────
# The main agent model and permission level are stored in VS Code's SQLite
# state database, NOT in settings.json. We pre-seed these so the agent starts
# with the correct model and auto-approve is active from the first session.
STATE_DB="/root/.config/Code/User/globalStorage/state.vscdb"
AGENT_MODEL="${AGENT_MODEL:-copilot/claude-sonnet-4.6}"
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$STATE_DB" ]]; then
    log "Seeding state.vscdb: model=${AGENT_MODEL}, auto-approve=on"
    sqlite3 "$STATE_DB" <<SQL
INSERT OR REPLACE INTO ItemTable (key, value) VALUES
    ('chat.currentLanguageModel.panel', '${AGENT_MODEL}'),
    ('chat.currentLanguageModel.panel.isDefault', 'false'),
    ('chat.tools.terminal.autoApprove.warningAccepted', 'true'),
    ('chat.lastChatMode', 'agent');
SQL
elif command -v sqlite3 >/dev/null 2>&1; then
    # state.vscdb doesn't exist yet; VS Code will create it on first launch.
    # Create the database and table so the settings are ready.
    log "Creating state.vscdb with model=${AGENT_MODEL}, auto-approve=on"
    mkdir -p "$(dirname "$STATE_DB")"
    sqlite3 "$STATE_DB" <<SQL
CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT);
INSERT OR REPLACE INTO ItemTable (key, value) VALUES
    ('chat.currentLanguageModel.panel', '${AGENT_MODEL}'),
    ('chat.currentLanguageModel.panel.isDefault', 'false'),
    ('chat.tools.terminal.autoApprove.warningAccepted', 'true'),
    ('chat.lastChatMode', 'agent');
SQL
else
    log "WARN: sqlite3 not available — cannot seed model/auto-approve into state.vscdb"
fi

# ── 9. Ensure log directory exists ───────────────────────────────────────────
mkdir -p /var/log/supervisor /tmp

log "Initialization complete — starting supervisord"
exec supervisord -n -c /etc/supervisord.conf
