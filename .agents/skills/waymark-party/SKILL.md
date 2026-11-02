---
name: waymark-party
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Party Planning Dashboard template (Personal).
---

# Waymark Party Planning Dashboard Skill

> Specialized skill for **Party Planning Dashboard** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Party Planning Dashboard domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `party` |
| Template Name | Party Planning Dashboard |
| Category | Personal |
| Interaction Type | `dashboard` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Party Planning Dashboard sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. party
2. guestOfHonor
3. date
4. theme
5. venue
6. host
```

**Default headers when creating a new Party Planning Dashboard sheet:**
```
Party Details, Value, Notes
```

**Detection signals** — headers that indicate a sheet is a Party Planning Dashboard:
```
party, guest of honor, theme, venue, host, date
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `dashboard` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Party Planning Dashboard

# Party Planning Dashboard — Domain Knowledge

## What This Template Is
A multi-tab event and party planning dashboard (`waymark-party`). A complete Party Planning spreadsheet organizes event overview details alongside dedicated tabs for Guests/RSVPs, Menu, Budget, Thank You Notes, Decorations, Links, and Layout.

## Multi-Tab Structure & Column Roles
1. **`Details` tab** (primary overview):
   - Headers: `Party`, `Guest of Honor`, `Date`, `Theme`, `Venue`, `Host`
   - Roles: `party`, `guestOfHonor`, `date`, `theme`, `venue`, `host`
2. **`Guests` tab**:
   - Headers: `Guest`, `RSVP`, `Party Size`, `Notes`
   - Valid `RSVP` values: `Attending`, `Tentative`, `Declined`, `Invited`, `Pending`
3. **`Menu` tab**:
   - Headers: `Dish`, `Course`, `Assigned To`, `Status`, `Notes`
   - Courses: `Appetizer`, `Main`, `Side`, `Dessert`, `Drink`
   - Statuses: `Idea`, `Planned`, `Confirmed`, `Prepared`
4. **`Budget` tab**:
   - Headers: `Item`, `Category`, `Estimated`, `Actual`, `Paid` (`Yes` / `No`)
5. **`Thank You Notes` tab**:
   - Headers: `Guest Name`, `Gift Description`, `Date Received`, `Note Status` (`Pending` / `Sent`), `Sent Date`
6. **`Decorations` tab**:
   - Headers: `Decoration`, `Location`, `Bought` (`Yes` / `No`), `Hung` (`Yes` / `No`), `Notes`
7. **`Links` tab**:
   - Headers: `Label`, `URL`, `Type` (`Registry`, `Pinterest`, `Playlist`, `Venue`, `Other`)
8. **`Layout` tab**:
   - Headers: `Setting`, `Value` (e.g. `order` → `guests,menu,budget,thankyou,decorations,links`)

## Smart Operations
- When creating a new `party` sheet via `waymark_create_sheet({ templateKey: "party", title, seedRows })`, `Details` is populated with `seedRows` and all companion tabs (`Guests`, `Menu`, `Budget`, `Thank You Notes`, `Decorations`, `Links`, `Layout`) are automatically created.
- To read or add rows to a specific tab (such as `Guests` or `Menu`), pass `sheetTitle: "Guests"` or `sheetTitle: "Menu"` to `waymark_get_sheet` or use `sheets_values_append` on that tab.

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
Call `waymark_create_sheet({ templateKey: "party", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Party Planning Dashboard headers and initial rows.
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
