---
name: waymark-agents
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Agent Registry template (Engineering).
---

# Waymark Agent Registry Skill

> Specialized skill for **Agent Registry** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Agent Registry domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `agents` |
| Template Name | Agent Registry |
| Category | Engineering |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Agent Registry sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. name
2. model
3. provider
4. status
5. tuning
6. task
7. project
8. heartbeat
9. workboard
10. command
```

**Default headers when creating a new Agent Registry sheet:**
```
Name, Model, Provider, Status, Tuning, Task, Project, Heartbeat, Workboard, Command
```

**Detection signals** — headers that indicate a sheet is a Agent Registry:
```
tuning, personality, agent, heartbeat, provider
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Agent Registry

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

---

## 4. MCP TOOL OPERATIONS

### 4.1 Reading a Sheet
Call `waymark_get_sheet(spreadsheetId, sheetTitle?)`
- Returns `templateKey`, `columnRoles{}`, and `rows[]` as objects with role-named keys.
- Always resolve columns by role name, not index.

### 4.2 Updating an Existing Row
Call `waymark_update_entry(spreadsheetId, rowIndex, updates, sheetTitle?)`
- `rowIndex` is 1-based data row index (1 = first row under headers).
- `updates` is `{ roleName: newValue }`.
- For `status-cycle`, only write values from the valid states list (§2).
- For `toggle`, only write `done` or ``.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet({ templateKey: "agents", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Agent Registry headers and initial rows.
- Created under user account via OAuth, automatically shared with service account and editors.
- Returns `{ spreadsheetId, waymarkUrl, sheetsUrl, title, templateKey }`.

### 4.5 Searching Entries & Files
- Search rows in a sheet: Call `waymark_search_entries({ spreadsheetId, query, column? })`.
- Search files in Google Drive: Call `waymark_list_files({ query?, type?: 'all'|'spreadsheet'|'document'|'folder', parentFolderId? })`.
- Share a sheet: Call `waymark_share_sheet({ spreadsheetId, shareWith?, shareWithAnyone?, role? })`.

### 4.6 Document Operations
- Create Google Doc: Call `waymark_create_doc({ title, body?, parentFolderId?, shareWith? })`.
- Read Google Doc: Call `waymark_get_doc({ documentId })`.
- Append to Google Doc: Call `waymark_append_doc({ documentId, text })`.
