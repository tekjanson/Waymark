---
name: waymark-tracker
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Progress Tracker template (Goals).
---

# Waymark Progress Tracker Skill

> Specialized skill for **Progress Tracker** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Progress Tracker domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `tracker` |
| Template Name | Progress Tracker |
| Category | Goals |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Progress Tracker sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. progress
3. target
4. notes
```

**Default headers when creating a new Progress Tracker sheet:**
```
Goal, Progress, Target, Started, Notes
```

**Detection signals** — headers that indicate a sheet is a Progress Tracker:
```
progress, percent, %, score, rating, level, grade, completion
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Progress Tracker

# Progress Tracker — Domain Knowledge

## What This Template Is
A goal-tracking sheet where each row is a goal or objective with a numeric progress value and a target. The `progress` column is a number (often a percentage 0–100, or a count toward a target). The `target` column is the goal value. Inline editing lets users update progress directly.

## Progress Convention Detection
- If progress values are 0–100 with no target column, treat as percentage directly
- If a `target` column exists, progress is absolute and percentage = progress / target × 100
- If progress values exceed 100, the convention is count-based with a target

## Smart Operations

### Overall Summary
For all goals, report:
```
{N} goals tracked
Completed (100%): N
In Progress:      N  (avg X% complete)
Not Started (0%): N
```
Include an overall weighted average completion percentage.

### Goal Health Check
Flag goals that may be off-track:
- `started` column exists AND goal has been running >30 days AND progress < 25% → flag as at-risk
- progress has not changed in >7 days (detect via notes subrows) → flag as stalled
- progress > target → flag as exceeded (good, but worth noting)

### Updating Progress
When asked to update a goal's progress:
- Find the row by `text` column (goal name)
- Write the new value to the `progress` column
- If the new value equals or exceeds `target`, note it as complete
- Always verify the written value by re-reading

### Completion Percentage
Calculate and return: `(progress / target × 100)%` for each row.
If no `target` column, read `progress` as the percentage directly.
Cap display at 100% even if exceeded.

### Adding a Goal
Append a row. Required: text (goal name), target (the finish line), progress = 0.
Optional: `started` = today's date, `notes`.
Never add a goal with progress = target unless explicitly told it's already done.

### Ranking by Completion
Sort all goals by completion percentage descending. Return the ranked list with:
`{rank}. {goal name} — {X}% ({progress}/{target})`

## Interpretation Rules
- Empty `progress` = 0, not unknown — treat as not started
- Empty `target` = no defined finish line; report raw progress value, skip percentage
- `notes` column on the row is a summary; detailed updates may be in subrows
- A goal at 100%+ is complete — do not flag it as at-risk regardless of age

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
Call `waymark_create_sheet({ templateKey: "tracker", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Progress Tracker headers and initial rows.
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
