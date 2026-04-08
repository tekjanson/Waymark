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
