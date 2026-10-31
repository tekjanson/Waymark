---
name: waymark-budget
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Budget template (Finance).
---

# Waymark Budget Skill

> Specialized skill for **Budget** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Budget domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `budget` |
| Template Name | Budget |
| Category | Finance |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Budget sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. amount
3. category
4. date
5. notes
```

**Default headers when creating a new Budget sheet:**
```
Description, Amount, Category, Date, Budget
```

**Detection signals** — headers that indicate a sheet is a Budget:
```
income, expense, budget, spent, balance, category, amount
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Budget

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
Call `waymark_create_sheet({ templateKey: "budget", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Budget headers and initial rows.
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
