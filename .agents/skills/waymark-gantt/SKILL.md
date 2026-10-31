---
name: waymark-gantt
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Gantt Timeline template (Project Management).
---

# Waymark Gantt Timeline Skill

> Specialized skill for **Gantt Timeline** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Gantt Timeline domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `gantt` |
| Template Name | Gantt Timeline |
| Category | Project Management |
| Interaction Type | `drag-to-reschedule` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Gantt Timeline sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. start
3. end
4. progress
5. dependencies
6. assignee
```

**Default headers when creating a new Gantt Timeline sheet:**
```
Task, Start Date, End Date, Progress, Dependencies, Assignee
```

**Detection signals** — headers that indicate a sheet is a Gantt Timeline:
```
task, start, start date, end, end date, finish, deadline, progress, milestone, dependencies, assignee
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `drag-to-reschedule` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Gantt Timeline

# Gantt Timeline — Domain Knowledge

## What This Template Is
A project timeline where each row is a task with a start date, end date, and dependencies. The `text` column is the task name. The `start` and `end` columns are dates. The `progress` column is 0–100 percent complete. The `dependencies` column lists tasks this one depends on (by name or row number). The `assignee` column is who owns the task.

## Smart Operations

### Timeline Summary
Sort all tasks by `start` date. Report:
```
{task name} [{assignee}]
  {start} → {end} ({N} days)  {progress}% complete
  Depends on: {dependencies}
```
Show the overall project span: earliest start to latest end date.

### Critical Path (Approximation)
The critical path is the longest sequence of dependent tasks. Identify:
- Tasks with no dependencies (can start immediately)
- The chain of dependencies that takes the longest total duration
- Report: `Estimated critical path: {N} days  →  {task1} → {task2} → ...`

### Behind Schedule Detection
For each task: if today's date is past `end` and `progress < 100`:
`⚠️ Overdue: {task} — ended {date}, {progress}% complete`
If today is past `start` and `progress = 0`:
`⚠️ Not started: {task} should have started {date}`

### Upcoming Tasks
Tasks starting within the next 14 days with `progress < 100`:
```
Starting soon: {task} ({start}) — {assignee}
```

### Dependency Check
For each task that lists dependencies:
- Find if all dependency tasks are at 100% progress
- If a dependency is not complete and the dependent task has already started, flag it:
  `⚠️ Blocked: {task} depends on {dependency} which is only {X}% complete`

### Updating Progress
When told a task is X% done:
- Find by task name
- Write progress value (0–100)
- If 100, note it as complete

### Adding a Task
Append a row. Required: `text` (task name), `start` date, `end` date. Optional: `assignee`, `progress` (default 0), `dependencies`.
Dates should use the same format already present in the sheet.

### Assignee Workload
Group tasks by `assignee`. For each: count of tasks, sum of task durations (days), count overdue.

### Milestone Identification
Tasks with duration = 0 days (start = end) are milestones. List them separately.

## Interpretation Rules
- `progress` = 100 means complete — the task's end date is no longer a constraint
- `dependencies` may be task names, row numbers, or comma-separated IDs — parse whichever format is used
- Date format must be preserved exactly as found — do not convert between ISO and local formats
- Tasks with no `end` date are open-ended — do not include them in schedule calculations
- Empty `assignee` = unassigned, not an error — flag in workload summary

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
Call `waymark_create_sheet({ templateKey: "gantt", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Gantt Timeline headers and initial rows.
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
