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
7. relation
8. target
9. synthesis
```

**Default headers when creating a new Community Linker sheet:**
```
Name, Description, Link, Type, Tags, Icon, Relation, Target, Synthesis
```

**Detection signals** — headers that indicate a sheet is a Community Linker:
```
link, url, sheet, waymark link, sheet id, public link, type, kind, entry type, name, title, community, relation, target, synthesis
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `navigation` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Community Linker

# Community Linker & Knowledge Graph — Domain Knowledge

## What This Template Is
A Knowledge Graph, Linker Tree, and curated Waymark directory where each row represents an entity/node, a Waymark resource, or a federated sub-graph, along with its directed relationships and synthetic understanding.
- `name`: Entity, hub, or resource title.
- `description`: Overview of what the node or resource represents.
- `link`: Waymark Sheet ID, Folder ID, or `#/sheet/{id}` route for direct source-data click-through.
- `type`: Categorizes the node (`waymark`, `linker`, `graph`, `sub-graph`, `concept`, `synthesis`, `folder`).
- `tags`: Comma-separated keywords/clusters used for filtering and semantic hub grouping.
- `icon`: Emoji or symbol identifier.
- `relation`: Directed relationship verb/predicate (e.g. `funded by`, `uses`, `federates`, `curates`, `informs`, `depends on`).
- `target`: Target entity name or target Waymark Sheet ID connected by `relation`.
- `synthesis`: Synthetic understanding, insights, or cross-sheet takeaway explaining how and why these sources connect.

## Smart Operations

### Knowledge Graph & Linker Tree Construction
- **Primary Node Rows**: Populate `name`, `description`, `link`, `type`, `tags`, `icon`, and optionally `relation`, `target`, and `synthesis`.
- **Multi-Edge / Multi-Insight Continuation Rows (§4.7)**: To attach multiple relationships or synthetic insights to the same entity without packing cells with delimiters, leave `name` blank on the following row(s) and populate `relation`, `target`, and/or `synthesis`.
- **Cross-Sheet Federation**: Entries with `type: "linker"` or `type: "graph"` and a `link` pointing to another Waymark spreadsheet act as federated sub-graph hubs that expand inline in the Waymark UI.

### Link Directory
Group all entries by `type`. For each type:
```
{Type} ({N} nodes)
  • {name} — {description}
    Link: {link} | {relation} → {target}
    Synthesis: {synthesis}
```

### Find a Node or Relationship
When asked "find a link for {topic}" or "how does {A} relate to {B}":
- Search `name` (exact then partial)
- Search `description` and `synthesis` (keyword match)
- Search `relation` and `target` (edge traversal)
- Search `tags` (split by comma, match individual tags)
- Return: name, description, link, type, relation, target, synthesis, tags

### Tag Search
Find all entries tagged with {tag}:
- Split `tags` by comma, strip whitespace, match case-insensitively
- Return matching entries with their links and relationships

### Adding a Node or Relationship
Append a row. Required: `name` (or continuation row under an existing node). Optional: `description`, `link`, `type`, `tags`, `icon`, `relation`, `target`, `synthesis`.
Before adding: check for an existing entry with the same `name` or `link` — if adding a new relationship to an existing node, either update the node or append a continuation row.

### Exporting
When asked to export the directory or knowledge graph:
Format as markdown:
```markdown
## {type}
- [{name}]({link}) — {description} (`{relation} → {target}`)
  - 💡 Synthesis: {synthesis}
```

## Interpretation Rules
- `link` should be a valid Waymark reference (`sheet-NNN`, Google Sheet/Folder ID, or `#/sheet/{id}` / `#/folder/{id}`) for direct source click-through
- `tags` is free text — normalize to lowercase for comparison, preserve original case for storage
- `icon` is optional decoration — an emoji (`📄`, `📁`, `🧠`, `💡`, `🌐`)
- `synthesis` stores higher-order synthetic understanding across linked sheets

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
Call `waymark_create_sheet({ templateKey: "linker", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Community Linker headers and initial rows.
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
