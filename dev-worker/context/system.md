# System Architecture

This document describes the full Waymark + dev-worker system you are running inside.
Read this at boot. It tells you what exists, where things live, and how they connect.

---

## The Waymark Application

**What it is:** A browser-first single-page app that renders Google Sheets as
beautiful, interactive views (kanban boards, budgets, checklists, recipe books, etc.).

**Stack:**
- Zero frameworks — vanilla ES modules, raw CSS, no build step
- Express server does 3 things only: serve static files, broker OAuth, inject flags
- All business logic runs in the browser
- Google Sheets is the database
- Google Drive is the file system

**Key rule:** Never put logic in the server. See `.github/instructions/AI_laws.instructions.md`
for the complete non-negotiable rule set (AI_LAWS). Every change must comply.

**Templates:** Each sheet type (kanban, budget, checklist, recipe, etc.) has:
- `public/js/templates/{key}.js` — detects + renders
- `public/css/templates/{key}.css` — scoped styles
- `tests/fixtures/sheets/{key}-*.json` — test fixtures
- Entry in `template-registry.json`

---

## The Waymark Workboard

**What it is:** A kanban Google Sheet that IS the project management system.
Waymark renders its own task board through the Waymark UI.

**Sheet ID:** `1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4`

**Columns:** Task | Description | Stage | Project | Assignee | Priority | Due | Label | Note

**Stages:** To Do → In Progress → QA → Done (also: Backlog, Archived)

**How it works:**
- Operator drops task ideas into "To Do" rows via the Waymark UI
- Agents poll it every 60 seconds via `scripts/check-workboard.js`
- Agents claim tasks (mark In Progress, set Assignee to AGENT_NAME)
- Agents implement, then mark QA
- Operator reviews in the Waymark UI, approves (→ Done) or rejects (→ To Do with note)

**Row format:** See AI_LAWS §15. Critical rule: notes go in sub-rows (column A empty,
note in column I), NOT in the task row itself.

---

## The Dev-Worker Container

**What it is:** A Docker container running one AI agent as pid 1 (via supervisord).
Multiple containers can run simultaneously, each with a unique AGENT_NAME.

**Stack:**
- `debian:bookworm-slim` base
- GitHub Copilot CLI (`copilot`) + Anthropic Claude Code (`claude`)
- Xvfb for real-headed Playwright tests
- Docker CLI (DooD — can spawn sibling containers)

**Entry points:**
- `scripts/entrypoint.sh` → init, git config, credential symlinks, learn-repo.sh
- `scripts/learn-repo.sh` → workspace introspection, MCP translation, CLAUDE.md gen
- `scripts/agent-runner.sh` → provider selection, watchdog loop

**AI providers:**
- `AI_PROVIDER=copilot` → uses `.github/agents/waymark-builder.agent.md` + MCP
- `AI_PROVIDER=claude` → uses `CLAUDE.md` + `.mcp.json` + ANTHROPIC_API_KEY
- `AI_PROVIDER=auto` → detected at startup from available credentials

---

## MCP Servers

Located in `/workspace/mcp/`. All are Node.js ES modules.

| Server | Purpose |
|---|---|
| `google-sheets.mjs` | Read/write Google Sheets (the workboard, Waymark sheets) |
| `waymark.mjs` | Waymark-specific operations (create sheets, manage Drive) |
| `orchestrator.mjs` | Task orchestration, sleep/wake cycles, notification rules |
| `mqtt-bridge.mjs` | Debug bridge to the Waymark browser session |

Auth: all servers use the Google SA key at
`/root/.config/gcloud/waymark-service-account-key.json`

MCP is configured automatically by `learn-repo.sh`:
- Copilot CLI: `~/.copilot/mcp.json`
- Claude Code: `/workspace/.mcp.json`

---

## Multi-Agent Topology

```
Operator (human)
    ↓ writes tasks to
Waymark Workboard (Google Sheets)
    ↓ polled by
dev-worker containers (N instances, unique AGENT_NAME each)
    ↓ each can run
Copilot /fleet subagents (parallel reasoning within one session)
    ↓ or spawn
Sibling containers via Docker socket (DooD)
    ↓ writing results back to
Waymark Workboard
    ↑ reviewed by
Operator (in the Waymark UI — not in the chat)
```

**Scaling:** To add more workers:
```bash
AGENT_NAME=beta docker compose -f dev-worker/docker-compose.yml up -d
AGENT_NAME=gamma docker compose -f dev-worker/docker-compose.yml up -d
```

Each container claims tasks independently. The `--agent $AGENT_NAME` flag on
`check-workboard.js` filters to tasks assigned to or unassigned to that agent.

---

## Credentials Available in Container

| Credential | Location | Used for |
|---|---|---|
| Google SA key | `/credentials/gsa-key.json` → `/root/.config/gcloud/waymark-service-account-key.json` | MCP servers, Drive/Sheets API |
| Copilot OAuth token | `/root/.copilot/config.json` | GitHub Copilot CLI |
| Anthropic API key | `ANTHROPIC_API_KEY` env var | Claude Code |
| SSH key | `/root/.ssh-rw/id_rsa` | Git push, SSH access |

---

## Key Scripts

| Script | What it does |
|---|---|
| `scripts/check-workboard.js` | One-shot workboard poll → JSON to stdout |
| `scripts/update-workboard.js` | Update a task's stage/notes |
| `npm test` | Playwright E2E suite (headed Chrome on Xvfb) |
| `npm run dev` | Start the Waymark dev server on :3000 |
| `docker compose -f dev-worker/docker-compose.yml up -d` | Start a dev-worker |

---

## Source of Truth for Rules

For ALL code changes to the Waymark app:
**`.github/instructions/AI_laws.instructions.md`** is the law. Non-negotiable.
Read it before making any change. Violations are rejected without exception.
