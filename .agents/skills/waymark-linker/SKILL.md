---
name: waymark-linker
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Community Linker template (Social).
---

# Waymark Community Linker Skill

> Specialized skill for **Community Linker** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Community Linker domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `linker` |
| Template Name | Community Linker |
| Category | Social |
| Interaction Type | `navigation` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Community Linker sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. name
2. description
3. link
4. type
5. tags
6. icon
```

**Default headers when creating a new Community Linker sheet:**
```
Name, Description, Link, Type, Tags, Icon
```

**Detection signals** — headers that indicate a sheet is a Community Linker:
```
link, url, sheet, waymark link, sheet id, public link, type, kind, entry type, name, title, community
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `navigation` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Community Linker

# Community Linker — Domain Knowledge

## What This Template Is
A curated link directory where each row is a resource. The `name` column is the link title. The `description` column explains what it is. The `link` column is the URL. The `type` column categorizes it (tool, article, repo, video, community, etc.). The `tags` column has comma-separated keywords. The `icon` column holds an emoji or icon identifier.

## Smart Operations

### Link Directory
Group all entries by `type`. For each type:
```
{Type} ({N} links)
  • {name} — {description}
    {link}
```

### Find a Link
When asked "find a link for {topic}" or "do we have a link to {thing}":
- Search `name` (exact then partial)
- Search `description` (keyword match)
- Search `tags` (split by comma, match individual tags)
- Return: name, description, link, type, tags
- If multiple matches: list all

### Tag Search
Find all entries tagged with {tag}:
- Split `tags` by comma, strip whitespace, match case-insensitively
- Return matching entries with their links

### Adding a Link
Append a row. Required: `name`, `link`. Optional: `description`, `type`, `tags`, `icon`.
Before adding: check for an existing entry with the same URL — warn if found.
`type` should use an existing type value from the sheet if one fits.

### Type Breakdown
Count entries per type. Report: `{type}: {N} links`

### Dead Link Detection
This agent cannot make HTTP requests, so it cannot verify links are live.
When asked to check links: note this limitation and report the full list of links for the user to verify manually.

### Tagging Suggestions
When asked to suggest tags for an entry:
- Read the `name` and `description`
- Suggest 3–5 relevant tags based on the content
- Do not write them unless confirmed by the user

### Exporting
When asked to export the directory:
Format as markdown:
```markdown
## {type}
- [{name}]({link}) — {description}  `{tags}`
```
Group by type, sort alphabetically within each group.

## Interpretation Rules
- `link` must start with http:// or https:// — flag entries with invalid URL format
- `tags` is free text — normalize to lowercase for comparison, preserve original case for storage
- `icon` is optional decoration — it's an emoji or icon name, not a URL
- Entries with empty `link` are placeholders — flag them: `{name} has no URL yet`
- Duplicate links (same URL, different names) may be intentional cross-references — flag but don't auto-remove

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
Call `waymark_create_sheet(title, "linker", initialEntries?)`
- Creates a sheet with the default Community Linker headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "linker", spreadsheetId?)`
- Searches entries across sheets matching the query.
