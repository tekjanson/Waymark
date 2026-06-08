# Financials Architecture — Data Schema

> Defines the Google Sheets data structure for the Waymark personal/household
> financial tracking system. All sheets follow the row-per-item format (§4.7 of
> AI Laws) — one piece of data per row, no delimiter-packed cells.

---

## Overview

The system uses **one Google Spreadsheet** with five tabs:

| Tab | Purpose |
|-----|---------|
| `Assets` | Every asset you own — accounts, properties, investments, vehicles |
| `Liabilities` | Every debt — mortgages, credit cards, loans, HELOCs |
| `Transactions` | Line-level debit/credit history across all assets and liabilities |
| `Statements` | Monthly statement records with Drive links to original PDFs |
| `Dashboard` | Summary formulas for net worth, totals, and cash flow (formula-only, no data rows) |

---

## Tab: Assets

**Purpose:** Master registry of every asset. One row per asset.

| Column | Header | Type | Required | Example |
|--------|--------|------|----------|---------|
| A | Asset ID | `ASSET-NNN` | ✅ | `ASSET-001` |
| B | Name | text | ✅ | `Chase Checking` |
| C | Type | enum | ✅ | `Bank Account` |
| D | Institution | text | ✅ | `Chase` |
| E | Account Number | text (masked) | ✅ | `••••4821` |
| F | Current Balance | number | ✅ | `8450.23` |
| G | Opening Balance | number | | `0.00` |
| H | Interest Rate | percent | | `0.01` |
| I | Open Date | `YYYY-MM-DD` | | `2019-03-15` |
| J | Status | enum | ✅ | `Active` |
| K | Notes | text | | `Joint account with spouse` |

**Type enum values:**
```
Bank Account | Savings Account | Investment Account | Retirement Account (401k/IRA)
Property | Vehicle | Business | Other
```

**Status enum values:**
```
Active | Closed | Frozen
```

**Interlinking rule:** Assets are referenced by `Asset ID` from the Liabilities tab (Linked Asset column) and from the Transactions tab (Entity ID column).

---

## Tab: Liabilities

**Purpose:** Master registry of every debt/liability. One row per liability.

| Column | Header | Type | Required | Example |
|--------|--------|------|----------|---------|
| A | Liability ID | `LIAB-NNN` | ✅ | `LIAB-001` |
| B | Name | text | ✅ | `Chase Sapphire` |
| C | Type | enum | ✅ | `Credit Card` |
| D | Institution | text | ✅ | `Chase` |
| E | Account Number | text (masked) | ✅ | `••••9432` |
| F | Current Balance | number | ✅ | `3214.50` |
| G | Credit Limit / Original Amount | number | | `15000.00` |
| H | Interest Rate (APR) | percent | ✅ | `0.2124` |
| I | Minimum Payment | number | | `65.00` |
| J | Payment Due Day | number (1–31) | | `15` |
| K | Linked Asset ID | `ASSET-NNN` | | `ASSET-005` |
| L | Open Date | `YYYY-MM-DD` | | `2021-07-20` |
| M | Status | enum | ✅ | `Active` |
| N | Notes | text | | `0% promo through 2026-12` |

**Type enum values:**
```
Credit Card | Mortgage | Home Equity Loan | HELOC
Auto Loan | Student Loan | Personal Loan | Business Loan | Other
```

**Linked Asset ID:** Used to interlink liabilities to the assets they're associated with.
- A **Mortgage** links to a **Property** asset (enables net equity calculation: `property value − mortgage balance`).
- A **HELOC** links to the same Property.
- Credit cards and loans leave this blank.

**Status enum values:**
```
Active | Paid Off | Closed | In Collections
```

---

## Tab: Transactions

**Purpose:** Every debit and credit across all assets and liabilities. One row per transaction.

| Column | Header | Type | Required | Example |
|--------|--------|------|----------|---------|
| A | Date | `YYYY-MM-DD` | ✅ | `2026-05-14` |
| B | Entity ID | `ASSET-NNN` or `LIAB-NNN` | ✅ | `LIAB-001` |
| C | Entity Name | text (denormalized) | ✅ | `Chase Sapphire` |
| D | Description | text | ✅ | `Amazon.com` |
| E | Amount | number (signed) | ✅ | `-89.99` |
| F | Category | text | ✅ | `Shopping` |
| G | Type | enum | ✅ | `Debit` |
| H | Running Balance | number | | `3124.51` |
| I | Statement ID | `STMT-NNN` | | `STMT-042` |
| J | Reconciled | boolean | | `TRUE` |
| K | Notes | text | | `Returned 2026-05-20` |

**Amount sign convention:**
- Positive = money in (deposit, payment received, credit)
- Negative = money out (purchase, payment made, debit)

**Type enum values:**
```
Debit | Credit | Transfer | Payment | Refund | Interest | Fee
```

**Category values (suggested, user-extendable):**
```
Housing | Utilities | Groceries | Dining | Transportation | Healthcare
Insurance | Shopping | Entertainment | Travel | Income | Transfer | Other
```

**Interlinking:**
- `Entity ID` → `ASSET-NNN` (from Assets tab) or `LIAB-NNN` (from Liabilities tab)
- `Statement ID` → `STMT-NNN` (from Statements tab) — links a transaction to the statement it appeared on

---

## Tab: Statements

**Purpose:** Monthly statement records. One row per statement (one per account per month).

