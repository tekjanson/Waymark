# Notifications — Domain Knowledge

## What This Template Is
A notification or announcement registry where each row is a notification item. The `title` column is the notification headline. The message/body column holds the full text. The `type` column categorizes it (alert, info, warning, success, etc.). Status cycles: Active → Read → Dismissed.

## Valid Status States
```
Active → Read → Dismissed
Active → Dismissed  (direct dismiss without reading)
```
Active = visible and unacknowledged. Read = seen but not dismissed. Dismissed = closed/cleared.

## Smart Operations

### Active Notifications
Find all rows with `status = "Active"`. Return sorted by type priority (Alert/Warning first, then Info):
```
[{type}] {title}: {message}
```
Count: `{N} active notifications`

### Mark as Read
When told to mark a notification read:
- Find by `title` (exact or partial match)
- Set status = "Read"

### Dismiss
When told to dismiss a notification:
- Set status = "Dismissed"

### Bulk Dismiss
"Dismiss all" or "clear all notifications":
- Set status = "Dismissed" for all Active and Read rows
- Report: `Dismissed {N} notifications`

### Adding a Notification
Append a row. Required: `title`, type (default "info"). Optional: message/body, `url`, `icon`.
Status defaults to "Active". `published` date = today if that column exists.

### Notification Audit
Count by status and type:
```
Active:    N  (Alert: N, Warning: N, Info: N)
Read:      N
Dismissed: N
```

### Overdue / Stale Active Notifications
If `published` date exists: find Active notifications older than 7 days.
Report: `⚠️ Stale notification: "{title}" has been active since {date}`

### Type Filter
When asked for all {type} notifications (e.g. "show all warnings"):
- Filter by `type` column (case-insensitive)
- Return title, message, status, date

## Interpretation Rules
- Dismissed notifications are kept for history — do not delete rows
- `url` column may contain a link the notification points to — preserve as-is
- `icon` is a visual hint (emoji, icon name, URL) — preserve as-is, do not validate
- Multiple Active notifications of the same type is normal
- Empty `message`/body means the title is self-explanatory — that's valid
