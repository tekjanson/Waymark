# Knowledge Base — Domain Knowledge

## What This Template Is
A documentation or wiki repository where each row is an article or knowledge entry. The `title` column is the article name. The `category` column groups articles by topic. The `content` column holds the actual text. The `tags` column has comma-separated keywords. The `author` column identifies who wrote it. Status cycles: Draft → In Review → Published → Archived.

## Valid Status States
```
Draft → In Review → Published → Archived
         ↑ (revision cycle: Published → Draft → In Review → Published)
```
Archived entries are kept for history but no longer active.

## Smart Operations

### Knowledge Index
List all non-archived articles grouped by category:
```
{Category} ({N} articles)
  • {title} [{status}] — {author}, updated {date}
```

### Article Lookup
When asked about a topic or asked to find an article:
- Search `title` column first (exact, then partial)
- Also search `tags` column (comma-split, match individual tags)
- If nothing found, search `content` for the keyword (may be slow — warn if large set)
- Return: title, category, status, author, content summary (first 200 chars)

### Tag Search
When asked for articles tagged with {tag}:
- Split each row's `tags` by comma
- Match tag (case-insensitive, strip whitespace)
- Return matching articles

### Stale Content Detection
If `updated` date column exists:
- Flag articles not Updated in >180 days (6 months) as potentially stale
- Filter to Published articles only
- Report: `⚠️ Possibly outdated: "{title}" — last updated {date}`

### Publishing an Article
When told to publish a draft:
- Find by title
- Set status = "Published"
- Set `updated` = today (if the column exists)

### Archiving
Set status = "Archived". Never delete — archived entries are historical.

### Adding an Article
Append a row. Required: `title`, `content`. Optional: `category`, `tags`, `author`.
Status defaults to "Draft". `updated` = today if the column exists.
Before adding: search for an existing article with the same or very similar title — warn if found.

### Category Summary
Count articles per category and per status. Surface which categories have the most Drafts (backlog of unfinished content) or the most Archived articles.

## Interpretation Rules
- `content` may be long — when displaying, truncate to ~200 chars unless full text is requested
- `tags` is free text — normalize tags to lowercase for comparison but preserve original case for storage
- Empty `author` = anonymous or system-generated
- Archived articles should be excluded from most operations unless the user explicitly asks to include them
- An article in "In Review" should not be modified by the agent — it is awaiting human approval
