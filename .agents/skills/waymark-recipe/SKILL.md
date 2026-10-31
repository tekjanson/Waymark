---
name: waymark-recipe
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Recipe template (Personal).
---

# Waymark Recipe Skill

> Specialized skill for **Recipe** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Recipe domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `recipe` |
| Template Name | Recipe |
| Category | Personal |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Recipe sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. servings
3. prepTime
4. cookTime
5. category
6. difficulty
7. qty
8. unit
9. quantity
10. ingredient
11. step
12. notes
13. source
```

**Default headers when creating a new Recipe sheet:**
```
Recipe, Servings, Prep Time, Cook Time, Category, Difficulty, Qty, Unit, Ingredient, Step, Notes, Source
```

**Detection signals** — headers that indicate a sheet is a Recipe:
```
recipe, ingredient, ingredients, qty, unit, quantity, step, instructions, servings, prep, cook, cuisine, difficulty, directions, source, notes
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Recipe

# Recipe — Domain Knowledge

## What This Template Is
A recipe collection where each row is either a recipe header or an ingredient/step detail. The `text` column holds the recipe name (on header rows) or is empty (on detail rows). The `servings`, `prepTime`, `cookTime`, and `category` columns appear on header rows. A single recipe spans multiple rows: one header row followed by ingredient rows and step rows.

## Row Type Detection
- **Recipe row**: `text` column is non-empty (this is the recipe name/title)
- **Ingredient row**: `text` empty, `Qty` and `Unit` and `Ingredient` columns have values
- **Step row**: `text` empty, `Step` column has a number and `Notes` has the instruction
- **Source row**: `text` empty, `Source` column has a URL or book reference

## Smart Operations

### Recipe Index
List all recipes (header rows only) with category, servings, and total time:
```
{recipe name} [{category}]
  Servings: {N}  Prep: {X} min  Cook: {Y} min  Total: {X+Y} min
```

### Recipe Detail View
When asked for "how to make {recipe}":
- Find the recipe header row by name
- Collect all subsequent rows until the next recipe header
- Format as:
```
## {Recipe Name}
Servings: {N}  Prep: {X} min  Cook: {Y} min
Difficulty: {level}

### Ingredients
  {qty} {unit} {ingredient}
  ...

### Steps
  1. {step instruction}
  2. ...

Source: {source}
```

### Serving Scaling
When asked to scale a recipe to {N} servings:
- Find the recipe and its original servings count
- Multiply all `Qty` values by (N / original_servings)
- Return the scaled ingredient list (do not write back unless asked)

### Category Filter
When asked for recipes in a category:
- Find all header rows where `category` matches (case-insensitive)
- Return recipe names and total cook times

### Adding a Recipe
Append rows. First row: `text` = recipe name, `servings`, `prepTime`, `cookTime`, `category`, `difficulty`.
Then append ingredient rows (Qty, Unit, Ingredient filled; text empty).
Then append step rows (Step number, Notes = instruction; text empty).

### Quick Stats
Return: total recipe count, count by category, average cook time, fastest recipe.

## Interpretation Rules
- The recipe structure is hierarchical (header + detail rows) — always read the block together
- `prepTime` and `cookTime` may be in minutes as a number, or as "30 min" / "1 hour" — parse to minutes for math
- Empty `text` column does NOT mean the row is blank — it means it's a detail row for the preceding recipe
- `difficulty` is free text (Easy, Medium, Hard, etc.) — preserve as found, do not normalize

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
Call `waymark_create_sheet({ templateKey: "recipe", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Recipe headers and initial rows.
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
