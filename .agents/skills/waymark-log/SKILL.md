---
name: waymark-log
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Activity Log template (Tracking).
---

# Waymark Activity Log Skill

> Specialized skill for **Activity Log** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Activity Log domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `log` |
| Template Name | Activity Log |
| Category | Tracking |
| Interaction Type | `none` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Activity Log sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. timestamp
3. type
4. duration
```

**Default headers when creating a new Activity Log sheet:**
```
Timestamp, Activity, Duration, Type
```

**Detection signals** — headers that indicate a sheet is a Activity Log:
```
timestamp, logged, entry.date, log.date, recorded, created.at
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `none` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Activity Log

# Activity Log — Domain Knowledge

## What This Template Is
A chronological record where each row is a logged event. The `timestamp` column is the event's date/time. The `text` column describes what happened. The `type` column categorizes the event. The `duration` column holds how long the activity took (optional). No interactive state — append-only logging with read/analysis.

## Timestamp Convention Detection
- ISO datetime (2026-04-08T14:30:00) → full precision, sort as-is
- Date only (2026-04-08) → day-level granularity
- Relative (2 hours ago, yesterday) → convert to approximate absolute for sorting
- Preserve the format already used when appending new entries

## Duration Convention Detection
- Pure numbers → minutes (unless context suggests otherwise)
- Values with units ("1h 30m", "45 min", "2.5 hours") → parse to minutes for math
- Empty duration → event had no tracked duration

## Smart Operations

### Recent Activity Feed
Return the N most recent entries (default: 10), most recent first:
```
{timestamp} [{type}] {activity} ({duration} min)
```
Skip duration if empty.

### Daily Summary
Group entries by date. For each date:
- List of activities in order
- Total duration for the day (sum of parseable durations)
- Count of entries

### Type Breakdown
Group by `type` column. For each type:
- Count of entries
- Total duration
- Most recent entry timestamp
Useful for: "how much time did I spend on meetings this week?"

### Time Period Filter
When asked "show log for {date} / last {N} days / this week":
- Filter rows by timestamp within the period
- Return sorted chronologically
- Include summary: N entries, total duration

### Appending a Log Entry
Append a row. Required: `text` (what happened). Optional: `type`, `duration`.
`timestamp` = now (current date/time in the format already used in the sheet).
Never backfill timestamps unless explicitly told to.

### Top Activities by Time
If duration data exists:
- Group by `text` or `type`, sum durations
- Rank by total time spent
- Report: `{activity} — {N} hours total ({M} entries)`

### Gap Detection
If entries are expected daily (e.g. a daily work log):
- Find date ranges where no entries exist
- Report: `No log entries for: {date range}`

## Interpretation Rules
- Rows are append-only — never reorder existing rows in the sheet
- Empty `type` is valid — not every log entry needs a category
- Duration of 0 is different from empty — 0 means the activity was instantaneous
- A log is a historical record; do not delete or modify past entries
- If the same activity appears multiple times, they are separate occurrences — do not deduplicate

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
Call `waymark_create_sheet(title, "log", initialEntries?)`
- Creates a sheet with the default Activity Log headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "log", spreadsheetId?)`
- Searches entries across sheets matching the query.
