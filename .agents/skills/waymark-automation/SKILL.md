---
name: waymark-automation
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Automation template (Engineering).
---

# Waymark Automation Skill

> Specialized skill for **Automation** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Automation domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `automation` |
| Template Name | Automation |
| Category | Engineering |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Automation sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. workflow
2. step
3. action
4. target
5. value
6. status
```

**Default headers when creating a new Automation sheet:**
```
Workflow, Step, Action, Target, Value, Status
```

**Detection signals** — headers that indicate a sheet is a Automation:
```
action, target, selector, workflow, automation, command
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `pending`
- `running`
- `done`
- `failed`
- `skipped`

Flow: `pending → running → done → failed → skipped`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — Automation

# Automation — Domain Knowledge

## What This Template Is
A workflow automation registry where each row is a step in a workflow. The `workflow` column groups steps by automation name. The `step` column labels this step. The `action` column describes what the step does. The `target` column is what the action acts on (API, service, object). The `value` column is the payload or parameter. The `status` column cycles through: pending → running → done → failed → skipped.

## Valid Status States
```
pending → running → done
                 ↘ failed → (retry) → running
                 ↘ skipped
```
Only write values from the valid states list. Never write arbitrary status strings.

## Smart Operations

### Workflow Summary
Group rows by `workflow`. For each workflow:
```
{workflow name} ({N} steps)
  pending: N  running: N  done: N  failed: N  skipped: N
```
Flag any workflow with `failed` steps: `⚠️ FAILED: {workflow} — {step} failed`

### Run Status Check
For a given workflow: find all steps not in `done` or `skipped`. These are the pending/blocked steps.
Report what's blocking completion.

### Advancing a Step
When told a step completed or failed:
- Find the row by workflow + step
- Write the new status (must be valid)
- If marking `done` and a next step exists in the workflow, set that step's status to `running`

### Resetting a Workflow
Set all steps in the workflow back to `pending`. Confirm before writing (this clears all progress).

### Failed Step Triage
Find all rows with `status = "failed"`. For each:
- Report: workflow, step name, action, target
- Suggest retry: set status to `pending` to re-queue

### Adding a Step
Append a row. Required: `workflow` (existing or new name), `step` (label), `action`, `target`.
Optional: `value`, status defaults to `pending`.

### Workflow Completion Check
A workflow is complete when all its steps are `done` or `skipped` (none are pending, running, or failed).
Report: `✅ {workflow} complete` or `⏳ {workflow} in progress ({X}% done)`

### Cross-Workflow Dependencies
If `target` of one step matches `workflow` of another (sub-workflow call pattern), identify these dependencies.

## Interpretation Rules
- Empty `value` = the action has no payload (not an error)
- A step stuck in `running` with no recent activity is likely stalled — flag after context suggests delay
- `skipped` is a valid terminal state — skipped steps are intentional bypasses, not errors
- Multiple workflows may have overlapping step names — always identify by workflow + step together

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
- For `toggle`, only write `pending` or `running`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet(title, "automation", initialEntries?)`
- Creates a sheet with the default Automation headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "automation", spreadsheetId?)`
- Searches entries across sheets matching the query.
