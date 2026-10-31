---
name: waymark-blog
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Blog template (Content).
---

# Waymark Blog Skill

> Specialized skill for **Blog** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Blog domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `blog` |
| Template Name | Blog |
| Category | Content |
| Interaction Type | `none` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Blog sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. title
2. doc
3. date
4. author
5. category
6. status
```

**Default headers when creating a new Blog sheet:**
```
Title, Doc, Date, Author, Category
```

**Detection signals** — headers that indicate a sheet is a Blog:
```
blog, title, doc, google doc, article, author
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `none` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Blog

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

### Creating a Post Document
When asked to create a blog post (or write / draft content for a post), first create a Google Doc using `waymark_create_doc`:
```
waymark_create_doc(title: "{post title}", body?: "{initial content}", parentFolderId?, shareWith?)
```
- Use the returned `docsUrl` as the value for the `doc` column when adding or updating the sheet row.
- Always create the doc before appending the row so the link is captured immediately.
- If the user only wants to register the post without writing content yet, skip `waymark_create_doc` and leave `doc` blank.

### Adding a Post
Append a row. Required: `title`. Optional: `doc` (the Google Doc URL from `waymark_create_doc`, or any other link provided by the user), `date` (default: today), `author`, `category`.
Never fabricate URLs for `doc` — leave empty if no link is provided and no doc was created.

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
- `doc` is typically a Google Doc URL produced by `waymark_create_doc` — record the exact URL returned
- `date` may be a publish date OR a draft/planned date — do not assume all dated posts are live
- `category` values are free text — do not normalize or rename them unless asked
- A blank `doc` means the post content isn't linked yet — this is normal for drafts
- Multiple posts can have the same `category` — never deduplicate rows

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
Call `waymark_create_sheet({ templateKey: "blog", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Blog headers and initial rows.
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
