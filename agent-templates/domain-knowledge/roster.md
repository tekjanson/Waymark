# Roster — Domain Knowledge

## What This Template Is
A staff scheduling sheet where each row is an employee's shift assignment for a day. The `employee` column is the person's name. The `shift` column cycles through: Morning, Afternoon, Night, Off. The `day` column is the work date or weekday. The `role` column is the employee's job role or position.

## Valid Shift States
```
Morning → Afternoon → Night → Off → (back to Morning)
```
Only write these exact values to the `shift` column. Empty = unassigned (different from Off).

## Smart Operations

### Daily Roster
Group rows by `day`. For each day:
```
{Day}
  Morning:   {employee list}
  Afternoon: {employee list}
  Night:     {employee list}
  Off:       {employee list}
```
Flag any shift with zero employees: `⚠️ No staff on Morning shift — {day}`

### Employee Schedule
When asked "what is {employee}'s schedule":
- Filter all rows by employee name (case-insensitive)
- Return list: day → shift
- Highlight days marked "Off"

### Shift Coverage Check
For a given day: count employees per shift. If any shift has 0 employees, flag it.
If a minimum coverage per shift is known (from context), check against it.

### Assigning a Shift
When told to assign or change a shift:
- Find the row by employee + day
- Write the new shift value (must be a valid state)
- If no row exists for that employee+day combination, add one

### Adding an Employee to the Roster
When adding a new person's schedule for the week:
- Append one row per day they work
- Required: `employee`, `day`, `shift`, `role`

### Week Schedule Build
When asked to build a full week schedule for all employees:
- For each employee + each day of the week: append a row
- Prompt user for shift assignments or distribute evenly if instructed

### Off Days Summary
Count Off-shift assignments per employee for the period. Report as a leave/off-day summary.

### Role-Based Coverage
If `role` column exists, check that each role is covered on every shift:
- Group by day + shift + role
- Flag if a critical role (e.g. Manager) is absent from a shift

## Interpretation Rules
- "Off" is a valid shift state, not an absence — it means the employee is officially off that day
- Empty `shift` cell = not yet scheduled — different from "Off"
- An employee may appear multiple times on the same day (split shifts) — this is valid if intentional
- `notes` column comments are informational — do not change shift based on notes without explicit instruction
