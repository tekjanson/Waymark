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
