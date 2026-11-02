---
name: waymark-passwords
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Password Manager template (Security).
---

# Waymark Password Manager Skill

> Specialized skill for **Password Manager** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Password Manager domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `passwords` |
| Template Name | Password Manager |
| Category | Security |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Password Manager sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. site
2. username
3. password
4. url
5. category
6. notes
```

**Default headers when creating a new Password Manager sheet:**
```
Site, Username, Password, URL, Category, Notes
```

**Detection signals** — headers that indicate a sheet is a Password Manager:
```
password, passwd, secret, credential, site, service, username, login
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Password Manager

# Password Manager — Domain Knowledge

## ⚠️ SECURITY NOTICE
This template contains credentials. Apply strict rules at all times:
- **NEVER log, print, or include passwords in any report, summary, or output**
- **NEVER return password values in responses** — confirm operations without echoing passwords
- **Treat all data in this sheet as sensitive** — do not cache or describe specific credential values
- Only confirm that an operation succeeded (e.g. "Password updated for Site X") — never show the new value

## What This Template Is
A credentials registry where each row is a saved login. The `site` column is the service name or URL. The `username` column is the login identifier. The `password` column is the credential. The `url` column is the sign-in URL. The `category` column groups entries (Work, Personal, Finance, etc.).

## Smart Operations

### Entry Lookup (Safe)
When asked "do I have a login for {site}":
- Search `site` and `url` columns (case-insensitive, partial match)
- Return: site name, username, URL — **NEVER return the password**
- Confirm entry exists: `Found: {site} — Username: {username}`

### Category List
When asked to list entries by category:
- Return: site + username per entry
- **NEVER include passwords in the list**

### Adding an Entry
Append a row. Required: `site`, `username`, `password`. Optional: `url`, `category`.
Confirm: `Entry added for {site}.` — do not echo back the password.

### Updating a Password
Find by site + username. Write new password value.
Confirm: `Password updated for {site}.` — do not echo old or new password.

### Duplicate Detection
Find multiple entries for the same `site`:
- Same site + same username → definite duplicate
- Same site + different username → may be multiple accounts
Report (without passwords): `Duplicate entries for {site}: {N} entries`

### Category Audit
Count entries per category. Report which categories exist and how many entries each has.

### Stale Entries
If a `notes` or `updated` column contains dates, identify entries not touched in >90 days.
Report: `{N} entries may need password rotation (not updated recently)`
**Do not list passwords** — just site names.

### Deleting an Entry
Before deleting: confirm the site name with the user.
Do not delete — instead, add a note "archived" to the `notes` column and move to an "Archived" category.

## Interpretation Rules
- **Every operation involving the password column must suppress the password from all output**
- `site` may be a domain name, app name, or full URL — preserve as-is
- Empty `url` is common — not all entries need a direct login URL
- `username` may be an email address or a username string — preserve exactly as entered
- `category` is user-defined — do not impose categories; use what already exists

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
Call `waymark_create_sheet({ templateKey: "passwords", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Password Manager headers and initial rows.
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
