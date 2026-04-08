# OKR / Goals — Domain Knowledge

## What This Template Is
An Objectives and Key Results tracker where each row is a Key Result under an Objective. The `objective` column names the high-level goal (often repeated across multiple rows for the same objective). The `keyResult` column is the specific measurable outcome. The `progress` column is the current value (0–100 or absolute number). The `target` column is the finish line. The `owner` column is the person responsible. The `quarter` column scopes the OKR to a time period.

## Smart Operations

### OKR Summary by Objective
Group rows by `objective`. For each objective:
```
O: {objective name}  [{quarter}]
  KR1: {keyResult} — {progress}/{target} ({X}%) [owner]
  KR2: {keyResult} — {progress}/{target} ({X}%) [owner]
  Objective progress: avg {X}% (N key results)
```
Objective progress = average of all KR completion percentages.

### Overall Health
Report across all objectives:
- Total OKRs: N objectives, M key results
- On track (≥66%): N
- At risk (33–65%): N
- Off track (<33%): N
- Complete (100%): N

### Completion Percentage
For each KR: `min(progress / target × 100, 100)%`
If no `target` column or target is empty, read `progress` as the percentage directly (assume 0–100 scale).

### Quarter Filter
When asked for "Q1" or "Q2 2026" etc.:
- Filter by `quarter` column (partial match OK — "Q1" matches "Q1 2026")
- Return all OKRs in that quarter

### Owner View
When asked what {person} is working on:
- Filter by `owner` column
- Return their KRs grouped by objective

### Updating Progress
When told to update a KR:
- Find by keyResult text (partial match OK within the specified objective)
- Write new `progress` value
- If `progress` reaches or exceeds `target`, note it as complete

### At-Risk Detection
KRs are at risk when:
- Quarter is more than 50% elapsed AND progress < 33%
- Quarter is more than 75% elapsed AND progress < 66%
Flag: `⚠️ At risk: {objective} / {keyResult} — {X}% with {N} weeks left in {quarter}`

### Adding a Key Result
Append a row. Required: `objective` (existing or new), `keyResult`, `target`. Optional: `owner`, `quarter`, `progress` (default 0).

## Interpretation Rules
- The same `objective` text on multiple rows = multiple KRs for that objective — group them
- OKR progress should never exceed 100% in reports even if `progress > target`
- `quarter` may be "Q1", "Q1 2026", "2026-Q1", or similar — preserve the format used; match loosely
- Empty `owner` = unassigned key result — flag it in health reports
- Do not conflate `progress` (current state) with `target` (goal) — they are different columns
