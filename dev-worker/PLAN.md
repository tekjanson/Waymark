# Waymark Dev Worker Container — Implementation Plan

> A Debian GUI Docker container that runs a VS Code GitHub Copilot agent continuously.
> When the agent session ends, the watchdog restarts it automatically.
> The agent command is fully configurable — works with any agent.

---

## Goal

Keep a GitHub Copilot agent running inside VS Code indefinitely inside a container,
accessible via a browser-based VNC desktop. The only thing that needs to change between
different agent modes is the `AGENT_COMMAND` environment variable.

---

## Architecture

```
┌─────────────────────────── Container ──────────────────────────────┐
│                                                                     │
│  ┌────────────┐   ┌─────────────┐   ┌──────────────────────────┐  │
│  │ supervisord│   │  TigerVNC   │   │  VS Code + Copilot Agent │  │
│  │  (pid 1)   │──▶│  (port 5901)│──▶│  (DISPLAY=:1)            │  │
│  └────────────┘   └────────────┘   └──────────────────────────┘  │
│         │              │                        ▲                  │
│         │         ┌────────────┐                │                  │
│         │         │  noVNC     │        ┌───────────────┐         │
│         │         │  (port 6080│        │  agent-       │         │
│         │         │  browser)  │        │  watchdog.sh  │         │
│         │         └────────────┘        └───────────────┘         │
│         │                                       │                  │
│         └──────────────────────────────────────▶│                  │
│                                                  │ xdotool          │
│  ┌──────────────────────┐                       │ restarts         │
│  │  ydotoold daemon     │                       ▼                  │
│  │  (/dev/uinput)       │           ┌───────────────────┐         │
│  └──────────────────────┘           │  Copilot Chat     │         │
│                                     │  $AGENT_COMMAND   │         │
│                                     └───────────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
         │                     │
    browser:6080          port 5901 (raw VNC)
```

---

## Key Component Decisions

| Component | Choice | Reason |
|-----------|--------|--------|
| Base image | `debian:bookworm` | Stable, same family as host Debian 13 |
| Display server | TigerVNC standalone (`Xtigervnc`) | Integrated VNC+X11, no Xvfb+x11vnc combo needed |
| Browser access | noVNC (port 6080) | No VNC client needed, works in any browser |
| Window manager | Openbox | Minimal, fast, no taskbar clutter |
| Process manager | supervisord | Per-process restart policies, single pid 1 |
| UI automation | xdotool (primary) + ydotool (installed) | xdotool targets DISPLAY=:1 directly inside container; ydotool's uinput path routes to the host display so is secondary |
| VS Code | Official Microsoft .deb | Full Copilot extension support |
| Copilot auth | Mounted host VS Code profile | Pre-authenticated tokens flow in via volume |

> **ydotool note:** `ydotool` operates via `/dev/uinput` at the kernel level. In a container
> with a virtual X11 server (TigerVNC), uinput events route to the HOST's X server, not the
> container's virtual display. So `xdotool` (which targets `DISPLAY=:1` directly) is the
> correct tool for driving VS Code inside the container. `ydotool` + `ydotoold` are installed
> for any cases where kernel-level input injection is explicitly needed.

---

## File Structure

```
dev-worker/
  PLAN.md                     # This document
  Dockerfile                  # Container image definition
  docker-compose.yml          # Standalone compose (separate from production)
  supervisord.conf            # Process supervision config
  scripts/
    entrypoint.sh             # Container init (sets VNC password, starts supervisord)
    start-vscode.sh           # Opens VS Code on DISPLAY=:1, waits for window
    inject-agent.sh           # xdotool: opens Copilot chat, types $AGENT_COMMAND, hits Enter
    agent-watchdog.sh         # The immortality loop — detects dead sessions, reinjects
  config/
    openbox-autostart         # Openbox autostart → calls start-vscode.sh
```

---

## Flexible Agent Kickoff

The `AGENT_COMMAND` environment variable controls what gets typed into the Copilot chat
panel on every start and restart. The container is agent-agnostic.

### Examples at launch

