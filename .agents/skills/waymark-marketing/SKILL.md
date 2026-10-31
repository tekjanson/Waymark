---
name: waymark-marketing
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Content Workbench template (Marketing).
---

# Waymark Content Workbench Skill

> Specialized skill for **Content Workbench** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Content Workbench domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `marketing` |
| Template Name | Content Workbench |
| Category | Marketing |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Content Workbench sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. post
2. platform
3. status
4. topic
5. date
6. likes
7. shares
8. comments
9. views
10. link
11. takeaway
```

**Default headers when creating a new Content Workbench sheet:**
```
Post, Platform, Status, Topic, Posted Date, Likes, Shares, Comments, Views, Link, Takeaway
```

**Detection signals** — headers that indicate a sheet is a Content Workbench:
```
post, content, draft, caption, tweet, platform, channel, likes, shares, comments, views, impressions, engagement, takeaway, lesson
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Idea`
- `Drafting`
- `Ready`
- `Posted`
- `Analyzing`

Flow: `Idea → Drafting → Ready → Posted → Analyzing`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — Content Workbench

# Content Workbench — Domain Knowledge

## What This Template Is
A content marketing tracker where each row is a piece of content (social post, article, video, etc.). The `post` column is the content title or caption. The `platform` column is where it's published (Twitter/X, LinkedIn, Instagram, etc.). Status cycles: Idea → Drafting → Ready → Posted → Analyzing. The `topic` column is the subject area. Engagement columns track performance: `likes`, `shares`, `comments`, `views`.

## Valid Status States
```
Idea → Drafting → Ready → Posted → Analyzing → (back to Idea for repurpose)
```
Only Posted content can have engagement data. Only write valid status values.

## Smart Operations

### Content Pipeline
Group by status. Report:
```
Idea:      N pieces
Drafting:  N pieces
Ready:     N pieces (ready to post)
Posted:    N pieces
Analyzing: N pieces
```
Flag anything stuck in "Ready" for >7 days (if date column exists).

### Platform Breakdown
Group all posts by `platform`. For each:
- Total posts: N (Posted: N, Scheduled/Ready: N)
- Avg engagement if data exists

### Top Performing Content
Sort Posted rows by `likes` (or `views` if likes is empty) descending. Return top 5:
```
{post title} [{platform}]
  Views: {views}  Likes: {likes}  Shares: {shares}  Comments: {comments}
```

### Engagement Summary
For all Posted rows with numeric engagement data:
- Total likes, shares, comments, views
- Average per post
- Best performing platform (highest avg engagement)

### Content Calendar View
If `Posted Date` or a `date` column exists:
- Group Posted content by week or month
- Show publish cadence: `{N} posts published this week`

### Adding a Content Item
Append a row. Required: `post` (title/caption), `platform`, `topic`. Optional: `status` (defaults to "Idea"), `link`.
Engagement columns (likes, shares, comments, views) = 0 or empty until posted.

### Advancing Status
When told to move content to next stage:
- Find by `post` title
- Write next status value
- When moving to "Posted": set `Posted Date` = today if that column exists

### Repurposing Content
When asked to repurpose a Posted item:
- Find the row
- Append a new row with same `post`, different `platform`, status = "Idea"

### Takeaway / Lessons Learned
If a `Takeaway` column exists, it stores post-analysis notes.
When asked to log a takeaway: find the row and write to the Takeaway column.

## Interpretation Rules
- Engagement data (likes, shares, etc.) is only meaningful for Posted items — skip for other statuses
- `platform` values should be preserved as found — do not normalize (Twitter vs X vs Twitter/X)
- Empty engagement cells = 0 for math purposes when the post is in "Posted" status
- Posts in "Analyzing" status are recently Published and awaiting engagement data — do not report them as underperforming yet

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
- For `toggle`, only write `Idea` or `Drafting`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet(title, "marketing", initialEntries?)`
- Creates a sheet with the default Content Workbench headers and initial data.
- Returns `{ spreadsheetId, spreadsheetUrl, title, sheetTitle }`.

### 4.5 Searching Entries
Call `waymark_search_entries(query, "marketing", spreadsheetId?)`
- Searches entries across sheets matching the query.
