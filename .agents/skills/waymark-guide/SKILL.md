---
name: waymark-guide
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Instruction Guide template (Documentation).
---

# Waymark Instruction Guide Skill

> Specialized skill for **Instruction Guide** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Instruction Guide domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `guide` |
| Template Name | Instruction Guide |
| Category | Documentation |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Instruction Guide sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. guide
2. slide
3. objective
4. instruction
5. visual
6. duration
7. status
```

**Default headers when creating a new Instruction Guide sheet:**
```
Guide, Slide, Objective, Instruction, Visual, Duration, Status
```

**Detection signals** — headers that indicate a sheet is a Instruction Guide:
```
guide, slide, objective, instruction, visual, duration
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Draft`
- `In Progress`
- `Ready`
- `Done`

Flow: `Draft → In Progress → Ready → Done`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — Instruction Guide

# Instruction Guide — Domain Knowledge

## What This Template Is
A structured training or how-to guide where each row is a slide or step. The `guide` column groups rows by guide name. The `slide` column numbers or names each slide. The `objective` column states what the learner will achieve. The `instruction` column is the actual instructional content. The `visual` column references an image or diagram. Status cycles: Draft → In Progress → Ready → Done.

## Valid Status States
```
Draft → In Progress → Ready → Done
```
Only write these values. "Ready" means the slide is complete and reviewed. "Done" means the entire guide incorporating this slide has been delivered/published.

## Smart Operations

### Guide Overview
Group rows by `guide`. For each:
```
{guide name} ({N} slides)
  Status: {N} Draft, {N} In Progress, {N} Ready, {N} Done
  Completion: {ready+done}/{total} slides ready
```

### Slide Deck View
When asked to show guide {name}:
- Find all rows for that guide, sorted by `slide`
- Return:
```
Slide {N}: {objective}
  Instruction: {instruction}
  Visual: {visual}
  Status: {status}
```

### Completeness Check
For a given guide, find slides that are missing key fields:
- Empty `objective` → slide has no learning goal
- Empty `instruction` → slide has no content
Report: `Incomplete slide: {guide} slide {N} — missing {fields}`

### Marking a Slide Ready
When told a slide is ready for review:
- Find by guide + slide
- Set status = "Ready"

### Publishing a Guide
When told to mark a guide as done:
- Find all rows for the guide
- Set all Ready slides to "Done"
- Report: `Guide "{name}" published. {N} slides marked Done.`

### Adding a Slide
Append a row. Required: `guide` (existing or new), `slide` (number or label), `objective`, `instruction`.
Optional: `visual`, `duration`. Status defaults to "Draft".

### Duration Summary
If `duration` column has values, sum them for a guide:
`Total runtime: {N} minutes for {guide}`

## Interpretation Rules
- Draft slides are works-in-progress — do not mark them Ready until `instruction` is complete
- `visual` may be a filename, URL, or description — preserve as-is
- `slide` may be a number (1, 2, 3) or a label ("Intro", "Step 1") — preserve the convention used
- A guide with all slides at "Done" is fully published
- Empty `guide` column = continuation row or note for the slide above

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
- For `toggle`, only write `Draft` or `In Progress`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet(title, "guide", initialEntries?)`
- Creates a sheet with the default Instruction Guide headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "guide", spreadsheetId?)`
- Searches entries across sheets matching the query.
