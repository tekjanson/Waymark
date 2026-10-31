---
name: waymark-ledger
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Ledger template (Finance).
---

# Waymark Ledger Skill

> Specialized skill for **Ledger** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Ledger domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `ledger` |
| Template Name | Ledger |
| Category | Finance |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Ledger sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. date
2. type
3. category
4. text
5. amount
6. reference
7. balance
```

**Default headers when creating a new Ledger sheet:**
```
Entry, Type, Category, Date, Amount, Counterparty, Reference, Status, TaxCategory, Notes
```

**Detection signals** — headers that indicate a sheet is a Ledger:
```
reference, journal, balance, running balance, type, entry type, gl code, folio
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Ledger

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
Call `waymark_create_sheet({ templateKey: "ledger", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Ledger headers and initial rows.
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
