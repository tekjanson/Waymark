# Kanban Board — Domain Knowledge

## What This Template Is
A work-in-progress board where rows are tasks that flow through lifecycle stages. The `stage` column drives everything. Cards live in swim lanes: Backlog → To Do → In Progress → QA → Done. Rejected and Archived are terminal cleanup states.

## Valid Stage Flow
```
Backlog → To Do → In Progress → QA → Done
                              ↘ Rejected → (fix) → To Do
                                        → Archived
```
Never move a card backward past To Do without a reason. Never write a stage not in the valid states list.

## Sheet Row Structure

### Task Rows vs. Note/Subtask Subrows
Every row in a kanban sheet is either a **task row** or a **subrow**:
- **Task row**: the `text` (Task) column is non-empty — this is the card itself
- **Note subrow**: the `text` column is **empty** AND the `note` column has content
- **Subtask subrow**: the `text` column is **empty** AND the `note` column is also empty — content is in other columns

Subrows belong to the task row immediately above them. The UI groups contiguous rows this way: when it sees a row with an empty task title, it attaches it to the previous task as a note or subtask.

### Status-Change Note Format
When a stage transition happens, a note subrow is written immediately after the task row:

| Column | Value |
|---|---|
| `text` (Task) | *(empty)* |
| `note` | `⟳ {Previous Stage} → {New Stage}` |
| `assignee` | Agent name or user (e.g., `waymark-kanban`) |
| `due` | Current timestamp in `YYYY-MM-DD HH:MM` format |

Example note row:
```
text:     (empty)
note:     ⟳ To Do → In Progress
assignee: waymark-kanban
due:      2026-04-20 14:32
```

### Adding Note Subrows via MCP
`waymark_add_entry` appends to the **end** of the sheet. For the note to appear after the correct card, the card must be the last task in the sheet, OR you must use the raw terminal approach below.

**When you need to insert a note after a specific card that is NOT the last row:**
Use `google-sheets/sheets_values_get` to read all rows, build the full updated values array with the note inserted at the correct position, then use `google-sheets/sheets_values_update` to write the entire range back:
```
1. sheets_values_get(spreadsheetId, range: "Sheet1")
2. Insert the new note row at position [taskRowIndex + 1 + existingNoteCount]
3. sheets_values_update(spreadsheetId, range: "Sheet1!A1", values: [...all rows with note inserted...])
```
This rewrites the sheet but preserves all data correctly.

**Shortcut for simple boards**: If the board has only a few tasks and the target is the last task, use `waymark_add_entry` directly with `text: ""` to append the note subrow.

## Smart Operations

### Stage Change Protocol (ALWAYS follow this)
When you change a card's stage, you MUST also add a status-change note. Never update stage alone.

1. Read current stage from the card row
2. Write new stage: `waymark_update_entry(spreadsheetId, rowIndex, { stage: "New Stage" })`
3. Add status note subrow immediately after the card:
   ```
   waymark_add_entry(spreadsheetId, {
     text: "",
     note: "⟳ {Old Stage} → {New Stage}",
     assignee: "waymark-kanban",
     due: "{YYYY-MM-DD HH:MM}"
   })
   ```
   (Use the insert-at-position approach above if this card is not the last row.)

### Sprint Health Check
Scan all rows and report:
- Cards stuck in "In Progress" with no status note in >3 days (look at the `due` timestamp in the most recent `⟳` note subrow)
- Cards in "To Do" with P0 priority and no Assignee
- Cards in "QA" with no status change note in >2 days (possibly forgotten)
- Completion ratio: Done / (To Do + In Progress + QA + Done) as a percentage
- Count of P0/P1 items per stage

### Stalled Card Detection
A card is "stalled" when:
- Stage = "In Progress" AND the most recent `⟳` note subrow is >3 days old (check `due` column of the note)
- Stage = "In Progress" AND no note subrow exists at all
- Stage = "To Do" AND priority is P0 with no Assignee for >1 day
- Stage = "QA" AND no `⟳ In Progress → QA` note subrow exists (may have been miscategorized)

Report stalled cards by: task title, row number, current stage, days since last status note.

### Stage Cycling
When asked to advance a card:
1. Read current stage
2. Determine next valid stage: Backlog → To Do → In Progress → QA → Done
3. Write stage + add status note subrow (always paired)

When asked to reject a card:
1. Set stage = "Rejected"
2. Add note subrow with `note: "⟳ {Old Stage} → Rejected"` + a second note subrow with the rejection reason
3. Never reject from Archived

