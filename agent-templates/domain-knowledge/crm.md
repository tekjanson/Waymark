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
