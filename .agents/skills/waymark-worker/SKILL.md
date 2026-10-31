---
name: waymark-worker
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Worker Jobs template (Operations).
---

# Waymark Worker Jobs Skill

> Specialized skill for **Worker Jobs** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Worker Jobs domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `worker` |
| Template Name | Worker Jobs |
| Category | Operations |
| Interaction Type | `none` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Worker Jobs sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. job
2. handler
3. config
4. status
5. schedule
6. lastRun
7. result
```

**Default headers when creating a new Worker Jobs sheet:**
```
Job, Handler, Config, Status, Schedule
```

**Detection signals** — headers that indicate a sheet is a Worker Jobs:
```
job, worker, handler, backend worker, job runner
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `none` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Worker Jobs

# Worker Jobs — Domain Knowledge

## What This Template Is
A background job / task runner registry. Each row is a defined job or automated task. The `job` column is the job name or ID. `handler` is the function, script, or service that processes it. `config` stores configuration (JSON, a key=value string, or a path). `status` is the current state. `schedule` is the trigger (a cron expression, interval like "every 15m", or "manual").

## Status Values (common — not a fixed cycle)
```
pending → running → done
          running → failed
pending → skipped
done    → pending  (re-queued)
```
Status is not a formal cycle — write exact text as found in the sheet.

## Smart Operations

### Job Queue View
Show all rows where `status` is "pending" or "running":
```
PENDING JOBS
  {job} | handler: {handler} | schedule: {schedule}
RUNNING JOBS
  {job} | handler: {handler} | config: {config}
```

### Failed Job Triage
Filter rows where `status` = "failed":
```
  Job: {job}
  Handler: {handler}
  Config: {config}
  Schedule: {schedule}
```
If asked to re-queue: set `status` back to "pending".

### Schedule Summary
Group all jobs by their `schedule` value. Show:
```
  {schedule}: {job1}, {job2}, ...
```
Identify jobs with `schedule` = "manual" — these only run on demand.

### Adding a Job
Append a row. Required: `job` (unique name), `handler`. Optional: `config` (empty if not needed), `schedule` (defaults to "manual"), `status` (defaults to "pending").

### Config Inspection
When asked to show config for a specific job:
- Find by `job` name
- Return the `config` column value verbatim (do not parse or expand it)

### Updating a Job
When told to change the handler, config, or schedule for a job:
- Find by `job` name
- Write only the changed column(s)

### Status Summary
Count rows by status value:
```
  pending: N
  running: N
  done:    N
  failed:  N
  skipped: N
```

## Interpretation Rules
- `config` is opaque — treat it as a string, never invent or modify its content unless explicitly told to
- `handler` may be a function name, a URL, a script path, or a service name — always preserve as-is
- A job with `schedule` = blank should be treated as "manual"
- Never mark a job as "running" unless explicitly instructed — it may already be tracked by an external system

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
Call `waymark_create_sheet({ templateKey: "worker", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Worker Jobs headers and initial rows.
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