| Column | Header | Type | Required | Example |
|--------|--------|------|----------|---------|
| A | Statement ID | `STMT-NNN` | ✅ | `STMT-001` |
| B | Entity ID | `ASSET-NNN` or `LIAB-NNN` | ✅ | `LIAB-001` |
| C | Entity Name | text (denormalized) | ✅ | `Chase Sapphire` |
| D | Statement Date | `YYYY-MM-DD` | ✅ | `2026-05-31` |
| E | Opening Balance | number | ✅ | `2890.00` |
| F | Closing Balance | number | ✅ | `3214.50` |
| G | Total Debits | number | ✅ | `1243.75` |
| H | Total Credits | number | ✅ | `919.25` |
| I | Minimum Payment Due | number | | `65.00` |
| J | Payment Due Date | `YYYY-MM-DD` | | `2026-06-15` |
| K | Drive File ID | text | | `1BxYz...` |
| L | Drive File Name | text | | `chase-sapphire-2026-05.pdf` |
| M | Reconciled | boolean | ✅ | `TRUE` |
| N | Notes | text | | `Dispute filed row 47` |

**Statement ID format:** `STMT-NNN` where NNN is sequential across all entities (global, not per-account).

**Interlinking:**
- `Entity ID` → same account in Assets or Liabilities tabs
- `Drive File ID` → Google Drive file (PDF of original bank/card statement)
- Transactions tab `Statement ID` references `STMT-NNN` here

---

## Tab: Dashboard

**Formula-only tab.** No data rows. Uses `SUMIF`, `VLOOKUP`, and `FILTER` functions to aggregate:

| Section | What It Shows |
|---------|---------------|
| Net Worth | `SUM(Assets.F) - SUM(Liabilities.F)` |
| Total Assets | Sum of all asset balances by type |
| Total Liabilities | Sum of all liability balances by type |
| Cash & Liquid | Sum of Bank Account + Savings Account balances |
| Property Equity | Sum of (property value − linked mortgage balance) per property |
| Monthly Cash Flow | Sum of Transactions this month by type (income vs expense) |
| Spending by Category | `SUMIF` on Transactions.F grouped by category |
| Liability Utilization | Credit card balance / limit per card |

---

## Entity ID Format Reference

| Prefix | Tab | Example |
|--------|-----|---------|
| `ASSET-NNN` | Assets | `ASSET-001`, `ASSET-012` |
| `LIAB-NNN` | Liabilities | `LIAB-001`, `LIAB-007` |
| `STMT-NNN` | Statements | `STMT-001`, `STMT-047` |

All IDs are zero-padded to 3 digits. Sequential within each type starting at `001`.

---

## Interlinking Map

```
Assets (ASSET-NNN)
  ↑ referenced by
Liabilities.K (Linked Asset ID)     — mortgage/HELOC → property
Transactions.B (Entity ID)          — transactions against this account
Statements.B (Entity ID)            — statements for this account

Liabilities (LIAB-NNN)
  ↑ referenced by
Transactions.B (Entity ID)          — transactions against this liability
Statements.B (Entity ID)            — statements for this liability

Statements (STMT-NNN)
  ↑ referenced by
Transactions.I (Statement ID)       — which statement this transaction appears on

Google Drive (file ID)
  ↑ referenced by
Statements.K (Drive File ID)        — original PDF statement
```

---

## Example Data (Row-per-Item Layout)

### Assets tab sample
```
| Asset ID  | Name              | Type            | Institution | Account Number | Current Balance | ... |
|-----------|-------------------|-----------------|-------------|----------------|-----------------|-----|
| ASSET-001 | Chase Checking    | Bank Account    | Chase       | ••••4821       | 8450.23         | ... |
| ASSET-002 | Ally Savings      | Savings Account | Ally        | ••••7702       | 22000.00        | ... |
| ASSET-003 | Vanguard Brokerage| Investment      | Vanguard    | ••••1193       | 145200.00       | ... |
| ASSET-004 | 123 Main St       | Property        | N/A         | N/A            | 520000.00       | ... |
| ASSET-005 | Tesla Model Y     | Vehicle         | N/A         | VIN ••••2KL9   | 38000.00        | ... |
```

### Liabilities tab sample
```
| Liability ID | Name          | Type        | Institution | Acct # | Balance  | Limit    | APR    | Min Pay | Due Day | Linked Asset |
|--------------|---------------|-------------|-------------|--------|----------|----------|--------|---------|---------|--------------|
| LIAB-001     | Chase Sapphire| Credit Card | Chase       | ••••9432 | 3214.50 | 15000.00 | 21.24% | 65.00   | 15      |              |
| LIAB-002     | Main St Mortgage | Mortgage  | Wells Fargo | ••••8801 | 387000.00| 420000.00 | 6.875%| 2810.00 | 1      | ASSET-004    |
| LIAB-003     | Auto Loan     | Auto Loan   | Capital One | ••••3312 | 18400.00 | 42000.00 | 4.99%  | 720.00  | 22      | ASSET-005    |
```

### Transactions tab sample (Credit Card)
```
| Date       | Entity ID | Entity Name   | Description       | Amount  | Category    | Type   | Statement ID |
|------------|-----------|---------------|-------------------|---------|-------------|--------|--------------|
| 2026-05-02 | LIAB-001  | Chase Sapphire| Whole Foods       | -127.43 | Groceries   | Debit  | STMT-041     |
| 2026-05-05 | LIAB-001  | Chase Sapphire| Shell Gas Station | -68.20  | Transportation | Debit | STMT-041   |
| 2026-05-15 | LIAB-001  | Chase Sapphire| Payment Thank You | 500.00  | Payment     | Credit | STMT-041     |
```

---

## Schema Version

`v1.0` — Established 2026-06-08. Breaking changes require all existing data migration.
