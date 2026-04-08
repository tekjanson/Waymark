# Travel Itinerary — Domain Knowledge

## What This Template Is
A trip planner where each row is an activity or booking. The `activity` column describes what's happening. The `date` column holds the calendar date. The `location` column is where it takes place. The `booking` column holds a reference number, confirmation code, or booking status. The `cost` column is a monetary amount.

## Smart Operations

### Day-by-Day Itinerary
Group rows by `date`, sorted chronologically. For each day:
```
{Date}
  {activity} — {location}
  Booking: {booking}  Cost: ${cost}
```
Skip empty booking/cost fields.

### Trip Cost Summary
Sum all numeric `cost` values. Report:
```
Total trip cost: ${total}
By day:
  {date}: ${sum}
  {date}: ${sum}
```
Flag any rows with non-numeric costs (e.g. "TBD", "included") as approximate/unknown.

### Booking Status Audit
Scan `booking` column for patterns:
- Numeric/alphanumeric codes → confirmed booking
- "TBD", "pending", empty → not yet booked
- "cancelled", "canceled" → cancelled
Report: `{N} confirmed, {N} pending, {N} not booked`

### Upcoming Activities
Filter to activities on or after today. Sort chronologically. Return next 5 (or N as requested).

### Adding an Itinerary Item
Append a row. Required: `activity`, `date`. Optional: `location`, `booking`, `cost`.
Preserve the date format already used in the sheet.
Insert near other entries on the same date if possible — or append to end with a note to sort.

### Location Grouping
When asked "what are we doing in {location}":
- Filter by location column (partial match OK)
- Return: date, activity, booking, cost for all matches

### First/Last Day
Identify the earliest and latest dates in the sheet.
Report: `Trip: {start date} to {end date} ({N} days)`

### Missing Bookings
Find all rows where `booking` is empty or "TBD" for future dates:
Report: `⚠️ Not yet booked: {activity} on {date}`

## Interpretation Rules
- Multiple activities on the same date are normal — sort them by any time info in the activity text
- `cost` may include currency symbols ($, €, £) or text — strip non-numeric characters for math
- Costs labeled "included" or "free" should be recorded as $0 in totals with a note
- `booking` column may contain URLs, confirmation codes, or status text — preserve as-is
- Do not reorder existing rows in the sheet — only report and append
