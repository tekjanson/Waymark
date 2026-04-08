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
