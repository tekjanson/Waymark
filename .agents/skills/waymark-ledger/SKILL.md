---
name: waymark-ledger
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Ledger template (Finance).
---

# Waymark Ledger Skill

> Specialized skill for **Ledger** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Ledger domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `ledger` |
| Template Name | Ledger |
| Category | Finance |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Ledger sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. date
2. type
3. category
4. text
5. amount
6. reference
7. balance
```

**Default headers when creating a new Ledger sheet:**
```
date, type, category, text, amount, reference, balance
```

**Detection signals** — headers that indicate a sheet is a Ledger:
```
reference, journal, balance, running balance, type, entry type, gl code, folio
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Ledger

# Ledger — Generic Domain Knowledge

## What This Template Is
This domain knowledge block was auto-generated because no hand-authored
`domain-knowledge/ledger.md` file exists yet. The agent can still operate
using the column roles and state machine defined in the agent file. For richer
domain-specific operations, create `agent-templates/domain-knowledge/ledger.md`
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
Call `waymark_create_sheet(title, "ledger", initialEntries?)`
- Creates a sheet with the default Ledger headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "ledger", spreadsheetId?)`
- Searches entries across sheets matching the query.