```bash
# Default — waymark-builder persistent loop
docker compose -f dev-worker/docker-compose.yml up -d

# Run the sub-board (local-only, never pushes) variant
AGENT_COMMAND="@waymark-builder-sub-board start" \
  docker compose -f dev-worker/docker-compose.yml up -d

# Pick a single specific task
AGENT_COMMAND="@waymark-builder pick next" \
  docker compose -f dev-worker/docker-compose.yml up -d

# Any future agent with any arguments
AGENT_COMMAND="@my-new-agent run --flag" \
  docker compose -f dev-worker/docker-compose.yml up -d

# Or persist the choice with a .env file
echo 'AGENT_COMMAND=@waymark-builder-sub-board start' > dev-worker/.env
docker compose -f dev-worker/docker-compose.yml up -d
```

---

## Script Details

### `inject-agent.sh`

Types `$AGENT_COMMAND` into the Copilot Chat panel.

```bash
#!/usr/bin/env bash
# inject-agent.sh — Types $AGENT_COMMAND into Copilot Chat

AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"

# Wait for VS Code window to exist (up to 60s)
DISPLAY=:1 xdotool search --sync --class "Code" --timeout 60 >/dev/null

# Open Copilot Chat panel
DISPLAY=:1 xdotool key --clearmodifiers ctrl+shift+i
sleep 2

# Clear any stale text, then type the command
DISPLAY=:1 xdotool key --clearmodifiers ctrl+a
DISPLAY=:1 xdotool type --clearmodifiers --delay 50 "${AGENT_COMMAND}"
sleep 1
DISPLAY=:1 xdotool key Return

echo "[inject] Sent: ${AGENT_COMMAND}"
```

### `agent-watchdog.sh`

Runs as a supervised process. Checks every 60 seconds whether the agent session is still
alive via a heartbeat file. If stale, re-injects the agent command.

```bash
#!/usr/bin/env bash
# agent-watchdog.sh — Keeps the agent alive indefinitely.

AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
HEARTBEAT_FILE="/tmp/agent-heartbeat"
STALE_THRESHOLD=600   # seconds — 10 minutes without a heartbeat = session dead

log() { echo "[watchdog $(date +%T)] $*"; }

inject() {
    log "Injecting agent command: ${AGENT_COMMAND}"
    /scripts/inject-agent.sh
}

# Always inject on first boot
inject

while true; do
    sleep 60

    # Check if VS Code is still running
    if ! pgrep -x "code" > /dev/null; then
        log "VS Code not running — relaunching"
        /scripts/start-vscode.sh &
        sleep 15
        inject
        continue
    fi

    # Check heartbeat file (agent pokes this each sleep cycle via a terminal watcher)
    if [[ -f "$HEARTBEAT_FILE" ]]; then
        AGE=$(( $(date +%s) - $(stat -c %Y "$HEARTBEAT_FILE") ))
        if [[ $AGE -gt $STALE_THRESHOLD ]]; then
            log "Heartbeat stale (${AGE}s) — agent session ended, restarting"
            inject
            touch "$HEARTBEAT_FILE"   # reset so we don't double-fire
        else
            log "Heartbeat fresh (${AGE}s ago) — agent alive"
        fi
    else
        log "No heartbeat file yet — agent still starting up"
    fi
done
```

---

## Dockerfile Layers

Ordered by change frequency (most stable first for cache efficiency):

1. `debian:bookworm` base
2. System & X11: `xvfb` fallback, `x11-utils`, `openbox`, `procps`
3. TigerVNC: `tigervnc-standalone-server`
4. noVNC + websockify (via apt)
5. UI tools: `xdotool`, `ydotool`, `imagemagick` (for screenshot monitoring)
6. Node.js LTS (via NodeSource .deb)
7. VS Code (Microsoft .deb from packages.microsoft.com)
8. Copilot extensions: `GitHub.copilot` + `GitHub.copilot-chat`
9. Python + supervisord
10. Copy `scripts/` and `config/` → `ENTRYPOINT ["/scripts/entrypoint.sh"]`

---

## `docker-compose.yml`

