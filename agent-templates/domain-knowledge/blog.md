# Blog — Domain Knowledge

## What This Template Is
A blog post registry and content index. Each row represents a single blog post or article. The `title` column is the post headline. `doc` is a link (Google Doc URL, Notion link, or file path) to the full post content. `date` is the publish date or draft date. `author` is the writer. `category` is the post topic area or tag.

## Smart Operations

### Post Index
List all posts sorted by `date` descending (newest first):
```
  {date} — {title}
  Author: {author} | Category: {category}
  {doc}
```
If no date, list alphabetically by title.

### Category Filter
When asked to show posts in a category:
- Case-insensitive match on `category`
- Return title, date, author, and doc link for each match

### Author Filter
When asked to show posts by an author:
- Case-insensitive match on `author`
- Return title, date, category, and doc link for each match

### Finding a Post
Search by:
- Exact `title` match
- Partial title keyword (case-insensitive)
- `category` value
- `author` name

Return all matching columns for the row(s) found.

### Adding a Post
Append a row. Required: `title`. Optional: `doc` (may be filled in later), `date` (default: today), `author`, `category`.
Never fabricate URLs for `doc` — leave empty if no link is provided.

### Category Summary
Show distinct categories with post count:
```
  {category}: N posts
```
Sort by count descending.

### Author Summary
Show distinct authors with post count:
```
  {author}: N posts
```

### Recent Posts
When asked for recent posts:
- Sort by `date` descending
- Return top N (default 5) posts with title, date, category

### Updating a Post
When told to update title, doc, date, author, or category:
- Find by exact or partial `title` match
- Write only the specified column(s)

## Interpretation Rules
- `doc` is a raw URL or path — preserve it exactly, never invent or guess it
- `date` may be a publish date OR a draft/planned date — do not assume all dated posts are live
- `category` values are free text — do not normalize or rename them unless asked
- A blank `doc` means the post content isn't linked yet — this is normal for drafts
- Multiple posts can have the same `category` — never deduplicate rows
