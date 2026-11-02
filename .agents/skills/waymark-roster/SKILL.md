---
name: waymark-roster
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Roster template (Operations).
---

# Waymark Roster Skill

> Specialized skill for **Roster** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Roster domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `roster` |
| Template Name | Roster |
| Category | Operations |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Roster sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. employee
2. shift
3. day
4. role
5. notes
```

**Default headers when creating a new Roster sheet:**
```
Employee, Role, Shift, Mon, Tue, Wed, Thu, Fri
```

**Detection signals** — headers that indicate a sheet is a Roster:
```
shift, roster, employee, availability, on.call, schedule, rotation
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Morning`
- `Afternoon`
- `Night`
- `Off`

Flow: `Morning → Afternoon → Night → Off`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — Roster

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
- For `toggle`, only write `Morning` or `Afternoon`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet({ templateKey: "roster", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Roster headers and initial rows.
- Created under user account via OAuth, automatically shared with service account and editors.
- Returns `{ spreadsheetId, waymarkUrl, sheetsUrl, title, templateKey }`.

### 4.5 Searching Entries & Files
- Search rows in a sheet: Call `waymark_search_entries({ spreadsheetId, query, column? })`.
- Search files in Google Drive: Call `waymark_list_files({ query?, type?: 'all'|'spreadsheet'|'document'|'folder', parentFolderId? })`.
- Share a sheet: Call `waymark_share_sheet({ spreadsheetId, shareWith?, shareWithAnyone?, role? })`.

### 4.6 Document Operations
- Create Google Doc: Call `waymark_create_doc({ title, body?, parentFolderId?, shareWith? })`.
- Read Google Doc: Call `waymark_get_doc({ documentId })`.
- Append to Google Doc: Call `waymark_append_doc({ documentId, text })`.
