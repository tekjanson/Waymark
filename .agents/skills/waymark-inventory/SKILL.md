---
name: waymark-inventory
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Inventory template (Assets).
---

# Waymark Inventory Skill

> Specialized skill for **Inventory** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Inventory domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `inventory` |
| Template Name | Inventory |
| Category | Assets |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Inventory sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. quantity
3. category
4. extra
```

**Default headers when creating a new Inventory sheet:**
```
Item, Quantity, Category, Notes
```

**Detection signals** — headers that indicate a sheet is a Inventory:
```
quantity, qty, count, stock, amount, price, cost, sku
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Inventory

# Inventory — Domain Knowledge

## What This Template Is
A stock or asset tracking sheet where each row is an item. The `quantity` column is a numeric count (or weight/volume). The `category` column groups items. The `extra` column holds flexible metadata (supplier, location, unit, condition, etc.). Inline editing lets users update quantities directly.

## Quantity Convention Detection
- Pure integer values → unit count (e.g. 12 screws, 4 monitors)
- Decimal values → weight or volume (e.g. 2.5 kg, 0.75 liters)
- Values with units embedded (e.g. "12 bags", "3.5 m") → extract numeric part for calculations, keep full string for display

## Smart Operations

### Stock Summary
Count all items. Report:
```
Total items: N ({N} categories)
Total quantity: N units (sum of all numeric quantities)
```
Group by category. For each category: item count + total quantity.

### Low Stock Alert
When asked for low stock or reorder warnings:
- Flag any item with quantity ≤ 0 as `OUT OF STOCK`
- Flag any item with quantity ≤ a threshold (default: 5, or ask the user) as `LOW: {item} — {qty} remaining`
- Sort by most critical (lowest quantity first)

### Quantity Update
When told to update stock for an item:
- Find the row by `text` (item name), case-insensitive
- Write the new quantity
- If the quantity is being set to 0, confirm before writing

### Category Breakdown
Group all rows by `category`. For each:
- List of items with quantities
- Subtotal quantity for the category
- Flag any empty-quantity items

### Adding an Item
Append a row. Required: `text` (item name), `quantity`. Optional: `category` (use an existing category name if appropriate), `extra` (notes, location, supplier).

### Finding an Item
When asked "do we have X" or "how many X":
- Search `text` column for partial/fuzzy match
- Return: item name, quantity, category, extra (if present)
- If multiple matches: list all

### Inventory Valuation
If an `extra` or `notes` column contains price data (e.g. "$12.99", "cost: 5.00"):
- Parse the numeric price
- Calculate: quantity × price for each row
- Sum for total inventory value

## Interpretation Rules
- Empty `quantity` = unknown stock, not zero — distinguish from 0 in reports
- Multiple rows with the same item name may be intentional (different locations/variants) — do not merge automatically
- `category` values should be preserved exactly as found — do not normalize capitalization
- Negative quantity = returned/defective — flag it, do not treat as valid stock

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
Call `waymark_create_sheet(title, "inventory", initialEntries?)`
- Creates a sheet with the default Inventory headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "inventory", spreadsheetId?)`
- Searches entries across sheets matching the query.
