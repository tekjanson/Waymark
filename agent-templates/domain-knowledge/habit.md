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
