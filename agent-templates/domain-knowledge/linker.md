# Community Linker — Domain Knowledge

## What This Template Is
A curated link directory where each row is a resource. The `name` column is the link title. The `description` column explains what it is. The `link` column is the URL. The `type` column categorizes it (tool, article, repo, video, community, etc.). The `tags` column has comma-separated keywords. The `icon` column holds an emoji or icon identifier.

## Smart Operations

### Link Directory
Group all entries by `type`. For each type:
```
{Type} ({N} links)
  • {name} — {description}
    {link}
```

### Find a Link
When asked "find a link for {topic}" or "do we have a link to {thing}":
- Search `name` (exact then partial)
- Search `description` (keyword match)
- Search `tags` (split by comma, match individual tags)
- Return: name, description, link, type, tags
- If multiple matches: list all

### Tag Search
Find all entries tagged with {tag}:
- Split `tags` by comma, strip whitespace, match case-insensitively
- Return matching entries with their links

### Adding a Link
Append a row. Required: `name`, `link`. Optional: `description`, `type`, `tags`, `icon`.
Before adding: check for an existing entry with the same URL — warn if found.
`type` should use an existing type value from the sheet if one fits.

### Type Breakdown
Count entries per type. Report: `{type}: {N} links`

### Dead Link Detection
This agent cannot make HTTP requests, so it cannot verify links are live.
When asked to check links: note this limitation and report the full list of links for the user to verify manually.

### Tagging Suggestions
When asked to suggest tags for an entry:
- Read the `name` and `description`
- Suggest 3–5 relevant tags based on the content
- Do not write them unless confirmed by the user

### Exporting
When asked to export the directory:
Format as markdown:
```markdown
## {type}
- [{name}]({link}) — {description}  `{tags}`
```
Group by type, sort alphabetically within each group.

## Interpretation Rules
- `link` must start with http:// or https:// — flag entries with invalid URL format
- `tags` is free text — normalize to lowercase for comparison, preserve original case for storage
- `icon` is optional decoration — it's an emoji or icon name, not a URL
- Entries with empty `link` are placeholders — flag them: `{name} has no URL yet`
- Duplicate links (same URL, different names) may be intentional cross-references — flag but don't auto-remove