When asked to archive:
1. Only valid if current stage is Done or Rejected
2. Set stage = "Archived"
3. Add note subrow: `"⟳ {Old Stage} → Archived"`

### QA Stage Workflow
QA is the human review gate between implementation and Done:
- Cards enter QA when the implementation agent marks them complete
- When in QA, do NOT automatically advance to Done — wait for human verdict
- If human rejects from QA: set stage back to "To Do", add note: `"⟳ QA → To Do"` + rejection reason
- If human approves: set stage to "Done", add note: `"⟳ QA → Done"`
- If card has been in QA >2 days with no verdict, flag it in health check

### Adding a New Task (Quality Standards)
When creating a new task, apply these quality standards:

**Required fields:**
- `text`: Imperative verb phrase, specific and actionable. Good: "Add pagination to search results". Bad: "Search", "Fix bug"
- `stage`: Start at "To Do" for near-term work, "Backlog" for future/unplanned items
- `priority`: Default P2. Use P0 only for blockers, P1 for high-impact items due this sprint

**Strongly recommended fields:**
- `description`: At minimum — what needs to happen + acceptance criteria. Use the format: `{Background}. Acceptance: {measurable outcome}`
- `project`: Always assign to the relevant project — never leave blank on a multi-project board
- `label`: Classify as `feature`, `bug`, `infra`, `design`, or `docs` based on the nature of the work

**Leave blank unless specified:**
- `assignee` — do not assume or auto-assign
- `due` — only set if a real deadline exists; do not fabricate dates
- `reporter` — the person who requested the work (leave blank if not specified)

**Priority guidance:**
- P0 = drop everything, production is broken or a blocker is on the critical path
- P1 = high-impact, must be in this sprint
- P2 = normal work, planned for current or next sprint
- P3 = nice-to-have, low urgency

**Label guidance:**
- `feature` — new capability or user-visible functionality
- `bug` — something broken that used to work
- `infra` — backend, tooling, deployment, CI/CD
- `design` — visual, UX, accessibility, layout
- `docs` — documentation, README, comments, guides

### Improving an Existing Task
When asked to improve or enhance existing items:
1. Read the card's full row including all note/subtask subrows
2. Check each field for quality:
   - **Description thin or missing?** → Expand it with context, background, and acceptance criteria
   - **Priority missing or wrong?** → Assess based on impact and urgency; update if clearly incorrect
   - **Label missing?** → Classify based on task content and assign appropriate label
   - **Description says "see X" but X is vague?** → Resolve the reference and inline the relevant detail
   - **Due date missing for P0/P1?** → Add a reasonable target date and note it's an estimate
3. After updating fields, add an improvement note subrow:
   ```
   note: "Improved: {brief summary of what was added/changed}"
   assignee: "waymark-kanban"
   due: "{current timestamp}"
   ```
4. Do NOT change stage, assignee, or reporter when improving — only improve content quality

### Bulk Stage Update
When moving multiple cards (e.g., "close out the sprint"):
1. Read all rows with `waymark_get_sheet`
2. Identify target cards and build the list of updates
3. For each card: update stage + build note row
4. Execute all stage updates, then add all note rows
5. Report count moved per stage (e.g., "Moved 3 cards to Done, 1 to QA")

### Project Grouping
The `project` column groups cards into sub-boards. When working on a specific project:
- Filter by project first before making any changes
- When adding a card, always specify which project it belongs to
- Report project-level summaries when doing health checks (cards per stage per project)

### Reading the Board State
Before making any changes, always read the full sheet:
1. `waymark_get_sheet(spreadsheetId)` — gets all rows including subrows
2. Identify task rows (text column non-empty) vs. subrows (text column empty)
3. For each task row, collect its note subrows to understand the card's history
4. The most recent `⟳` note shows the last stage transition and when it happened
5. Build a mental model: how many cards per stage, who is assigned to what, what's stalled

## Interpretation Rules
- Empty assignee = unassigned, not a bug
- A note subrow (`text` column empty, `note` column non-empty) belongs to the task row immediately above it
- A subtask subrow (`text` and `note` both empty) is a sub-task belonging to the task above it
- Priority P0 = drop everything, P1 = high, P2 = normal, P3 = low
- Valid labels: `bug`, `feature`, `design`, `docs`, `infra`
- "Archived" cards must be excluded from all health checks, counts, and completion ratios
- The `due` column on a **note subrow** is a timestamp (when the note was written), not a deadline
- The `due` column on a **task row** is the task's deadline date
- `⟳ From → To` prefix on a note = auto-generated status-change note (written by the agent)
- Notes without `⟳` prefix = human-written comments
