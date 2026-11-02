# Agent Registry — Domain Knowledge

## What This Template Is
A fleet registry and control plane for AI agents (`waymark-agents`). Each row defines an autonomous or scheduled agent worker, its LLM model/provider, operational status, system tuning/persona, assigned project/workboard, and launch command.

## Column Role Semantics
- `name` — Unique agent display name or handle (e.g., `Wayside Orchestrator`, `Dev Worker Alpha`).
- `model` — Model identifier (e.g., `gemini-3.8-flash-high`, `claude-sonnet-5-5-high`).
- `provider` — AI platform/runtime (`AGY`, `Google`, `Anthropic`, `Local`).
- `status` — Current operational state (`online`, `idle`, `busy`, `paused`, `offline`, `error`).
- `tuning` — Persona, skill specialization, or system instructions summary.
- `task` — Currently active task or assignment description.
- `project` — Target project or repository name.
- `heartbeat` — ISO-8601 UTC timestamp of last agent check-in.
- `workboard` — Linked Kanban or Share Ledger spreadsheet ID.
- `command` — CLI invocation command (e.g., `./run-wayside.sh <sheetId>`).

## Smart Operations

### Fleet Health & Status Inspection
- Identify stale agents whose `heartbeat` is older than expected while `status` is `online` or `busy`.
- Summarize active vs. idle agents by `provider` and `model`.
- When registering a new agent, populate `name`, `model`, `provider`, `status`, `tuning`, and `command`.
