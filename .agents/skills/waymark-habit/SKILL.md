---
name: waymark-habit
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Habit Tracker template (Personal).
---

# Waymark Habit Tracker Skill

> Specialized skill for **Habit Tracker** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Habit Tracker domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `habit` |
| Template Name | Habit Tracker |
| Category | Personal |
| Interaction Type | `toggle-grid` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Habit Tracker sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. weekOf
3. days
4. streak
5. notes
```

**Default headers when creating a new Habit Tracker sheet:**
```
Habit, Mon, Tue, Wed, Thu, Fri, Sat, Sun, Streak
```

**Detection signals** — headers that indicate a sheet is a Habit Tracker:
```
habit, streak, monday, tuesday, wednesday, thursday, friday, mon, tue, wed
```

---

## 2. STATE MACHINE

Interaction type: `toggle-grid`

Valid values:
- `✓`
- ``

---

## 3. DOMAIN KNOWLEDGE — Habit Tracker

# Habit Tracker — Domain Knowledge

## What This Template Is
A weekly grid where each row is a habit. The `text` column is the habit name. Day columns (Mon–Sun or date columns) are toggles — each cell is either the done marker (✓) or empty. The `streak` column tracks the current consecutive-days streak. The `weekOf` column identifies which week the row belongs to. The interaction type `toggle-grid` means individual day cells are toggled.

## Done Value Detection
Read the first non-empty day cell across all rows. The done value is whatever string is there (commonly `✓`, `x`, `1`, `done`). Empty = not done. Preserve the exact done value.

## Smart Operations

### Weekly Completion Summary
For each habit row, count done cells across the day columns. Report:
```
{habit name}: {N}/7 days  ({X}%) {streak_emoji} Streak: {streak}
```
Overall: `{total done}/{total possible} = X% completion rate this week`

### Streak Calculation
For a habit, a streak is the count of consecutive done-marked days ending today (or the most recent day in the sheet). When asked to update streaks:
- Count backward from today/most recent day
- Write the streak count to the `streak` column
- A gap (empty cell) resets the streak to 0

### Today's Check
Return all habits and whether they're marked done for today:
```
✓ {habit name}
○ {habit name}  ← not done yet
```
If today's column can't be identified, report the most recent day column.

### Marking a Day
When told "{habit} was done today" or "mark {habit} for {day}":
- Find the row by habit name
- Identify the correct day column
- Write the done value
- Recalculate streak and update streak column

### Perfect Week Detection
Find habits with all 7 days marked. Report: `🏆 Perfect week: {habit name}`

### Adding a Habit
Append a row. Required: `text` (habit name). All day columns = empty (not done). Streak = 0.
If `weekOf` column exists, set it to the current week's start date (Monday).

### Weekly Reset
When asked to start a new week:
- Do NOT clear existing rows — append new rows for each habit with a new `weekOf` date
- New rows have all day cells empty, streak carries over from previous week's final value

## Interpretation Rules
- Each row represents one habit for one week — multiple rows for the same habit are different weeks
- `weekOf` identifies which week; if missing, infer from surrounding rows' context
- Streak shown in the sheet may be stale — recalculate from the actual day cells if accuracy matters
- Day columns are positional (Mon=col2, Tue=col3, etc.) — identify them by header name, not index
- A habit with all empty day cells this week is not abandoned — they just haven't been logged yet

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
- For `toggle`, only write `✓` or ``.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet({ templateKey: "habit", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Habit Tracker headers and initial rows.
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
