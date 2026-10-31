---
name: waymark-changelog
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Changelog template (Engineering).
---

# Waymark Changelog Skill

> Specialized skill for **Changelog** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Changelog domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `changelog` |
| Template Name | Changelog |
| Category | Engineering |
| Interaction Type | `none` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Changelog sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. version
2. date
3. type
4. description
```

**Default headers when creating a new Changelog sheet:**
```
Version, Date, Type, What Changed
```

**Detection signals** — headers that indicate a sheet is a Changelog:
```
version, release, changelog, what.changed, breaking, added, fixed
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `none` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Changelog

# Changelog — Domain Knowledge

## What This Template Is
A software version history where each row is a change entry. The `version` column holds a semver or version string (1.2.0, v2.3, etc.). The `date` column holds the release or change date. The `type` column categorizes the change. The `description` column describes what changed.

## Change Type Convention Detection
Read existing `type` values. Common conventions:
- **Standard**: Added, Changed, Fixed, Removed, Deprecated, Security
- **Short**: feat, fix, chore, refactor, docs, style, test, perf
- **Informal**: New, Bug fix, Improvement, Breaking
Preserve the convention already in use when adding entries.

## Smart Operations

### Version Summary
Group rows by `version` column. For each version (newest first), report:
```
## v{version}  ({date})
  [Added]   {description}
  [Fixed]   {description}
  [Breaking] {description}
```
Show how many changes per type across the whole changelog.

### Latest Version
Find the most recent version (by date or by semantic version comparison). Return:
- Version string, date, all entries for that version

### Breaking Changes
Find all rows where `type` = "Breaking" / "BREAKING CHANGE" / similar.
List them: `{version} ({date}): {description}`
This is critical for anyone doing a major upgrade.

### Adding a Changelog Entry
Append a row. Required: `version`, `type`, `description`. Optional: `date` (today if not specified).
Preserve the existing type vocabulary.
Place the entry near other entries of the same version if they exist (seek the version group, append after the last row of that group).

### Since Version
When asked "what changed since v{X}":
- Find all rows with versions newer than the specified version
- Group by version, return in order newest first

### Release Notes Draft
When asked to generate release notes for a version:
- Find all entries for that version
- Group by type
- Format as:
```
### What's New in {version}
**New Features:** ...
**Bug Fixes:** ...
**Breaking Changes:** (if any — highlight prominently)
```

### Security Audit
Find all rows with `type` = "Security" or "security". List them with version and date.
If none, report: `No security fixes recorded in this changelog.`

## Interpretation Rules
- Version ordering: semantic version (1.10.0 > 1.9.0) — do not sort lexicographically
- The same version may appear on multiple rows (one per change) — this is standard practice
- Empty `date` = undated change (common for unreleased/upcoming entries)
- "Unreleased" or "Next" as a version label = upcoming changes not yet shipped
- Do not delete or modify existing changelog entries — they are a historical record

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
Call `waymark_create_sheet({ templateKey: "changelog", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Changelog headers and initial rows.
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
