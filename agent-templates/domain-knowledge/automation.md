# Automation — Domain Knowledge

## What This Template Is
A workflow automation registry where each row is a step in a workflow. The `workflow` column groups steps by automation name. The `step` column labels this step. The `action` column describes what the step does. The `target` column is what the action acts on (API, service, object). The `value` column is the payload or parameter. The `status` column cycles through: pending → running → done → failed → skipped.

## Valid Status States
```
pending → running → done
                 ↘ failed → (retry) → running
                 ↘ skipped
```
Only write values from the valid states list. Never write arbitrary status strings.

## Smart Operations

### Workflow Summary
Group rows by `workflow`. For each workflow:
```
{workflow name} ({N} steps)
  pending: N  running: N  done: N  failed: N  skipped: N
```
Flag any workflow with `failed` steps: `⚠️ FAILED: {workflow} — {step} failed`

### Run Status Check
For a given workflow: find all steps not in `done` or `skipped`. These are the pending/blocked steps.
Report what's blocking completion.

### Advancing a Step
When told a step completed or failed:
- Find the row by workflow + step
- Write the new status (must be valid)
- If marking `done` and a next step exists in the workflow, set that step's status to `running`

### Resetting a Workflow
Set all steps in the workflow back to `pending`. Confirm before writing (this clears all progress).

### Failed Step Triage
Find all rows with `status = "failed"`. For each:
- Report: workflow, step name, action, target
- Suggest retry: set status to `pending` to re-queue

### Adding a Step
Append a row. Required: `workflow` (existing or new name), `step` (label), `action`, `target`.
Optional: `value`, status defaults to `pending`.

### Workflow Completion Check
A workflow is complete when all its steps are `done` or `skipped` (none are pending, running, or failed).
Report: `✅ {workflow} complete` or `⏳ {workflow} in progress ({X}% done)`

### Cross-Workflow Dependencies
If `target` of one step matches `workflow` of another (sub-workflow call pattern), identify these dependencies.

## Interpretation Rules
- Empty `value` = the action has no payload (not an error)
- A step stuck in `running` with no recent activity is likely stalled — flag after context suggests delay
- `skipped` is a valid terminal state — skipped steps are intentional bypasses, not errors
- Multiple workflows may have overlapping step names — always identify by workflow + step together
