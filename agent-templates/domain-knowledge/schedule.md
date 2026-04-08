# Schedule — Domain Knowledge

## What This Template Is
A time-based activity planner where rows are events or slots. The `day` column groups entries by date or weekday. The `time` column holds a start time (and sometimes end time). The `location` column identifies where the activity takes place. No interactive state — it's read and displayed.

## Day/Time Convention Detection
- If `day` values are weekday names (Mon, Tuesday, etc.) → repeating weekly schedule
- If `day` values are ISO dates (2026-04-08) → date-specific schedule
- If `time` values include a range (9:00–10:00, 09:00 to 10:30) → duration is encoded in the time field
- Preserve whatever format is already used when writing new rows

## Smart Operations

### Day View
Group all rows by `day` value. For each day:
```
{Day/Date}
  {time} — {activity} [{location}]
  {time} — {activity} [{location}]
```
Sort events within a day by time (earliest first). Handle 12-hour (AM/PM) and 24-hour formats.

### Today's Schedule
If days are dates: filter rows where `day` = today's ISO date.
If days are weekdays: filter rows where `day` = today's weekday name.
Return sorted by time. If nothing scheduled: `Nothing scheduled for today.`

### Conflict Detection
Within the same day, find overlapping time slots (requires start+end times).
If only start time is present, assume 1-hour blocks unless duration is inferable.
Report: `⚠️ Conflict: {activity1} and {activity2} overlap at {day} {time}`

### Adding an Event
Append a row. Required: `text` (activity name), `day`, `time`.
Optional: `location`. Preserve the existing day/time format found in the sheet.
If the time slot is already occupied, warn before writing.

### Weekly Summary
If the schedule is weekly (weekday names):
- Count events per day
- Report busiest day, lightest day
- Total scheduled events for the week

### Finding Free Slots
Given a day and duration: scan the day's events, find gaps in the schedule.
Report available time windows not occupied by any activity.

## Interpretation Rules
- Empty `location` = no location specified, not an error
- Rows without `time` are all-day entries — list them first in the day view
- Do not reorder rows in the sheet — only read and interpret order for display
- If `day` is blank, the row is a continuation or note for the row above it
