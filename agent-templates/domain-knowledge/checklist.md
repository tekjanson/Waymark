# Checklist — Domain Knowledge

## What This Template Is
A simple list where each row is an item with a done/not-done status. The `status` column is a toggle — it is either the done marker (✓, "done", "x", "true", "1") or empty. Every other column is metadata (category, due date, notes). The goal is tracking completion of discrete items.

## Done Value Detection
Read the first few non-empty status cells. The done value is whatever non-empty string appears there. Common values: `✓`, `done`, `x`, `true`, `1`. Empty = not done. Preserve the exact done value found — never write a different truthy string.

## Smart Operations

### Completion Summary
Count rows. Report:
```
Total: N items
✓ Done:    N (X%)
◯ Pending: N (X%)
```
If a `category` column exists, break down per category.

### Overdue Detection
If a `due` or `date` column exists:
- Find all rows where status is empty (not done) AND due date is before today
- Report: `⚠️ Overdue: {item name} — was due {date}`
- Order by most overdue first

### Due Soon
Items not done with due dates within the next 7 days:
- Report: `📅 Due soon: {item name} — due {date}`

### Checking Off Items
When asked to mark items done:
- Find rows matching the description (exact or fuzzy match on text/name role)
- Write the done value (detected from existing data) to the status column
- Report: `Checked off: {item name}`

### Adding Items
Append a row. Required: text/item name. Optional: category (preserve existing category names), due date. Status = empty (not done). Never pre-check a newly added item.

### Clearing Completed
When asked to clear or archive done items:
- Do NOT delete rows — set a note or flag in notes column: "archived {date}"
- Report: `Archived N completed items`

### Category Filter
When asked "show me all {category} items":
- Filter rows by category column value (case-insensitive match)
- Report matching items with their current status

## Interpretation Rules
- Empty status = not done. Never treat empty as a third state.
- If the `status` column has values other than the done-marker and empty, detect what convention is used before writing
- Rows with empty text/name are spacers or separators — skip them in all counts
- "Check all" means set done value on EVERY non-done row, regardless of due date
