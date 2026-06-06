# Waymark Dev Worker — Copilot CLI Container

> A lean Debian container that runs the GitHub Copilot CLI agent headlessly.
> The agent operates autonomously in autopilot mode. When a session ends,
> the watchdog loop restarts it immediately. Xvfb provides a real virtual
> display so Playwright browser tests run against actual browsers, not mocks.

---

## Architecture

```
┌──────────────────────────── Container ──────────────────────────────────┐
│                                                                          │
│  ┌─────────────┐    ┌──────────────────────────────────────────────┐   │
│  │ supervisord │    │  agent-runner.sh (watchdog loop)             │   │
│  │  (pid 1)    │───▶│                                              │   │
│  └─────────────┘    │  while true; do                             │   │
│         │           │    copilot --allow-all --autopilot \         │   │
│         │           │      --model claude-sonnet-4.6 \             │   │
│         │           │      --add-dir /workspace \                  │   │
│         │           │      -p "@waymark-builder start"             │   │
│         │           │  done                                        │   │
│         │           └──────────────────────────────────────────────┘   │
│         │                                                               │
│         │           ┌──────────────────────────────────────────────┐   │
│         └──────────▶│  Xvfb :99 (virtual framebuffer)              │   │
│                     │  Real headed Chrome at DISPLAY=:99           │   │
│                     │  Used by: npm test → Playwright → Chromium   │   │
│                     └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
        │
   docker logs -f waymark-dev-worker
```

### Why keep Xvfb?

The Copilot CLI agent itself is headless — no display needed. But when the
agent runs `npm test`, Playwright launches real browser instances. Without
a display those browsers would need `--headless` mode, which is a mock.
With Xvfb, they get a full virtual display and render exactly as they would
on a real desktop. This is what makes the test suite genuine QA coverage,
not a simulation.

---

## What Was Replaced

| Before (VS Code GUI stack) | After (Copilot CLI) |
|---|---|
| VS Code GUI (Electron, 2GB shm) | Copilot CLI npm package |
| TigerVNC + noVNC (ports 5901, 6080) | Nothing — no GUI needed |
| Openbox window manager | Nothing |
| xdotool keyboard injection | `copilot --allow-all --autopilot -p` |
| inject-agent.sh (300 lines, 3-retry loop) | agent-runner.sh (50 lines) |
| setup-auth.sh gnome-keyring dance | `copilot --login` (once, on host) |
| SQLite state.vscdb seeding | Not needed |
| `--password-store=basic` workaround | Not needed |
| Auth named Docker volume | Host `~/.copilot/` mount |
| 2GB shm_size | Removed |
| 6 supervisor programs | 2 supervisor programs |

---

## Key Components

| Component | Choice | Reason |
|---|---|---|
| Base image | `debian:bookworm-slim` | Minimal, stable |
| Agent runtime | `@github/copilot` npm CLI | The actual agent — no GUI needed |
| Virtual display | Xvfb `:99` | Real browser rendering for Playwright |
| Browser | Google Chrome stable | Playwright E2E tests |
| Process manager | supervisord | Two programs: xvfb + agent-runner |
| Auth | `~/.copilot/config.json` mount | Plain JSON, no keyring complexity |

---

## File Structure

```
dev-worker/
  PLAN.md              # This document
  Dockerfile           # Lean image: Node.js + copilot CLI + Xvfb + Chrome
  docker-compose.yml   # Container config (no ports, no shm_size)
  supervisord.conf     # Two programs: xvfb + agent-runner
  scripts/
    entrypoint.sh      # Container init: git config, SSH keys, agent-env.sh
    agent-runner.sh    # Watchdog loop: runs copilot CLI, restarts on exit
  AUTH.md              # Auth setup documentation
  test.sh              # Diagnostic test suite
```

---

## Usage

```bash
# Start with default agent (waymark-builder)
docker compose -f dev-worker/docker-compose.yml up -d

# Override the agent command
AGENT_COMMAND="@waymark-builder-sub-board start" \
  docker compose -f dev-worker/docker-compose.yml up -d

# Multi-agent: run N containers with unique names
AGENT_NAME=alpha docker compose -f dev-worker/docker-compose.yml up -d
AGENT_NAME=beta  docker compose -f dev-worker/docker-compose.yml up -d

# Watch the agent work
docker logs -f waymark-dev-worker

# Diagnostics
bash dev-worker/test.sh
```

---

## Auth Setup

```bash
# First time (or after token expiry):
copilot --login   # on your HOST machine

# Container picks up the token automatically via volume mount.
# No restart needed if already running (token file is read each session).
```

---

## Scaling

Each container is stateless and independent. To run multiple agents:

1. Give each a unique `AGENT_NAME` (used for task claiming in the workboard)
2. Mount the same `~/.copilot/` directory (shared read-only token)
3. No port conflicts — no ports are exposed

At 10 agents × 12 heartbeats/hour = 120 API calls/hour (trivial quota usage).

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_COMMAND` | `@waymark-builder start` | Initial prompt for the CLI agent |
| `AGENT_NAME` | _(unset)_ | Agent identity for workboard claiming |
| `AGENT_MODEL` | `claude-sonnet-4.6` | Model passed to `--model` |
| `GIT_EMAIL` | `waymark-agent@container.local` | Git commit identity |
| `GIT_NAME` | `Waymark Agent` | Git commit identity |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/credentials/gsa-key.json` | Google SA key path |
