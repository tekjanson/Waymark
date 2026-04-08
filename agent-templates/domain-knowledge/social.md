# Social Feed — Domain Knowledge

## What This Template Is
A social media post log or community feed where each row is a post. The `text` column is the post content or title. The `author` column is who posted it. The `date` column is the post timestamp. The `category` column groups posts by topic or type. The `mood` column captures sentiment or tone. Other columns (`link`, `comment`, `likes`, `image`) are engagement metadata.

## Smart Operations

### Recent Feed
Return the N most recent posts (default: 10), sorted by `date` descending:
```
{date} [{category}] {author}: {text}
  Likes: {likes}  Comments: {comment}
```

### Author Feed
When asked for posts by {author}:
- Filter by `author` column (case-insensitive)
- Return chronologically, most recent first
- Summary: `{N} posts by {author}`

### Category / Topic Filter
Filter by `category` column (exact or partial match). Return matching posts with dates and authors.

### Top Posts by Engagement
If `likes` column has numeric data:
- Sort by likes descending
- Return top N posts
- Report: `Most liked: "{text}" by {author} ({likes} likes)`

### Mood / Sentiment Summary
If `mood` column has values, group posts by mood. Report:
```
Mood breakdown: Positive: N, Neutral: N, Negative: N
```
If moods are free-text, list the most common values.

### Adding a Post
Append a row. Required: `text` (post content), `author`. Optional: `date` (today if not supplied), `category`, `mood`, `link`, `image`.
`likes` = 0 by default.

### Link Extraction
When asked "show me all links posted":
- Find rows with non-empty `link` column
- Return: date, author, link, text (post title/context)

### Date Range Filter
Filter posts within a time range. Return count and list.

### Duplicate Detection
Find posts with identical or near-identical `text` from the same `author` within 24 hours.
Report: `Possible duplicate: {post} posted {N} times by {author}`

## Interpretation Rules
- `text` is the post body — it may be long; truncate to 120 chars in summaries
- Empty `author` = anonymous or system post — do not treat as an error
- `likes` may be 0 or empty — treat empty as unknown, not 0, in engagement ranking
- `mood` is free text — do not enforce a vocabulary; read what's there
- Rows without `date` appeared before dating was added — treat them as oldest entries
