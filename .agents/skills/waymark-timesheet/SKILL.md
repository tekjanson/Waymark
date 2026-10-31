---
name: waymark-timesheet
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Timesheet template (Work).
---

# Waymark Timesheet Skill

> Specialized skill for **Timesheet** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Timesheet domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `timesheet` |
| Template Name | Timesheet |
| Category | Work |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Timesheet sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. hours
3. date
4. client
5. billable
```

**Default headers when creating a new Timesheet sheet:**
```
Project, Client, Hours, Rate, Billable, Date
```

**Detection signals** — headers that indicate a sheet is a Timesheet:
```
hours, billable, rate, client, project, timesheet
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Timesheet

# Timesheet — Domain Knowledge

## What This Template Is
A work-hours log where each row is a time entry. The `text` column is the project or task name. The `hours` column is a numeric duration worked. The `client` column identifies who the work is for. The `billable` column indicates whether the hours are billable (yes/no, true/false, or a checkmark). The `date` column holds the work date.

## Billable Convention Detection
- Values: "yes"/"no", "true"/"false", "✓"/"", "billable"/"non-billable", "B"/"NB"
- Read existing non-empty billable values to infer the convention
- Empty billable = assume billable unless the project's other entries say otherwise

## Smart Operations

### Hours Summary
Report:
```
Total hours: X.X h
Billable:    X.X h (X%)
Non-billable:X.X h (X%)
```
Group by client:
```
{Client}: X.X h (X.X h billable)
```
Group by project (text column):
```
{Project}: X.X h
```

### Time Period Filter
When asked "this week / last month / {date range}":
- Filter rows by `date` within the period
- Report total, billable/non-billable split, by-client breakdown

### Billable Invoice Prep
Group billable hours by client. For each client:
```
{Client}
  {project} — X.X h
  {project} — X.X h
  Total: X.X h
```
This is the raw data for invoice generation.

### Daily Total
When asked "how many hours on {date}":
- Filter by date
- Sum hours
- List entries chronologically

### Logging Time
Append a row. Required: `text` (project), `hours` (number), `date` (today unless specified).
Optional: `client`, `billable` (default to billable = yes unless otherwise stated).
Hours must be positive. Flag if hours > 24 for a single date.

### Overtime Detection
Group by date. If any date has total hours > 8, flag it:
`⚠️ Overtime on {date}: {X.X h} logged`

### Project Time Audit
When asked how much time was spent on a project:
- Search `text` column for the project name (partial match OK)
- Sum all matching hours across all dates
- Report: `{project}: {X.X h} total across {N} entries ({date range})`

## Interpretation Rules
- Hours should be stored as a decimal number (1.5 = 1h 30min) — if entered as "1:30" format, parse to decimal for math
- The same project may appear on many rows (one per day worked) — this is normal, not duplicates
- Empty `client` is valid — not all work is client-facing
- Do not modify past entries unless explicitly instructed to correct an error

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
Call `waymark_create_sheet(title, "timesheet", initialEntries?)`
- Creates a sheet with the default Timesheet headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "timesheet", spreadsheetId?)`
- Searches entries across sheets matching the query.
