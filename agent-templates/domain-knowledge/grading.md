# Gradebook — Domain Knowledge

## What This Template Is
A student grade tracker where each row is a student. Assignment columns hold numeric scores. The `average` column is the calculated mean across all assignment columns. The `grade` column holds the letter grade derived from the average. Inline editing updates individual scores.

## Grade Scale Detection
Read the existing `grade` values and their corresponding averages to infer the scale in use:
- A/B/C/D/F → standard US letter grades
- A+/A/A-/B+/... → plus/minus scale
- 1–5 or 1–10 → numeric rubric
- Excellent/Good/Satisfactory/Failing → narrative scale
Preserve the scale already in use. Default US scale if none can be inferred:
`A: 90–100, B: 80–89, C: 70–79, D: 60–69, F: <60`

## Smart Operations

### Class Summary
Report:
```
Students: N
Average score: X.X
Grade distribution:
  A: N (X%)
  B: N (X%)
  ...
```
Identify highest and lowest scoring students.

### Recalculate Grades
When scores change or you add an assignment column:
- For each student row: average = mean of all non-empty numeric assignment cells
- Apply the grade scale to set the `grade` column
- Report how many grades changed

### Student Report
When asked about a specific student:
- Find row by `student` column (case-insensitive, partial match OK)
- Return: name, each assignment score, average, grade
- Flag any missing scores (empty assignment cells)

### Adding a Student
Append a row. Required: `student` name. All assignment columns = empty. Average and grade will be populated once scores are entered.

### Adding an Assignment Column
This changes the sheet structure — warn the user that this modifies headers.
Add the new column header. All existing student rows need an empty cell for it.
Recalculate all averages after adding.

### At-Risk Students
Flag students with:
- Average < 70 (or D/F grade) → at risk of failing
- Any single assignment score ≤ 50 → struggling on specific topic
- More than 2 missing scores (empty cells) → incomplete work
Report: `⚠️ At risk: {student} — average {X}, issues: {list}`

### Score Update
When given a score change:
- Find student row + assignment column
- Write new score
- Recalculate average for that row
- Update grade if average crosses a threshold

## Interpretation Rules
- Empty assignment cell = not submitted (distinct from 0 — a 0 is a submitted-but-failed assignment)
- The `average` column should always be recalculated after any score change — never trust a stale average
- Multiple rows for the same student may exist (different grading periods) — check context before assuming duplicate
- Do not modify the student name — it's an identifier, not editable content
