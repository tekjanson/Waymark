---
name: waymark-notification
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Push Notification Rules template (Productivity).
---

# Waymark Push Notification Rules Skill

> Specialized skill for **Push Notification Rules** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Push Notification Rules domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `notification` |
| Template Name | Push Notification Rules |
| Category | Productivity |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Push Notification Rules sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. event
2. condition
3. title
4. body
5. priority
6. enabled
```

**Default headers when creating a new Push Notification Rules sheet:**
```
Title, Body, Type, URL, Published
```

**Detection signals** — headers that indicate a sheet is a Push Notification Rules:
```
event, condition, enabled
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Active`
- `Read`
- `Dismissed`

Flow: `Active → Read → Dismissed`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — Push Notification Rules

# Push Notification Rules — Domain Knowledge

## Purpose
This template configures which orchestra events trigger P2P push notifications to the user's Android device. Each row is one rule. The MCP orchestrator reads this sheet at startup and evaluates rules on every dispatch cycle.

## Schema

| Column    | Role      | Description |
|-----------|-----------|-------------|
| Event     | event     | The orchestrator event that triggers this rule (see events below) |
| Condition | condition | Optional sub-condition (leave blank to match all) |
| Title     | title     | Notification title sent to the device |
| Body      | body      | Notification body; supports `{{variables}}` (see below) |
| Priority  | priority  | `urgent` / `high` / `normal` / `low` |
| Enabled   | enabled   | `yes` or `no` — whether this rule is active |

## Valid Events

| Event             | Fires when… |
|-------------------|-------------|
| `DISPATCH`        | A task is dispatched to an agent |
| `TASK_QA`         | An agent marks a task as QA-ready |
| `TASK_DONE`       | A task is marked Done |
| `BLOCKED`         | A task is blocked and needs human input |
| `WAIT`            | Orchestrator is waiting (no ready tasks) |
| `IDLE`            | No tasks — entire board is complete or empty |
| `POLL_FAILED`     | Workboard poll returned an error |
| `CYCLE_RATE_HIGH` | Orchestrator is cycling unusually fast |
| `WAKE`            | Device reconnected or orchestrator woke up |

## Body Template Variables

Use `{{variableName}}` in the Body column:

| Variable        | Value |
|-----------------|-------|
| `{{agentName}}` | Name of the dispatched agent |
| `{{taskTitle}}` | Title of the current task |
| `{{task}}`      | Full task description (may be long) |
| `{{reason}}`    | Reason for BLOCKED / IDLE state |
| `{{doneCount}}` | Number of tasks marked Done |
| `{{qaCount}}`   | Number of tasks awaiting QA |
| `{{delta}}`     | Cycle time delta (ms) for CYCLE_RATE_HIGH |

## Priority Values
- `urgent` — plays full-volume alert on device
- `high` — high-importance notification
- `normal` — standard notification (default)
- `low` — silent / minimal interruption

## Enabled Column
- `yes` (or `true`, `1`, `on`) — rule is active
- `no` (or `false`, `0`, `off`) — rule is disabled

## Smart Operations

### Add a new rule
Use `waymark_add_entry` with all 6 columns. Example:
```
Event: DISPATCH
Condition: 
Title: 🚀 Task Dispatched
Body: {{agentName}} is working on "{{taskTitle}}"
Priority: normal
Enabled: yes
```

### Disable a rule
Find the row where Event matches, set Enabled column to `no`.
Use `waymark_update_entry` targeting the `enabled` column.

### Enable a rule
Set Enabled to `yes` via `waymark_update_entry`.

### Edit notification text
Use `waymark_update_entry` targeting the `title` or `body` column.

### Change priority
Use `waymark_update_entry` targeting the `priority` column.
Valid values: `urgent`, `high`, `normal`, `low`.

## Notes
- The orchestrator MCP server loads this sheet once at startup via `WAYMARK_RULES_SHEET_ID` env var.
- To hot-reload rules, restart the orchestrator (or call `orchestrator_boot` again).
- Blank Body falls back to a default message for the event type.
- Blank Condition matches any invocation of that event.
- Multiple rules can exist for the same Event (all matching rules fire).

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
- For `toggle`, only write `Active` or `Read`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet(title, "notification", initialEntries?)`
- Creates a sheet with the default Push Notification Rules headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "notification", spreadsheetId?)`
- Searches entries across sheets matching the query.
