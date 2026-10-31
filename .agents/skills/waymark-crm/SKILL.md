---
name: waymark-crm
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the CRM template (Sales).
---

# Waymark CRM Skill

> Specialized skill for **CRM** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to CRM domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `crm` |
| Template Name | CRM |
| Category | Sales |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for CRM sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. company
2. contact
3. stage
4. value
5. notes
```

**Default headers when creating a new CRM sheet:**
```
Company, Contact, Deal Stage, Value, Notes
```

**Detection signals** — headers that indicate a sheet is a CRM:
```
lead, deal, pipeline, company, value, stage, prospect, opportunity
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Lead`
- `Contacted`
- `Qualified`
- `Proposal`
- `Won`
- `Lost`

Flow: `Lead → Contacted → Qualified → Proposal → Won → Lost`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — CRM

# CRM — Domain Knowledge

## What This Template Is
A sales pipeline where each row is a deal. The `stage` column tracks where a deal is in the sales funnel: Lead → Contacted → Qualified → Proposal → Won → Lost. The `value` column is a monetary amount (the deal size). The `company` and `contact` columns identify who the deal is with.

## Valid Stage Flow
```
Lead → Contacted → Qualified → Proposal → Won
                                        ↘ Lost
```
Won and Lost are terminal states. A deal can move backward (e.g., Qualified → Contacted) if a contact goes cold. Never write a stage not in the valid states list.

## Smart Operations

### Pipeline Summary
Group rows by stage. For each stage report:
- Count of deals
- Total value of deals in that stage
- Output as funnel:
```
Lead:      N deals  ($X total)
Contacted: N deals  ($X total)
Qualified: N deals  ($X total)
Proposal:  N deals  ($X total)
Won:       N deals  ($X total)  ← closed/won
Lost:      N deals  ($X total)  ← closed/lost
```
Win rate = Won / (Won + Lost) × 100%
Pipeline value = sum of all non-terminal deals

### Deal Health / Stalled Detection
A deal is stalled when:
- Stage has not changed (use notes subrows to detect last activity date)
- Lead or Contacted with no notes in >14 days
- Qualified or Proposal with no notes in >7 days
- Report: `⚠️ Stalled: {company} ({stage}) — no activity in ~{N} days`

### Stage Advancing
When asked to advance a deal: read current stage → write next valid stage.
When asked to close as won: set stage = "Won".
When asked to close as lost: set stage = "Lost", prompt for reason to add as note.

### Adding a New Deal
Append a row. Required: company (company role), stage = "Lead". Optional: contact, value, notes. If value not provided, leave blank. Date = today if date column exists.

### Follow-Up List
Return all deals that are NOT in Won or Lost, ordered by stage depth (Proposal first, then Qualified, etc.) — these are the highest-priority follow-ups.

### Value at Risk
Sum the value of all deals in Proposal and Qualified stages. Report:
`Value at risk (not yet won): $X across N deals`

### Won vs Lost Analysis
If both Won and Lost deals exist:
- Average value of Won deals
- Average value of Lost deals
- If Lost deals consistently have higher values, flag it

## Interpretation Rules
- Empty value = deal size unknown, not zero — exclude from monetary calculations
- The `notes` column on the main row is a summary; detailed notes are in subrows
- A deal moved to Lost is not deleted — it stays for historical analysis
- `contact` is a person's name, `company` is the organization — both may exist on the same row

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
- For `toggle`, only write `Lead` or `Contacted`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet(title, "crm", initialEntries?)`
- Creates a sheet with the default CRM headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "crm", spreadsheetId?)`
- Searches entries across sheets matching the query.
