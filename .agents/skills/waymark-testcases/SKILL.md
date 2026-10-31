---
name: waymark-testcases
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Test Cases template (Engineering).
---

# Waymark Test Cases Skill

> Specialized skill for **Test Cases** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Test Cases domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `testcases` |
| Template Name | Test Cases |
| Category | Engineering |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Test Cases sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. result
3. expected
4. actual
5. priority
6. notes
```

**Default headers when creating a new Test Cases sheet:**
```
Test Case, Result, Expected, Actual, Priority, Notes
```

**Detection signals** — headers that indicate a sheet is a Test Cases:
```
result, pass, fail, test.status, outcome, verdict, test, case, scenario, expected, actual
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Untested`
- `Pass`
- `Fail`
- `Blocked`
- `Skip`

Flow: `Untested → Pass → Fail → Blocked → Skip`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — Test Cases

# Test Cases — Domain Knowledge

## What This Template Is
A test suite tracker where each row is a test case with a result status. The `result` column cycles through: Untested → Pass → Fail → Blocked → Skip. The `expected` and `actual` columns capture what should happen vs. what did happen. Priority indicates which tests to run first.

## Valid Result States
```
Untested → (run test) → Pass | Fail | Blocked | Skip
Fail     → (fix + rerun)   → Pass | Fail
Blocked  → (unblock)       → Untested | Pass | Fail
Skip     → (re-enable)     → Untested
```
Never write a result value not in the valid states list.

## Smart Operations

### Coverage Summary
Count all rows by result state. Report:
```
Total: N tests
✅ Pass:     N (X%)
❌ Fail:     N (X%)
⚠️ Blocked:  N (X%)
⏭ Skip:     N (X%)
◯  Untested: N (X%)

Coverage: X% tested (Pass + Fail + Skip / Total excluding Untested)
Pass rate: X% (Pass / Total excluding Untested and Blocked)
```

### Failure Triage
List all Fail rows ordered by priority (P0 first). For each:
- Test name, priority, actual value (if available), notes
- Flag P0 failures: `🔴 CRITICAL FAILURE: {test name}`

### Gap Detection
Identify test coverage gaps:
- Group tests by any `feature`, `module`, or `category` column if it exists
- Report modules with zero Pass tests
- Report modules with >50% Untested tests
- Flag: `No tests passing for: {module}`

### Drafting New Test Cases
When asked to add test cases for a feature:
- Generate rows with: test name, expected value, result = "Untested", priority = "P2" unless specified
- Use the naming pattern already present in the sheet (read 3 existing test names first)
- Append at the end of the relevant group if grouping exists

### Bulk Status Update
When asked to mark a set of tests (e.g., "mark all login tests as Pass"):
- Find rows matching the name/group filter
- Write result = "Pass" to each
- Report: `Updated N tests to Pass`

### Reset to Untested
When preparing for a new test run:
- Set result = "Untested" for all Pass, Fail, and Skip rows
- Leave Blocked rows as Blocked (they need manual unblocking)
- Report count reset

## Interpretation Rules
- A test with no `actual` value and result = "Fail" is incomplete — flag it
- `expected` column contains what correct behavior looks like, not a number to compare
- Priority on test cases means run-order importance, not severity (P0 = run first, not most critical)
- Notes subrows below a test row contain tester observations — read them before updating status

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
- For `toggle`, only write `Untested` or `Pass`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet(title, "testcases", initialEntries?)`
- Creates a sheet with the default Test Cases headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "testcases", spreadsheetId?)`
- Searches entries across sheets matching the query.
