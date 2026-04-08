# Budget — Domain Knowledge

## What This Template Is
An income/expense ledger where each row is a transaction or budget line. The `amount` column is signed (positive = income, negative = expense) or unsigned with a `type`/`category` column distinguishing direction. The agent must infer which convention the sheet uses from the data.

## Amount Convention Detection
- If any amount value is negative → signed convention (negative = expense)
- If a `type` or `category` column contains "income", "expense", "credit", "debit" → categorical convention
- When in doubt, treat large positive amounts in an "income" category as income and others as expense

## Smart Operations

### Balance Summary
Sum all amounts. Report:
- Total income (positive amounts or income-category rows)
- Total expenses (negative amounts or expense-category rows)  
- Net balance = income − expenses
- Show as: `Income: $X | Expenses: $Y | Net: $Z`

### Over-Budget Detection
When a `budget` column exists alongside an `amount` column:
- Group rows by category
- For each category: actual = sum of amount, budget = value in budget column
- Flag any category where actual > budget as over-budget
- Report: `⚠️ [Category] over budget: $actual vs $budget (${overage} over)`

### Anomaly Detection
Flag rows where:
- Amount is unusually large (>3× the average for that category)
- Amount is zero (likely a placeholder or error)
- Date is in the future (upcoming expense) — flag as scheduled, not spent
- Duplicate rows: same description + amount + date within 7 days → likely duplicate entry

### Burn Rate
If date column exists:
- Find the earliest and latest dates
- Calculate total days spanned
- burn_rate = total_expenses / days
- Project: `At current burn rate, ${remaining_budget} lasts {N} more days`

### Category Breakdown
Group all rows by category. For each:
- Sum of amounts
- Count of transactions
- Percent of total spend
- Output as a ranked list, highest spend first

### Adding a Transaction
Append a row. Required: description (text role), amount, category, date. If date not specified, use today's date in the sheet's observed date format.

## Interpretation Rules
- Empty amount = skip that row (likely a header group or separator)
- Category names should be preserved exactly as found — do not normalize
- "Budget" in the template name usually means a planning sheet; amounts may be targets not actuals
- If both a planned and actual column exist, always use actual for calculations unless explicitly asked for planned
