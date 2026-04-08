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
