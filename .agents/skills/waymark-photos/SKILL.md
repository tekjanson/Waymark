---
name: waymark-photos
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Photo Gallery template (Personal).
---

# Waymark Photo Gallery Skill

> Specialized skill for **Photo Gallery** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Photo Gallery domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `photos` |
| Template Name | Photo Gallery |
| Category | Personal |
| Interaction Type | `none` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Photo Gallery sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. photo
2. title
3. date
4. album
5. description
```

**Default headers when creating a new Photo Gallery sheet:**
```
Photo, Title, Date, Album, Description
```

**Detection signals** — headers that indicate a sheet is a Photo Gallery:
```
photo, image, picture, album, gallery
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `none` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Photo Gallery

# Photo Gallery — Domain Knowledge

## What This Template Is
A photo catalog or gallery inventory. Each row represents a photo or image asset. The `photo` column typically holds a filename, URL, Google Drive link, or a short reference ID. `title` is the display name. `date` is when the photo was taken or added. `album` is the collection it belongs to. `description` is optional caption or notes.

## Smart Operations

### Album Browser
List all distinct values in the `album` column with count:
```
  {album}: N photos
```
When asked to browse a specific album: filter and show all rows in that album.
```
  Album: {album}
  {title} | {date} | {photo}
  ...
```

### Date Range Filter
When a date range is given, filter rows where `date` falls within the range (inclusive).
Show rows sorted by date ascending:
```
  {date} — {title} [{album}]
```
Accept natural language dates ("last month", "June 2024") and convert to range.

### Adding a Photo Entry
Append a row. Required: `photo` (filename, URL, or reference). Optional: `title` (default: filename), `date` (default: today), `album`, `description`.
Do not fabricate photo URLs or file paths — use exactly what is provided.

### Finding a Photo
Search by:
- Exact `title` match
- Partial `title` match (case-insensitive)
- `album` filter
- `description` keyword

Return: `title`, `date`, `album`, `photo` (the link/reference), `description`.

### Album Summary
When asked for a summary of an album:
```
  Album: {album}
  Photos: N
  Date range: {earliest} → {latest}
  Descriptions: {first few non-empty descriptions, truncated}
```

### Updating a Photo Entry
When told to update title, date, album, or description:
- Find by `photo` reference or exact `title`
- Write only the changed columns

### Removing / Archiving a Photo
Do NOT delete rows without explicit "delete" instruction.
If asked to archive: change `album` to "Archive" (or a provided archive album name).

## Interpretation Rules
- The `photo` column often contains a raw URL or file path — preserve it exactly, never shorten or modify
- Album names are case-sensitive — preserve original casing when writing
- If `date` is empty for existing rows, do not infer or fill it in unless asked
- `description` is free text — no length limit or format requirement
- A blank `album` indicates an uncategorized photo — do not assign an album unless asked

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
Call `waymark_create_sheet(title, "photos", initialEntries?)`
- Creates a sheet with the default Photo Gallery headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "photos", spreadsheetId?)`
- Searches entries across sheets matching the query.
