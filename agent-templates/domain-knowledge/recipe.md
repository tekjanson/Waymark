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
