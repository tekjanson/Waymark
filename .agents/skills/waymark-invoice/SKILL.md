---
name: waymark-invoice
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Invoice template (Finance).
---

# Waymark Invoice Skill

> Specialized skill for **Invoice** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Invoice domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `invoice` |
| Template Name | Invoice |
| Category | Finance |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Invoice sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. invoice
2. client
3. date
4. due
5. status
6. item
7. qty
8. unitPrice
9. notes
```

**Default headers when creating a new Invoice sheet:**
```
Invoice #, Client, Client Email, Client Address, Issue Date, Due Date, Status, Item, Category, Qty, Unit Price, Tax %, Discount, Notes
```

**Detection signals** — headers that indicate a sheet is a Invoice:
```
invoice, invoice #, quote #, invoice no, client, due date, unit price, qty
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Draft`
- `Sent`
- `Viewed`
- `Paid`
- `Overdue`
- `Cancelled`

Flow: `Draft → Sent → Viewed → Paid → Overdue → Cancelled`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — Invoice

# Invoice — Domain Knowledge

## What This Template Is
A billing and invoicing tracker where rows represent invoice line items or standalone client invoices. Multiple rows sharing the same `invoice` number (`Invoice #`) are grouped into a single printable invoice document in Waymark.

## Column Role Semantics
- `invoice` — Invoice identifier (e.g., `INV-2026-001`). Rows with the same `invoice` value belong to the same invoice.
- `client` — Client or customer name/company.
- `date` — Issue date (`YYYY-MM-DD`).
- `due` — Payment due date (`YYYY-MM-DD`, typically Net 15 or Net 30 from issue date).
- `status` — Lifecycle state (`Draft` → `Sent` → `Viewed` → `Paid` → `Overdue` → `Cancelled`).
- `item` — Line item description / deliverable.
- `qty` — Quantity or hours billed.
- `unitPrice` — Price per unit or hourly rate (line total is `qty * unitPrice`).
- `notes` — Payment terms, PO number, or line-item notes.

## Smart Operations

### Creating or Appending an Invoice
- When creating a multi-line invoice, use the same `invoice`, `client`, `date`, `due`, and `status` across all line-item rows for that invoice.
- Only write valid states (`Draft`, `Sent`, `Viewed`, `Paid`, `Overdue`, `Cancelled`) to `status`.

### Receivables Summary
- Group rows by `invoice`, summing `qty * unitPrice` per invoice.
- Report total billed, total `Paid`, total outstanding (`Sent` + `Viewed`), and total `Overdue`.

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
- For `toggle`, only write `Draft` or `Sent`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet({ templateKey: "invoice", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Invoice headers and initial rows.
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
