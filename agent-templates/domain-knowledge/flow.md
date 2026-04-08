# Flow Diagram — Domain Knowledge

## What This Template Is
A process or workflow definition where each row is a step in a flow. The `flow` column groups steps by flow name (one flow = multiple rows). The `step` column is a label or ID for this node. The `type` column describes the node kind (start, end, decision, action, etc.). The `next` column references the next step's label. The `condition` column holds the branching condition (for decision nodes).

## Node Type Convention Detection
Read existing `type` values. Common conventions:
- start, end, action, decision, loop, trigger, wait, sub-flow
- process, gateway, event, task (BPMN-style)
Preserve the convention already used.

## Smart Operations

### Flow Map Summary
Group rows by `flow`. For each flow:
```
Flow: {flow name}  ({N} steps)
  {step} [{type}] → {next}  [Condition: {condition}]
  ...
```
Identify the start node (type = "start" or first row with no incoming references).
Identify end nodes (type = "end" or `next` is empty).

### Path Trace
When asked "walk me through flow {name}":
- Start from the start node
- Follow `next` references, step by step
- At decision nodes, show both branches (next + condition)
- Stop at end nodes or when a cycle is detected
Report the sequence as a numbered narrative.

### Cycle Detection
Traverse the flow's `next` references. If any step eventually points back to itself (via any path), report:
`⚠️ Cycle detected in flow "{flow}": {step1} → {step2} → ... → {step1}`

### Dead End Detection
Find steps where `next` references a step label that doesn't exist in the sheet:
`⚠️ Broken reference: step "{step}" points to "{next}" which does not exist`

### Adding a Step
Append a row. Required: `flow` (flow name), `step` (unique label), `type`, `next`.
Optional: `condition` (for decision nodes only), `notes`.
After adding: check if any existing step's `next` should now point to this new step.

### Flow List
Return all unique `flow` values with step counts and whether each flow has a valid start and end.

### Decision Node Summary
Find all rows where `type` = "decision" (or gateway/conditional). List them with their conditions and both possible `next` values.

## Interpretation Rules
- A flow with no "start" type node is incomplete — flag it
- `step` values are identifiers — they must be unique within a flow
- `next` may reference steps in the same flow or a different flow (sub-flow call) — distinguish if possible
- `condition` is only meaningful on decision/gateway nodes — ignore it on all other types
- Empty `next` = terminal step (end of flow) — this is valid
