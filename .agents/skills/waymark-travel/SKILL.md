---
name: waymark-travel
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Travel Itinerary template (Travel).
---

# Waymark Travel Itinerary Skill

> Specialized skill for **Travel Itinerary** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Travel Itinerary domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `travel` |
| Template Name | Travel Itinerary |
| Category | Travel |
| Interaction Type | `none` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Travel Itinerary sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. activity
2. date
3. location
4. booking
5. bookingLink
6. bookingDetails
7. cost
```

**Default headers when creating a new Travel Itinerary sheet:**
```
Activity, Date, Location, Booking, Cost
```

**Detection signals** — headers that indicate a sheet is a Travel Itinerary:
```
flight, hotel, booking, booking link, booking details, itinerary, departure, arrival, accommodation
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `none` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Travel Itinerary

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
Call `waymark_create_sheet(title, "travel", initialEntries?)`
- Creates a sheet with the default Travel Itinerary headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "travel", spreadsheetId?)`
- Searches entries across sheets matching the query.
