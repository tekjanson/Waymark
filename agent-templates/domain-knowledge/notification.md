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
