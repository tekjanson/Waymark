---
name: waymark-contacts
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Contacts template (People).
---

# Waymark Contacts Skill

> Specialized skill for **Contacts** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Contacts domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `contacts` |
| Template Name | Contacts |
| Category | People |
| Interaction Type | `none` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Contacts sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. name
2. email
3. phone
4. role
5. group
6. shareSheet
7. socialLocation
```

**Default headers when creating a new Contacts sheet:**
```
Name, Phone, Email, Role
```

**Detection signals** — headers that indicate a sheet is a Contacts:
```
email, phone, mobile, cell, name, contact, person
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `none` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Contacts

# Contacts — Domain Knowledge

## What This Template Is
A people directory where each row is a person. The `name` column is the person's full name. The `email` and `phone` columns are contact methods. The `role` column describes their position, relationship, or title. No interactive state — read-only lookup and organization.

## Smart Operations

### Find a Contact
When asked to look up someone:
- Search `name` column first (exact then fuzzy)
- Also search `role` and `email` if name search returns nothing
- Return: name, role, email, phone (all available columns)
- If multiple matches: list all with distinguishing details

### Role Filter
When asked "show me all {role}":
- Case-insensitive match on `role` column
- Also match partial role names (e.g. "engineer" matches "Senior Engineer")
- Return matching contacts list

### Deduplication Check
Scan for potential duplicates:
- Same email address on multiple rows → definite duplicate
- Very similar name (e.g. "John Smith" and "John A. Smith") + same role → probable duplicate
- Report: `Possible duplicate: {name1} (row {r1}) and {name2} (row {r2})`

### Adding a Contact
Append a row. Required: `name`. Optional but encouraged: `email`, `phone`, `role`.
Before adding: search for existing contact with same name — warn if found.

### Export Format
When asked to format contacts for export or sharing:
```
{name} — {role}
  Email: {email}
  Phone: {phone}
```
Skip empty fields silently.

### Group by Role
Group all contacts by their `role` value. Report:
```
{Role} ({N} people)
  - {name} — {email}
```
Sort roles alphabetically. Contacts with no role go under "Uncategorized".

### Missing Fields Audit
Scan all rows. Report:
- Contacts with no email AND no phone (no way to reach them)
- Contacts with no role
- Count: `{N} contacts have no reachable contact method`

## Interpretation Rules
- Phone numbers should be preserved exactly as entered — do not normalize format
- Email addresses are case-insensitive for lookup but preserve original case for display
- Multiple entries for the same person are not always errors (e.g. work vs. personal)
- `role` is free text — do not impose a controlled vocabulary
- Empty rows are separators — skip in all operations

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
Call `waymark_create_sheet({ templateKey: "contacts", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Contacts headers and initial rows.
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
