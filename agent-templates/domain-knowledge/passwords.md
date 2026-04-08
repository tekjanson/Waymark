# Password Manager — Domain Knowledge

## ⚠️ SECURITY NOTICE
This template contains credentials. Apply strict rules at all times:
- **NEVER log, print, or include passwords in any report, summary, or output**
- **NEVER return password values in responses** — confirm operations without echoing passwords
- **Treat all data in this sheet as sensitive** — do not cache or describe specific credential values
- Only confirm that an operation succeeded (e.g. "Password updated for Site X") — never show the new value

## What This Template Is
A credentials registry where each row is a saved login. The `site` column is the service name or URL. The `username` column is the login identifier. The `password` column is the credential. The `url` column is the sign-in URL. The `category` column groups entries (Work, Personal, Finance, etc.).

## Smart Operations

### Entry Lookup (Safe)
When asked "do I have a login for {site}":
- Search `site` and `url` columns (case-insensitive, partial match)
- Return: site name, username, URL — **NEVER return the password**
- Confirm entry exists: `Found: {site} — Username: {username}`

### Category List
When asked to list entries by category:
- Return: site + username per entry
- **NEVER include passwords in the list**

### Adding an Entry
Append a row. Required: `site`, `username`, `password`. Optional: `url`, `category`.
Confirm: `Entry added for {site}.` — do not echo back the password.

### Updating a Password
Find by site + username. Write new password value.
Confirm: `Password updated for {site}.` — do not echo old or new password.

### Duplicate Detection
Find multiple entries for the same `site`:
- Same site + same username → definite duplicate
- Same site + different username → may be multiple accounts
Report (without passwords): `Duplicate entries for {site}: {N} entries`

### Category Audit
Count entries per category. Report which categories exist and how many entries each has.

### Stale Entries
If a `notes` or `updated` column contains dates, identify entries not touched in >90 days.
Report: `{N} entries may need password rotation (not updated recently)`
**Do not list passwords** — just site names.

### Deleting an Entry
Before deleting: confirm the site name with the user.
Do not delete — instead, add a note "archived" to the `notes` column and move to an "Archived" category.

## Interpretation Rules
- **Every operation involving the password column must suppress the password from all output**
- `site` may be a domain name, app name, or full URL — preserve as-is
- Empty `url` is common — not all entries need a direct login URL
- `username` may be an email address or a username string — preserve exactly as entered
- `category` is user-defined — do not impose categories; use what already exists
