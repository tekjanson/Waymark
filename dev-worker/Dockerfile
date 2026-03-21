FROM debian:bookworm
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ── System, X11, VNC, and display tools ──────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    ca-certificates curl wget gnupg git openssh-client procps \
    imagemagick dbus-x11 netcat-openbsd sqlite3 xclip \
    # X11 + UI automation
    x11-utils xauth xdotool ydotool \
    # TigerVNC (virtual X11 display with built-in VNC server)
    tigervnc-standalone-server \
    # noVNC (browser-based VNC client) + websockify proxy
    novnc python3-websockify \
    # Minimal window manager
    openbox \
    # Process manager (pid 1)
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js LTS (via NodeSource) ──────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── VS Code (official Microsoft .deb repo) ────────────────────────────────────
RUN install -d -m 755 /etc/apt/keyrings \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
       | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/microsoft.gpg] \
       https://packages.microsoft.com/repos/code stable main" \
       > /etc/apt/sources.list.d/vscode.list \
    && apt-get update \
    && apt-get install -y code \
    && rm -rf /var/lib/apt/lists/*

# ── Copilot extensions (best-effort; the host volume mount may override) ──────
# --no-sandbox: required to run VS Code as root in a container
# || true: graceful failure if marketplace is unreachable at build time
RUN code --no-sandbox --disable-gpu \
    --user-data-dir /root/.config/Code \
    --extensions-dir /root/.vscode/extensions \
    --install-extension GitHub.copilot \
    --install-extension GitHub.copilot-chat \
    2>/dev/null || true

# ── Required runtime directories ──────────────────────────────────────────────
RUN mkdir -p \
    /root/.vnc \
    /root/.config/Code/User \
    /root/.config/openbox \
    /root/.vscode/extensions \
    /var/log/supervisor \
    /workspace \
    /credentials

# ── Scripts, config, and supervisord ──────────────────────────────────────────
COPY scripts/ /scripts/
COPY config/  /config/
COPY supervisord.conf /etc/supervisord.conf
RUN chmod +x /scripts/*.sh

EXPOSE 5901 6080

ENTRYPOINT ["/scripts/entrypoint.sh"]
