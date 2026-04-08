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
