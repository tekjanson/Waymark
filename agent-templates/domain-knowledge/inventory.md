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
