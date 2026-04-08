# Meal Planner — Domain Knowledge

## What This Template Is
A weekly food plan where each row is a meal. The `day` column groups meals by day (Mon–Sun or full date). The `meal` column is the meal type (Breakfast, Lunch, Dinner, Snack). The `calories` and `protein` columns are nutrition data. The `recipe` column names the dish.

## Smart Operations

### Week View
Group rows by `day`. For each day, list meals in order (Breakfast → Lunch → Dinner → Snack):
```
{Day}
  Breakfast: {recipe} ({calories} kcal, {protein}g protein)
  Lunch:     {recipe}
  Dinner:    {recipe}
```
If nutrition data is missing, skip those fields.

### Daily Nutrition Total
For a given day, sum:
- Total calories across all meals
- Total protein across all meals
Compare to common targets if asked (e.g. 2000 kcal, 50g protein).
Report surplus/deficit: `+{N} kcal above / -{N} kcal below daily target`

### Weekly Nutrition Summary
Sum calories and protein for the entire week. Average per day. Identify highest/lowest calorie days.

### Missing Meals
Scan all days (Mon–Sun or dates in the plan) and report any meal type with no entry:
`Missing: {day} Lunch, {day} Dinner`

### Adding a Meal
Append a row. Required: `day`, `meal` (type), `recipe` (dish name).
Optional: `calories`, `protein`, `notes`.
Use the same day/meal format already present in the sheet.
If a meal type already exists for that day, warn before adding a duplicate.

### Recipe Lookup
When asked "what are we having for dinner on {day}":
- Find row where day matches AND meal = "Dinner"
- Return: recipe, calories, protein, notes

### Meal Swap
When asked to replace a meal:
- Find the row by day + meal type
- Update `recipe` (and optionally calories/protein)

### Shopping List Hint
When asked to generate a shopping list:
- Return all unique `recipe` values for the week
- Note: ingredient extraction is not possible from recipe names alone — provide the recipe list for the user to reference

## Interpretation Rules
- `day` may be a weekday name or a date — detect from existing data and preserve the format
- Multiple rows for the same day + meal type may be intentional (multiple dishes) — do not flag as error by default
- Empty `calories`/`protein` is very common — skip those fields in totals rather than treating as 0
- Meal types like "Breakfast" should be case-consistent with what's already in the sheet
