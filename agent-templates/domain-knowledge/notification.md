# Notifications — Domain Knowledge

## Purpose
This template renders a Google Sheet as a structured notification inbox. Each row is one notification alert. Users can filter by status (Active/Read/Dismissed), cycle status by clicking the type badge, and link notifications back to the source sheet that generated them.

The bell icon in the Waymark top bar evaluates each sheet you open and surfaces condition-based alerts (overdue kanban tasks, budget overspend, checklist overdue items, and any custom per-sheet rules you configure). Those alerts are automatically appended to a configured notification sheet in your Waymark directory.

## Schema

| Column   | Role     | Description |
|----------|----------|-------------|
| Title    | title    | Alert headline (required) |
| Message  | message  | Detailed alert body |
| Type     | type     | `alert` / `warning` / `info` / `success` |
| Status   | status   | `Active` / `Read` / `Dismissed` |
| Icon     | icon     | Emoji displayed on the card |
| Priority | priority | `High` / `Medium` / `Low` |
| Created  | created  | ISO timestamp when the alert was generated |
| Expires  | expires  | ISO date — card shows "Expired" and strikes out title after this date |
| Source   | source   | Human-readable origin (e.g. "Kanban Board", "Budget Tracker") |
| Sheet    | sheetRef | Sheet ID of the source sheet — renders an "Open Sheet →" link |

## Detection Signals
A sheet is detected as a Notifications template when headers include **title**, **status**, and **message** (in any order, case-insensitive).

## Default Headers
`Title | Message | Type | Status | Icon | Priority | Created | Expires | Source | Sheet`

## Valid Field Values

### Type
| Value     | Badge color | Meaning |
|-----------|-------------|---------|
| `alert`   | Red         | Critical issue requiring immediate action |
| `warning` | Amber       | Issue worth attention soon |
| `info`    | Blue        | Informational — no action required |
| `success` | Green       | Positive outcome |

### Status lifecycle
`Active` → `Read` → `Dismissed` → (cycles back to `Active`)

Clicking the type badge in the UI cycles the status. The notification bell badge only counts **Active** rows.

### Priority
`High` / `Medium` / `Low` (or `Urgent`, `Critical` map to `High`; `Minor` maps to `Low`)

## Smart Operations

### Add a new notification
Use `waymark_add_entry` with columns: Title, Message, Type, Status, Icon, Priority, Created (ISO timestamp), Source.
```
Title:    🔴 Critical: Production DB down
Message:  Database replication lag exceeded 30s threshold.
Type:     alert
Status:   Active
Icon:     🔴
Priority: High
Created:  2026-04-27T10:00:00
Source:   Monitoring System
```

### Mark a notification as Read
Find the row by Title and Source, set Status to `Read`.

### Dismiss a notification
Set Status to `Dismissed` via `waymark_update_entry` targeting the `status` column.

### Bulk clear: mark all Active as Dismissed
Iterate rows where Status = `Active`, update each to `Dismissed`.

### Link to a source sheet
Set the `Sheet` column to the spreadsheet ID of the source sheet. The template renders an "Open Sheet →" link.

## Notification Bell System

The Waymark notification bell automatically evaluates sheets as you open them:

| Rule key           | Template  | Fires when… |
|--------------------|-----------|-------------|
| `kanbanOverdue`    | kanban    | Tasks have a Due date in the past and are not Done/Archived |
| `kanbanP0`         | kanban    | Active P0-priority tasks exist |
| `budgetOverspend`  | budget    | Expenses exceed income in the sheet |
| `checklistOverdue` | checklist | Items have a Due date in the past and are not done |

**Custom per-sheet rules** can be configured via the overflow menu (⋮) → "Notification rules" on any sheet. These rules persist in localStorage and evaluate on every sheet open.

### Custom Rule Format (localStorage key: `waymark_notification_rules`)
```json
{
  "sheet-017": [
    {
      "id": "abc123",
      "column": "Stage",
      "operator": "equals",
      "value": "Done",
      "notifType": "success",
      "message": "Tasks completed: {count}",
      "enabled": true
    }
  ]
}
```

### Operators available
`equals` | `does not equal` | `contains` | `does not contain` | `greater than` | `less than` | `is before today` | `is after today` | `is empty` | `is not empty`

### Message placeholders
`{count}` → number of matching rows  
`{sheet}` → sheet title

## Building a Notification Stack

To set up a complete notification workflow for a user:

1. **Create or locate a Notifications sheet** — use `waymark_create_sheet` with default headers. Waymark auto-creates one named "Waymark Notifications" in the user's folder on first login.

2. **Connect the bell to the sheet** — the user clicks "📌 Use as Notification Sheet" in the notification template view, or sets `waymark_notif_sheet_id` in localStorage.

3. **Configure built-in rules** — use ⚙️ Settings in the bell panel to toggle kanban/budget/checklist alerts.

4. **Add custom per-sheet rules** — open the source sheet → overflow menu → "Notification rules" → IF column [condition] value THEN [type] message.

5. **Review alerts** — the bell badge shows unread count. Click to open panel. Click any item to navigate to the source sheet.

6. **Archive old alerts** — set Status to `Dismissed`. Dismissed rows show at reduced opacity and can be filtered out.

## Notes
- Expired notifications (Expires column < today) show with strikethrough title.
- In local/test mode (`window.__WAYMARK_LOCAL`) the system does not write to Drive.
- The Notifications template `priority` 22 means it wins over generic/checklist templates but yields to more-specific templates (testcases priority 23, recipe priority 25).
- Multiple notification sheets can exist; only the one stored in `waymark_notif_sheet_id` receives auto-appended alerts.
