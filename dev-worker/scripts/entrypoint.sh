#!/usr/bin/env bash
# entrypoint.sh — Container initialization for the AI dev worker.
# Supports GitHub Copilot CLI and Claude Code side-by-side.
# Runs as pid 1 → sets up environment → hands off to supervisord.
set -euo pipefail

log() { echo "[entrypoint $(date +%T)] $*"; }

# ── 1. Git identity ───────────────────────────────────────────────────────────
GIT_EMAIL="${GIT_EMAIL:-waymark-agent@container.local}"
GIT_NAME="${GIT_NAME:-Waymark Agent}"
git config --global user.email "$GIT_EMAIL"
git config --global user.name  "$GIT_NAME"
git config --global safe.directory /workspace
git config --global safe.directory '*'
log "Git identity: ${GIT_NAME} <${GIT_EMAIL}>"

# ── 2. REPO_URL: clone the repo if workspace is empty ────────────────────────
REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"
if [[ -n "$REPO_URL" ]]; then
    if [[ ! -d /workspace/.git ]]; then
        log "REPO_URL set — cloning ${REPO_URL} (branch: ${REPO_BRANCH}) into /workspace..."
        git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" /workspace
        log "Clone complete"
    else
        log "REPO_URL set but /workspace already has a git repo — skipping clone"
    fi
fi

# ── 3. Write /etc/agent-env.sh for child scripts ─────────────────────────────
# supervisord doesn't forward the container's environment to child processes.
# Write all dynamic vars here; every script sources this file at startup.
AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
AGENT_NAME="${AGENT_NAME:-}"
AGENT_HUMAN_NAME="${AGENT_HUMAN_NAME:-}"
AGENT_MODEL="${AGENT_MODEL:-claude-sonnet-4.6}"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-opus-4-5}"
AI_PROVIDER="${AI_PROVIDER:-auto}"
AGENTS_SHEET_ID="${AGENTS_SHEET_ID:-}"

cat > /etc/agent-env.sh <<EOF
# Written by entrypoint.sh — sourced by all scripts at runtime
export AGENT_COMMAND="${AGENT_COMMAND}"
export AGENT_NAME="${AGENT_NAME:-${AGENT_HUMAN_NAME}}"
export AGENT_HUMAN_NAME="${AGENT_HUMAN_NAME}"
export AGENT_MODEL="${AGENT_MODEL}"
export CLAUDE_MODEL="${CLAUDE_MODEL}"
export AI_PROVIDER="${AI_PROVIDER}"
export AGENTS_SHEET_ID="${AGENTS_SHEET_ID}"
export CONTAINER_NAME="${CONTAINER_NAME:-waymark-dev-worker}"
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-/credentials/gsa-key.json}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
export DISPLAY=":99"
export HOME="/root"
EOF
chmod 644 /etc/agent-env.sh
log "Agent env: NAME=${AGENT_HUMAN_NAME:-<unnamed>}, CMD=${AGENT_COMMAND}, MODEL=${AGENT_MODEL}, AI_PROVIDER=${AI_PROVIDER}"

# ── 4. Symlink Google credential ──────────────────────────────────────────────
if [[ -f /credentials/gsa-key.json ]]; then
    mkdir -p /root/.config/gcloud
    ln -sf /credentials/gsa-key.json /root/.config/gcloud/waymark-service-account-key.json
    log "Google SA credential symlinked → /root/.config/gcloud/"
    OPERATOR_HOME="${OPERATOR_HOME:-/home/tekjanson}"
    if [[ -n "$OPERATOR_HOME" && "$OPERATOR_HOME" != "/root" ]]; then
        mkdir -p "${OPERATOR_HOME}/.config/gcloud"
        ln -sf /credentials/gsa-key.json "${OPERATOR_HOME}/.config/gcloud/waymark-service-account-key.json"
        log "Google SA credential symlinked → ${OPERATOR_HOME}/.config/gcloud/"
    fi
fi

# ── 5. SSH key permissions ────────────────────────────────────────────────────
if [[ -d /root/.ssh ]]; then
    mkdir -p /root/.ssh-rw
    cp -r /root/.ssh/. /root/.ssh-rw/
    chmod 700 /root/.ssh-rw
    find /root/.ssh-rw -type f -name "id_*" ! -name "*.pub" -exec chmod 600 {} \;
    echo "export GIT_SSH_COMMAND='ssh -i /root/.ssh-rw/id_rsa -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/root/.ssh-rw/known_hosts'" \
        >> /etc/agent-env.sh
    log "SSH keys copied to /root/.ssh-rw with correct permissions"
fi

# ── 6. Docker socket permissions (DooD) ──────────────────────────────────────
if [[ -S /var/run/docker.sock ]]; then
    chmod 666 /var/run/docker.sock 2>/dev/null || true
    log "Docker socket permissions set — agent can spawn sibling containers"
fi

# ── 7. Workspace learning — scan repo for AI tooling and configure all agents ─
# This is the "brain injection" step: learn-repo.sh reads every AI config file
# in the workspace and configures each installed AI tool so it understands the
# project, has MCP servers wired up, and knows which provider to use.
if [[ -d /workspace ]]; then
    log "Running repo learning pass..."
    bash /scripts/learn-repo.sh \
        || log "WARNING: learn-repo.sh had errors — continuing with partial config"
else
    log "Workspace not mounted — skipping repo learning"
fi

# ── 8. Ensure log directory exists ───────────────────────────────────────────
mkdir -p /var/log/supervisor /tmp

log "Initialization complete — starting supervisord"
exec supervisord -n -c /etc/supervisord.conf