```yaml
services:
  waymark-dev-worker:
    build: ./dev-worker
    ports:
      - "6080:6080"   # noVNC browser access
      - "5901:5901"   # Raw VNC (optional)
    environment:
      - DISPLAY=:1
      - VNC_PASSWORD=${VNC_PASSWORD:-waymark}
      - AGENT_COMMAND=${AGENT_COMMAND:-@waymark-builder start}
      - GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json
    devices:
      - /dev/uinput
    shm_size: 2g
    restart: unless-stopped
    volumes:
      - /home/tekjanson/Documents/Code/Waymark:/workspace
      - /home/tekjanson/.config/Code/User:/root/.config/Code/User:ro
      - /home/tekjanson/.vscode/extensions:/root/.vscode/extensions
      - /home/tekjanson/.config/gcloud/waymark-service-account-key.json:/credentials/gsa-key.json:ro
      - /home/tekjanson/.ssh:/root/.ssh:ro
```

---

## Volume Mounts

| Host path | Container path | Access | Purpose |
|-----------|---------------|--------|---------|
| `~/Documents/Code/Waymark` | `/workspace` | rw | The codebase the agent works on |
| `~/.config/Code/User` | `/root/.config/Code/User` | ro | Pre-authenticated Copilot tokens |
| `~/.vscode/extensions` | `/root/.vscode/extensions` | rw | Extension cache (avoids re-downloading) |
| `~/.config/gcloud/waymark-service-account-key.json` | `/credentials/gsa-key.json` | ro | Google service account for workboard |
| `~/.ssh` | `/root/.ssh` | ro | SSH keys for git push |

---

## Open Questions (to settle before implementation)

1. **VS Code profile auth strategy** — Mount host's existing `~/.config/Code/User` (tokens
   reused, no re-auth needed) vs fresh container profile (must re-auth via noVNC browser on
   first run)? Mounting host profile is recommended.

2. **Which agent is the default** — `waymark-builder` (pushes branches) or
   `waymark-builder-sub-board` (local-only, never pushes)? The default in `AGENT_COMMAND`
   can reflect whatever is safer.

3. **noVNC binding** — `127.0.0.1:6080` (local only, SSH tunnel to access remotely) vs
   `0.0.0.0:6080` with VNC password? Local-only is more secure.

4. **Git identity** — Should the container use its own `git config user.email/name`, or rely
   on the host's `.gitconfig` being mounted?

5. **Extensions volume** — Mount host `~/.vscode/extensions` (fast, no download) vs let
   container build its own extension volume? Host mount is faster but may cause permission
   issues if VS Code versions differ.

---

## V2: Decentralized Watchdog & Multi-Agent Support

### What Changed

The internal three-tier health model (HEALTHY/STUCK/DEAD) in `agent-watchdog.sh` has been
replaced by an **external host-side watchdog** that reads the Waymark Workboard for heartbeats.

| Before (v1) | After (v2) |
|---|---|
| `heartbeat-watcher.sh` watches VS Code log mtime | Agent writes heartbeat to Heartbeat sheet tab |
| `agent-watchdog.sh` runs forever inside container | `agent-watchdog.sh` runs once (boot only) |
| Health monitoring inside container | `host-watchdog.sh` monitors from host, restarts stale containers |
| Single agent ("AI") hardcoded | Named agents via `AGENT_NAME` env var |
| No race protection on task claiming | Verify-after-claim (write→wait→re-read) |
| Auto-approve / bypass mode | Autopilot mode (new highest permission level) |

### New Files

- `scripts/check-heartbeat.js` — Reads Heartbeat sheet tab, reports per-agent age
- `dev-worker/scripts/host-watchdog.sh` — Host-side cron/loop that restarts stale containers

### Removed Files

- `dev-worker/scripts/heartbeat-watcher.sh` — Replaced by workboard-based heartbeats

### Multi-Agent Architecture

Each container gets a unique `AGENT_NAME` (e.g., `alpha`, `beta`). The agent uses this name
for claiming tasks, writing notes, and heartbeat check-ins. When `--agent` is passed to
`check-workboard.js`, it filters: To Do shows unassigned + own tasks; In Progress shows own only.

**Scaling:** `AGENT_NAME=alpha docker compose ... up -d` — run N containers with unique names.
At 100 agents × 12 heartbeats/hour = 1,200 API calls/hour (well within Google Sheets' 18,000/hr quota).

### Heartbeat Sheet Tab

A separate "Heartbeat" sheet tab (not on Sheet1) stores per-agent check-ins:
| A: Agent | B: Timestamp | C: Status | D: Container |
Safe because kanban template detection only reads column headers, never scans tab names.
