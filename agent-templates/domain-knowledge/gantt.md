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
