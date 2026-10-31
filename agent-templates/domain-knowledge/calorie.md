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
