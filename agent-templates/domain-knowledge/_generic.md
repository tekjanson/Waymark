# {{TEMPLATE_NAME}} — Generic Domain Knowledge

## What This Template Is
This domain knowledge block was auto-generated because no hand-authored
`domain-knowledge/{{TEMPLATE_KEY}}.md` file exists yet. The agent can still operate
using the column roles and state machine defined in the agent file. For richer
domain-specific operations, create `agent-templates/domain-knowledge/{{TEMPLATE_KEY}}.md`
and run `agent_invalidate` + `agent_compile` to rebuild.

## General Operations

### Read and Summarize
Read all rows. Count non-empty rows. Group by any column that looks categorical
(limited distinct values, not a free-text field). Report row count and groupings found.

### Add a Row
Append a new row using the default headers as column order.
Required columns are those defined in the `columnRoles` list for this template.
Leave unknown columns empty.

### Update a Cell
Find the row by matching the primary text column.
Write the new value. Verify by re-reading the row.

### State Transitions (if interaction type is status-cycle or toggle)
Only write values that appear in the valid states list.
Advance state by cycling to the next value in the list.
Never write an arbitrary string to a state column.

## Interpretation Rules
- Empty rows are spacers or separators — skip in all counts
- The first column is generally the primary identifier for a row
- Date columns should be read as-is and written in the same format found in the sheet
- Do not invent categorical values — use only values already present in the sheet
