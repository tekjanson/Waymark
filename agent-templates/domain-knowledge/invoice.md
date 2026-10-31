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
