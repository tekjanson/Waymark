# Poll / Survey — Domain Knowledge

## What This Template Is
A voting or survey results sheet where each row is an option/choice. The `text` column is the option label. The `votes` column is a numeric vote count. The `percent` column is the derived percentage (votes / total × 100). The `winner` column flags the winning option (often a checkmark or "winner" on the top row).

## Smart Operations

### Results Summary
Calculate total votes = sum of all `votes` values. For each option:
```
{option}: {votes} votes ({percent}%)
```
Sort by votes descending. Identify the winner (most votes).
Report: `Winner: {option} with {votes} votes ({percent}%)`

### Recalculate Percentages
When vote counts change:
- total = sum of all numeric `votes` values
- For each row: percent = round(votes / total × 100, 1)
- Write updated percent to the `percent` column
- Mark the `winner` column on the row with the highest votes

### Recording a Vote
When told to add a vote for option X:
- Find the row by `text` column (case-insensitive match)
- Increment `votes` by 1
- Recalculate all percentages and winner flag

### Resetting Votes
When asked to reset or start a new poll:
- Set all `votes` to 0
- Set all `percent` to 0 (or empty)
- Clear `winner` column
- Confirm: `Poll reset. {N} options ready to receive votes.`

### Adding an Option
Append a row. Required: `text` (option label). Set `votes` = 0, `percent` = 0.
Recalculate percentages after adding (all existing percentages change).

### Tie Detection
If two or more options share the highest vote count:
- Report: `Tie: {option1} and {option2} both have {N} votes`
- Do not set a winner — or set winner on all tied rows

### Poll Validity Check
Flag if:
- Total votes = 0 (poll hasn't received any votes yet)
- Any `percent` value doesn't match the calculated value → stale percentages, trigger recalculate
- Votes column has non-numeric values

## Interpretation Rules
- `percent` is always derived from `votes` — never treat it as authoritative; always recalculate
- `winner` column may be a checkmark, the word "winner", or just a non-empty value — detect from existing data
- Options with 0 votes are valid and should appear in results (just at 0%)
- The sheet may show ranked results (ordered by votes) or original order — preserve original row order; rank only in reports
