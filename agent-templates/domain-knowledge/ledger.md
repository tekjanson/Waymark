# Ledger — Domain Knowledge

## What This Template Is
A double-entry or running-balance accounting ledger where each row records a financial journal entry with date, entry type (`Credit` / `Debit` or `Income` / `Expense`), account category, description, amount, reference/folio code, and optional running balance.

## Column Role Semantics
- `date` — Transaction date (`YYYY-MM-DD`).
- `type` — Entry direction (`Credit`, `Debit`, `Income`, `Expense`, `Transfer`).
- `category` — Chart-of-accounts category (e.g., `Revenue`, `Payroll`, `Operations`, `Software`, `Tax`).
- `text` — Transaction description or memo.
- `amount` — Monetary value (numeric string without currency symbol preferred, e.g. `1250.00`).
- `reference` — Invoice number, receipt ID, check number, or GL folio reference (e.g. `INV-1042`, `JE-009`).
- `balance` — Optional running balance after the transaction.

## Smart Operations

### Running Balance & Reconciliation
- Compute credits minus debits across chronological rows.
- Verify that any explicit `balance` column matches the cumulative sum; flag discrepancies.
- Group totals by `category` and `type` for trial-balance style reporting.

### Adding a Journal Entry
- Required fields: `date` (default to today in `YYYY-MM-DD`), `type`, `category`, `text`, `amount`, and `reference`.
- Preserve existing reference numbering conventions (e.g. `REF-001`, `JE-104`) when generating new entries.
