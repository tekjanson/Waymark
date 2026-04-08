# Photo Gallery — Domain Knowledge

## What This Template Is
A photo catalog or gallery inventory. Each row represents a photo or image asset. The `photo` column typically holds a filename, URL, Google Drive link, or a short reference ID. `title` is the display name. `date` is when the photo was taken or added. `album` is the collection it belongs to. `description` is optional caption or notes.

## Smart Operations

### Album Browser
List all distinct values in the `album` column with count:
```
  {album}: N photos
```
When asked to browse a specific album: filter and show all rows in that album.
```
  Album: {album}
  {title} | {date} | {photo}
  ...
```

### Date Range Filter
When a date range is given, filter rows where `date` falls within the range (inclusive).
Show rows sorted by date ascending:
```
  {date} — {title} [{album}]
```
Accept natural language dates ("last month", "June 2024") and convert to range.

### Adding a Photo Entry
Append a row. Required: `photo` (filename, URL, or reference). Optional: `title` (default: filename), `date` (default: today), `album`, `description`.
Do not fabricate photo URLs or file paths — use exactly what is provided.

### Finding a Photo
Search by:
- Exact `title` match
- Partial `title` match (case-insensitive)
- `album` filter
- `description` keyword

Return: `title`, `date`, `album`, `photo` (the link/reference), `description`.

### Album Summary
When asked for a summary of an album:
```
  Album: {album}
  Photos: N
  Date range: {earliest} → {latest}
  Descriptions: {first few non-empty descriptions, truncated}
```

### Updating a Photo Entry
When told to update title, date, album, or description:
- Find by `photo` reference or exact `title`
- Write only the changed columns

### Removing / Archiving a Photo
Do NOT delete rows without explicit "delete" instruction.
If asked to archive: change `album` to "Archive" (or a provided archive album name).

## Interpretation Rules
- The `photo` column often contains a raw URL or file path — preserve it exactly, never shorten or modify
- Album names are case-sensitive — preserve original casing when writing
- If `date` is empty for existing rows, do not infer or fill it in unless asked
- `description` is free text — no length limit or format requirement
- A blank `album` indicates an uncategorized photo — do not assign an album unless asked
