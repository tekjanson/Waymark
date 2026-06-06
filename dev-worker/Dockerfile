FROM debian:bookworm-slim
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ── System utilities ──────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg git openssh-client procps \
    netcat-openbsd sqlite3 jq \
    # Virtual framebuffer — Xvfb gives real headed Chrome for Playwright E2E.
    # The AI agents themselves are headless; Xvfb only exists so `npm test`
    # can launch a real browser with full rendering (no --headless shortcuts).
    xvfb x11-utils \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js LTS (via NodeSource) ──────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Docker CLI + Compose plugin (Docker-outside-of-Docker) ────────────────────
# Only the CLI — the daemon runs on the host, socket is mounted at runtime.
# Lets the agent spawn sibling containers: parallel workers, test databases, etc.
RUN install -d -m 755 /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] \
       https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# ── Google Chrome (stable) for Playwright E2E tests ───────────────────────────
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
       | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] \
       https://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# ── AI CLI tools ─────────────────────────────────────────────────────────────
#
# Two providers installed side-by-side. The agent-runner.sh selects at runtime
# based on AI_PROVIDER env var (or auto-detects from available credentials).
#
# GitHub Copilot CLI — auth via ~/.copilot/config.json (volume-mounted)
#   --allow-all --autopilot: fully headless, no permission prompts
#   /fleet command: parallel subagent sessions within one invocation
#
# Claude Code — auth via ANTHROPIC_API_KEY env var (or ~/.claude.json)
#   --dangerously-skip-permissions: equivalent of Copilot's --allow-all
#   --print (-p): non-interactive single-turn mode (outer loop in agent-runner)
#
# Both read MCP servers from the workspace (see learn-repo.sh for config generation).
RUN npm install -g @github/copilot @anthropic-ai/claude-code

# ── Runtime directories ────────────────────────────────────────────────────────
RUN mkdir -p \
    /root/.copilot \
    /root/.claude \
    /var/log/supervisor \
    /workspace \
    /credentials

# ── Scripts, defaults, context, and supervisord ───────────────────────────────
COPY scripts/ /scripts/
COPY defaults/ /defaults/
COPY context/ /defaults/context/
COPY supervisord.conf /etc/supervisord.conf
RUN chmod +x /scripts/*.sh /defaults/hooks/*.sh

ENTRYPOINT ["/scripts/entrypoint.sh"]
