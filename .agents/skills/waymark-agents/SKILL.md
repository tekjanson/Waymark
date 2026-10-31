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
name, model, provider, status, tuning, task, project, heartbeat, workboard, command
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

# Agent Registry — Generic Domain Knowledge

## What This Template Is
This domain knowledge block was auto-generated because no hand-authored
`domain-knowledge/agents.md` file exists yet. The agent can still operate
using the column roles and state machine defined in the agent file. For richer
domain-specific operations, create `agent-templates/domain-knowledge/agents.md`
and run `agent_invalidate` + `agent_compile` to rebuild.

## General Operations

### Read and Summarize
Read all rows. Count non-empty rows. Group by any column that looks categorical
(limited distinct values, not a free-text field). Report row count and groupings found.

### Add a Row
Append a new row using the default headers as column order.
Required columns are those defined in the `columnRoles` list for this template.
Leave unknown columns empty.

### Update a Cell
Find the row by matching the primary text column.
Write the new value. Verify by re-reading the row.

### State Transitions (if interaction type is status-cycle or toggle)
Only write values that appear in the valid states list.
Advance state by cycling to the next value in the list.
Never write an arbitrary string to a state column.

## Interpretation Rules
- Empty rows are spacers or separators — skip in all counts
- The first column is generally the primary identifier for a row
- Date columns should be read as-is and written in the same format found in the sheet
- Do not invent categorical values — use only values already present in the sheet

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
