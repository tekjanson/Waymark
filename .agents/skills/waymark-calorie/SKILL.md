---
name: waymark-calorie
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Calorie & Fitness Tracker template (Health & Lifestyle).
---

# Waymark Calorie & Fitness Tracker Skill

> Specialized skill for **Calorie & Fitness Tracker** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Calorie & Fitness Tracker domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `calorie` |
| Template Name | Calorie & Fitness Tracker |
| Category | Health & Lifestyle |
| Interaction Type | `dashboard` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Calorie & Fitness Tracker sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. date
2. meal
3. item
4. qty
5. unit
6. calories
7. protein
8. carbs
9. fat
10. burned
11. target
```

**Default headers when creating a new Calorie & Fitness Tracker sheet:**
```
Food, Meal, Calories, Protein, Carbs, Fat, Date, Servings, Notes
```

**Detection signals** — headers that indicate a sheet is a Calorie & Fitness Tracker:
```
date, meal, item, calories, protein, carbs, fat, burned, exercise, target
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `dashboard` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Calorie & Fitness Tracker

# Calorie & Fitness Tracker — Domain Knowledge

## What This Template Is
A daily nutrition, macronutrient, and exercise calorie expenditure tracker (`waymark-calorie`). Renders an interactive health dashboard with daily calorie balance (intake minus burned vs. target) and macro breakdowns (protein, carbs, fat).

## Column Role Semantics
- `date` — Entry date (`YYYY-MM-DD`).
- `meal` — Meal slot or activity category (`Breakfast`, `Lunch`, `Dinner`, `Snack`, `Exercise`).
- `item` — Food item or workout activity name (e.g., `Greek Yogurt & Berries`, `5k Morning Run`).
- `qty` — Serving quantity or exercise duration.
- `unit` — Serving unit (`g`, `oz`, `cup`, `serving`, `min`).
- `calories` — Calorie intake (`kcal`) for food items (`0` for pure exercise rows).
- `protein` — Protein in grams (`g`).
- `carbs` — Carbohydrates in grams (`g`).
- `fat` — Fat in grams (`g`).
- `burned` — Calories burned through exercise (`kcal`, `0` or empty for food rows).
- `target` — Daily net calorie target (e.g., `2000` or `2200`).

## Smart Operations

### Logging Meals & Workouts
- For food entries: populate `date`, `meal` (`Breakfast`/`Lunch`/`Dinner`/`Snack`), `item`, `qty`, `unit`, `calories`, `protein`, `carbs`, `fat`, and `target`.
- For workouts: set `meal` to `Exercise`, populate `item`, `qty`, `unit` (e.g., `min`), `burned`, and set `calories` to `0`.
- Sanity-check macros: `calories` should approximately equal `(protein * 4) + (carbs * 4) + (fat * 9)`.

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
Call `waymark_create_sheet({ templateKey: "calorie", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Calorie & Fitness Tracker headers and initial rows.
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
