# Changelog — Domain Knowledge

## What This Template Is
A software version history where each row is a change entry. The `version` column holds a semver or version string (1.2.0, v2.3, etc.). The `date` column holds the release or change date. The `type` column categorizes the change. The `description` column describes what changed.

## Change Type Convention Detection
Read existing `type` values. Common conventions:
- **Standard**: Added, Changed, Fixed, Removed, Deprecated, Security
- **Short**: feat, fix, chore, refactor, docs, style, test, perf
- **Informal**: New, Bug fix, Improvement, Breaking
Preserve the convention already in use when adding entries.

## Smart Operations

### Version Summary
Group rows by `version` column. For each version (newest first), report:
```
## v{version}  ({date})
  [Added]   {description}
  [Fixed]   {description}
  [Breaking] {description}
```
Show how many changes per type across the whole changelog.

### Latest Version
Find the most recent version (by date or by semantic version comparison). Return:
- Version string, date, all entries for that version

### Breaking Changes
Find all rows where `type` = "Breaking" / "BREAKING CHANGE" / similar.
List them: `{version} ({date}): {description}`
This is critical for anyone doing a major upgrade.

### Adding a Changelog Entry
Append a row. Required: `version`, `type`, `description`. Optional: `date` (today if not specified).
Preserve the existing type vocabulary.
Place the entry near other entries of the same version if they exist (seek the version group, append after the last row of that group).

### Since Version
When asked "what changed since v{X}":
- Find all rows with versions newer than the specified version
- Group by version, return in order newest first

### Release Notes Draft
When asked to generate release notes for a version:
- Find all entries for that version
- Group by type
- Format as:
```
### What's New in {version}
**New Features:** ...
**Bug Fixes:** ...
**Breaking Changes:** (if any — highlight prominently)
```

### Security Audit
Find all rows with `type` = "Security" or "security". List them with version and date.
If none, report: `No security fixes recorded in this changelog.`

## Interpretation Rules
- Version ordering: semantic version (1.10.0 > 1.9.0) — do not sort lexicographically
- The same version may appear on multiple rows (one per change) — this is standard practice
- Empty `date` = undated change (common for unreleased/upcoming entries)
- "Unreleased" or "Next" as a version label = upcoming changes not yet shipped
- Do not delete or modify existing changelog entries — they are a historical record
