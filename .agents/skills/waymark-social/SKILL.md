---
name: waymark-social
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Social Feed template (Social).
---

# Waymark Social Feed Skill

> Specialized skill for **Social Feed** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Social Feed domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `social` |
| Template Name | Social Feed |
| Category | Social |
| Interaction Type | `inline-edit` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Social Feed sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. text
2. author
3. date
4. category
5. mood
6. link
7. comment
8. likes
9. image
```

**Default headers when creating a new Social Feed sheet:**
```
Post, Author, Date, Category, Mood, Link, Comment, Likes, Image
```

**Detection signals** — headers that indicate a sheet is a Social Feed:
```
post, message, status, update, author, posted.by
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `inline-edit` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Social Feed

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

---

## 4. MCP TOOL OPERATIONS

### 4.1 Reading a Sheet
Call `waymark_get_sheet(spreadsheetId, sheetTitle?)`
- Returns `templateKey`, `columnRoles{}`, and `rows[]` as objects with role-named keys.
- Always resolve columns by role name, not index.

### 4.2 Updating an Existing Row
Call `waymark_update_entry(spreadsheetId, rowIndex, updates, sheetTitle?)`
- `rowIndex` is 1-based data row index (1 = first row under headers).
- `updates` is `{ roleName: newValue }`.
- For `status-cycle`, only write values from the valid states list (§2).
- For `toggle`, only write `done` or ``.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet({ templateKey: "social", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Social Feed headers and initial rows.
- Created under user account via OAuth, automatically shared with service account and editors.
- Returns `{ spreadsheetId, waymarkUrl, sheetsUrl, title, templateKey }`.

### 4.5 Searching Entries & Files
- Search rows in a sheet: Call `waymark_search_entries({ spreadsheetId, query, column? })`.
- Search files in Google Drive: Call `waymark_list_files({ query?, type?: 'all'|'spreadsheet'|'document'|'folder', parentFolderId? })`.
- Share a sheet: Call `waymark_share_sheet({ spreadsheetId, shareWith?, shareWithAnyone?, role? })`.

### 4.6 Document Operations
- Create Google Doc: Call `waymark_create_doc({ title, body?, parentFolderId?, shareWith? })`.
- Read Google Doc: Call `waymark_get_doc({ documentId })`.
- Append to Google Doc: Call `waymark_append_doc({ documentId, text })`.
