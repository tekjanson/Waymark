# Contacts — Domain Knowledge

## What This Template Is
A people directory where each row is a person. The `name` column is the person's full name. The `email` and `phone` columns are contact methods. The `role` column describes their position, relationship, or title. No interactive state — read-only lookup and organization.

## Smart Operations

### Find a Contact
When asked to look up someone:
- Search `name` column first (exact then fuzzy)
- Also search `role` and `email` if name search returns nothing
- Return: name, role, email, phone (all available columns)
- If multiple matches: list all with distinguishing details

### Role Filter
When asked "show me all {role}":
- Case-insensitive match on `role` column
- Also match partial role names (e.g. "engineer" matches "Senior Engineer")
- Return matching contacts list

### Deduplication Check
Scan for potential duplicates:
- Same email address on multiple rows → definite duplicate
- Very similar name (e.g. "John Smith" and "John A. Smith") + same role → probable duplicate
- Report: `Possible duplicate: {name1} (row {r1}) and {name2} (row {r2})`

### Adding a Contact
Append a row. Required: `name`. Optional but encouraged: `email`, `phone`, `role`.
Before adding: search for existing contact with same name — warn if found.

### Export Format
When asked to format contacts for export or sharing:
```
{name} — {role}
  Email: {email}
  Phone: {phone}
```
Skip empty fields silently.

### Group by Role
Group all contacts by their `role` value. Report:
```
{Role} ({N} people)
  - {name} — {email}
```
Sort roles alphabetically. Contacts with no role go under "Uncategorized".

### Missing Fields Audit
Scan all rows. Report:
- Contacts with no email AND no phone (no way to reach them)
- Contacts with no role
- Count: `{N} contacts have no reachable contact method`

## Interpretation Rules
- Phone numbers should be preserved exactly as entered — do not normalize format
- Email addresses are case-insensitive for lookup but preserve original case for display
- Multiple entries for the same person are not always errors (e.g. work vs. personal)
- `role` is free text — do not impose a controlled vocabulary
- Empty rows are separators — skip in all operations
