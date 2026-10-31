---
name: waymark-floorplan
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Floor Plan template (Home Design).
---

# Waymark Floor Plan Skill

> Specialized skill for **Floor Plan** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Floor Plan domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `floorplan` |
| Template Name | Floor Plan |
| Category | Home Design |
| Interaction Type | `dashboard` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Floor Plan sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. type
2. label
3. layer
4. x
5. y
6. width
7. height
8. length
9. notes
```

**Default headers when creating a new Floor Plan sheet:**
```
Room Name, Type, Points, Doors, Windows, Color, Notes
```

**Detection signals** — headers that indicate a sheet is a Floor Plan:
```
type, room, wall, fixture, electrical, plumbing, x, y, width, height, length, layer
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `dashboard` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Floor Plan

# Floor Plan — Domain Knowledge

## What This Template Is
A parametric 2D/3D architectural floor plan and room layout designer (`waymark-floorplan`). Each row defines a spatial element (room, wall, door, window, furniture, fixture, electrical, or plumbing element) with coordinates and dimensions in feet.

## Column Role Semantics
- `type` — Element type (`Room`, `Wall`, `Door`, `Window`, `Fixture`, `Furniture`, `Electrical`, `Plumbing`, `Zone`, `Stair`).
- `label` — Human-readable name (e.g., `Living Room`, `Kitchen Island`, `Primary Bedroom`, `Front Door`).
- `layer` — Architectural layer (`Structure`, `Rooms`, `Openings`, `Fixtures`, `Furniture`, `Electrical`, `Plumbing`, `Annotations`).
- `x` — Horizontal X position in feet from origin (`0` = left edge).
- `y` — Vertical Y position in feet from origin (`0` = top edge).
- `width` — Width (X span) in feet.
- `height` — Ceiling/wall height (Z span) in feet (typically `8` or `9` for rooms/walls, `3` for counters).
- `length` — Depth/length (Y span) in feet.
- `notes` — Material, finish, color, circuit, or specification notes.

## Smart Operations

### Designing a Cohesive Layout
- Avoid unintentionally overlapping rooms on the `Rooms` / `Structure` layer: place adjacent rooms so their `(x, y)` coordinates and `(width, length)` spans abut cleanly (e.g., Room A at `x=0, y=0, width=16, length=14` and adjacent Room B at `x=16, y=0, width=12, length=14`).
- Place `Furniture` and `Fixture` elements inside the bounding box `[x, x + width] × [y, y + length]` of their parent room.
- Place `Door` and `Window` elements along room boundary walls.

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
Call `waymark_create_sheet({ templateKey: "floorplan", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Floor Plan headers and initial rows.
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
