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
