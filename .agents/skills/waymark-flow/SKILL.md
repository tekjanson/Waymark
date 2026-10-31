---
name: waymark-flow
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Flow Diagram template (Engineering).
---

# Waymark Flow Diagram Skill

> Specialized skill for **Flow Diagram** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Flow Diagram domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `flow` |
| Template Name | Flow Diagram |
| Category | Engineering |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Flow Diagram sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. flow
2. step
3. type
4. next
5. condition
6. notes
```

**Default headers when creating a new Flow Diagram sheet:**
```
Flow, Step, Type, Next, Condition, Notes
```

**Detection signals** — headers that indicate a sheet is a Flow Diagram:
```
flow, diagram, process, workflow, pipeline, step, node, type, next, condition
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Flow Diagram

# Flow Diagram — Domain Knowledge

## What This Template Is
A process or workflow definition where each row is a step in a flow. The `flow` column groups steps by flow name (one flow = multiple rows). The `step` column is a label or ID for this node. The `type` column describes the node kind (start, end, decision, action, etc.). The `next` column references the next step's label. The `condition` column holds the branching condition (for decision nodes).

## ⚠️ CRITICAL: Flow Column Grouping Rule
**The `flow` column must ONLY be set on the FIRST row of each flow group.** All subsequent rows in the same flow MUST have an EMPTY `flow` column. This is how the template renderer groups steps — it starts a new group every time a non-empty `flow` value appears. If you set the flow name on every row, each row becomes an isolated single-step diagram with no connections.

**CORRECT format:**
```
Flow            | Step              | Type     | Next
Provisioning    | Start             | start    | OAuth Login
                | OAuth Login       | process  | Check Sheet
                | Check Sheet       | decision | Write Config, Load Key
Authentication  | Load Creds        | start    | Validate
                | Validate          | process  | Done
```

**WRONG format (breaks connections):**
```
Flow            | Step              | Type     | Next
Provisioning    | Start             | start    | OAuth Login
Provisioning    | OAuth Login       | process  | Check Sheet   ← WRONG: creates new isolated group
Provisioning    | Check Sheet       | decision | Write Config  ← WRONG: creates another isolated group
```

## Node Type Convention Detection
Read existing `type` values. Common conventions:
- start, end, action, decision, loop, trigger, wait, sub-flow
- process, gateway, event, task (BPMN-style)
Preserve the convention already used.

## Smart Operations

### Flow Map Summary
Group rows by `flow`. For each flow:
```
Flow: {flow name}  ({N} steps)
  {step} [{type}] → {next}  [Condition: {condition}]
  ...
```
Identify the start node (type = "start" or first row with no incoming references).
Identify end nodes (type = "end" or `next` is empty).

### Path Trace
When asked "walk me through flow {name}":
- Start from the start node
- Follow `next` references, step by step
- At decision nodes, show both branches (next + condition)
- Stop at end nodes or when a cycle is detected
Report the sequence as a numbered narrative.

### Cycle Detection
Traverse the flow's `next` references. If any step eventually points back to itself (via any path), report:
`⚠️ Cycle detected in flow "{flow}": {step1} → {step2} → ... → {step1}`

### Dead End Detection
Find steps where `next` references a step label that doesn't exist in the sheet:
`⚠️ Broken reference: step "{step}" points to "{next}" which does not exist`

### Adding a Step
Append a row. Required: `step` (unique label within the flow), `type`, `next`.
Set `flow` ONLY if this is the FIRST row of a new flow group. For all other rows in the same flow, leave `flow` EMPTY.
Optional: `condition` (for decision nodes only), `notes`.
After adding: check if any existing step's `next` should now point to this new step.

### Flow List
Return all unique `flow` values with step counts and whether each flow has a valid start and end.

### Decision Node Summary
Find all rows where `type` = "decision" (or gateway/conditional). List them with their conditions and both possible `next` values.

## Interpretation Rules
- A flow with no "start" type node is incomplete — flag it
- `step` values are identifiers — they must be unique within a flow
- `next` may reference steps in the same flow or a different flow (sub-flow call) — distinguish if possible
- `next` values are matched case-insensitively but must otherwise match the target step name EXACTLY — do not abbreviate or rephrase them
- For decision nodes with multiple outgoing edges, each branch needs its own row: duplicate the step label, set a different `next`, and set `condition` to the branch label (e.g. "Yes" / "No")
- `condition` is only meaningful on decision/gateway nodes — ignore it on all other types
- Empty `next` = terminal step (end of flow) — this is valid
- **NEVER set `flow` on continuation rows** — only the first row of each flow group gets the flow name

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
Call `waymark_create_sheet(title, "flow", initialEntries?)`
- Creates a sheet with the default Flow Diagram headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "flow", spreadsheetId?)`
- Searches entries across sheets matching the query.
