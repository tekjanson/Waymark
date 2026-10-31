---
name: waymark-kanban
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Kanban Board template (Project Management).
---

# Waymark Kanban Board Skill

> Specialized skill for **Kanban Board** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Kanban Board domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `kanban` |
| Template Name | Kanban Board |
| Category | Project Management |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Kanban Board sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. description
3. stage
4. project
5. assignee
6. priority
7. due
8. label
9. note
10. reporter
```

**Default headers when creating a new Kanban Board sheet:**
```
Task, Description, Stage, Project, Assignee, Priority, Due, Label, Note, Reported By
```

**Detection signals** — headers that indicate a sheet is a Kanban Board:
```
backlog, in.progress, todo, doing, done, column, board, stage, lane
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Backlog`
- `To Do`
- `In Progress`
- `Done`
- `Rejected`
- `Archived`

Flow: `Backlog → To Do → In Progress → Done → Rejected → Archived`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — Kanban Board

# Kanban Board — Domain Knowledge

## What This Template Is
A work-in-progress board where rows are tasks that flow through lifecycle stages. The `stage` column drives everything. Cards live in swim lanes: Backlog → To Do → In Progress → Done. Rejected and Archived are terminal cleanup states.

## Valid Stage Flow
```
Backlog → To Do → In Progress → Done
                             ↘ Rejected → (fix) → To Do
                                       → Archived
```
Never move a card backward past To Do without a reason. Never write a stage not in the valid states list.

## Smart Operations

### Sprint Health Check
Scan all rows and report:
- Cards stuck in "In Progress" with no recent activity (no notes subrow in >3 days)
- Cards in "To Do" with P0 priority that haven't been claimed
- Cards in "QA" (if used) with no verdict notes
- Ratio: Done / (To Do + In Progress + Done) as a sprint completion percentage

### Stalled Card Detection
A card is "stalled" when:
- Stage = "In Progress" AND no note subrow exists (or last note is >3 days old)
- Stage = "To Do" AND priority is P0 with no Assignee
- Report stalled cards by name, row number, and days since last update

### Stage Cycling
When asked to advance a card: read current stage → pick next valid stage → write it.
When asked to reject a card: set stage = "Rejected", add a note subrow explaining why.
When asked to archive: set stage = "Archived" only if stage is already Done or Rejected.

### Adding a New Task
Append a row with all required columns filled. Required minimum: Task (text role), Stage = "To Do", Priority = "P2" if not specified. Leave assignee blank unless specified.

### Bulk Stage Update
When moving multiple cards (e.g., "close out the sprint"): read all rows first, build a batch of writes, execute them together. Report count moved per stage.

### Project Grouping
The `project` column groups cards into sub-boards. When working on a specific project, filter by project first. When adding a card, always specify which project it belongs to.

## Interpretation Rules
- Empty assignee = unassigned, not a bug
- A note subrow (text role column empty, notes column non-empty) belongs to the task row above it
- Priority P0 = drop everything, P1 = high, P2 = normal, P3 = low
- If `label` column exists: valid values are `bug`, `feature`, `design`, `docs`, `infra`
- "Archived" cards should be ignored in all health checks and counts

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
- For `toggle`, only write `Backlog` or `To Do`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet({ templateKey: "kanban", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Kanban Board headers and initial rows.
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
